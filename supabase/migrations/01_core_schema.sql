-- 01_core_schema.sql
-- Core User Profiles, Progression Stats, Banning System, and Logging Schema

-- 1. Create Core Tables
CREATE TABLE IF NOT EXISTS public.profiles (
  id text PRIMARY KEY,
  display_name text,
  email text,
  theme_preference text DEFAULT 'dark',
  distance_metric text DEFAULT 'km',
  map_preference text DEFAULT 'roadmap',
  is_admin boolean DEFAULT false,
  avatar_url text,
  exp integer DEFAULT 0,
  elo integer DEFAULT 1300,
  last_avg_score double precision DEFAULT 0,
  online_status boolean DEFAULT false,
  games_played integer DEFAULT 0,
  is_banned boolean DEFAULT false,
  ban_reason text DEFAULT NULL,
  ban_timestamp timestamp with time zone DEFAULT NULL,
  last_seen timestamp with time zone DEFAULT timezone('utc'::text, now()),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.exp_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text REFERENCES public.profiles(id) ON DELETE CASCADE,
  exp_gained integer NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL,
  details jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 3. Core Auth & Banning Helper Functions (Security Definer to bypass RLS)
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()::text),
    false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_current_user_banned()
RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(
    (SELECT is_banned FROM public.profiles WHERE id = auth.uid()::text),
    false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_banned() TO authenticated, anon;

-- 4. Define Core Table RLS Policies
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT USING (
    (auth.uid()::text = id) OR
    (NOT public.is_current_user_banned() AND NOT is_banned) OR
    public.is_current_user_admin()
  );

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid()::text = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (
    auth.uid()::text = id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can delete their own profile" ON public.profiles;
CREATE POLICY "Users can delete their own profile"
  ON public.profiles FOR DELETE TO authenticated USING (
    auth.uid()::text = id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "exp_history is viewable by authenticated users" ON public.exp_history;
CREATE POLICY "exp_history is viewable by authenticated users"
  ON public.exp_history FOR SELECT TO authenticated USING (NOT public.is_current_user_banned());


DROP POLICY IF EXISTS "Users can delete their own exp_history" ON public.exp_history;
CREATE POLICY "Users can delete their own exp_history"
  ON public.exp_history FOR DELETE TO authenticated USING (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT TO authenticated USING (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can insert their own notifications" ON public.notifications;
CREATE POLICY "Users can insert their own notifications"
  ON public.notifications FOR INSERT TO authenticated WITH CHECK (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE TO authenticated USING (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;
CREATE POLICY "Users can delete their own notifications"
  ON public.notifications FOR DELETE TO authenticated USING (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can view their own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can view their own activity_logs"
  ON public.activity_logs FOR SELECT TO authenticated USING (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

DROP POLICY IF EXISTS "Users can insert their own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can insert their own activity_logs"
  ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (
    auth.uid()::text = user_id AND NOT public.is_current_user_banned()
  );

-- 5. Global Grants
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.exp_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;

-- 6. Revoke update privileges on profiles stats/admin/banning fields
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (
  id,
  email,
  avatar_url, 
  theme_preference, 
  distance_metric, 
  map_preference, 
  online_status, 
  last_seen, 
  updated_at
) ON public.profiles TO authenticated;

-- 7. Helper Functions & Triggers

DROP FUNCTION IF EXISTS public.sync_profile(uuid, text, text);
CREATE OR REPLACE FUNCTION public.sync_profile(
  p_user_id uuid,
  p_email text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_name text;
  v_email text;
  v_avatar text;
  v_exists boolean;
  v_count integer := 0;
  v_res jsonb;
BEGIN
  -- Check if profile already exists
  SELECT display_name, email, avatar_url INTO v_name, v_email, v_avatar 
  FROM public.profiles 
  WHERE id = p_user_id::text;
  
  IF v_name IS NOT NULL THEN
    -- DETECT TRANSITION: Guest converting to Google/Linked account
    IF v_email IS NULL AND p_email IS NOT NULL THEN
      UPDATE public.profiles
      SET email = p_email,
          -- Replace Guest display name with real Google display name
          display_name = CASE 
            WHEN (display_name LIKE 'Guest #%' OR display_name = 'Guest' OR display_name = '') AND p_display_name IS NOT NULL THEN p_display_name 
            ELSE display_name 
          END,
          -- Replace empty or generic avatar with Google avatar
          avatar_url = COALESCE(avatar_url, p_avatar_url),
          last_seen = now(),
          updated_at = now()
      WHERE id = p_user_id::text
      RETURNING jsonb_build_object('display_name', display_name) INTO v_res;
      
      RETURN v_res;
    END IF;

    -- Normalize legacy guest names so anonymous users do not stay stuck on plain "Guest"
    IF p_email IS NULL AND (v_name = 'Guest' OR v_name = '' OR v_name IS NULL) THEN
      LOOP
        v_name := 'Guest #' || (floor(random() * (999999-100000+1)) + 100000)::text;
        SELECT EXISTS(SELECT 1 FROM public.profiles WHERE display_name = v_name) INTO v_exists;
        EXIT WHEN NOT v_exists;
        v_count := v_count + 1;
        IF v_count > 10 THEN
          v_name := 'Guest #' || (extract(epoch FROM now())::bigint % 1000000)::text || '-' || substring(p_user_id::text, 1, 6);
          EXIT;
        END IF;
      END LOOP;

      UPDATE public.profiles
      SET display_name = v_name,
          last_seen = now(),
          updated_at = now()
      WHERE id = p_user_id::text;

      RETURN jsonb_build_object('display_name', v_name);
    END IF;

    -- Update last seen and just return existing name
    UPDATE public.profiles
    SET last_seen = now(), updated_at = now()
    WHERE id = p_user_id::text;
    RETURN jsonb_build_object('display_name', v_name);
  END IF;

  -- New profile logic
  v_name := p_display_name;

  -- If it's a guest or name is missing, generate a unique random 6-digit Guest ID
  IF p_email IS NULL OR v_name IS NULL OR v_name = '' THEN
    LOOP
      v_name := 'Guest #' || (floor(random() * (999999-100000+1)) + 100000)::text;
      SELECT EXISTS(SELECT 1 FROM public.profiles WHERE display_name = v_name) INTO v_exists;
      IF NOT v_exists THEN
        EXIT;
      END IF;
      v_count := v_count + 1;
      IF v_count > 10 THEN
        -- Fallback to timestamp-based suffix to avoid infinite loop
        v_name := 'Guest #' || (extract(epoch FROM now())::bigint % 1000000)::text || '-' || substring(p_user_id::text, 1, 6);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, avatar_url, updated_at, last_seen)
  VALUES (p_user_id::text, p_email, COALESCE(v_name, 'New User'), p_avatar_url, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = CASE 
      WHEN p_email IS NOT NULL THEN EXCLUDED.display_name 
      ELSE profiles.display_name 
    END,
    avatar_url = COALESCE(profiles.avatar_url, EXCLUDED.avatar_url),
    updated_at = now(),
    last_seen = now()
  RETURNING jsonb_build_object('display_name', display_name) INTO v_res;

  RETURN v_res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.sync_profile(uuid, text, text, text) TO authenticated;

-- Function for a guest to delete their own profile
CREATE OR REPLACE FUNCTION public.delete_guest_profile(p_user_id text)
RETURNS void AS $$
BEGIN
  IF p_user_id <> auth.uid()::text THEN
    RAISE EXCEPTION 'Unauthorized guest profile deletion request.';
  END IF;

  -- Only allow deleting if it's a guest account (no email)
  DELETE FROM public.profiles
  WHERE id = p_user_id AND email IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.delete_guest_profile(text) TO authenticated;
