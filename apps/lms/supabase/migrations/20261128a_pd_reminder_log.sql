-- =====================================================================
-- WATEACHERPD — PD module: reminder delivery log (Part 8)
-- Run AFTER 20261127g_pd_trends_by_teacher.sql. Safe to re-run.
--
-- For the daily reminder job only (Netlify Scheduled Function, service role).
-- Reminder types:
--   goal_due                   goal target date within N days, goal not complete
--   observation_unacknowledged published N+ days ago, teacher hasn't acknowledged
--
-- Delivery policy: AT MOST ONCE. SendGrid has no idempotency key, so when a
-- send result is unknown (timeout, crash after sending) we mark it
-- 'uncertain' and never resend it automatically. A missed reminder is
-- better than a duplicate. Only DEFINITE failures (SendGrid returned an
-- error response, so nothing was sent) are retried, up to 3 attempts.
--
-- Each reminder has a key built from database values (never from the app):
--   goal_due                    -> goal id + target date
--   observation_unacknowledged  -> observation id + published_at
-- so a changed target date, or an observation reopened and republished,
-- gets its own reminder.
--
-- The log stores ids, keys, status and short error codes only. No goal or
-- observation text, no email body.
-- =====================================================================

CREATE TABLE IF NOT EXISTS pd_reminder_log (
  id BIGSERIAL PRIMARY KEY,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('goal_due', 'observation_unacknowledged')),
  subject_id UUID NOT NULL,                 -- pd_goals.id or pd_observations.id
  subject_key TEXT NOT NULL,                -- target date / published_at, as text
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'sent', 'failed', 'uncertain')),
  attempts INTEGER NOT NULL DEFAULT 1,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  provider_message_id TEXT,                 -- SendGrid X-Message-Id, if returned
  last_error TEXT,                          -- short code/status only, max 200 chars
  UNIQUE (reminder_type, subject_id, subject_key)
);
CREATE INDEX IF NOT EXISTS idx_pd_reminder_log_status ON pd_reminder_log(status, claimed_at);

-- Service role only: no access for signed-in users or the public.
ALTER TABLE pd_reminder_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON pd_reminder_log;
REVOKE ALL ON pd_reminder_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE pd_reminder_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON pd_reminder_log TO service_role;
GRANT USAGE ON SEQUENCE pd_reminder_log_id_seq TO service_role;

-- "Today" in Bermuda, so reminders line up with the school day
CREATE OR REPLACE FUNCTION public.pd_today()
RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT (NOW() AT TIME ZONE 'Atlantic/Bermuda')::date;
$$;

-- ---------------------------------------------------------------------
-- 1. What's due? Returns candidates only; claiming decides who sends.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_list_due_reminders(p_goal_days INTEGER DEFAULT 14, p_ack_days INTEGER DEFAULT 7)
RETURNS TABLE (reminder_type TEXT, subject_id UUID, subject_key TEXT, recipient_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'goal_due', g.id, g.target_date::text, g.user_id
  FROM pd_goals g JOIN profiles p ON p.id = g.user_id
  WHERE g.year_id = public.pd_current_year_id()
    AND g.status <> 'complete'
    AND g.target_date IS NOT NULL
    AND g.target_date BETWEEN public.pd_today() AND public.pd_today() + p_goal_days
    AND p.is_active AND p.pd_email_reminders
  UNION ALL
  SELECT 'observation_unacknowledged', o.id,
         to_char(o.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), o.teacher_id
  FROM pd_observations o JOIN profiles p ON p.id = o.teacher_id
  WHERE o.status = 'published'
    AND o.teacher_acknowledged_at IS NULL
    AND o.form_type <> 'self_reflection'
    AND o.published_at <= NOW() - make_interval(days => p_ack_days)
    AND p.is_active AND p.pd_email_reminders
  EXCEPT
  SELECT l.reminder_type, l.subject_id, l.subject_key, l.recipient_id
  FROM pd_reminder_log l
  WHERE l.status IN ('claimed', 'sent', 'uncertain') OR l.attempts >= 3;
$$;

-- ---------------------------------------------------------------------
-- 2. Claim one reminder atomically. Re-checks it is still due using the
--    database's own values. Returns the log id and recipient email, or no
--    row if it isn't due any more or another run has it / already sent it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_claim_reminder(
  p_type TEXT, p_subject_id UUID, p_goal_days INTEGER DEFAULT 14, p_ack_days INTEGER DEFAULT 7)
RETURNS TABLE (log_id BIGINT, recipient_id UUID, recipient_email TEXT, recipient_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key TEXT; v_recipient UUID; v_id BIGINT;
BEGIN
  SELECT d.subject_key, d.recipient_id INTO v_key, v_recipient
  FROM public.pd_list_due_reminders(p_goal_days, p_ack_days) d
  WHERE d.reminder_type = p_type AND d.subject_id = p_subject_id;
  IF v_key IS NULL THEN RETURN; END IF;

  INSERT INTO pd_reminder_log (reminder_type, subject_id, subject_key, recipient_id)
  VALUES (p_type, p_subject_id, v_key, v_recipient)
  ON CONFLICT (reminder_type, subject_id, subject_key) DO UPDATE
    SET status = 'claimed', attempts = pd_reminder_log.attempts + 1,
        claimed_at = NOW(), completed_at = NULL, last_error = NULL
    WHERE pd_reminder_log.status = 'failed' AND pd_reminder_log.attempts < 3
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RETURN; END IF;   -- someone else has it, or it's finished
  RETURN QUERY SELECT v_id, p.id, p.email, p.name FROM profiles p WHERE p.id = v_recipient;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Record the outcome of a claimed reminder.
--    p_outcome: 'sent'      SendGrid accepted it (2xx)
--               'failed'    SendGrid returned an error, so nothing was sent (retryable)
--               'uncertain' result unknown (timeout / network error); never resent
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_complete_reminder(
  p_log_id BIGINT, p_outcome TEXT, p_message_id TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_outcome NOT IN ('sent', 'failed', 'uncertain') THEN
    RAISE EXCEPTION 'Outcome must be sent, failed or uncertain';
  END IF;
  UPDATE pd_reminder_log
  SET status = p_outcome, completed_at = NOW(),
      provider_message_id = LEFT(p_message_id, 200), last_error = LEFT(p_error, 200)
  WHERE id = p_log_id AND status = 'claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Reminder % is not in a claimed state', p_log_id; END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Housekeeping: a claim left open (job crashed) can't be known to have
--    sent or not, so after p_minutes it becomes 'uncertain' (not resent).
--    Call at the start of each run. Returns how many were marked.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_mark_stale_reminders(p_minutes INTEGER DEFAULT 30)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE pd_reminder_log
  SET status = 'uncertain', completed_at = NOW(), last_error = 'claim expired (job stopped before recording result)'
  WHERE status = 'claimed' AND claimed_at < NOW() - make_interval(mins => p_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Only the service role may call these (Supabase grants EXECUTE on new
-- functions to anon/authenticated by default, so revoke explicitly).
REVOKE ALL ON FUNCTION public.pd_list_due_reminders(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pd_claim_reminder(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pd_complete_reminder(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pd_mark_stale_reminders(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pd_list_due_reminders(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.pd_claim_reminder(TEXT, UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.pd_complete_reminder(BIGINT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pd_mark_stale_reminders(INTEGER) TO service_role;

-- Done.
