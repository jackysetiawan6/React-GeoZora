-- 10_security_hardening.sql
-- Corrective migration: bind all actor identity to auth.uid(), remove unsafe RPCs,
-- and make room mutations host-authorized and field-limited.

CREATE OR REPLACE FUNCTION public.assert_current_user(p_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Unauthorized request.';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_match_room(text, text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_user_rooms(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.leave_matchmaking_queue(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.join_match_room(text, text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.leave_match_room(text, text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.set_player_ready(text, text, boolean) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.kick_participant_from_room(text, text, text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.find_match(text, integer, integer) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.migrate_host_on_disconnect(text, text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.insert_system_message(text, text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.find_room_by_code(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.close_match_room(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_user_rooms(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.leave_matchmaking_queue(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_match_room(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.leave_match_room(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_player_ready(text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kick_participant_from_room(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_match(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.migrate_host_on_disconnect(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_system_message(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_room_by_code(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.safe_leave_matchmaking_queue()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_current_user_banned() THEN RAISE EXCEPTION 'User is banned'; END IF;
  DELETE FROM public.matchmaking_queue WHERE user_id = auth.uid()::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_cleanup_my_rooms()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id text := auth.uid()::text;
BEGIN
  IF v_user_id IS NULL OR public.is_current_user_banned() THEN RAISE EXCEPTION 'Unauthorized request.'; END IF;
  DELETE FROM public.match_rooms WHERE player1_id = v_user_id AND status = 'waiting';
  UPDATE public.match_rooms
  SET participants = participants - v_user_id,
      ready_states = COALESCE(ready_states - v_user_id, '{}'::jsonb),
      player2_id = CASE WHEN player2_id = v_user_id THEN NULL ELSE player2_id END,
      updated_at = now()
  WHERE status = 'waiting' AND (participants ? v_user_id OR player2_id = v_user_id) AND player1_id <> v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_close_match_room(p_room_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_current_user_banned() THEN RAISE EXCEPTION 'User is banned'; END IF;
  DELETE FROM public.match_rooms WHERE id = p_room_id AND player1_id = auth.uid()::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_join_match_room(p_room_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id text := auth.uid()::text;
  v_participants jsonb;
  v_player1_id text;
  v_player2_id text;
  v_status text;
  v_is_public boolean;
BEGIN
  IF v_user_id IS NULL OR public.is_current_user_banned() THEN RAISE EXCEPTION 'Unauthorized request.'; END IF;
  SELECT participants, player1_id, player2_id, status, is_public
  INTO v_participants, v_player1_id, v_player2_id, v_status, v_is_public
  FROM public.match_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_status IS NULL OR v_status <> 'waiting' THEN RETURN false; END IF;
  IF v_is_public = false AND NOT (v_participants ? v_user_id) AND v_player1_id <> v_user_id THEN RETURN false; END IF;
  v_participants := COALESCE(v_participants, '[]'::jsonb);
  IF NOT (v_participants ? v_user_id) THEN
    IF jsonb_array_length(v_participants) >= 30 THEN RETURN false; END IF;
    v_participants := v_participants || jsonb_build_array(v_user_id);
    IF v_player2_id IS NULL AND jsonb_array_length(v_participants) = 2 AND v_player1_id <> v_user_id THEN v_player2_id := v_user_id; END IF;
    UPDATE public.match_rooms SET participants = v_participants, player2_id = v_player2_id, updated_at = now() WHERE id = p_room_id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_leave_match_room(p_room_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id text := auth.uid()::text;
  v_participants jsonb;
  v_ready_states jsonb;
  v_player1_id text;
  v_player2_id text;
  v_new_host_id text;
BEGIN
  IF v_user_id IS NULL OR public.is_current_user_banned() THEN RAISE EXCEPTION 'Unauthorized request.'; END IF;
  SELECT participants, ready_states, player1_id, player2_id INTO v_participants, v_ready_states, v_player1_id, v_player2_id
  FROM public.match_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_participants IS NULL OR NOT (v_participants ? v_user_id) THEN RETURN false; END IF;
  v_participants := v_participants - v_user_id;
  v_ready_states := COALESCE(v_ready_states - v_user_id, '{}'::jsonb);
  IF jsonb_array_length(v_participants) = 0 THEN DELETE FROM public.match_rooms WHERE id = p_room_id; RETURN true; END IF;
  IF v_player1_id = v_user_id THEN
    v_new_host_id := v_participants ->> 0;
    SELECT value INTO v_player2_id FROM jsonb_array_elements_text(v_participants) WHERE value <> v_new_host_id LIMIT 1;
    v_ready_states := jsonb_set(v_ready_states, ARRAY[v_new_host_id], 'true'::jsonb);
    UPDATE public.match_rooms SET player1_id = v_new_host_id, player2_id = v_player2_id, participants = v_participants, ready_states = v_ready_states, updated_at = now() WHERE id = p_room_id;
  ELSE
    IF v_player2_id = v_user_id THEN SELECT value INTO v_player2_id FROM jsonb_array_elements_text(v_participants) WHERE value <> v_player1_id LIMIT 1; END IF;
    UPDATE public.match_rooms SET participants = v_participants, ready_states = v_ready_states, player2_id = v_player2_id, updated_at = now() WHERE id = p_room_id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_set_player_ready(p_room_id text, p_is_ready boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id text := auth.uid()::text; v_ready_states jsonb;
BEGIN
  IF v_user_id IS NULL OR public.is_current_user_banned() THEN RAISE EXCEPTION 'Unauthorized request.'; END IF;
  SELECT COALESCE(ready_states, '{}'::jsonb) INTO v_ready_states FROM public.match_rooms
  WHERE id = p_room_id AND (player1_id = v_user_id OR player2_id = v_user_id OR participants ? v_user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User is not a participant of this room'; END IF;
  v_ready_states := jsonb_set(v_ready_states, ARRAY[v_user_id], to_jsonb(p_is_ready));
  UPDATE public.match_rooms SET ready_states = v_ready_states, updated_at = now() WHERE id = p_room_id;
  RETURN (SELECT row_to_json(r)::jsonb FROM public.match_rooms r WHERE r.id = p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_kick_participant_from_room(p_room_id text, p_kicked_user_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_host text; v_participants jsonb;
BEGIN
  IF public.is_current_user_banned() THEN RAISE EXCEPTION 'User is banned'; END IF;
  SELECT player1_id, participants INTO v_host, v_participants FROM public.match_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_host IS NULL OR v_host <> auth.uid()::text OR p_kicked_user_id = v_host THEN RETURN false; END IF;
  IF NOT (v_participants ? p_kicked_user_id) THEN RETURN false; END IF;
  UPDATE public.match_rooms SET participants = participants - p_kicked_user_id, ready_states = COALESCE(ready_states - p_kicked_user_id, '{}'::jsonb),
    player2_id = CASE WHEN player2_id = p_kicked_user_id THEN NULL ELSE player2_id END, updated_at = now() WHERE id = p_room_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_find_match(p_range integer)
RETURNS TABLE (new_room_id text, matched_user_id text, matched_elo integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id text := auth.uid()::text; v_elo integer;
BEGIN
  IF v_user_id IS NULL OR public.is_current_user_banned() THEN RAISE EXCEPTION 'Unauthorized request.'; END IF;
  SELECT elo INTO v_elo FROM public.matchmaking_queue WHERE user_id = v_user_id AND status = 'waiting';
  IF v_elo IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.find_match(v_user_id, v_elo, greatest(0, least(p_range, 500)));
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_create_match_room(
  p_room_id text, p_player2_id text, p_targets jsonb, p_total_rounds integer, p_round_seconds integer,
  p_no_moving boolean, p_no_panning boolean, p_no_zooming boolean, p_selected_maps jsonb,
  p_status text, p_mode text, p_enable_time_multiplier boolean, p_is_public boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id text := auth.uid()::text;
BEGIN
  IF v_user_id IS NULL OR public.is_current_user_banned() THEN RAISE EXCEPTION 'Unauthorized request.'; END IF;
  IF p_room_id !~ '^[A-Za-z0-9-]{6,64}$' OR p_total_rounds NOT BETWEEN 5 AND 30 OR p_round_seconds NOT BETWEEN 20 AND 90
     OR jsonb_typeof(p_targets) <> 'array' OR jsonb_array_length(p_targets) > p_total_rounds
     OR jsonb_typeof(p_selected_maps) <> 'array' OR jsonb_array_length(p_selected_maps) NOT BETWEEN 1 AND 3
     OR p_mode NOT IN ('classic', 'vsAI', 'headToHead', 'creatorRoom') OR p_status NOT IN ('waiting', 'active') THEN
    RAISE EXCEPTION 'Invalid room configuration.';
  END IF;
  IF p_mode = 'headToHead' THEN
    IF p_player2_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.matchmaking_queue WHERE room_id = p_room_id AND user_id = v_user_id AND matched_with = p_player2_id AND status = 'matched') THEN
      RAISE EXCEPTION 'Invalid matchmaking room.';
    END IF;
  ELSIF p_player2_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only matchmaking rooms can set a second player at creation.';
  END IF;
  INSERT INTO public.match_rooms (id, player1_id, player2_id, participants, scores, ready_states, targets, total_rounds, round_seconds, no_moving, no_panning, no_zooming, enable_time_multiplier, selected_maps, status, mode, is_public)
  VALUES (p_room_id, v_user_id, p_player2_id, CASE WHEN p_player2_id IS NULL THEN jsonb_build_array(v_user_id) ELSE jsonb_build_array(v_user_id, p_player2_id) END,
    '{}'::jsonb, jsonb_build_object(v_user_id, true), p_targets, p_total_rounds, p_round_seconds, p_no_moving, p_no_panning, p_no_zooming,
    p_enable_time_multiplier, p_selected_maps, p_status, p_mode, p_is_public);
  RETURN (SELECT row_to_json(r)::jsonb FROM public.match_rooms r WHERE r.id = p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_update_match_room(p_room_id text, p_updates jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.match_rooms%ROWTYPE; v_keys text[]; v_targets jsonb; v_index integer; v_is_creator_reset boolean := false;
BEGIN
  IF auth.uid() IS NULL OR public.is_current_user_banned() THEN RAISE EXCEPTION 'Unauthorized request.'; END IF;
  SELECT * INTO r FROM public.match_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR r.player1_id <> auth.uid()::text THEN RAISE EXCEPTION 'Only the room host may update this room.'; END IF;
  SELECT array_agg(key) INTO v_keys FROM jsonb_object_keys(p_updates) AS key;
  IF v_keys IS NULL OR v_keys <@ ARRAY['targets','current_round','status','total_rounds','round_seconds','no_moving','no_panning','no_zooming','enable_time_multiplier','selected_maps','is_public','ready_states','player1_score','player2_score','scores','winner_id'] IS NOT TRUE THEN
    RAISE EXCEPTION 'Unsupported room update.';
  END IF;
  IF p_updates ? 'scores' OR p_updates ? 'player1_score' OR p_updates ? 'player2_score' OR p_updates ? 'winner_id' OR (p_updates->>'status') = 'completed' THEN
    RAISE EXCEPTION 'Scores and completion are server-authoritative.';
  END IF;
  IF p_updates ? 'status' AND (p_updates->>'status') NOT IN ('waiting', 'active') THEN
    RAISE EXCEPTION 'Invalid room status.';
  END IF;
  v_is_creator_reset := r.mode = 'creatorRoom' AND r.status = 'completed'
    AND (p_updates->>'status') = 'waiting' AND (p_updates->>'current_round') = '0';
  IF p_updates ? 'ready_states' AND NOT v_is_creator_reset THEN
    RAISE EXCEPTION 'Ready states are changed through safe_set_player_ready.';
  END IF;
  IF p_updates ? 'targets' THEN
    v_targets := p_updates->'targets';
    IF jsonb_typeof(v_targets) <> 'array' OR jsonb_array_length(v_targets) > r.total_rounds THEN RAISE EXCEPTION 'Invalid targets.'; END IF;
    IF NOT v_is_creator_reset THEN
      IF r.status = 'active' AND jsonb_array_length(v_targets) < jsonb_array_length(r.targets) THEN RAISE EXCEPTION 'Cannot remove active targets.'; END IF;
      FOR v_index IN 0 .. greatest(jsonb_array_length(r.targets) - 1, 0) LOOP
        IF v_index < jsonb_array_length(r.targets) AND v_targets->v_index IS DISTINCT FROM r.targets->v_index THEN RAISE EXCEPTION 'Cannot modify existing targets.'; END IF;
      END LOOP;
    END IF;
  END IF;
  IF (p_updates ? 'total_rounds' OR p_updates ? 'round_seconds' OR p_updates ? 'no_moving' OR p_updates ? 'no_panning' OR p_updates ? 'no_zooming' OR p_updates ? 'enable_time_multiplier' OR p_updates ? 'selected_maps' OR p_updates ? 'is_public')
     AND (r.mode <> 'creatorRoom' OR r.status <> 'waiting') THEN RAISE EXCEPTION 'Lobby settings may only be changed by the creator before a match starts.'; END IF;
  IF p_updates ? 'current_round' AND NOT v_is_creator_reset AND ((p_updates->>'current_round')::integer < r.current_round OR (p_updates->>'current_round')::integer > r.current_round + 1) THEN RAISE EXCEPTION 'Invalid round transition.'; END IF;
  UPDATE public.match_rooms SET
    targets = CASE WHEN p_updates ? 'targets' THEN p_updates->'targets' ELSE r.targets END,
    current_round = CASE WHEN p_updates ? 'current_round' THEN (p_updates->>'current_round')::integer ELSE r.current_round END,
    status = CASE WHEN p_updates ? 'status' THEN p_updates->>'status' ELSE r.status END,
    total_rounds = CASE WHEN p_updates ? 'total_rounds' THEN (p_updates->>'total_rounds')::integer ELSE r.total_rounds END,
    round_seconds = CASE WHEN p_updates ? 'round_seconds' THEN (p_updates->>'round_seconds')::integer ELSE r.round_seconds END,
    no_moving = CASE WHEN p_updates ? 'no_moving' THEN (p_updates->>'no_moving')::boolean ELSE r.no_moving END,
    no_panning = CASE WHEN p_updates ? 'no_panning' THEN (p_updates->>'no_panning')::boolean ELSE r.no_panning END,
    no_zooming = CASE WHEN p_updates ? 'no_zooming' THEN (p_updates->>'no_zooming')::boolean ELSE r.no_zooming END,
    enable_time_multiplier = CASE WHEN p_updates ? 'enable_time_multiplier' THEN (p_updates->>'enable_time_multiplier')::boolean ELSE r.enable_time_multiplier END,
    selected_maps = CASE WHEN p_updates ? 'selected_maps' THEN p_updates->'selected_maps' ELSE r.selected_maps END,
    is_public = CASE WHEN p_updates ? 'is_public' THEN (p_updates->>'is_public')::boolean ELSE r.is_public END,
    ready_states = CASE WHEN p_updates ? 'ready_states' THEN p_updates->'ready_states' ELSE r.ready_states END,
    updated_at = now()
  WHERE id = p_room_id;
END;
$$;

-- Keep the existing implementation intact, but place an authorization and state
-- gate in front of it. This prevents clients from scoring a future/finished round.
ALTER FUNCTION public.submit_match_guess(text, integer, double precision, double precision, integer, jsonb)
  RENAME TO submit_match_guess_internal;
REVOKE EXECUTE ON FUNCTION public.submit_match_guess_internal(text, integer, double precision, double precision, integer, jsonb) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.submit_match_guess_internal(text, integer, double precision, double precision, integer, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.submit_match_guess(
  p_room_id text, p_round integer, p_guess_lat double precision, p_guess_lng double precision,
  p_time_left integer, p_telemetry jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_round integer; v_status text; v_user_id text := auth.uid()::text;
  v_total_rounds integer; v_mode text; v_submissions jsonb; v_participants jsonb;
  v_player1 text; v_player2 text; v_everyone_done boolean := false; v_idx integer; v_participant text; v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT current_round, status, total_rounds, mode, round_submissions, participants, player1_id, player2_id
    INTO v_current_round, v_status, v_total_rounds, v_mode, v_submissions, v_participants, v_player1, v_player2
    FROM public.match_rooms
    WHERE id = p_room_id AND (player1_id = v_user_id OR player2_id = v_user_id OR participants ? v_user_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a participant of this room'; END IF;
  IF v_status <> 'active' OR p_round <> v_current_round THEN RAISE EXCEPTION 'Guess does not match the active round.'; END IF;
  v_result := public.submit_match_guess_internal(p_room_id, p_round, p_guess_lat, p_guess_lng, p_time_left, p_telemetry);
  IF COALESCE((v_result->>'cheat_detected')::boolean, false) THEN RETURN v_result; END IF;
  SELECT status, round_submissions INTO v_status, v_submissions FROM public.match_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_status = 'active' AND p_round < v_total_rounds THEN
    IF v_mode = 'headToHead' THEN
      v_everyone_done := (v_submissions->p_round::text->v_player1) IS NOT NULL AND (v_submissions->p_round::text->v_player2) IS NOT NULL;
    ELSIF v_mode = 'creatorRoom' THEN
      v_everyone_done := jsonb_array_length(COALESCE(v_participants, '[]'::jsonb)) > 0;
      FOR v_idx IN 0 .. greatest(jsonb_array_length(COALESCE(v_participants, '[]'::jsonb)) - 1, 0) LOOP
        v_participant := v_participants->>v_idx;
        IF v_participant IS NOT NULL AND (v_submissions->p_round::text->v_participant) IS NULL THEN v_everyone_done := false; END IF;
      END LOOP;
    ELSE
      v_everyone_done := true;
    END IF;
    IF v_everyone_done THEN
      UPDATE public.match_rooms SET current_round = p_round + 1, updated_at = now() WHERE id = p_room_id AND current_round = p_round AND status = 'active';
    END IF;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_forfeit_match(p_room_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.match_rooms%ROWTYPE; v_user_id text := auth.uid()::text; v_opponent text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.match_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR r.mode <> 'headToHead' OR r.status <> 'active' OR v_user_id NOT IN (r.player1_id, r.player2_id) THEN
    RAISE EXCEPTION 'Only an active duel participant may forfeit.';
  END IF;
  v_opponent := CASE WHEN r.player1_id = v_user_id THEN r.player2_id ELSE r.player1_id END;
  UPDATE public.match_rooms SET status = 'completed', winner_id = v_opponent,
    scores = jsonb_set(COALESCE(r.scores, '{}'::jsonb), ARRAY[v_user_id], '-1'::jsonb),
    player1_score = CASE WHEN r.player1_id = v_user_id THEN -1 ELSE r.player1_score END,
    player2_score = CASE WHEN r.player2_id = v_user_id THEN -1 ELSE r.player2_score END,
    updated_at = now() WHERE id = p_room_id;
END;
$$;

DROP POLICY IF EXISTS "Participants can update rooms" ON public.match_rooms;
DROP POLICY IF EXISTS "No direct room updates" ON public.match_rooms;
CREATE POLICY "No direct room updates"
  ON public.match_rooms FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.find_room_by_code_safe(p_code text)
RETURNS SETOF public.match_rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_current_user_banned() OR p_code !~ '^[A-Za-z0-9]{6}$' THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.match_rooms WHERE status = 'waiting' AND upper(id) = upper(p_code) LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile(
  p_user_id uuid, p_email text DEFAULT NULL, p_display_name text DEFAULT NULL, p_avatar_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text; v_auth_email text := auth.jwt() ->> 'email'; v_result jsonb;
BEGIN
  PERFORM public.assert_current_user(p_user_id::text);
  IF p_email IS DISTINCT FROM v_auth_email THEN RAISE EXCEPTION 'Email does not match authenticated identity.'; END IF;
  SELECT display_name INTO v_name FROM public.profiles WHERE id = p_user_id::text FOR UPDATE;
  IF FOUND THEN
    UPDATE public.profiles SET email = COALESCE(v_auth_email, email), display_name = CASE WHEN (display_name LIKE 'Guest #%' OR display_name IS NULL OR display_name = '') AND p_display_name IS NOT NULL THEN left(p_display_name, 80) ELSE display_name END,
      avatar_url = COALESCE(avatar_url, left(p_avatar_url, 2048)), last_seen = now(), updated_at = now() WHERE id = p_user_id::text
      RETURNING jsonb_build_object('display_name', display_name) INTO v_result;
    RETURN v_result;
  END IF;
  v_name := CASE WHEN v_auth_email IS NULL OR p_display_name IS NULL OR btrim(p_display_name) = '' THEN 'Guest #' || (floor(random() * 900000) + 100000)::text ELSE left(btrim(p_display_name), 80) END;
  INSERT INTO public.profiles (id, email, display_name, avatar_url, updated_at, last_seen) VALUES (p_user_id::text, v_auth_email, v_name, left(p_avatar_url, 2048), now(), now())
    RETURNING jsonb_build_object('display_name', display_name) INTO v_result;
  RETURN v_result;
END;
$$;

-- Profile rows include email, moderation state, and presence data. Do not expose
-- those fields merely because a player is signed in; use this narrow RPC for
-- opponent cards, scoreboards, and other public-facing identity data.
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users view their own profile or admins view all profiles" ON public.profiles;
CREATE POLICY "Users view their own profile or admins view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid()::text = id OR public.is_current_user_admin());

-- Profile content is updated only through update_profile_safe/sync_profile.
-- Presence remains a narrow, self-scoped direct update used by the client.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (online_status, last_seen, updated_at) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_profiles(p_ids text[])
RETURNS TABLE (id text, display_name text, avatar_url text, exp integer, elo integer, games_played integer, last_avg_score double precision)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_current_user_banned() OR cardinality(p_ids) > 30 THEN
    RAISE EXCEPTION 'Unauthorized public profile request.';
  END IF;
  RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_url, p.exp, p.elo, p.games_played, p.last_avg_score
    FROM public.profiles p
    WHERE p.id = ANY(p_ids) AND p.is_banned = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.safe_leave_matchmaking_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_cleanup_my_rooms() TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_close_match_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_join_match_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_leave_match_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_set_player_ready(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_kick_participant_from_room(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_find_match(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_create_match_room(text, text, jsonb, integer, integer, boolean, boolean, boolean, jsonb, text, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_update_match_room(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_room_by_code_safe(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_match_guess(text, integer, double precision, double precision, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_forfeit_match(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(text[]) TO authenticated;
