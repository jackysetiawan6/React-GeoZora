-- 09_rpc_maintenance_utilities.sql
-- Database Maintenance, Admin controls, Leaderboard, Stats, and Cron triggers

-- 1. Secure Leaderboard Retrieval
CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_filter text,
  p_metric text,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id text,
  display_name text,
  exp integer,
  elo integer,
  games_played integer,
  avatar_url text,
  score integer,
  rounds_window integer
) AS $$
DECLARE
  v_from_date timestamp with time zone;
BEGIN
  IF p_filter = 'overall' THEN
    IF p_metric = 'elo' THEN
      RETURN QUERY
      SELECT p.id, p.display_name, p.exp, p.elo, p.games_played, p.avatar_url, p.elo as score, p.games_played as rounds_window
      FROM public.profiles p
      WHERE p.email IS NOT NULL
        AND p.is_banned = false
        AND p.games_played > 0
      ORDER BY p.elo DESC
      LIMIT p_limit;
    ELSE
      RETURN QUERY
      SELECT p.id, p.display_name, p.exp, p.elo, p.games_played, p.avatar_url, p.exp as score, p.games_played as rounds_window
      FROM public.profiles p
      WHERE p.email IS NOT NULL
        AND p.is_banned = false
        AND p.games_played > 0
      ORDER BY p.exp DESC
      LIMIT p_limit;
    END IF;
  ELSE
    -- Time-based filters
    IF p_filter = 'today' THEN
      v_from_date := now() - interval '1 day';
    ELSIF p_filter = 'week' THEN
      v_from_date := now() - interval '7 days';
    ELSIF p_filter = 'month' THEN
      v_from_date := now() - interval '1 month';
    ELSIF p_filter = 'year' THEN
      v_from_date := now() - interval '1 year';
    ELSE
      v_from_date := now() - interval '100 years';
    END IF;

    IF p_metric = 'elo' THEN
      RETURN QUERY
      WITH active_users AS (
        SELECT user_id, count(*)::integer as rounds
        FROM public.exp_history
        WHERE created_at >= v_from_date
        GROUP BY user_id
      )
      SELECT 
        p.id, 
        p.display_name, 
        p.exp, 
        p.elo, 
        p.games_played, 
        p.avatar_url,
        p.elo as score,
        au.rounds as rounds_window
      FROM active_users au
      JOIN public.profiles p ON p.id = au.user_id
      WHERE p.email IS NOT NULL
        AND p.is_banned = false
      ORDER BY p.elo DESC
      LIMIT p_limit;
    ELSE
      RETURN QUERY
      WITH aggregated_exp AS (
        SELECT user_id, sum(exp_gained)::integer as total_exp, count(*)::integer as rounds
        FROM public.exp_history
        WHERE created_at >= v_from_date
        GROUP BY user_id
      )
      SELECT 
        p.id, 
        p.display_name, 
        p.exp, 
        p.elo, 
        p.games_played, 
        p.avatar_url,
        ae.total_exp as score,
        ae.rounds as rounds_window
      FROM aggregated_exp ae
      JOIN public.profiles p ON p.id = ae.user_id
      WHERE p.email IS NOT NULL
        AND p.is_banned = false
      ORDER BY ae.total_exp DESC
      LIMIT p_limit;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_leaderboard(text, text, integer) TO authenticated, anon;

-- 2. Atomically increment player stats and protect from banned users
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
        v_idx integer;
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

-- 3. Secure profile update RPC
CREATE OR REPLACE FUNCTION public.update_profile_safe(
  p_id uuid,
  p_display_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_distance_metric text DEFAULT NULL,
  p_map_preference text DEFAULT NULL,
  p_theme_preference text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF p_id::text <> auth.uid()::text THEN
    RAISE EXCEPTION 'Unauthorized profile update request.';
  END IF;

  -- Validate display name uniqueness (exclude same user)
  IF p_display_name IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.profiles WHERE display_name = p_display_name AND id <> p_id::text
    ) INTO v_exists;
    IF v_exists THEN
      RETURN jsonb_build_object('status', 'error', 'message', 'display_name_taken');
    END IF;
  END IF;

  UPDATE public.profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    avatar_url = COALESCE(p_avatar_url, avatar_url),
    distance_metric = COALESCE(p_distance_metric, distance_metric),
    map_preference = COALESCE(p_map_preference, map_preference),
    theme_preference = COALESCE(p_theme_preference, theme_preference),
    updated_at = now()
  WHERE id = p_id::text;

  RETURN jsonb_build_object('status', 'ok');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.update_profile_safe(uuid, text, text, text, text, text) TO authenticated;

-- 4. Admin function to ban/unban users securely
CREATE OR REPLACE FUNCTION public.admin_set_user_ban_status(
  p_target_user_id text,
  p_is_banned boolean,
  p_ban_reason text DEFAULT NULL
)
RETURNS boolean AS $$
BEGIN
  -- Verify caller is admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid()::text 
    AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied. Caller is not an admin.';
  END IF;

  UPDATE public.profiles
  SET is_banned = p_is_banned,
      ban_reason = CASE WHEN p_is_banned THEN p_ban_reason ELSE NULL END,
      ban_timestamp = CASE WHEN p_is_banned THEN now() ELSE NULL END
  WHERE id = p_target_user_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_set_user_ban_status(text, boolean, text) TO authenticated;

-- 5. Function to cleanup inactive guest profiles (no email and inactive for >p_minutes)
CREATE OR REPLACE FUNCTION public.cleanup_inactive_guests(p_minutes integer DEFAULT 10)
RETURNS void AS $$
BEGIN
  DELETE FROM public.profiles
  WHERE email IS NULL
    AND last_seen < (now() - (p_minutes || ' minutes')::interval);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.cleanup_inactive_guests(integer) FROM public, authenticated, anon;

-- Function to cleanup banned guests
CREATE OR REPLACE FUNCTION public.cleanup_banned_guests()
RETURNS void AS $$
BEGIN
  DELETE FROM public.profiles
  WHERE email IS NULL AND is_banned = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.cleanup_banned_guests() FROM public, authenticated, anon;

-- 6. Function to cleanup stale active/waiting match rooms (no updates for >3 hours)
CREATE OR REPLACE FUNCTION public.cleanup_stale_rooms()
RETURNS void AS $$
BEGIN
  DELETE FROM public.match_rooms
  WHERE status IN ('waiting', 'active')
    AND updated_at < (now() - interval '3 hours');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.cleanup_stale_rooms() FROM public, authenticated, anon;

-- 7. Function to mark inactive users offline based on last_seen
CREATE OR REPLACE FUNCTION public.mark_inactive_offline(p_minutes integer DEFAULT 5)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET online_status = false
  WHERE online_status = true
    AND last_seen < (now() - (p_minutes || ' minutes')::interval);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.mark_inactive_offline(integer) FROM public, authenticated, anon;

-- 8. Enable pg_cron and schedule maintenance jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup_inactive_guests(10) to run every 10 minutes
SELECT cron.schedule(
  'cleanup-inactive-guests-job',
  '*/10 * * * *',
  $$SELECT public.cleanup_inactive_guests(10)$$
);

-- Schedule cleanup_stale_rooms() to run every hour
SELECT cron.schedule(
  'cleanup-stale-rooms-job',
  '0 * * * *',
  $$SELECT public.cleanup_stale_rooms()$$
);

-- Schedule cleanup_banned_guests() to run every hour
SELECT cron.schedule(
  'cleanup-banned-guests-job',
  '0 * * * *',
  $$SELECT public.cleanup_banned_guests()$$
);

-- Schedule mark_inactive_offline(5) to run every 5 minutes
SELECT cron.schedule(
  'mark-inactive-offline-job',
  '*/5 * * * *',
  $$SELECT public.mark_inactive_offline(5)$$
);

-- 9. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_match_history_player1_id ON public.match_history(player1_id);
CREATE INDEX IF NOT EXISTS idx_match_history_player2_id ON public.match_history(player2_id);
CREATE INDEX IF NOT EXISTS idx_exp_history_created_at_user_id ON public.exp_history(created_at, user_id);
