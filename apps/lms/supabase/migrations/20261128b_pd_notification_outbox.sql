-- =====================================================================
-- WATEACHERPD — PD module: essential-notification outbox (Part 8)
-- Run AFTER 20261128a_pd_reminder_log.sql. Safe to re-run.
--
-- Essential notices are written to an outbox IN THE SAME TRANSACTION as the
-- action that causes them, so they can't be lost if the browser closes or
-- the email request fails.
--
-- Events (one per observation, recipient and publication):
--   observation_published   Form 1/2 published               -> teacher
--   appraisal_ready_to_sign appraisal published               -> teacher
--                           teacher signed, observer hasn't   -> observer
--   appraisal_signed        both have signed                  -> teacher + observer
--   teacher_responded       first response this publication   -> observer
--   teacher_acknowledged    teacher acknowledged (not by signing) -> observer
-- Self-reflections never notify. Inactive recipients are skipped.
-- event_key = the observation's published_at, so a reopened and
-- republished observation gets new notices; repeats are ignored.
--
-- Dispatch:
--   1. Immediately, by the signed-in person who caused the event:
--      pd_claim_my_notifications() then pd_complete_my_notification(...)
--      from a server route using the user's own Supabase client.
--   2. Recovery by the scheduled job (service role):
--      pd_mark_stale_notifications(), pd_claim_pending_notifications(),
--      pd_complete_notification(...)
-- Claims use FOR UPDATE SKIP LOCKED, so no notice is claimed twice.
-- Same at-most-once policy as reminders: 'uncertain' is never resent;
-- definite 'failed' sends are retried by the job, up to 3 attempts.
-- Stores identifiers, status and short error codes only. No content.
-- =====================================================================

CREATE TABLE IF NOT EXISTS pd_notification_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'observation_published', 'appraisal_ready_to_sign', 'appraisal_signed',
    'teacher_responded', 'teacher_acknowledged')),
  observation_id UUID NOT NULL REFERENCES pd_observations(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,   -- who caused it
  event_key TEXT NOT NULL,                                    -- published_at
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claimed_by UUID,                  -- signed-in dispatcher; NULL = scheduled job
  completed_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error TEXT,
  UNIQUE (event_type, observation_id, recipient_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_pd_outbox_status ON pd_notification_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pd_outbox_actor ON pd_notification_outbox(actor_id, status);

ALTER TABLE pd_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pd_notification_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE pd_notification_outbox_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON pd_notification_outbox TO service_role;
GRANT USAGE ON SEQUENCE pd_notification_outbox_id_seq TO service_role;

-- ---------------------------------------------------------------------
-- Writing events (internal)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_enqueue_notice(
  p_event TEXT, p_obs UUID, p_recipient UUID, p_actor UUID, p_key TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_recipient IS NULL OR p_key IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_recipient AND is_active) THEN RETURN; END IF;
  INSERT INTO pd_notification_outbox (event_type, observation_id, recipient_id, actor_id, event_key)
  VALUES (p_event, p_obs, p_recipient, p_actor, p_key)
  ON CONFLICT (event_type, observation_id, recipient_id, event_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.pd_enqueue_notice(TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pd_obs_event_key(p_published TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_published AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

CREATE OR REPLACE FUNCTION public.pd_observation_notices()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key TEXT; v_actor UUID := auth.uid();
BEGIN
  IF NEW.form_type = 'self_reflection' THEN RETURN NEW; END IF;
  v_key := public.pd_obs_event_key(NEW.published_at);

  -- Published
  IF OLD.status = 'draft' AND NEW.status = 'published' THEN
    IF NEW.form_type = 'appraisal' THEN
      PERFORM public.pd_enqueue_notice('appraisal_ready_to_sign', NEW.id, NEW.teacher_id, COALESCE(v_actor, NEW.observer_id), v_key);
    ELSE
      PERFORM public.pd_enqueue_notice('observation_published', NEW.id, NEW.teacher_id, COALESCE(v_actor, NEW.observer_id), v_key);
    END IF;
  END IF;

  -- Teacher signed first: observer now needs to sign
  IF NEW.form_type = 'appraisal' AND OLD.teacher_signed_at IS NULL AND NEW.teacher_signed_at IS NOT NULL
     AND NEW.observer_signed_at IS NULL THEN
    PERFORM public.pd_enqueue_notice('appraisal_ready_to_sign', NEW.id, NEW.observer_id, COALESCE(v_actor, NEW.teacher_id), v_key);
  END IF;

  -- Fully signed
  IF OLD.status <> 'signed' AND NEW.status = 'signed' THEN
    PERFORM public.pd_enqueue_notice('appraisal_signed', NEW.id, NEW.teacher_id, v_actor, v_key);
    PERFORM public.pd_enqueue_notice('appraisal_signed', NEW.id, NEW.observer_id, v_actor, v_key);
  END IF;

  -- Acknowledged (not as part of signing, which has its own notices)
  IF OLD.teacher_acknowledged_at IS NULL AND NEW.teacher_acknowledged_at IS NOT NULL
     AND NOT (OLD.teacher_signed_at IS NULL AND NEW.teacher_signed_at IS NOT NULL) THEN
    PERFORM public.pd_enqueue_notice('teacher_acknowledged', NEW.id, NEW.observer_id, COALESCE(v_actor, NEW.teacher_id), v_key);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_obs_notices ON pd_observations;
CREATE TRIGGER trg_pd_obs_notices AFTER UPDATE ON pd_observations
  FOR EACH ROW EXECUTE FUNCTION public.pd_observation_notices();

-- Teacher response: same as fix 3, plus the 'teacher_responded' notice
CREATE OR REPLACE FUNCTION public.pd_respond_to_observation(
  p_obs UUID, p_response TEXT, p_sections JSONB DEFAULT '[]'::jsonb, p_goal UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o pd_observations; s JSONB;
BEGIN
  SELECT * INTO o FROM pd_observations WHERE id = p_obs FOR UPDATE;
  IF o.id IS NULL OR o.teacher_id <> auth.uid() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF o.status <> 'published' THEN RAISE EXCEPTION 'This observation is not open for responses.'; END IF;
  IF o.form_type = 'appraisal' AND o.teacher_signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'You have already signed this appraisal, so your response can no longer change.';
  END IF;
  IF p_goal IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pd_goals WHERE id = p_goal AND user_id = auth.uid() AND year_id = o.year_id) THEN
    RAISE EXCEPTION 'You can only link to one of your own goals from the same year.';
  END IF;
  UPDATE pd_observations SET teacher_response = p_response, goal_id = COALESCE(p_goal, goal_id) WHERE id = p_obs;
  FOR s IN SELECT * FROM jsonb_array_elements(COALESCE(p_sections, '[]'::jsonb)) LOOP
    INSERT INTO pd_observation_sections (observation_id, category_id, teacher_response)
    VALUES (p_obs, (s->>'category_id')::int, s->>'teacher_response')
    ON CONFLICT (observation_id, category_id) DO UPDATE SET teacher_response = EXCLUDED.teacher_response;
  END LOOP;
  IF o.form_type <> 'self_reflection' THEN
    PERFORM public.pd_enqueue_notice('teacher_responded', p_obs, o.observer_id, auth.uid(),
                                     public.pd_obs_event_key(o.published_at));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 1. Immediate dispatch by the signed-in person who caused the event
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_claim_my_notifications()
RETURNS TABLE (outbox_id BIGINT, event_type TEXT, observation_id UUID,
               recipient_id UUID, recipient_email TEXT, recipient_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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
  p_id BIGINT, p_outcome TEXT, p_message_id TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_outcome NOT IN ('sent', 'failed', 'uncertain') THEN RAISE EXCEPTION 'Outcome must be sent, failed or uncertain'; END IF;
  UPDATE pd_notification_outbox
  SET status = p_outcome, completed_at = NOW(),
      provider_message_id = LEFT(p_message_id, 200), last_error = LEFT(p_error, 200)
  WHERE id = p_id AND status = 'claimed' AND claimed_by = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification % is not claimed by you', p_id; END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Recovery by the scheduled job (service role only)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_mark_stale_notifications(p_minutes INTEGER DEFAULT 30)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE pd_notification_outbox
  SET status = 'uncertain', completed_at = NOW(),
      last_error = 'claim expired (sender stopped before recording result)'
  WHERE status = 'claimed' AND claimed_at < NOW() - make_interval(mins => p_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Pending notices older than p_min_age_minutes (gives the immediate path
-- time first) and definite failures with fewer than 3 attempts.
CREATE OR REPLACE FUNCTION public.pd_claim_pending_notifications(p_limit INTEGER DEFAULT 50, p_min_age_minutes INTEGER DEFAULT 5)
RETURNS TABLE (outbox_id BIGINT, event_type TEXT, observation_id UUID,
               recipient_id UUID, recipient_email TEXT, recipient_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT n.id FROM pd_notification_outbox n
    WHERE (n.status = 'pending' AND n.created_at < NOW() - make_interval(mins => p_min_age_minutes))
       OR (n.status = 'failed' AND n.attempts < 3)
    ORDER BY n.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
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

CREATE OR REPLACE FUNCTION public.pd_complete_notification(
  p_id BIGINT, p_outcome TEXT, p_message_id TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_outcome NOT IN ('sent', 'failed', 'uncertain') THEN RAISE EXCEPTION 'Outcome must be sent, failed or uncertain'; END IF;
  UPDATE pd_notification_outbox
  SET status = p_outcome, completed_at = NOW(),
      provider_message_id = LEFT(p_message_id, 200), last_error = LEFT(p_error, 200)
  WHERE id = p_id AND status = 'claimed' AND claimed_by IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification % is not claimed by the job', p_id; END IF;
END;
$$;

-- Permissions: signed-in users get only the two "my" functions.
REVOKE ALL ON FUNCTION public.pd_obs_event_key(TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_claim_my_notifications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_complete_my_notification(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_claim_my_notifications() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pd_complete_my_notification(BIGINT, TEXT, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pd_mark_stale_notifications(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pd_claim_pending_notifications(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pd_complete_notification(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pd_mark_stale_notifications(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.pd_claim_pending_notifications(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.pd_complete_notification(BIGINT, TEXT, TEXT, TEXT) TO service_role;

-- Done.
