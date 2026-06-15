-- 05_anti_cheat_and_telemetry.sql
-- Anti-Cheat, Telemetry Logging, and Secure Score Verification

-- 1. Create the Cheat Logs Table
CREATE TABLE IF NOT EXISTS public.cheat_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text REFERENCES public.profiles(id) ON DELETE CASCADE,
  username text NOT NULL,
  reason text NOT NULL,
  severity text DEFAULT 'warning', -- 'warning', 'suspicious', 'ban_auto'
  telemetry_details jsonb, -- Stores user pathing, tab blurs, speed, etc.
  round_index integer,
  room_id text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security on cheat_logs
ALTER TABLE public.cheat_logs ENABLE ROW LEVEL SECURITY;

-- 2. Set up Policies for cheat_logs
DROP POLICY IF EXISTS "Admins can view cheat logs" ON public.cheat_logs;
CREATE POLICY "Admins can view cheat logs"
  ON public.cheat_logs FOR SELECT TO authenticated
  USING (public.is_current_user_admin());

DROP POLICY IF EXISTS "System can insert cheat logs" ON public.cheat_logs;
CREATE POLICY "System can insert cheat logs"
  ON public.cheat_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

GRANT SELECT, INSERT ON public.cheat_logs TO authenticated;

-- 3. Score & Admin Functions (Extracted to 06_rpc_gameplay.sql and 09_rpc_maintenance_utilities.sql)
