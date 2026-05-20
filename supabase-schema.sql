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
  scores jsonb DEFAULT '{}'::jsonb,
  targets jsonb NOT NULL,
  total_rounds integer DEFAULT 10,
  round_seconds integer DEFAULT 30,
  no_moving boolean DEFAULT false,
  no_panning boolean DEFAULT false,
  no_zooming boolean DEFAULT false,
  selected_maps jsonb DEFAULT '["world"]'::jsonb,
  player1_score integer DEFAULT 0,
  player2_score integer DEFAULT 0,
  current_round integer DEFAULT 1,
  status text DEFAULT 'waiting',
  winner_id text REFERENCES public.profiles(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.map_regions (
  id text PRIMARY KEY,
  name text NOT NULL,
  flag text NOT NULL,
  flag_image text,
  background text,
  categories text[] NOT NULL DEFAULT '{}',
  min_lat double precision NOT NULL,
  max_lat double precision NOT NULL,
  min_lng double precision NOT NULL,
  max_lng double precision NOT NULL,
  camera_zoom double precision,
  camera_min_zoom double precision,
  camera_max_zoom double precision,
  sort_order integer DEFAULT 0,
  is_enabled boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.map_fallback_locations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  region_id text REFERENCES public.map_regions(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  sort_order integer DEFAULT 0,
  is_enabled boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.feedbacks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_name text,
  type text NOT NULL, -- 'feedback' or 'report'
  message text NOT NULL,
  details jsonb, -- e.g., { lat, lng, round, mode }
  status text DEFAULT 'open', -- 'open', 'acknowledged', 'done'
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_fallback_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT ON public.exp_history TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matchmaking_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.match_rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.map_regions TO authenticated;
GRANT SELECT ON public.map_regions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.map_fallback_locations TO authenticated;
GRANT SELECT ON public.map_fallback_locations TO anon;
GRANT SELECT, INSERT, UPDATE ON public.feedbacks TO authenticated;

ALTER TABLE public.feedbacks ADD COLUMN IF NOT EXISTS player_name text;

-- Function to sync profile and handle unique guest name generation
CREATE OR REPLACE FUNCTION public.sync_profile(
  p_user_id uuid,
  p_email text DEFAULT NULL,
  p_display_name text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_name text;
  v_exists boolean;
  v_count integer := 0;
  v_res jsonb;
BEGIN
  -- Check if profile already exists
  SELECT display_name INTO v_name FROM public.profiles WHERE id = p_user_id::text;
  
  IF v_name IS NOT NULL THEN
    -- Update last seen and just return existing name
    UPDATE public.profiles 
    SET last_seen = now(), updated_at = now()
    WHERE id = p_user_id::text;
    RETURN jsonb_build_object('display_name', v_name);
  END IF;

  -- New profile logic
  v_name := p_display_name;

  -- If it's a guest or name is missing, generate a random 6-digit Guest ID
  IF p_email IS NULL OR v_name IS NULL OR v_name = '' THEN
    v_name := 'Guest #' || (floor(random() * (999999-100000+1)) + 100000)::text;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, updated_at, last_seen)
  VALUES (p_user_id::text, p_email, COALESCE(v_name, 'New User'), now(), now())
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    -- Only update name if it was previously null or if it's a non-guest login
    display_name = CASE 
      WHEN p_email IS NOT NULL THEN EXCLUDED.display_name 
      ELSE profiles.display_name 
    END,
    updated_at = now(),
    last_seen = now()
  RETURNING jsonb_build_object('display_name', display_name) INTO v_res;

  RETURN v_res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to the sync function
GRANT EXECUTE ON FUNCTION public.sync_profile(uuid, text, text) TO authenticated;

-- Function to cleanup inactive guest profiles
CREATE OR REPLACE FUNCTION public.cleanup_inactive_guests(p_minutes integer DEFAULT 10)
RETURNS void AS $$
BEGIN
  DELETE FROM public.profiles
  WHERE email IS NULL
    AND last_seen < (now() - (p_minutes || ' minutes')::interval);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for a guest to delete their own profile
CREATE OR REPLACE FUNCTION public.delete_guest_profile(p_user_id text)
RETURNS void AS $$
BEGIN
  -- Only allow deleting if it's a guest account (no email)
  DELETE FROM public.profiles
  WHERE id = p_user_id AND email IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for host to close a room (delete from match_rooms)
CREATE OR REPLACE FUNCTION public.close_match_room(p_room_id text, p_user_id text)
RETURNS void AS $$
BEGIN
  DELETE FROM public.match_rooms
  WHERE id = p_room_id AND player1_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup all waiting rooms for a user
CREATE OR REPLACE FUNCTION public.cleanup_user_rooms(p_user_id text)
RETURNS void AS $$
BEGIN
  DELETE FROM public.match_rooms
  WHERE player1_id = p_user_id AND status = 'waiting';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to leave matchmaking queue securely
CREATE OR REPLACE FUNCTION public.leave_matchmaking_queue(p_user_id text)
RETURNS void AS $$
BEGIN
  DELETE FROM public.matchmaking_queue
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to kick a participant from a creator room
CREATE OR REPLACE FUNCTION public.kick_participant_from_room(
  p_room_id text,
  p_kicked_user_id text,
  p_host_id text
)
RETURNS boolean AS $$
DECLARE
  v_room_host text;
  v_participants jsonb;
BEGIN
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

  -- Get current participants
  SELECT participants INTO v_participants
  FROM public.match_rooms
  WHERE id = p_room_id;

  -- Remove the kicked user from participants array
  UPDATE public.match_rooms
  SET participants = v_participants - p_kicked_user_id
  WHERE id = p_room_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert profiles" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid()::text = id);

DROP POLICY IF EXISTS "Anyone can update profiles" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid()::text = id);

DROP POLICY IF EXISTS "Anyone can delete profiles" ON public.profiles;
CREATE POLICY "Users can delete their own profile"
  ON public.profiles FOR DELETE TO authenticated USING (auth.uid()::text = id);

DROP POLICY IF EXISTS "exp_history is viewable by everyone for leaderboard" ON public.exp_history;
CREATE POLICY "exp_history is viewable by authenticated users"
  ON public.exp_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert their own exp_history" ON public.exp_history;
CREATE POLICY "Users can insert their own exp_history"
  ON public.exp_history FOR INSERT TO authenticated WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can delete their own exp_history" ON public.exp_history;
CREATE POLICY "Users can delete their own exp_history"
  ON public.exp_history FOR DELETE TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can insert their own notifications" ON public.notifications;
CREATE POLICY "Users can insert their own notifications"
  ON public.notifications FOR INSERT TO authenticated WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;
CREATE POLICY "Users can delete their own notifications"
  ON public.notifications FOR DELETE TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can view their own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can view their own activity_logs"
  ON public.activity_logs FOR SELECT TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can insert their own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can insert their own activity_logs"
  ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Public read matchmaking_queue" ON public.matchmaking_queue;
CREATE POLICY "Authenticated users can read queue"
  ON public.matchmaking_queue FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can insert matchmaking_queue" ON public.matchmaking_queue;
CREATE POLICY "Users can insert themselves into queue"
  ON public.matchmaking_queue FOR INSERT TO authenticated WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users update matchmaking_queue" ON public.matchmaking_queue;
CREATE POLICY "Users can update their own queue status"
  ON public.matchmaking_queue FOR UPDATE TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users delete matchmaking_queue" ON public.matchmaking_queue;
CREATE POLICY "Users can delete their own queue entry"
  ON public.matchmaking_queue FOR DELETE TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Public read match_rooms" ON public.match_rooms;
CREATE POLICY "Authenticated users can read rooms"
  ON public.match_rooms FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can insert match_rooms" ON public.match_rooms;
CREATE POLICY "Authenticated users can create rooms"
  ON public.match_rooms FOR INSERT TO authenticated WITH CHECK (auth.uid()::text = player1_id);

DROP POLICY IF EXISTS "Users update match_rooms" ON public.match_rooms;
CREATE POLICY "Participants can update rooms"
  ON public.match_rooms FOR UPDATE TO authenticated USING (
    auth.uid()::text = player1_id OR 
    auth.uid()::text = player2_id OR 
    participants ? auth.uid()::text
  );

DROP POLICY IF EXISTS "Anyone can delete match_rooms" ON public.match_rooms;
CREATE POLICY "Host can delete room"
  ON public.match_rooms FOR DELETE TO authenticated USING (auth.uid()::text = player1_id);

DROP POLICY IF EXISTS "Public read enabled map_regions" ON public.map_regions;
CREATE POLICY "Public read enabled map_regions"
  ON public.map_regions FOR SELECT USING (is_enabled = true);

DROP POLICY IF EXISTS "Admins can manage map_regions" ON public.map_regions;
CREATE POLICY "Admins can manage map_regions"
  ON public.map_regions FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND is_admin = true)
  );

DROP POLICY IF EXISTS "Public read fallback locations" ON public.map_fallback_locations;
CREATE POLICY "Public read fallback locations"
  ON public.map_fallback_locations FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.map_regions r
      WHERE r.id = map_fallback_locations.region_id
        AND r.is_enabled = true
    )
  );

DROP POLICY IF EXISTS "Admins can manage map_fallback_locations" ON public.map_fallback_locations;
CREATE POLICY "Admins can manage map_fallback_locations"
  ON public.map_fallback_locations FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND is_admin = true)
  );

DROP POLICY IF EXISTS "Users can view and create feedbacks" ON public.feedbacks;
CREATE POLICY "Users can create feedbacks"
  ON public.feedbacks FOR INSERT TO authenticated WITH CHECK (
    user_id IS NULL OR auth.uid()::text = user_id
  );

DROP POLICY IF EXISTS "Users can read own feedbacks and admins can read all" ON public.feedbacks;
CREATE POLICY "Users can read own feedbacks and admins can read all"
  ON public.feedbacks FOR SELECT TO authenticated USING (
    auth.uid()::text = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND is_admin = true)
  );

DROP POLICY IF EXISTS "Admins can update feedbacks" ON public.feedbacks;
CREATE POLICY "Admins can update feedbacks"
  ON public.feedbacks FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND is_admin = true)
  );

CREATE OR REPLACE FUNCTION public.get_time_filtered_exp(from_date timestamp with time zone)
RETURNS TABLE (
  user_id text,
  display_name text,
  total_exp bigint,
  elo integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.display_name,
    COALESCE(SUM(eh.exp_gained), 0) AS total_exp,
    p.elo
  FROM public.profiles p
  LEFT JOIN public.exp_history eh ON p.id = eh.user_id AND eh.created_at >= from_date
  GROUP BY p.id, p.display_name, p.elo
  ORDER BY total_exp DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.find_match(p_user_id text, p_elo integer, p_range integer)
RETURNS TABLE (new_room_id text, matched_user_id text, matched_elo integer) AS $$
DECLARE
  v_opponent RECORD;
  v_room_id text;
BEGIN
  SELECT * INTO v_opponent
  FROM public.matchmaking_queue
  WHERE user_id != p_user_id
    AND status = 'waiting'
    AND elo >= (p_elo - p_range)
    AND elo <= (p_elo + p_range)
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

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

INSERT INTO public.map_regions (id, name, flag, flag_image, background, categories, min_lat, max_lat, min_lng, max_lng, camera_zoom, camera_min_zoom, camera_max_zoom, sort_order, is_enabled)
VALUES
  ('argentina', 'Argentina', '🇦🇷', 'https://flagcdn.com/w640/ar.png', NULL, ARRAY['americas'], -55, -21, -73, -53, NULL, NULL, NULL, 22, true),
  ('australia', 'Australia', '🇦🇺', 'https://flagcdn.com/w640/au.png', NULL, ARRAY['popular','oceania'], -44, -10, 113, 154, NULL, NULL, NULL, 24, true),
  ('brazil', 'Brazil', '🇧🇷', 'https://flagcdn.com/w640/br.png', NULL, ARRAY['americas'], -34, 5.3, -74, -34, NULL, NULL, NULL, 21, true),
  ('canada', 'Canada', '🇨🇦', 'https://flagcdn.com/w640/ca.png', NULL, ARRAY['americas'], 42, 70, -141, -52, NULL, NULL, NULL, 19, true),
  ('chile', 'Chile', '🇨🇱', 'https://flagcdn.com/w640/cl.png', NULL, ARRAY['americas'], -56, -17, -76, -66, NULL, NULL, NULL, 23, true),
  ('france', 'France', '🇫🇷', 'https://flagcdn.com/w640/fr.png', NULL, ARRAY['europe'], 41, 51.2, -5.2, 9.6, NULL, NULL, NULL, 13, true),
  ('germany', 'Germany', '🇩🇪', 'https://flagcdn.com/w640/de.png', NULL, ARRAY['popular','europe'], 47.2, 55.1, 5.8, 15.1, NULL, NULL, NULL, 12, true),
  ('india', 'India', '🇮🇳', 'https://flagcdn.com/w640/in.png', NULL, ARRAY['asia'], 8, 35, 68, 97, NULL, NULL, NULL, 10, true),
  ('indonesia', 'Indonesia', '🇮🇩', 'https://flagcdn.com/w640/id.png', NULL, ARRAY['popular','asia'], -10, 6, 95, 141, 5, 4, 13, 1, true),
  ('italy', 'Italy', '🇮🇹', 'https://flagcdn.com/w640/it.png', NULL, ARRAY['europe'], 36.5, 47.1, 6.6, 18.6, NULL, NULL, NULL, 14, true),
  ('japan', 'Japan', '🇯🇵', 'https://flagcdn.com/w640/jp.png', NULL, ARRAY['popular','asia'], 30, 45, 130, 146, 5, 4, 13, 2, true),
  ('malaysia', 'Malaysia', '🇲🇾', 'https://flagcdn.com/w640/my.png', NULL, ARRAY['asia'], 0.8, 7.4, 99.6, 119.3, 6, 5, 13, 5, true),
  ('mexico', 'Mexico', '🇲🇽', 'https://flagcdn.com/w640/mx.png', NULL, ARRAY['americas'], 14, 32.8, -118, -86, NULL, NULL, NULL, 20, true),
  ('netherlands', 'Netherlands', '🇳🇱', 'https://flagcdn.com/w640/nl.png', NULL, ARRAY['europe'], 50.7, 53.7, 3.3, 7.3, 7, 6, 14, 16, true),
  ('newZealand', 'New Zealand', '🇳🇿', 'https://flagcdn.com/w640/nz.png', NULL, ARRAY['oceania'], -47.5, -34, 166, 179, 6, 5, 14, 25, true),
  ('norway', 'Norway', '🇳🇴', 'https://flagcdn.com/w640/no.png', NULL, ARRAY['europe'], 58, 71.2, 4, 31, NULL, NULL, NULL, 18, true),
  ('philippines', 'Philippines', '🇵🇭', 'https://flagcdn.com/w640/ph.png', NULL, ARRAY['asia'], 5, 19.5, 117, 127, NULL, NULL, NULL, 7, true),
  ('singapore', 'Singapore', '🇸🇬', 'https://flagcdn.com/w640/sg.png', NULL, ARRAY['asia'], 1.18, 1.48, 103.6, 104.05, 11, 10, 16, 4, true),
  ('southKorea', 'South Korea', '🇰🇷', 'https://flagcdn.com/w640/kr.png', NULL, ARRAY['asia'], 33, 38.7, 124.5, 131, NULL, NULL, NULL, 9, true),
  ('spain', 'Spain', '🇪🇸', 'https://flagcdn.com/w640/es.png', NULL, ARRAY['europe'], 36, 43.8, -9.5, 3.3, NULL, NULL, NULL, 15, true),
  ('sweden', 'Sweden', '🇸🇪', 'https://flagcdn.com/w640/se.png', NULL, ARRAY['europe'], 59.3293, 18.0686, 11, 24, NULL, NULL, NULL, 17, true),
  ('thailand', 'Thailand', '🇹🇭', 'https://flagcdn.com/w640/th.png', NULL, ARRAY['asia'], 5.6, 20.5, 97.3, 105.7, NULL, NULL, NULL, 6, true),
  ('unitedKingdom', 'United Kingdom', '🇬🇧', 'https://flagcdn.com/w640/gb.png', NULL, ARRAY['popular','europe'], 49.8, 58.8, -8.7, 1.9, 6, 5, 14, 11, true),
  ('usa', 'United States', '🇺🇸', 'https://flagcdn.com/w640/us.png', NULL, ARRAY['popular','americas'], 25, 49, -125, -67, 4, 3, 13, 3, true),
  ('vietnam', 'Vietnam', '🇻🇳', 'https://flagcdn.com/w640/vn.png', NULL, ARRAY['asia'], 8, 23.5, 102, 110, NULL, NULL, NULL, 8, true),
  ('world', 'World', '🌍', NULL, 'radial-gradient(circle at 30% 30%, rgba(59,130,246,0.45), transparent 35%), radial-gradient(circle at 70% 60%, rgba(34,197,94,0.35), transparent 35%), linear-gradient(135deg, rgba(15,23,42,1), rgba(30,41,59,1))', ARRAY['popular'], -85, 85, -180, 180, 2, 2, 12, 0, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.map_fallback_locations (id, region_id, lat, lng, sort_order)
VALUES
  ('3dcc1c81-8742-4d6c-8f23-74994b8d55c8', 'argentina', -34.6037, -58.3816, 0),
  ('180dfee4-ff31-43e8-8706-1643ca488107', 'australia', -33.8688, 151.2093, 0),
  ('2bcc6eca-49e6-4dbe-9a91-6e56acb8590b', 'brazil', -23.5505, -46.6333, 0),
  ('8c730cdd-23dc-4f52-ba89-0393fac0290a', 'canada', 43.6532, -79.3832, 0),
  ('c40631ed-7125-4ff3-a065-8ad251c42678', 'chile', -33.4489, -70.6693, 0),
  ('7e383936-605e-4407-b1d1-0bf960d0bca3', 'france', 48.8566, 2.3522, 0),
  ('2a340b3a-beba-4eec-a314-61bb2dba4b3d', 'germany', 52.52, 13.405, 0),
  ('25f87b96-e33e-4f05-bfad-d06d941de1c2', 'india', 28.6139, 77.209, 0),
  ('0b497af2-7474-4afa-9355-1944bec77354', 'indonesia', -6.2088, 106.8456, 0),
  ('16e8500d-afdb-47e0-a9c4-a0fb1f5ae4e5', 'indonesia', -7.2575, 112.7521, 1),
  ('89c3fdc6-6946-474b-8ef7-afd82044ba7c', 'indonesia', -8.65, 115.2167, 2),
  ('cfe76ecf-5bb5-4942-aacc-dddb48209f78', 'indonesia', -6.9667, 110.4167, 3),
  ('943800dd-a25e-4d16-9bff-3b0935fb8d68', 'italy', 41.9028, 12.4964, 0),
  ('ed4bf0d9-5490-4e2b-8d48-bc680637aaf6', 'japan', 35.6762, 139.6503, 0),
  ('81a8c0a6-0a8b-4c2a-9926-5b14d8a5158b', 'japan', 35.0116, 135.7681, 1),
  ('2ff26246-91c0-4318-97cc-fb821a1b5b58', 'japan', 34.6937, 135.5023, 2),
  ('45c7ca47-ca8a-4f97-8c3c-5d654a85ccc0', 'malaysia', 3.139, 101.6869, 0),
  ('19ec8373-8403-4b3e-9bba-11cef692bd8e', 'mexico', 19.4326, -99.1332, 0),
  ('2d42aef4-337b-4522-b502-9eb515190d42', 'netherlands', 52.3676, 4.9041, 0),
  ('478d3931-ffd4-4d87-8d0f-5b9b435c8274', 'newZealand', -36.8509, 174.7645, 0),
  ('99d967c1-a578-45e8-ba1c-8b578d82f47a', 'norway', 59.9139, 10.7522, 0),
  ('12dc70b6-79b1-4f89-9968-d210c465975a', 'philippines', 14.5995, 120.9842, 0),
  ('67b50ced-03ed-4fc0-9379-f6b9c505a197', 'singapore', 1.3521, 103.8198, 0),
  ('70f3234e-f142-4bb1-99d1-938d34e747e5', 'southKorea', 37.5665, 126.978, 0),
  ('18a723f9-fab0-41c8-94c3-a542039e3a74', 'spain', 40.4168, -3.7038, 0),
  ('570d9ee4-ba40-4e85-a7a5-f0f46db95271', 'sweden', 59.3293, 18.0686, 0),
  ('d5094ba5-8c6b-448d-84de-8b866a67604b', 'thailand', 13.7563, 100.5018, 0),
  ('d9fa4668-6646-4b32-84a3-9383c6977895', 'unitedKingdom', 51.5074, -0.1278, 0),
  ('11f13b8f-beea-47fb-af60-ed936ec2b333', 'usa', 40.7128, -74.006, 0),
  ('b743ee14-6706-48dc-9f3c-9f32ecc558db', 'usa', 34.0522, -118.2437, 1),
  ('1b72416e-07a6-4183-9357-df46827d31d1', 'usa', 37.7749, -122.4194, 2),
  ('4c4d2237-349b-4a14-86c7-b4aaf1fb2225', 'vietnam', 21.0278, 105.8342, 0)
ON CONFLICT (id) DO NOTHING;

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

ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own match history"
  ON public.match_history FOR SELECT TO authenticated USING (
    auth.uid()::text = player1_id OR auth.uid()::text = player2_id
  );

CREATE POLICY "Users can read all match history for stats"
  ON public.match_history FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.match_history TO authenticated;

CREATE TABLE IF NOT EXISTS public.game_modes (
  id text PRIMARY KEY,
  label text NOT NULL,
  rounds integer NOT NULL,
  seconds integer NOT NULL,
  description text NOT NULL,
  multiplayer boolean DEFAULT false,
  enabled boolean DEFAULT true,
  icon text,
  bg_img text,
  sort_order integer DEFAULT 0
);

ALTER TABLE public.game_modes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read game_modes" ON public.game_modes;
CREATE POLICY "Public read game_modes"
  ON public.game_modes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage game_modes" ON public.game_modes;
CREATE POLICY "Admins can manage game_modes"
  ON public.game_modes FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND is_admin = true)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_modes TO authenticated;
GRANT SELECT ON public.game_modes TO anon;

INSERT INTO public.game_modes (id, label, rounds, seconds, description, multiplayer, enabled, icon, bg_img, sort_order)
VALUES
  ('classic', 'Classic', 5, 60, '5 rounds, 60 seconds each. The core singleplayer experience.', false, true, 'MapPin', 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?q=80&w=600&auto=format&fit=crop', 1),
  ('headToHead', 'Head-to-head', 10, 30, '1v1 battle over 10 fast rounds (30s). Find a random opponent.', true, true, 'Map', 'https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=600&auto=format&fit=crop', 2),
  ('creatorRoom', 'Creator Room', 20, 45, 'Flexible rules for private matches with friends.', true, true, 'Crosshair', 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=600&auto=format&fit=crop', 3),
  ('chaos', 'Chaos Mode', 0, 0, 'Same geography core, but with random effects & power-ups. Coming soon.', true, false, 'Zap', 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=600&auto=format&fit=crop', 4),
  ('vsAI', 'VS AI', 0, 0, 'Test your skills against an AI opponent. Coming soon.', false, false, 'Cpu', 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=600&auto=format&fit=crop', 5)
ON CONFLICT (id) DO NOTHING;

-- Room Chat Tables and Functions
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

ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_room_messages_room_created ON public.room_messages(room_id, created_at DESC);

DROP POLICY IF EXISTS "Users can read room messages" ON public.room_messages;
CREATE POLICY "Users can read room messages"
  ON public.room_messages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert their own messages" ON public.room_messages;
CREATE POLICY "Users can insert their own messages"
  ON public.room_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can update own messages" ON public.room_messages;
CREATE POLICY "Users can update own messages"
  ON public.room_messages FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id OR is_deleted = true);

GRANT SELECT, INSERT, UPDATE ON public.room_messages TO authenticated;

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

-- Function to get the count of active (online) players safely for all users (including anonymous)
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

-- Match History insertion policies and grants
DROP POLICY IF EXISTS "Users can insert match history" ON public.match_history;
CREATE POLICY "Users can insert match history"
  ON public.match_history FOR INSERT TO authenticated WITH CHECK (
    auth.uid()::text = player1_id OR auth.uid()::text = player2_id
  );

GRANT INSERT ON public.match_history TO authenticated;