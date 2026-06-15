-- 06_rpc_gameplay.sql
-- Gameplay calculations, score calculation, and guess submissions

-- 1. Secure Score Calculation Functions
CREATE OR REPLACE FUNCTION public.haversine_distance_km(
  lat1 double precision, 
  lng1 double precision, 
  lat2 double precision, 
  lng2 double precision
)
RETURNS double precision AS $$
DECLARE
  R double precision := 6371.0;
  dLat double precision;
  dLng double precision;
  a_rad double precision;
  b_rad double precision;
  h double precision;
BEGIN
  dLat := radians(lat2 - lat1);
  dLng := radians(lng2 - lng1);
  a_rad := radians(lat1);
  b_rad := radians(lat2);
  
  h := sin(dLat / 2.0) * sin(dLat / 2.0) +
       cos(a_rad) * cos(b_rad) * sin(dLng / 2.0) * sin(dLng / 2.0);
       
  RETURN 2.0 * R * asin(least(1.0, sqrt(h)));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.calculate_score(
  distance_km double precision, 
  time_left double precision, 
  round_seconds double precision
)
RETURNS integer AS $$
DECLARE
  distance_score double precision;
  time_bonus double precision;
BEGIN
  distance_score := 5000.0 * exp(-distance_km / 1500.0);
  time_bonus := 0.6 + 0.4 * (time_left / greatest(1.0, round_seconds));
  RETURN greatest(0, round(distance_score * time_bonus))::integer;
END;
$$ LANGUAGE plpgsql;

-- 2. Secure Guess Submission and Telemetry Verification RPC
CREATE OR REPLACE FUNCTION public.submit_match_guess(
  p_room_id text,
  p_round integer,
  p_guess_lat double precision,
  p_guess_lng double precision,
  p_time_left integer,
  p_telemetry jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_user_id text;
  v_username text;
  v_target_lat double precision;
  v_target_lng double precision;
  v_targets jsonb;
  v_distance_km double precision;
  v_score integer;
  v_round_seconds integer;
  v_no_moving boolean;
  v_no_panning boolean;
  v_no_zooming boolean;
  v_mode text;
  v_cheat_detected boolean := false;
  v_cheat_reason text := '';
  v_is_fallback boolean := false;
  v_pans integer;
  v_zooms integer;
  v_blurs integer;
  v_duration double precision;
  v_is_banned boolean;
  v_scores jsonb;
  v_participants jsonb;
  v_current_round integer;
  v_status text;
  v_enable_time_multiplier boolean;
  v_res jsonb;
  
  -- Additional variables for secure score recording
  v_player1_id text;
  v_player2_id text;
  v_total_rounds integer;
  v_round_submissions jsonb;
  v_everyone_done boolean := false;
  v_winner_id text := NULL;
  v_score1 integer;
  v_score2 integer;
  v_new_total_score integer;
  v_idx integer;
  v_p_id text;
  v_existing_sub jsonb;
  v_max_score integer;
  v_curr_score integer;
  v_is_draw boolean;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid()::text;
  
  -- If not logged in, error out
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user is banned
  SELECT is_banned, display_name INTO v_is_banned, v_username FROM public.profiles WHERE id = v_user_id;
  IF v_is_banned = true THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  -- Get room details
  SELECT 
    targets, round_seconds, no_moving, no_panning, no_zooming, mode, scores, participants, current_round, status, enable_time_multiplier, player1_id, player2_id, total_rounds, round_submissions
  INTO 
    v_targets, v_round_seconds, v_no_moving, v_no_panning, v_no_zooming, v_mode, v_scores, v_participants, v_current_round, v_status, v_enable_time_multiplier, v_player1_id, v_player2_id, v_total_rounds, v_round_submissions
  FROM public.match_rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  -- Verify user is a participant
  IF NOT EXISTS (
    SELECT 1 FROM public.match_rooms 
    WHERE id = p_room_id 
    AND (player1_id = v_user_id OR player2_id = v_user_id OR participants ? v_user_id)
  ) THEN
    RAISE EXCEPTION 'Not a participant of this room';
  END IF;

  -- Verify timer sanity
  IF p_time_left > v_round_seconds OR p_time_left < 0 THEN
    v_cheat_detected := true;
    v_cheat_reason := 'Time-freezing or invalid remaining duration: ' || p_time_left || 's (max: ' || v_round_seconds || 's)';
  END IF;

  -- Parse telemetry
  v_pans := COALESCE((p_telemetry->>'pans')::integer, 0);
  v_zooms := COALESCE((p_telemetry->>'zooms')::integer, 0);
  v_blurs := COALESCE((p_telemetry->>'blurs')::integer, 0);
  v_duration := COALESCE((p_telemetry->>'duration')::double precision, 0.0);

  -- Get the target for this round (0-indexed in array)
  IF jsonb_array_length(v_targets) < p_round THEN
    RAISE EXCEPTION 'Invalid round index';
  END IF;

  v_target_lat := (v_targets->(p_round - 1)->>'lat')::double precision;
  v_target_lng := (v_targets->(p_round - 1)->>'lng')::double precision;

  -- Check if user has already submitted a guess for this round
  -- round_submissions format: { "round_num": { "user_id": { "score": score, "guess": { "lat": lat, "lng": lng } } } }
  IF COALESCE(v_round_submissions, '{}'::jsonb) ? p_round::text AND (COALESCE(v_round_submissions, '{}'::jsonb)->p_round::text) ? v_user_id THEN
    v_existing_sub := v_round_submissions->p_round::text->v_user_id;
    RETURN jsonb_build_object(
      'cheat_detected', false,
      'score', (v_existing_sub->>'score')::integer,
      'distance_km', CASE 
        WHEN (v_existing_sub->'guess'->>'lat') IS NULL THEN 20000.0
        ELSE public.haversine_distance_km(
          (v_existing_sub->'guess'->>'lat')::double precision,
          (v_existing_sub->'guess'->>'lng')::double precision,
          v_target_lat,
          v_target_lng
        )
      END,
      'target', jsonb_build_object('lat', v_target_lat, 'lng', v_target_lng),
      'already_submitted', true
    );
  END IF;

  -- Check if target is a known fallback location (tolerating slight floating precision)
  SELECT EXISTS (
    SELECT 1 FROM public.map_fallback_locations
    WHERE abs(lat - v_target_lat) < 1e-4 AND abs(lng - v_target_lng) < 1e-4
  ) INTO v_is_fallback;

  -- Compute distance and score
  IF p_guess_lat IS NULL OR p_guess_lng IS NULL THEN
    v_distance_km := 20000.0;
    v_score := 0;
  ELSE
    v_distance_km := public.haversine_distance_km(p_guess_lat, p_guess_lng, v_target_lat, v_target_lng);
    IF COALESCE(v_enable_time_multiplier, true) = true THEN
      v_score := public.calculate_score(v_distance_km, p_time_left, v_round_seconds);
    ELSE
      v_score := greatest(0, round(5000.0 * exp(-v_distance_km / 1500.0)))::integer;
    END IF;
  END IF;

  -- Telemetry Heuristics / Anti-Cheat Checks
  IF p_guess_lat IS NOT NULL AND p_guess_lng IS NOT NULL THEN
    -- 1. Exact coordinate match (Coordinate Injection)
    IF abs(p_guess_lat - v_target_lat) < 1e-6 AND abs(p_guess_lng - v_target_lng) < 1e-6 AND v_is_fallback = false THEN
      v_cheat_detected := true;
      v_cheat_reason := 'Exact coordinate injection (match within 10cm)';
    END IF;

    -- 2. Perfect guess in < 3s, or with 0 movement
    -- ONLY flag zero movement if panning/zooming are allowed AND it is not a fallback location
    IF v_distance_km < 0.01 AND v_pans = 0 AND v_zooms = 0 AND v_mode != 'chaos' AND v_no_panning = false AND v_no_zooming = false AND v_is_fallback = false THEN
      v_cheat_detected := true;
      v_cheat_reason := 'Perfect guess with zero camera panning and zooming';
    -- ONLY flag perfect guess in < 3s if it is not a fallback location
    ELSIF v_distance_km < 0.1 AND p_time_left >= (v_round_seconds - 3) AND v_mode != 'chaos' AND v_is_fallback = false THEN
      v_cheat_detected := true;
      v_cheat_reason := 'Perfect guess within 3 seconds of round start';
    END IF;
  END IF;

  -- 3. No Panning/Zooming restriction bypass
  IF v_no_panning = true AND v_pans > 0 THEN
    v_cheat_detected := true;
    v_cheat_reason := 'Bypassed no-panning restriction';
  END IF;
  IF v_no_zooming = true AND v_zooms > 0 THEN
    v_cheat_detected := true;
    v_cheat_reason := 'Bypassed no-zooming restriction';
  END IF;

  -- If cheat is detected, log and auto-ban
  IF v_cheat_detected THEN
    -- Log cheat
    INSERT INTO public.cheat_logs (
      user_id, username, reason, severity, telemetry_details, round_index, room_id
    ) VALUES (
      v_user_id, COALESCE(v_username, 'Banned User'), v_cheat_reason, 'ban_auto', p_telemetry, p_round, p_room_id
    );

    -- Auto-ban user
    UPDATE public.profiles
    SET is_banned = true,
        ban_reason = 'Automated Anti-Cheat Ban: ' || v_cheat_reason,
        ban_timestamp = now()
    WHERE id = v_user_id;
    
    -- Return response with cheat flag
    RETURN jsonb_build_object(
      'cheat_detected', true,
      'reason', v_cheat_reason,
      'score', 0,
      'distance_km', v_distance_km,
      'target', jsonb_build_object('lat', v_target_lat, 'lng', v_target_lng)
    );
  END IF;

  -- Calculate new total score
  v_new_total_score := COALESCE((v_scores->>v_user_id)::integer, 0) + v_score;
  v_scores := jsonb_set(COALESCE(v_scores, '{}'::jsonb), ARRAY[v_user_id], to_jsonb(v_new_total_score));

  -- Update round_submissions
  IF NOT (COALESCE(v_round_submissions, '{}'::jsonb) ? p_round::text) THEN
    v_round_submissions := jsonb_set(COALESCE(v_round_submissions, '{}'::jsonb), ARRAY[p_round::text], '{}'::jsonb);
  END IF;
  v_round_submissions := jsonb_set(
    v_round_submissions, 
    ARRAY[p_round::text, v_user_id], 
    jsonb_build_object(
      'score', v_score,
      'guess', CASE 
        WHEN p_guess_lat IS NULL OR p_guess_lng IS NULL THEN NULL
        ELSE jsonb_build_object('lat', p_guess_lat, 'lng', p_guess_lng)
      END
    )
  );

  -- Determine if everyone is done for this round
  IF v_mode = 'headToHead' THEN
    IF (v_round_submissions->p_round::text->v_player1_id) IS NOT NULL AND
       (v_round_submissions->p_round::text->COALESCE(v_player2_id, '')) IS NOT NULL THEN
      v_everyone_done := true;
    END IF;
  ELSIF v_mode = 'creatorRoom' THEN
    v_everyone_done := true;
    IF v_participants IS NOT NULL AND jsonb_array_length(v_participants) > 0 THEN
      FOR v_idx IN 0 .. (jsonb_array_length(v_participants) - 1) LOOP
        v_p_id := (v_participants->v_idx)::text;
        v_p_id := replace(v_p_id, '"', '');
        IF (v_round_submissions->p_round::text->v_p_id) IS NULL THEN
          v_everyone_done := false;
        END IF;
      END LOOP;
    ELSE
      v_everyone_done := false;
    END IF;
  ELSIF v_mode = 'classic' THEN
    v_everyone_done := true;
  END IF;

  -- If it is the final round and everyone is done, set status to 'completed' and compute winner
  IF p_round = v_total_rounds AND v_everyone_done THEN
    v_status := 'completed';
    -- Compute winner
    IF v_mode = 'headToHead' THEN
      v_score1 := COALESCE((v_scores->>v_player1_id)::integer, 0);
      v_score2 := COALESCE((v_scores->>v_player2_id)::integer, 0);
      IF v_score1 > v_score2 THEN
        v_winner_id := v_player1_id;
      ELSIF v_score2 > v_score1 THEN
        v_winner_id := v_player2_id;
      ELSE
        v_winner_id := 'draw';
      END IF;
    ELSIF v_mode = 'creatorRoom' THEN
      -- Find participant with the highest score
      v_max_score := -1;
      v_is_draw := false;
      IF v_participants IS NOT NULL AND jsonb_array_length(v_participants) > 0 THEN
        FOR v_idx IN 0 .. (jsonb_array_length(v_participants) - 1) LOOP
          v_p_id := (v_participants->v_idx)::text;
          v_p_id := replace(v_p_id, '"', '');
          v_curr_score := COALESCE((v_scores->>v_p_id)::integer, 0);
          IF v_curr_score > v_max_score THEN
            v_max_score := v_curr_score;
            v_winner_id := v_p_id;
            v_is_draw := false;
          ELSIF v_curr_score = v_max_score THEN
            v_is_draw := true;
          END IF;
        END LOOP;
      END IF;
      IF v_is_draw THEN
        v_winner_id := 'draw';
      END IF;
    END IF;
  END IF;

  -- Save to database
  UPDATE public.match_rooms
  SET 
    round_submissions = v_round_submissions,
    scores = v_scores,
    player1_score = CASE WHEN v_player1_id IS NOT NULL THEN COALESCE((v_scores->>v_player1_id)::integer, 0) ELSE player1_score END,
    player2_score = CASE WHEN v_player2_id IS NOT NULL THEN COALESCE((v_scores->>v_player2_id)::integer, 0) ELSE player2_score END,
    status = v_status,
    winner_id = CASE WHEN v_status = 'completed' THEN v_winner_id ELSE winner_id END
  WHERE id = p_room_id;

  -- Return successful verification
  RETURN jsonb_build_object(
    'cheat_detected', false,
    'score', v_score,
    'distance_km', v_distance_km,
    'target', jsonb_build_object('lat', v_target_lat, 'lng', v_target_lng)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.submit_match_guess(text, integer, double precision, double precision, integer, jsonb) TO authenticated;
