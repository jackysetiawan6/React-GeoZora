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
    (auth.uid()::text = player1_id OR 
     auth.uid()::text = player2_id OR 
     participants ? auth.uid()::text) AND 
    NOT public.is_current_user_banned()
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

-- 5. Matchmaking and Room Functions

-- Function for host to close a room (delete from match_rooms)
CREATE OR REPLACE FUNCTION public.close_match_room(p_room_id text, p_user_id text)
RETURNS void AS $$
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  DELETE FROM public.match_rooms
  WHERE id = p_room_id AND player1_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.close_match_room(text, text) TO authenticated;

-- Function to cleanup all waiting rooms for a user
CREATE OR REPLACE FUNCTION public.cleanup_user_rooms(p_user_id text)
RETURNS void AS $$
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- 1. Delete rooms where user is host (player1) and room is waiting
  DELETE FROM public.match_rooms
  WHERE player1_id = p_user_id AND status = 'waiting';

  -- 2. Remove user from participants & ready_states in all other waiting rooms they joined as guest
  UPDATE public.match_rooms
  SET participants = participants - p_user_id,
      ready_states = CASE 
        WHEN ready_states IS NOT NULL THEN ready_states - p_user_id
        ELSE '{}'::jsonb
      END,
      player2_id = CASE 
        WHEN player2_id = p_user_id THEN NULL 
        ELSE player2_id 
      END,
      updated_at = now()
  WHERE status = 'waiting' 
    AND (participants ? p_user_id OR player2_id = p_user_id)
    AND player1_id != p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.cleanup_user_rooms(text) TO authenticated;

-- Function to leave matchmaking queue securely
CREATE OR REPLACE FUNCTION public.leave_matchmaking_queue(p_user_id text)
RETURNS void AS $$
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  DELETE FROM public.matchmaking_queue
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.leave_matchmaking_queue(text) TO authenticated;

-- Function to join a match room atomically (for Creator Rooms)
CREATE OR REPLACE FUNCTION public.join_match_room(
  p_room_id text,
  p_user_id text
)
RETURNS boolean AS $$
DECLARE
  v_participants jsonb;
  v_player1_id text;
  v_player2_id text;
  v_status text;
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Get current room details with row-level lock
  SELECT participants, player1_id, player2_id, status
  INTO v_participants, v_player1_id, v_player2_id, v_status
  FROM public.match_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN false; -- Room not found
  END IF;

  IF v_status != 'waiting' THEN
    RETURN false; -- Cannot join active or completed games
  END IF;

  -- Parse/initialize participants list
  IF v_participants IS NULL THEN
    v_participants := '[]'::jsonb;
  END IF;

  -- Add user if not already in participants
  IF NOT (v_participants ? p_user_id) THEN
    -- Check if room is already full (max 30 players limit)
    IF jsonb_array_length(v_participants) >= 30 THEN
      RETURN false;
    END IF;

    v_participants := v_participants || jsonb_build_array(p_user_id);
    
    -- Handle 1v1 legacy support
    IF v_player2_id IS NULL AND jsonb_array_length(v_participants) = 2 AND v_player1_id != p_user_id THEN
      v_player2_id := p_user_id;
    END IF;

    UPDATE public.match_rooms
    SET participants = v_participants,
        player2_id = v_player2_id,
        updated_at = now()
    WHERE id = p_room_id;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.join_match_room(text, text) TO authenticated;

-- Function to leave a match room atomically (for Creator Rooms)
CREATE OR REPLACE FUNCTION public.leave_match_room(
  p_room_id text,
  p_user_id text
)
RETURNS boolean AS $$
DECLARE
  v_participants jsonb;
  v_ready_states jsonb;
  v_player1_id text;
  v_player2_id text;
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Get current room details with row-level lock
  SELECT participants, ready_states, player1_id, player2_id
  INTO v_participants, v_ready_states, v_player1_id, v_player2_id
  FROM public.match_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF v_participants IS NULL THEN
    RETURN false;
  END IF;

  -- If user is the host (player1), we should close the room entirely
  IF v_player1_id = p_user_id THEN
    DELETE FROM public.match_rooms WHERE id = p_room_id;
    RETURN true;
  END IF;

  -- Otherwise, remove player from participants and ready_states
  IF v_participants ? p_user_id THEN
    v_participants := v_participants - p_user_id;
    
    IF v_ready_states IS NOT NULL THEN
      v_ready_states := v_ready_states - p_user_id;
    END IF;

    -- Update player2_id if they were the player2
    IF v_player2_id = p_user_id THEN
      v_player2_id := NULL;
    END IF;

    UPDATE public.match_rooms
    SET participants = v_participants,
        ready_states = COALESCE(v_ready_states, '{}'::jsonb),
        player2_id = v_player2_id,
        updated_at = now()
    WHERE id = p_room_id;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.leave_match_room(text, text) TO authenticated;

-- Function to update player ready status (for Creator Rooms)
CREATE OR REPLACE FUNCTION public.set_player_ready(
  p_room_id text,
  p_user_id text,
  p_is_ready boolean
)
RETURNS jsonb AS $$
DECLARE
  v_ready_states jsonb;
  v_updated_room jsonb;
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Ensure the user is in the room's participants
  IF NOT EXISTS (
    SELECT 1 FROM public.match_rooms
    WHERE id = p_room_id AND (player1_id = p_user_id OR player2_id = p_user_id OR participants ? p_user_id)
  ) THEN
    RAISE EXCEPTION 'User is not a participant of this room';
  END IF;

  -- Get current ready states with row-level lock
  SELECT COALESCE(ready_states, '{}'::jsonb) INTO v_ready_states
  FROM public.match_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  -- Set/update the key for this user
  v_ready_states := jsonb_set(v_ready_states, ARRAY[p_user_id], to_jsonb(p_is_ready));

  -- Update database row
  UPDATE public.match_rooms
  SET ready_states = v_ready_states,
      updated_at = now()
  WHERE id = p_room_id;

  -- Select and return updated room row as jsonb
  SELECT row_to_json(r)::jsonb INTO v_updated_room
  FROM public.match_rooms r
  WHERE r.id = p_room_id;

  RETURN v_updated_room;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_player_ready(text, text, boolean) TO authenticated;

-- Function to kick a participant from a creator room (updated to clean up ready_states)
CREATE OR REPLACE FUNCTION public.kick_participant_from_room(
  p_room_id text,
  p_kicked_user_id text,
  p_host_id text
)
RETURNS boolean AS $$
DECLARE
  v_room_host text;
  v_participants jsonb;
  v_ready_states jsonb;
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Verify the caller is the host
  SELECT player1_id INTO v_room_host
  FROM public.match_rooms
  WHERE id = p_room_id;

  IF v_room_host IS NULL THEN
    RETURN false; -- Room not found
  END IF;

  IF v_room_host != p_host_id AND v_room_host != auth.uid()::text THEN
    RETURN false; -- Not authorized
  END IF;

  -- Get current participants and ready states
  SELECT participants, ready_states INTO v_participants, v_ready_states
  FROM public.match_rooms
  WHERE id = p_room_id;

  -- Remove the kicked user from participants array and ready_states jsonb
  UPDATE public.match_rooms
  SET participants = v_participants - p_kicked_user_id,
      ready_states = COALESCE(ready_states - p_kicked_user_id, '{}'::jsonb),
      updated_at = now()
  WHERE id = p_room_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.kick_participant_from_room(text, text, text) TO authenticated;

-- Function to find a matchmaking opponent matching ELO range
CREATE OR REPLACE FUNCTION public.find_match(p_user_id text, p_elo integer, p_range integer)
RETURNS TABLE (new_room_id text, matched_user_id text, matched_elo integer) AS $$
DECLARE
  v_opponent RECORD;
  v_room_id text;
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Ensure the calling player is still waiting in the queue
  IF NOT EXISTS (
    SELECT 1 FROM public.matchmaking_queue
    WHERE user_id = p_user_id AND status = 'waiting'
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_opponent
  FROM public.matchmaking_queue
  WHERE user_id != p_user_id
    AND status = 'waiting'
    AND elo >= (p_elo - p_range)
    AND elo <= (p_elo + p_range)
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    v_room_id := gen_random_uuid()::text;

    UPDATE public.matchmaking_queue
    SET status = 'matched', matched_with = p_user_id, room_id = v_room_id
    WHERE user_id = v_opponent.user_id;

    UPDATE public.matchmaking_queue
    SET status = 'matched', matched_with = v_opponent.user_id, room_id = v_room_id
    WHERE user_id = p_user_id;

    RETURN QUERY SELECT v_room_id, v_opponent.user_id, v_opponent.elo;
  ELSE
    RETURN;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.find_match(text, integer, integer) TO authenticated;

-- Function to find a room securely by code from the server side
CREATE OR REPLACE FUNCTION public.find_room_by_code(p_code text)
RETURNS SETOF public.match_rooms AS $$
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.match_rooms
  WHERE status = 'waiting'
    AND UPPER(id) LIKE UPPER(p_code) || '%'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.find_room_by_code(text) TO authenticated, anon;

-- Function to atomically increment player stats and protect from banned users
CREATE OR REPLACE FUNCTION public.increment_player_stats(
  p_user_id text,
  p_exp_gain integer,
  p_elo_change integer,
  p_avg_score double precision,
  p_room_id text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_is_banned boolean;
  v_res jsonb;
  v_room_status text;
  v_participants jsonb;
  v_player1_id text;
  v_player2_id text;
  v_mode text;
  v_expected_exp integer;
  v_expected_elo_change integer;
  v_actual_result text;
  v_scores jsonb;
  v_p1_score integer;
  v_p2_score integer;
  v_user_score integer;
  v_opp_score integer;
  v_opp_elo integer;
  v_user_elo integer;
  v_targets jsonb;
BEGIN
  IF p_user_id <> auth.uid()::text THEN
    RAISE EXCEPTION 'Unauthorized stats update request.';
  END IF;

  -- Check if banned
  SELECT is_banned INTO v_is_banned FROM public.profiles WHERE id = p_user_id;
  IF v_is_banned = true THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Enforce p_room_id requirement for ELO modifications
  IF p_room_id IS NULL AND p_elo_change != 0 THEN
    RAISE EXCEPTION 'p_room_id is required for ELO modifications.';
  END IF;

  -- Validation if room ID is provided (Head-to-Head, Creator Rooms, and Classic)
  IF p_room_id IS NOT NULL THEN
    SELECT status, participants, player1_id, player2_id, mode, scores, player1_score, player2_score, targets
    INTO v_room_status, v_participants, v_player1_id, v_player2_id, v_mode, v_scores, v_p1_score, v_p2_score, v_targets
    FROM public.match_rooms
    WHERE id = p_room_id;

    IF v_room_status IS NULL THEN
      RAISE EXCEPTION 'Room not found.';
    END IF;

    IF v_room_status != 'completed' THEN
      RAISE EXCEPTION 'Cannot claim stats for an incomplete match.';
    END IF;

    -- Verify user is participant
    IF NOT (v_participants ? p_user_id OR v_player1_id = p_user_id OR v_player2_id = p_user_id) THEN
      RAISE EXCEPTION 'User is not a participant of this room.';
    END IF;

    -- Verify ELO and EXP calculations server-side for Head-to-Head
    IF v_mode = 'headToHead' THEN
      -- Get scores of both players
      v_user_score := COALESCE((v_scores->>p_user_id)::integer, 0);
      
      -- Identify opponent
      IF v_player1_id = p_user_id THEN
        v_opp_score := COALESCE((v_scores->>v_player2_id)::integer, 0);
        SELECT elo INTO v_opp_elo FROM public.profiles WHERE id = v_player2_id;
      ELSE
        v_opp_score := COALESCE((v_scores->>v_player1_id)::integer, 0);
        SELECT elo INTO v_opp_elo FROM public.profiles WHERE id = v_player1_id;
      END IF;

      SELECT elo INTO v_user_elo FROM public.profiles WHERE id = p_user_id;
      
      -- ELO K = 32
      IF v_user_score > v_opp_score THEN
        v_actual_result := 'win';
      ELSIF v_user_score < v_opp_score THEN
        v_actual_result := 'loss';
      ELSE
        v_actual_result := 'draw';
      END IF;

      -- Check expected elo change
      DECLARE
        expected_prob double precision;
        actual_val double precision;
      BEGIN
        expected_prob := 1.0 / (1.0 + power(10.0, (v_opp_elo - v_user_elo) / 400.0));
        IF v_actual_result = 'win' THEN actual_val := 1.0;
        ELSIF v_actual_result = 'draw' THEN actual_val := 0.5;
        ELSE actual_val := 0.0;
        END IF;
        v_expected_elo_change := round(32.0 * (actual_val - expected_prob));
      END;

      IF ABS(p_elo_change - v_expected_elo_change) > 2 THEN
        RAISE EXCEPTION 'ELO calculation mismatch. Client: %, Expected: %', p_elo_change, v_expected_elo_change;
      END IF;

      -- Check expected exp gain (EXP_H2H_WIN=100, EXP_H2H_DRAW=60, EXP_H2H_LOSS=30, EXP_SCORE_DIV=100)
      v_expected_exp := (CASE 
        WHEN v_actual_result = 'win' THEN 100 
        WHEN v_actual_result = 'draw' THEN 60 
        ELSE 30 
      END) + floor(v_user_score / 100);

      IF p_exp_gain != v_expected_exp THEN
        RAISE EXCEPTION 'EXP calculation mismatch. Client: %, Expected: %', p_exp_gain, v_expected_exp;
      END IF;
      
    ELSIF v_mode = 'creatorRoom' THEN
      -- Creator rooms don't modify ELO
      IF p_elo_change != 0 THEN
        RAISE EXCEPTION 'ELO change is not permitted in Creator Rooms.';
      END IF;

      -- Verify EXP calculations (EXP_H2H_WIN=100, EXP_H2H_DRAW=60, EXP_H2H_LOSS=30)
      -- Find user rank/result by iterating over actual participants list
      DECLARE
        v_max_score integer := -1;
        v_max_count integer := 0;
        r_p_id text;
        v_p_score integer;
      BEGIN
        IF v_participants IS NOT NULL AND jsonb_array_length(v_participants) > 0 THEN
          FOR v_idx IN 0 .. (jsonb_array_length(v_participants) - 1) LOOP
            r_p_id := (v_participants->v_idx)::text;
            r_p_id := replace(r_p_id, '"', '');
            
            -- Get score, default to 0 if not present in scores json
            v_p_score := COALESCE((v_scores->>r_p_id)::integer, 0);
            
            IF v_p_score > v_max_score THEN
              v_max_score := v_p_score;
              v_max_count := 1;
            ELSIF v_p_score = v_max_score THEN
              v_max_count := v_max_count + 1;
            END IF;
          END LOOP;
        ELSE
          v_max_score := 0;
          v_max_count := 1;
        END IF;

        v_user_score := COALESCE((v_scores->>p_user_id)::integer, 0);

        IF v_user_score = v_max_score THEN
          IF v_max_count > 1 THEN
            v_actual_result := 'draw';
          ELSE
            v_actual_result := 'win';
          END IF;
        ELSE
          v_actual_result := 'loss';
        END IF;

        v_expected_exp := (CASE 
          WHEN v_actual_result = 'win' THEN 100 
          WHEN v_actual_result = 'draw' THEN 60 
          ELSE 30 
        END) + floor(v_user_score / 100);

        IF p_exp_gain != v_expected_exp THEN
          RAISE EXCEPTION 'EXP calculation mismatch. Client: %, Expected: %', p_exp_gain, v_expected_exp;
        END IF;
      END;
      
    ELSIF v_mode = 'classic' THEN
      -- Classic solo mode backing room checks
      IF p_elo_change != 0 THEN
        RAISE EXCEPTION 'ELO changes are not permitted in Classic Mode.';
      END IF;
      
      v_user_score := COALESCE((v_scores->>p_user_id)::integer, 0);
      -- Classic EXP calculation: EXP_CLASSIC = 50 + bonus
      v_expected_exp := 50 + floor(v_user_score / 100);

      IF p_exp_gain != v_expected_exp THEN
        RAISE EXCEPTION 'EXP calculation mismatch for Classic Mode. Client: %, Expected: %', p_exp_gain, v_expected_exp;
      END IF;
    END IF;

  END IF;

  UPDATE public.profiles
  SET exp = COALESCE(exp, 0) + p_exp_gain,
      elo = GREATEST(0, COALESCE(elo, 1300) + p_elo_change),
      games_played = COALESCE(games_played, 0) + 1,
      last_avg_score = p_avg_score,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING jsonb_build_object(
    'id', id,
    'exp', exp,
    'elo', elo,
    'last_avg_score', last_avg_score,
    'games_played', games_played
  ) INTO v_res;

  -- Log to exp_history
  IF p_exp_gain > 0 THEN
    INSERT INTO public.exp_history (user_id, exp_gained)
    VALUES (p_user_id, p_exp_gain);
  END IF;

  RETURN v_res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_player_stats(text, integer, integer, double precision, text) TO authenticated, anon;

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
      NEW.scores := OLD.scores;
      NEW.player1_score := OLD.player1_score;
      NEW.player2_score := OLD.player2_score;
      
      -- Only allow client to modify winner_id when completing the match
      IF NOT (NEW.status = 'completed' AND OLD.status != 'completed') THEN
        NEW.winner_id := OLD.winner_id;
      END IF;
      
      -- Client cannot directly set status to completed (must go through submit_match_guess RPC or have finished all rounds)
      IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'completed' THEN
        IF OLD.mode = 'creatorRoom' OR OLD.mode = 'classic' OR OLD.current_round >= OLD.total_rounds THEN
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

