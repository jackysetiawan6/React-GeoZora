-- 03_gameplay_and_matchmaking.sql
-- Gameplay matchmaking queue, match rooms, and match history schema

-- 1. Create Tables
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
  user_id text PRIMARY KEY,
  elo integer NOT NULL,
  status text DEFAULT 'waiting',
  matched_with text,
  room_id text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.match_rooms (
  id text PRIMARY KEY,
  player1_id text,
  player2_id text,
  participants jsonb DEFAULT '[]'::jsonb,
  ready_states jsonb DEFAULT '{}'::jsonb,
  scores jsonb DEFAULT '{}'::jsonb,
  round_submissions jsonb DEFAULT '{}'::jsonb,
  targets jsonb NOT NULL,
  total_rounds integer DEFAULT 10 CONSTRAINT chk_total_rounds CHECK (total_rounds BETWEEN 5 AND 30),
  round_seconds integer DEFAULT 30 CONSTRAINT chk_round_seconds CHECK (round_seconds BETWEEN 20 AND 90),
  no_moving boolean DEFAULT false,
  no_panning boolean DEFAULT false,
  no_zooming boolean DEFAULT false,
  enable_time_multiplier boolean DEFAULT false,
  is_public boolean DEFAULT true,
  mode text DEFAULT 'classic',
  selected_maps jsonb DEFAULT '["world"]'::jsonb,
  player1_score integer DEFAULT 0,
  player2_score integer DEFAULT 0,
  current_round integer DEFAULT 1,
  status text DEFAULT 'waiting',
  winner_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.match_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id text,
  player1_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  player2_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  player1_name text NOT NULL,
  player2_name text,
  player1_score integer NOT NULL,
  player2_score integer NOT NULL,
  winner_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  mode text NOT NULL,
  selected_maps jsonb NOT NULL,
  total_rounds integer NOT NULL,
  round_seconds integer NOT NULL,
  restrictions jsonb,
  player1_elo_change integer,
  player2_elo_change integer,
  player1_exp_gained integer NOT NULL,
  player2_exp_gained integer,
  completed_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;

-- 3. Define RLS Policies (Enforcing Ban Checks)
DROP POLICY IF EXISTS "Authenticated users can read queue" ON public.matchmaking_queue;
CREATE POLICY "Authenticated users can read queue"
  ON public.matchmaking_queue FOR SELECT TO authenticated USING (NOT public.is_current_user_banned());

DROP POLICY IF EXISTS "Users can insert themselves into queue" ON public.matchmaking_queue;
CREATE POLICY "Users can insert themselves into queue"
  ON public.matchmaking_queue FOR INSERT TO authenticated WITH CHECK (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can update their own queue status" ON public.matchmaking_queue;
CREATE POLICY "Users can update their own queue status"
  ON public.matchmaking_queue FOR UPDATE TO authenticated USING (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can delete their own queue entry" ON public.matchmaking_queue;
CREATE POLICY "Users can delete their own queue entry"
  ON public.matchmaking_queue FOR DELETE TO authenticated USING (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Authenticated users can read rooms" ON public.match_rooms;
DROP POLICY IF EXISTS "Participants can read rooms" ON public.match_rooms;
CREATE POLICY "Participants can read rooms"
  ON public.match_rooms FOR SELECT TO authenticated USING (
    NOT public.is_current_user_banned() AND (
      -- Full access for participants
      (auth.uid()::text = player1_id OR 
       auth.uid()::text = player2_id OR 
       participants ? auth.uid()::text)
      OR
      -- Read-only access for public discovery (waiting creator rooms only)
      (is_public = true AND status = 'waiting' AND mode = 'creatorRoom')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can create rooms" ON public.match_rooms;
CREATE POLICY "Authenticated users can create rooms"
  ON public.match_rooms FOR INSERT TO authenticated WITH CHECK (
    auth.uid()::text = player1_id AND 
    NOT public.is_current_user_banned() AND
    (
      mode != 'headToHead' OR EXISTS (
        SELECT 1 FROM public.matchmaking_queue
        WHERE room_id = id
          AND user_id = player1_id
          AND matched_with = player2_id
          AND status = 'matched'
      )
    )
  );

DROP POLICY IF EXISTS "Participants can update rooms" ON public.match_rooms;
CREATE POLICY "Participants can update rooms"
  ON public.match_rooms FOR UPDATE TO authenticated USING (
    (auth.uid()::text = player1_id OR 
     auth.uid()::text = player2_id OR 
     participants ? auth.uid()::text) AND 
    NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Host can delete room" ON public.match_rooms;
CREATE POLICY "Host can delete room"
  ON public.match_rooms FOR DELETE TO authenticated USING (
    auth.uid()::text = player1_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can read their own match history" ON public.match_history;
CREATE POLICY "Users can read their own match history"
  ON public.match_history FOR SELECT TO authenticated USING (
    (auth.uid()::text = player1_id OR auth.uid()::text = player2_id) AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can read all match history for stats" ON public.match_history;
CREATE POLICY "Users can read all match history for stats"
  ON public.match_history FOR SELECT TO authenticated USING (NOT public.is_current_user_banned());

DROP POLICY IF EXISTS "Users can insert match history" ON public.match_history;
CREATE POLICY "Users can insert match history"
  ON public.match_history FOR INSERT TO authenticated WITH CHECK (
    (auth.uid()::text = player1_id OR auth.uid()::text = player2_id) AND NOT public.is_current_user_banned()
  );

-- 4. Global Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matchmaking_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_rooms TO authenticated;
GRANT SELECT, INSERT ON public.match_history TO authenticated;

-- 5. Matchmaking and Room Functions (Extracted to 07_rpc_matchmaking.sql and other RPC files)
-- Enable Realtime for match_rooms
alter publication supabase_realtime add table public.match_rooms;

-- Prevent modifying match targets after match starts
CREATE OR REPLACE FUNCTION public.before_match_room_update()
RETURNS trigger AS $$
DECLARE
  v_idx integer;
  v_old_len integer;
  v_p_id text;
BEGIN
  -- 1. Security check: if updated by a standard client, prevent manual modifications to scores / winner / completed status
  IF current_user IN ('authenticated', 'anon') THEN
    -- If resetting the room to lobby
    IF NEW.status = 'waiting' THEN
      -- Allow resetting everything
      NULL;
    -- If starting the match (transitioning status from waiting to active or playing)
    ELSIF OLD.status = 'waiting' AND (NEW.status = 'active' OR NEW.status = 'playing') THEN
      -- Allow starting, but ensure scores and winner are clean
      NEW.scores := '{}'::jsonb;
      NEW.player1_score := 0;
      NEW.player2_score := 0;
      NEW.winner_id := NULL;
      NEW.round_submissions := '{}'::jsonb;
    ELSE
      -- Discard manual client modifications to scores, player scores
      -- EXCEPT for vsAI mode where the local bot's score is submitted directly from the client.
      IF OLD.mode != 'vsAI' THEN
        NEW.scores := OLD.scores;
        NEW.player1_score := OLD.player1_score;
        NEW.player2_score := OLD.player2_score;
      END IF;
      
      -- Only allow client to modify winner_id when completing the match
      IF NOT (NEW.status = 'completed' AND OLD.status != 'completed') THEN
        NEW.winner_id := OLD.winner_id;
      END IF;
      
      -- Client cannot directly set status to completed (must go through submit_match_guess RPC or have finished all rounds)
      IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'completed' THEN
        IF OLD.mode = 'creatorRoom' OR OLD.mode = 'classic' OR OLD.mode = 'vsAI' OR OLD.current_round >= OLD.total_rounds THEN
          -- Allow setting status to completed
          NULL;
        ELSE
          NEW.status := OLD.status;
        END IF;
      END IF;
    END IF;

    -- 2. Enforce Round Advancement:
    -- Instead of throwing exceptions (which blocks games when players disconnect or are AFK),
    -- we auto-populate a default null guess for any player who hasn't submitted their guess yet.
    IF NEW.current_round IS DISTINCT FROM OLD.current_round AND NEW.current_round = OLD.current_round + 1 THEN
      IF OLD.mode = 'headToHead' THEN
        IF (NEW.round_submissions->(OLD.current_round::text)->OLD.player1_id) IS NULL THEN
          NEW.round_submissions := jsonb_set(
            COALESCE(NEW.round_submissions, '{}'::jsonb),
            ARRAY[OLD.current_round::text, OLD.player1_id],
            '{"score": 0, "guess": null}'::jsonb
          );
        END IF;
        IF OLD.player2_id IS NOT NULL AND (NEW.round_submissions->(OLD.current_round::text)->OLD.player2_id) IS NULL THEN
          NEW.round_submissions := jsonb_set(
            COALESCE(NEW.round_submissions, '{}'::jsonb),
            ARRAY[OLD.current_round::text, OLD.player2_id],
            '{"score": 0, "guess": null}'::jsonb
          );
        END IF;
      ELSIF OLD.mode = 'creatorRoom' THEN
        IF OLD.participants IS NOT NULL AND jsonb_array_length(OLD.participants) > 0 THEN
          FOR v_idx IN 0 .. (jsonb_array_length(OLD.participants) - 1) LOOP
            v_p_id := (OLD.participants->v_idx)::text;
            v_p_id := replace(v_p_id, '"', '');
            IF (NEW.round_submissions->(OLD.current_round::text)->v_p_id) IS NULL THEN
              NEW.round_submissions := jsonb_set(
                COALESCE(NEW.round_submissions, '{}'::jsonb),
                ARRAY[OLD.current_round::text, v_p_id],
                '{"score": 0, "guess": null}'::jsonb
              );
            END IF;
          END LOOP;
        END IF;
      ELSIF OLD.mode = 'classic' THEN
        IF (NEW.round_submissions->(OLD.current_round::text)->OLD.player1_id) IS NULL THEN
          NEW.round_submissions := jsonb_set(
            COALESCE(NEW.round_submissions, '{}'::jsonb),
            ARRAY[OLD.current_round::text, OLD.player1_id],
            '{"score": 0, "guess": null}'::jsonb
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- 3. Prevent modifying match targets after match starts
  IF OLD.status != 'waiting' AND NEW.status != 'waiting' AND NEW.targets IS DISTINCT FROM OLD.targets THEN
    v_old_len := jsonb_array_length(OLD.targets);
    
    IF jsonb_array_length(NEW.targets) < v_old_len THEN
      RAISE EXCEPTION 'Cannot remove or shorten match coordinates (targets) after game starts.';
    END IF;
    
    FOR v_idx IN 0 .. (v_old_len - 1) LOOP
      -- Compare lat and lng coordinates with a small tolerance (1e-5 degrees ~1.1 meters)
      -- to avoid serialization/precision mismatch errors on non-essential properties.
      IF (NEW.targets->v_idx->>'lat') IS NULL OR (OLD.targets->v_idx->>'lat') IS NULL OR
         (NEW.targets->v_idx->>'lng') IS NULL OR (OLD.targets->v_idx->>'lng') IS NULL OR
         ABS((NEW.targets->v_idx->>'lat')::numeric - (OLD.targets->v_idx->>'lat')::numeric) > 0.00001 OR
         ABS((NEW.targets->v_idx->>'lng')::numeric - (OLD.targets->v_idx->>'lng')::numeric) > 0.00001 THEN
        RAISE EXCEPTION 'Cannot modify existing match coordinates (targets) after game starts. Only appending is allowed.';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_before_match_room_update ON public.match_rooms;
CREATE TRIGGER trg_before_match_room_update
  BEFORE UPDATE ON public.match_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.before_match_room_update();

