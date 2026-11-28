-- =====================================================================
-- WATEACHERPD — PD module: trusted dispatcher for essential notices
-- Run AFTER 20261128b_pd_notification_outbox.sql. Safe to re-run.
--
-- Problem fixed: any signed-in user could call pd_claim_my_notifications
-- and pd_complete_my_notification('sent') from the browser without an
-- email being sent, suppressing an essential notice.
--
-- Fix: both functions now require a dispatcher key that only the app's
-- server knows (Netlify environment variable PD_DISPATCH_TOKEN). The
-- database stores only a SHA-256 hash of it. Calls from a browser can't
-- supply it, so they are refused. The server route still calls these with
-- the signed-in user's own Supabase client (no service role), and still
-- only gets events that user caused. If no key is set, immediate dispatch
-- is refused and the scheduled job delivers the notices instead.
--
-- The goal reminder rule stays "target date within the next 14 days"
-- (one reminder per goal per target date), as decided by the school.
--
-- SETUP (once, by Mark; never paste the key into chat or Copilot):
--   1. Make a long random key, e.g. in PowerShell:
--        [Convert]::ToBase64String((1..48 | ForEach-Object {Get-Random -Max 256}))
--   2. Netlify > Site configuration > Environment variables:
--        PD_DISPATCH_TOKEN = <the key>   (and in .env.local for local testing)
--   3. Supabase SQL Editor (as postgres):
--        SELECT public.pd_set_dispatch_token('<the key>');
--   4. Redeploy on Netlify.
-- =====================================================================

CREATE TABLE IF NOT EXISTS pd_private_config (
  key TEXT PRIMARY KEY,
  value_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE pd_private_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pd_private_config FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pd_hash_token(p_token TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex');
$$;

-- Set or rotate the key. Only the database owner (SQL Editor) can run this.
CREATE OR REPLACE FUNCTION public.pd_set_dispatch_token(p_token TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RAISE EXCEPTION 'Use a random key of at least 32 characters.';
  END IF;
  INSERT INTO pd_private_config (key, value_hash, updated_at)
  VALUES ('dispatch_token', public.pd_hash_token(p_token), NOW())
  ON CONFLICT (key) DO UPDATE SET value_hash = EXCLUDED.value_hash, updated_at = NOW();
  RETURN 'Dispatcher key saved. Put the same key in Netlify as PD_DISPATCH_TOKEN and redeploy.';
END;
$$;
REVOKE ALL ON FUNCTION public.pd_set_dispatch_token(TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pd_check_dispatch_token(p_token TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT;
BEGIN
  SELECT value_hash INTO v_hash FROM pd_private_config WHERE key = 'dispatch_token';
  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'Notification dispatcher is not configured.';
  END IF;
  IF p_token IS NULL OR public.pd_hash_token(p_token) <> v_hash THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pd_check_dispatch_token(TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Replace the old unprotected functions
DROP FUNCTION IF EXISTS public.pd_claim_my_notifications();
DROP FUNCTION IF EXISTS public.pd_complete_my_notification(BIGINT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.pd_claim_my_notifications(p_dispatch_token TEXT)
RETURNS TABLE (outbox_id BIGINT, event_type TEXT, observation_id UUID,
               recipient_id UUID, recipient_email TEXT, recipient_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.pd_check_dispatch_token(p_dispatch_token);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT n.id FROM pd_notification_outbox n
    WHERE n.actor_id = auth.uid() AND n.status = 'pending'
      AND n.created_at > NOW() - INTERVAL '1 hour'
    ORDER BY n.id
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE pd_notification_outbox n
    SET status = 'claimed', claimed_at = NOW(), claimed_by = auth.uid(), attempts = n.attempts + 1
    FROM picked WHERE n.id = picked.id
    RETURNING n.id, n.event_type, n.observation_id, n.recipient_id
  )
  SELECT c.id, c.event_type, c.observation_id, c.recipient_id, p.email, p.name
  FROM claimed c JOIN profiles p ON p.id = c.recipient_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pd_complete_my_notification(
  p_dispatch_token TEXT, p_id BIGINT, p_outcome TEXT, p_message_id TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.pd_check_dispatch_token(p_dispatch_token);
  IF p_outcome NOT IN ('sent', 'failed', 'uncertain') THEN RAISE EXCEPTION 'Outcome must be sent, failed or uncertain'; END IF;
  UPDATE pd_notification_outbox
  SET status = p_outcome, completed_at = NOW(),
      provider_message_id = LEFT(p_message_id, 200), last_error = LEFT(p_error, 200)
  WHERE id = p_id AND status = 'claimed' AND claimed_by = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification % is not claimed by you', p_id; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pd_claim_my_notifications(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_complete_my_notification(TEXT, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_claim_my_notifications(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pd_complete_my_notification(TEXT, BIGINT, TEXT, TEXT, TEXT) TO authenticated;

-- Done.
