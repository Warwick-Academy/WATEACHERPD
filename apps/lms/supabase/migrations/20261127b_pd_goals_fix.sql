-- =====================================================================
-- WATEACHERPD — PD module fix 1: goals
-- Run AFTER 20261127_pd_module.sql. Safe to re-run.
--  1. Goals and goal updates from earlier academic years are read-only
--     (admins can still correct them).
--  2. The goal limit can't be exceeded by two saves at the same moment.
--  3. Observations and CPD can only be linked to a goal from the same year.
-- =====================================================================

-- 1. Read-only earlier years ------------------------------------------
DROP POLICY IF EXISTS "owner insert" ON pd_goals;
DROP POLICY IF EXISTS "owner update" ON pd_goals;
DROP POLICY IF EXISTS "owner delete" ON pd_goals;

CREATE POLICY "owner insert" ON pd_goals FOR INSERT WITH CHECK (
  public.is_admin() OR (user_id = auth.uid() AND year_id = public.pd_current_year_id()));
CREATE POLICY "owner update" ON pd_goals FOR UPDATE
  USING      (public.is_admin() OR (user_id = auth.uid() AND year_id = public.pd_current_year_id()))
  WITH CHECK (public.is_admin() OR (user_id = auth.uid() AND year_id = public.pd_current_year_id()));
CREATE POLICY "owner delete" ON pd_goals FOR DELETE USING (
  public.is_admin() OR (user_id = auth.uid() AND year_id = public.pd_current_year_id()));

DROP POLICY IF EXISTS "add" ON pd_goal_updates;
DROP POLICY IF EXISTS "author delete" ON pd_goal_updates;

CREATE POLICY "add" ON pd_goal_updates FOR INSERT WITH CHECK (
  public.is_admin() OR (
    author_id = auth.uid() AND EXISTS (
      SELECT 1 FROM pd_goals g
      WHERE g.id = goal_id
        AND g.year_id = public.pd_current_year_id()
        AND (g.user_id = auth.uid() OR public.pd_is_leader_of(g.user_id, g.year_id)))));
CREATE POLICY "author delete" ON pd_goal_updates FOR DELETE USING (
  public.is_admin() OR (
    author_id = auth.uid() AND EXISTS (
      SELECT 1 FROM pd_goals g WHERE g.id = goal_id AND g.year_id = public.pd_current_year_id())));

-- 2. Goal limit safe under simultaneous saves ---------------------------
-- A per-person-per-year lock makes a second save wait until the first
-- finishes, then count again.
CREATE OR REPLACE FUNCTION public.pd_check_goal_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_max INTEGER; v_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.year_id IS DISTINCT FROM OLD.year_id THEN
    PERFORM pg_advisory_xact_lock(hashtext('pd_goals'), hashtext(NEW.user_id::text || ':' || NEW.year_id::text));
    SELECT max_goals_per_year INTO v_max FROM pd_settings WHERE id = 1;
    SELECT COUNT(*) INTO v_count FROM pd_goals
      WHERE user_id = NEW.user_id AND year_id = NEW.year_id AND id <> NEW.id;
    IF v_count >= COALESCE(v_max, 3) THEN
      RAISE EXCEPTION 'You can have up to % goals per year.', COALESCE(v_max, 3);
    END IF;
  END IF;
  IF NEW.status = 'complete' AND NEW.completed_at IS NULL THEN NEW.completed_at := NOW(); END IF;
  IF NEW.status <> 'complete' THEN NEW.completed_at := NULL; END IF;
  RETURN NEW;
END;
$$;

-- 3. Goal links must match the year ------------------------------------
CREATE OR REPLACE FUNCTION public.pd_link_cpd_to_goal(p_cpd UUID, p_goal UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_goal IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pd_goals g JOIN pd_cpd_activities a ON a.id = p_cpd
    WHERE g.id = p_goal AND g.user_id = auth.uid() AND g.year_id = a.year_id) THEN
    RAISE EXCEPTION 'You can only link to one of your own goals from the same year.';
  END IF;
  UPDATE pd_cpd_activities SET goal_id = p_goal WHERE id = p_cpd AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.pd_respond_to_observation(
  p_obs UUID, p_response TEXT, p_sections JSONB DEFAULT '[]'::jsonb, p_goal UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o pd_observations; s JSONB;
BEGIN
  SELECT * INTO o FROM pd_observations WHERE id = p_obs;
  IF o.id IS NULL OR o.teacher_id <> auth.uid() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF o.status <> 'published' THEN RAISE EXCEPTION 'This observation is not open for responses.'; END IF;
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

-- Done.
