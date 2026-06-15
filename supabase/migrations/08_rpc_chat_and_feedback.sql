-- 08_rpc_chat_and_feedback.sql
-- Chat management and player feedback helper RPC functions

-- 1. Helper function for system message insertion
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

-- 2. Helper function to get active online players count
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
