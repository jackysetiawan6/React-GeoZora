-- 11_runtime_compatibility.sql
-- Keep ordinary presence updates on a narrow, self-scoped RPC. This avoids
-- exposing broader profile UPDATE privileges to the browser.

CREATE OR REPLACE FUNCTION public.set_profile_presence(p_online boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id text := auth.uid()::text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  UPDATE public.profiles
  SET online_status = p_online,
      last_seen = now(),
      updated_at = now()
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_presence(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_presence(boolean) TO authenticated;

-- Preserve the intended authenticated-only access for the hardened guess RPC
-- when PostgREST refreshes its function metadata after a migration.
DO $$
BEGIN
  IF to_regprocedure('public.submit_match_guess(text,integer,double precision,double precision,integer,jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.submit_match_guess(text, integer, double precision, double precision, integer, jsonb) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.submit_match_guess(text, integer, double precision, double precision, integer, jsonb) TO authenticated';
  END IF;
END;
$$;
