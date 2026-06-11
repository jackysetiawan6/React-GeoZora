-- 06_rpc_utilities_and_maintenance.sql
-- Database Maintenance and Secure Utility Functions

-- 1. Secure Leaderboard Retrieval (avoids exposing entire profiles/exp_history table to anon role)
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

-- 2. Function to cleanup inactive guest profiles (no email and inactive for >p_minutes)
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

-- 3. Function to cleanup stale active/waiting match rooms (no updates for >3 hours)
CREATE OR REPLACE FUNCTION public.cleanup_stale_rooms()
RETURNS void AS $$
BEGIN
  DELETE FROM public.match_rooms
  WHERE status IN ('waiting', 'active')
    AND updated_at < (now() - interval '3 hours');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.cleanup_stale_rooms() FROM public, authenticated, anon;

-- 4. Enable pg_cron and schedule maintenance jobs
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

-- 6. Function to mark inactive users offline based on last_seen (useful if clients disconnect unexpectedly)
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

-- Schedule mark_inactive_offline(5) to run every 5 minutes
SELECT cron.schedule(
  'mark-inactive-offline-job',
  '*/5 * * * *',
  $$SELECT public.mark_inactive_offline(5)$$
);

-- 7. Secure profile update RPC: centralize validations and avoid RLS/REST 401 surprises
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

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_match_history_player1_id ON public.match_history(player1_id);
CREATE INDEX IF NOT EXISTS idx_match_history_player2_id ON public.match_history(player2_id);
CREATE INDEX IF NOT EXISTS idx_exp_history_created_at_user_id ON public.exp_history(created_at, user_id);

