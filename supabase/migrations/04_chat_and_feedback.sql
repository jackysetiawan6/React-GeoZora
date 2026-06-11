-- 04_chat_and_feedback.sql
-- In-game chat messaging and feedback reporting schema

-- 1. Create Tables
CREATE TABLE IF NOT EXISTS public.room_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id text REFERENCES public.match_rooms(id) ON DELETE CASCADE,
  user_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  username text NOT NULL,
  avatar_url text,
  content text NOT NULL,
  is_system boolean DEFAULT false,
  message_type text DEFAULT 'text',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  edited_at timestamp with time zone,
  is_deleted boolean DEFAULT false,
  reactions jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.feedbacks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  player_name text,
  type text NOT NULL, -- 'feedback' or 'report'
  message text NOT NULL,
  details jsonb, -- e.g., { lat, lng, round, mode }
  status text DEFAULT 'open', -- 'open', 'acknowledged', 'done'
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_room_messages_room_created ON public.room_messages(room_id, created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

-- 4. Define RLS Policies (Enforcing Ban Checks)
DROP POLICY IF EXISTS "Users can read room messages" ON public.room_messages;
CREATE POLICY "Users can read room messages"
  ON public.room_messages FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.match_rooms mr
      WHERE mr.id = room_messages.room_id
        AND (mr.player1_id = auth.uid()::text 
             OR mr.player2_id = auth.uid()::text 
             OR mr.participants ? auth.uid()::text)
    ) AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can insert their own messages" ON public.room_messages;
CREATE POLICY "Users can insert their own messages"
  ON public.room_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid()::text = user_id 
    AND EXISTS (
      SELECT 1 FROM public.match_rooms mr
      WHERE mr.id = room_messages.room_id
        AND (mr.player1_id = auth.uid()::text 
             OR mr.player2_id = auth.uid()::text 
             OR mr.participants ? auth.uid()::text)
    ) AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can update own messages" ON public.room_messages;
CREATE POLICY "Users can update own messages"
  ON public.room_messages FOR UPDATE TO authenticated
  USING (
    (
      auth.uid()::text = user_id OR EXISTS (
        SELECT 1
        FROM public.match_rooms mr
        WHERE mr.id = room_messages.room_id
          AND mr.player1_id = auth.uid()::text
      )
    ) AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can create feedbacks" ON public.feedbacks;
CREATE POLICY "Users can create feedbacks"
  ON public.feedbacks FOR INSERT TO authenticated WITH CHECK (
    (user_id IS NULL OR auth.uid()::text = user_id) AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can read own feedbacks and admins can read all" ON public.feedbacks;
CREATE POLICY "Users can read own feedbacks and admins can read all"
  ON public.feedbacks FOR SELECT TO authenticated USING (
    (auth.uid()::text = user_id AND NOT public.is_current_user_banned()) OR 
    public.is_current_user_admin()
  );

DROP POLICY IF EXISTS "Admins can update feedbacks" ON public.feedbacks;
CREATE POLICY "Admins can update feedbacks"
  ON public.feedbacks FOR UPDATE TO authenticated USING (
    public.is_current_user_admin()
  );

DROP POLICY IF EXISTS "Admins can delete feedbacks" ON public.feedbacks;
CREATE POLICY "Admins can delete feedbacks"
  ON public.feedbacks FOR DELETE TO authenticated USING (
    public.is_current_user_admin()
  );

-- 5. Global Grants
GRANT SELECT, INSERT, UPDATE ON public.room_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedbacks TO authenticated;

-- 6. Helper Functions

-- Function for system messages insertion
CREATE OR REPLACE FUNCTION public.insert_system_message(
  p_room_id text,
  p_message text
) RETURNS void AS $$
BEGIN
  INSERT INTO public.room_messages (
    room_id, user_id, username, content, is_system, message_type
  ) VALUES (
    p_room_id, NULL, 'System', p_message, true, 'system'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.insert_system_message(text, text) TO authenticated;

-- Function to get active players count safely (anon or authenticated)
CREATE OR REPLACE FUNCTION public.get_active_players_count()
RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM public.profiles
  WHERE online_status = true
    AND last_seen >= (now() - interval '15 minutes');
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_active_players_count() TO anon, authenticated;

-- Enable Realtime for room_messages
alter publication supabase_realtime add table public.room_messages;

