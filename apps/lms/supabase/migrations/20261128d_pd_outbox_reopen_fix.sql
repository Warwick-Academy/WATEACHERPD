-- =====================================================================
-- WATEACHERPD — PD module: outbox single-claim + reopen handling
-- Run AFTER 20261128c_pd_dispatch_token.sql. Safe to re-run.
--  1. pd_claim_my_notifications(p_dispatch_token) keeps its signature but
--     now claims AT MOST ONE notice per call (call again for the next).
--  2. Notices for an obsolete publication are never claimed:
--     - reopening an observation cancels its pending / failed notices
--       (new status 'cancelled') in the same transaction;
--     - both claim functions only claim a notice whose observation is still
--       published/signed with the same published_at as the notice's key,
--       and they share-lock the observation row, so a claim waits for an
--       in-progress reopen and then re-checks (and a reopen waits for an
--       in-progress claim).
--     Residual risk (cannot be removed without provider idempotency): a
--     notice already claimed before the reopen committed may still be sent
--     in the seconds between claim and send. Such rows keep their outcome.
--  3. The first-response-only rule is unchanged.
-- =====================================================================

-- 'cancelled' status
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.pd_notification_outbox'::regclass AND con.contype = 'c' AND att.attname = 'status'
  LOOP
    EXECUTE format('ALTER TABLE public.pd_notification_outbox DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE pd_notification_outbox ADD CONSTRAINT pd_notification_outbox_status_check
  CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'uncertain', 'cancelled'));

-- Reopen cancels unsent notices for the old publication (same transaction)
CREATE OR REPLACE FUNCTION public.pd_cancel_notices_on_reopen()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    UPDATE pd_notification_outbox
    SET status = 'cancelled', completed_at = NOW(), last_error = 'observation reopened'
    WHERE observation_id = NEW.id
      AND status IN ('pending', 'failed')
      AND event_key = public.pd_obs_event_key(OLD.published_at);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_obs_cancel_notices ON pd_observations;
CREATE TRIGGER trg_pd_obs_cancel_notices AFTER UPDATE OF status ON pd_observations
  FOR EACH ROW EXECUTE FUNCTION public.pd_cancel_notices_on_reopen();

-- 1 + 2. Immediate dispatch: at most one current notice per call
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
    JOIN pd_observations o ON o.id = n.observation_id
    WHERE n.actor_id = auth.uid() AND n.status = 'pending'
      AND n.created_at > NOW() - INTERVAL '1 hour'
      AND o.status IN ('published', 'signed')
      AND n.event_key = public.pd_obs_event_key(o.published_at)
    ORDER BY n.id
    LIMIT 1
    FOR UPDATE OF n SKIP LOCKED
    FOR SHARE OF o
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

-- 2. Scheduled recovery: same currency check
CREATE OR REPLACE FUNCTION public.pd_claim_pending_notifications(p_limit INTEGER DEFAULT 50, p_min_age_minutes INTEGER DEFAULT 5)
RETURNS TABLE (outbox_id BIGINT, event_type TEXT, observation_id UUID,
               recipient_id UUID, recipient_email TEXT, recipient_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT n.id FROM pd_notification_outbox n
    JOIN pd_observations o ON o.id = n.observation_id
    WHERE ((n.status = 'pending' AND n.created_at < NOW() - make_interval(mins => p_min_age_minutes))
           OR (n.status = 'failed' AND n.attempts < 3))
      AND o.status IN ('published', 'signed')
      AND n.event_key = public.pd_obs_event_key(o.published_at)
    ORDER BY n.id
    LIMIT p_limit
    FOR UPDATE OF n SKIP LOCKED
    FOR SHARE OF o
  ), claimed AS (
    UPDATE pd_notification_outbox n
    SET status = 'claimed', claimed_at = NOW(), claimed_by = NULL, attempts = n.attempts + 1,
        completed_at = NULL, last_error = NULL
    FROM picked WHERE n.id = picked.id
    RETURNING n.id, n.event_type, n.observation_id, n.recipient_id
  )
  SELECT c.id, c.event_type, c.observation_id, c.recipient_id, p.email, p.name
  FROM claimed c JOIN profiles p ON p.id = c.recipient_id;
END;
$$;

-- Housekeeping also cancels any unsent notice that is no longer current
CREATE OR REPLACE FUNCTION public.pd_mark_stale_notifications(p_minutes INTEGER DEFAULT 30)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER; v_cancel INTEGER;
BEGIN
  UPDATE pd_notification_outbox
  SET status = 'uncertain', completed_at = NOW(),
      last_error = 'claim expired (sender stopped before recording result)'
  WHERE status = 'claimed' AND claimed_at < NOW() - make_interval(mins => p_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE pd_notification_outbox n
  SET status = 'cancelled', completed_at = NOW(), last_error = 'publication no longer current'
  WHERE n.status IN ('pending', 'failed')
    AND NOT EXISTS (
      SELECT 1 FROM pd_observations o
      WHERE o.id = n.observation_id AND o.status IN ('published', 'signed')
        AND n.event_key = public.pd_obs_event_key(o.published_at));
  GET DIAGNOSTICS v_cancel = ROW_COUNT;
  RETURN v_count + v_cancel;
END;
$$;

-- Permissions unchanged from earlier scripts (re-stated for safety)
REVOKE ALL ON FUNCTION public.pd_claim_my_notifications(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_claim_my_notifications(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.pd_claim_pending_notifications(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pd_claim_pending_notifications(INTEGER, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.pd_mark_stale_notifications(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pd_mark_stale_notifications(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.pd_cancel_notices_on_reopen() FROM PUBLIC, anon, authenticated;

-- Done.
