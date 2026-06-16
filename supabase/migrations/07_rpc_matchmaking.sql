-- 07_rpc_matchmaking.sql
-- Matchmaking queue, match rooms management, and lobby discovery RPC functions

-- 1. Close match room
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

-- 2. Cleanup user waiting rooms
CREATE OR REPLACE FUNCTION public.cleanup_user_rooms(p_user_id text)
RETURNS void AS $$
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Delete rooms where user is host (player1) and room is waiting
  DELETE FROM public.match_rooms
  WHERE player1_id = p_user_id AND status = 'waiting';

  -- Remove user from participants & ready_states in all other waiting rooms they joined as guest
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

-- 3. Leave matchmaking queue
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

-- 4. Join match room (supporting public/private waiting creator room check)
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
  v_is_public boolean;
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Get current room details with row-level lock
  SELECT participants, player1_id, player2_id, status, is_public
  INTO v_participants, v_player1_id, v_player2_id, v_status, v_is_public
  FROM public.match_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN false; -- Room not found
  END IF;

  IF v_status != 'waiting' THEN
    RETURN false; -- Cannot join active or completed games
  END IF;

  -- Block new joiners if room is private (existing participants can still reconnect)
  IF v_is_public = false AND NOT (v_participants ? p_user_id) AND v_player1_id != p_user_id THEN
    RETURN false; -- Room is private
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

-- 5. Leave match room
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
  v_new_host_id text;
  v_new_host_name text;
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

  -- If user is not in participants, nothing to do
  IF NOT (v_participants ? p_user_id) THEN
    RETURN true;
  END IF;

  -- Remove user from participants and ready_states
  v_participants := v_participants - p_user_id;
  IF v_ready_states IS NOT NULL THEN
    v_ready_states := v_ready_states - p_user_id;
  END IF;

  -- If no participants left, delete the room
  IF jsonb_array_length(v_participants) = 0 THEN
    DELETE FROM public.match_rooms WHERE id = p_room_id;
    RETURN true;
  END IF;

  -- If the leaving user was the host (player1_id)
  IF v_player1_id = p_user_id THEN
    -- Promote the first remaining participant to host
    v_new_host_id := v_participants ->> 0;
    
    -- Find new player2_id (first remaining participant who is not the new host)
    SELECT value INTO v_player2_id
    FROM jsonb_array_elements_text(v_participants)
    WHERE value != v_new_host_id
    LIMIT 1;

    -- Ensure the new host is set to ready
    IF v_ready_states IS NULL THEN
      v_ready_states := '{}'::jsonb;
    END IF;
    v_ready_states := jsonb_set(v_ready_states, ARRAY[v_new_host_id], 'true'::jsonb);

    UPDATE public.match_rooms
    SET player1_id = v_new_host_id,
        player2_id = v_player2_id,
        participants = v_participants,
        ready_states = v_ready_states,
        updated_at = now()
    WHERE id = p_room_id;

    -- Get new host's display name
    SELECT COALESCE(display_name, 'Guest Player') INTO v_new_host_name
    FROM public.profiles
    WHERE id = v_new_host_id;

    -- Insert system message
    INSERT INTO public.room_messages (room_id, username, content, is_system)
    VALUES (p_room_id, 'System', v_new_host_name || ' has been appointed as the new host after the previous host left.', true);
  ELSE
    -- If a non-host left, just update participants, ready_states, and player2_id
    IF v_player2_id = p_user_id THEN
      -- Find new player2_id (first participant who is not the host)
      SELECT value INTO v_player2_id
      FROM jsonb_array_elements_text(v_participants)
      WHERE value != v_player1_id
      LIMIT 1;
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

-- 6. Set player ready status
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

-- 7. Kick participant from creator room
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

-- 8. Find matchmaking match
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

-- 9. Find room securely by code
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

-- 10. List public waiting rooms
CREATE OR REPLACE FUNCTION public.list_public_rooms()
RETURNS TABLE (
  id text,
  host_display_name text,
  participant_count integer,
  total_rounds integer,
  round_seconds integer,
  no_moving boolean,
  no_panning boolean,
  no_zooming boolean,
  enable_time_multiplier boolean,
  selected_maps jsonb,
  created_at timestamptz
) AS $$
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  RETURN QUERY
    SELECT
      mr.id,
      COALESCE(p.display_name, 'Unknown Host') AS host_display_name,
      jsonb_array_length(mr.participants)::integer AS participant_count,
      mr.total_rounds,
      mr.round_seconds,
      mr.no_moving,
      mr.no_panning,
      mr.no_zooming,
      mr.enable_time_multiplier,
      mr.selected_maps,
      mr.created_at
    FROM public.match_rooms mr
    LEFT JOIN public.profiles p ON p.id = mr.player1_id
    WHERE mr.status = 'waiting'
      AND mr.mode = 'creatorRoom'
      AND (mr.is_public IS NULL OR mr.is_public = true)
      AND jsonb_array_length(mr.participants) < 30
    ORDER BY mr.created_at DESC
    LIMIT 20;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.list_public_rooms() TO authenticated;

-- 11. Transfer room host manually
CREATE OR REPLACE FUNCTION public.transfer_room_host(
  p_room_id text,
  p_current_host_id text,
  p_new_host_id text
)
RETURNS boolean AS $$
DECLARE
  v_room_host text;
  v_participants jsonb;
  v_ready_states jsonb;
  v_player2_id text;
  v_new_host_name text;
BEGIN
  IF public.is_current_user_banned() THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Verify the caller is the host
  SELECT player1_id, participants, ready_states INTO v_room_host, v_participants, v_ready_states
  FROM public.match_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF v_room_host IS NULL THEN
    RETURN false; -- Room not found
  END IF;

  IF v_room_host != p_current_host_id OR v_room_host != auth.uid()::text THEN
    RETURN false; -- Not authorized
  END IF;

  -- Verify new host is a participant
  IF NOT (v_participants ? p_new_host_id) THEN
    RETURN false; -- New host is not in the room
  END IF;

  -- Determine the new player2_id (first participant who is not the new host)
  SELECT value INTO v_player2_id
  FROM jsonb_array_elements_text(v_participants)
  WHERE value != p_new_host_id
  LIMIT 1;

  -- Ensure new host is set to ready
  IF v_ready_states IS NULL THEN
    v_ready_states := '{}'::jsonb;
  END IF;
  v_ready_states := jsonb_set(v_ready_states, ARRAY[p_new_host_id], 'true'::jsonb);

  UPDATE public.match_rooms
  SET player1_id = p_new_host_id,
      player2_id = v_player2_id,
      ready_states = v_ready_states,
      updated_at = now()
  WHERE id = p_room_id;

  -- Get new host's display name
  SELECT COALESCE(display_name, 'Guest Player') INTO v_new_host_name
  FROM public.profiles
  WHERE id = p_new_host_id;

  -- Insert a system message into room_messages
  INSERT INTO public.room_messages (room_id, username, content, is_system)
  VALUES (p_room_id, 'System', v_new_host_name || ' has been appointed as the new host.', true);

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.transfer_room_host(text, text, text) TO authenticated;

-- 12. Elect new host if current host disconnects (presence timeout fallback)
CREATE OR REPLACE FUNCTION public.migrate_host_on_disconnect(
  p_room_id text,
  p_disconnected_host_id text
)
RETURNS boolean AS $$
DECLARE
  v_participants jsonb;
  v_ready_states jsonb;
  v_player1_id text;
  v_player2_id text;
  v_new_host_id text;
  v_new_host_name text;
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

  IF v_player1_id IS NULL OR v_player1_id != p_disconnected_host_id THEN
    RETURN false; -- Host already changed or room doesn't exist
  END IF;

  -- Remove disconnected host from participants and ready_states
  v_participants := v_participants - p_disconnected_host_id;
  IF v_ready_states IS NOT NULL THEN
    v_ready_states := v_ready_states - p_disconnected_host_id;
  END IF;

  -- If no participants left, delete the room
  IF jsonb_array_length(v_participants) = 0 THEN
    DELETE FROM public.match_rooms WHERE id = p_room_id;
    RETURN true;
  END IF;

  -- Promote the first remaining participant to host
  v_new_host_id := v_participants ->> 0;
  
  -- Find new player2_id (first remaining participant who is not the new host)
  SELECT value INTO v_player2_id
  FROM jsonb_array_elements_text(v_participants)
  WHERE value != v_new_host_id
  LIMIT 1;

  -- Ensure new host is set to ready
  IF v_ready_states IS NULL THEN
    v_ready_states := '{}'::jsonb;
  END IF;
  v_ready_states := jsonb_set(v_ready_states, ARRAY[v_new_host_id], 'true'::jsonb);

  UPDATE public.match_rooms
  SET player1_id = v_new_host_id,
      player2_id = v_player2_id,
      participants = v_participants,
      ready_states = v_ready_states,
      updated_at = now()
  WHERE id = p_room_id;

  -- Get new host's display name
  SELECT COALESCE(display_name, 'Guest Player') INTO v_new_host_name
  FROM public.profiles
  WHERE id = v_new_host_id;

  -- Insert system message
  INSERT INTO public.room_messages (room_id, username, content, is_system)
  VALUES (p_room_id, 'System', v_new_host_name || ' has been appointed as the new host due to host disconnection.', true);

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.migrate_host_on_disconnect(text, text) TO authenticated;

