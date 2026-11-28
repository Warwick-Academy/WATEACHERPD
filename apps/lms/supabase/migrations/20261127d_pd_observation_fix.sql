-- =====================================================================
-- WATEACHERPD — PD module fix 3: observation safeguards
-- Run AFTER 20261127c_pd_goal_link_fix.sql. Safe to re-run.
--  1. Drafts are private to the writer (admins and leadership no longer see them).
--  2. Teacher responses, acknowledgements, signatures and the 'signed' status
--     can only be set through the database functions, never by a direct write.
--     Published or signed observations can't be edited directly at all;
--     an admin must reopen first. The functions lock the row, so a response
--     and a signature can't race.
--  3. New observations must be dated in the CURRENT academic year, the year is
--     always worked out from the date (never trusted from the app), and the
--     Feedback Leader check uses the current year only.
-- How (2) works: the guard triggers run with the caller's own database role.
-- Direct writes from the app arrive as 'authenticated' / 'anon' /
-- 'service_role' and are restricted; the pd_ functions run as the owner
-- (SECURITY DEFINER) and are allowed through.
-- =====================================================================

-- 1 + 3. Who may write which form, for whom, on what date --------------
CREATE OR REPLACE FUNCTION public.pd_observation_allowed(p_form TEXT, p_teacher UUID, p_year INTEGER, p_date DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- p_year is ignored on purpose: the year always comes from the date.
  SELECT EXISTS (
    SELECT 1 FROM pd_academic_years y
    WHERE y.is_current AND p_date BETWEEN y.start_date AND y.end_date
  ) AND CASE
    WHEN p_form = 'learning_walk'   THEN p_teacher <> auth.uid()
    WHEN p_form = 'self_reflection' THEN p_teacher = auth.uid()
    WHEN p_form IN ('fl_learning_walk', 'appraisal')
      THEN public.pd_is_leader_of(p_teacher, public.pd_current_year_id())
    ELSE FALSE END;
$$;

CREATE OR REPLACE FUNCTION public.pd_can_view_observation(p_obs UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pd_observations o WHERE o.id = p_obs AND (
      o.observer_id = auth.uid()
      OR (o.status <> 'draft' AND (
            public.pd_can_view_all()
         OR o.teacher_id = auth.uid()
         OR public.pd_is_leader_of(o.teacher_id, o.year_id)))));
$$;

-- Sections and ratings can only be edited while the observation is a draft
-- (admins included: reopen first).
CREATE OR REPLACE FUNCTION public.pd_can_edit_observation(p_obs UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pd_observations o
    WHERE o.id = p_obs AND o.status = 'draft' AND (o.observer_id = auth.uid() OR public.is_admin()));
$$;

DROP POLICY IF EXISTS "view" ON pd_observations;
DROP POLICY IF EXISTS "create" ON pd_observations;
DROP POLICY IF EXISTS "observer edits draft" ON pd_observations;
DROP POLICY IF EXISTS "observer deletes draft" ON pd_observations;

CREATE POLICY "view" ON pd_observations FOR SELECT USING (
  observer_id = auth.uid()
  OR (status <> 'draft' AND (
        public.pd_can_view_all()
     OR teacher_id = auth.uid()
     OR public.pd_is_leader_of(teacher_id, year_id))));

CREATE POLICY "create" ON pd_observations FOR INSERT WITH CHECK (
  observer_id = auth.uid() AND status = 'draft'
  AND (public.is_admin() OR public.pd_observation_allowed(form_type, teacher_id, NULL, observation_date)));

CREATE POLICY "observer edits draft" ON pd_observations FOR UPDATE
  USING (status = 'draft' AND (observer_id = auth.uid() OR public.is_admin()))
  WITH CHECK (status IN ('draft', 'published') AND (
    public.is_admin()
    OR (observer_id = auth.uid() AND public.pd_observation_allowed(form_type, teacher_id, NULL, observation_date))));

CREATE POLICY "observer deletes draft" ON pd_observations FOR DELETE
  USING ((observer_id = auth.uid() AND status = 'draft') OR public.is_admin());

-- 3. Year always comes from the date; published_at set by the database ----
CREATE OR REPLACE FUNCTION public.pd_observation_defaults()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.year_id := public.pd_year_for_date(NEW.observation_date);
  IF TG_OP = 'INSERT' THEN
    NEW.published_at := CASE WHEN NEW.status = 'draft' THEN NULL ELSE NOW() END;
  ELSE
    IF OLD.status = 'draft' AND NEW.status = 'published' THEN NEW.published_at := NOW();
    ELSIF NEW.status = 'draft' THEN NEW.published_at := NULL;
    ELSE NEW.published_at := OLD.published_at; END IF;
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Guard against direct writes (SECURITY INVOKER on purpose) -----------
CREATE OR REPLACE FUNCTION public.pd_guard_observation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'service_role') THEN
    RETURN NEW;   -- pd_ functions, cascades, SQL editor
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft'
       OR NEW.teacher_response IS NOT NULL OR NEW.teacher_acknowledged_at IS NOT NULL
       OR NEW.teacher_signed_at IS NOT NULL OR NEW.observer_signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'New observations must start as a blank draft.';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'A published observation can only be changed by an admin after reopening it.';
  END IF;
  IF NEW.status NOT IN ('draft', 'published')
     OR NEW.teacher_response IS DISTINCT FROM OLD.teacher_response
     OR NEW.teacher_acknowledged_at IS DISTINCT FROM OLD.teacher_acknowledged_at
     OR NEW.teacher_signed_at IS DISTINCT FROM OLD.teacher_signed_at
     OR NEW.observer_signed_at IS DISTINCT FROM OLD.observer_signed_at THEN
    RAISE EXCEPTION 'Responses, acknowledgements and signatures can only be added with the respond, acknowledge and sign actions.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_obs_guard ON pd_observations;
CREATE TRIGGER trg_pd_obs_guard BEFORE INSERT OR UPDATE ON pd_observations
  FOR EACH ROW EXECUTE FUNCTION public.pd_guard_observation();

CREATE OR REPLACE FUNCTION public.pd_guard_observation_section()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.teacher_response IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.teacher_response IS DISTINCT FROM OLD.teacher_response) THEN
    RAISE EXCEPTION 'Teacher responses can only be added with the respond action.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_obs_section_guard ON pd_observation_sections;
CREATE TRIGGER trg_pd_obs_section_guard BEFORE INSERT OR UPDATE ON pd_observation_sections
  FOR EACH ROW EXECUTE FUNCTION public.pd_guard_observation_section();

-- 2. Functions lock the row first, so respond / acknowledge / sign / reopen
--    can't overlap ------------------------------------------------------
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
END;
$$;

CREATE OR REPLACE FUNCTION public.pd_acknowledge_observation(p_obs UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o pd_observations;
BEGIN
  SELECT * INTO o FROM pd_observations WHERE id = p_obs FOR UPDATE;
  IF o.id IS NULL OR o.teacher_id <> auth.uid() OR o.status NOT IN ('published', 'signed') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE pd_observations SET teacher_acknowledged_at = COALESCE(teacher_acknowledged_at, NOW()) WHERE id = p_obs;
END;
$$;

CREATE OR REPLACE FUNCTION public.pd_sign_appraisal(p_obs UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o pd_observations;
BEGIN
  SELECT * INTO o FROM pd_observations WHERE id = p_obs FOR UPDATE;
  IF o.id IS NULL OR o.form_type <> 'appraisal' OR o.status <> 'published' THEN
    RAISE EXCEPTION 'Only a published appraisal can be signed.';
  END IF;
  IF auth.uid() = o.observer_id THEN
    UPDATE pd_observations SET observer_signed_at = COALESCE(observer_signed_at, NOW()) WHERE id = p_obs;
  ELSIF auth.uid() = o.teacher_id THEN
    UPDATE pd_observations SET teacher_signed_at = COALESCE(teacher_signed_at, NOW()),
      teacher_acknowledged_at = COALESCE(teacher_acknowledged_at, NOW()) WHERE id = p_obs;
  ELSE
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE pd_observations SET status = 'signed'
    WHERE id = p_obs AND observer_signed_at IS NOT NULL AND teacher_signed_at IS NOT NULL;
  RETURN (SELECT status FROM pd_observations WHERE id = p_obs);
END;
$$;

CREATE OR REPLACE FUNCTION public.pd_reopen_observation(p_obs UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM 1 FROM pd_observations WHERE id = p_obs FOR UPDATE;
  UPDATE pd_observations
  SET status = 'draft', observer_signed_at = NULL, teacher_signed_at = NULL
  WHERE id = p_obs;
END;
$$;

-- Done.
