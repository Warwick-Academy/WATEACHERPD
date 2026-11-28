-- =====================================================================
-- WATEACHERPD — PD module fix 4: observation drafts and deletes
-- Run AFTER 20261127d_pd_observation_fix.sql. Safe to re-run.
--  1. A draft (the observation, its sections and its ratings) can only be
--     read, changed or deleted by the person writing it. Admins included.
--  2. Admins follow the same current-year date rule as everyone else. They
--     can still start a Form 2 / Form 3 for any staff member (as the brief
--     allows), but not for themselves and not dated outside this year.
--  3. Nobody can delete a published or signed observation. To remove one,
--     an admin reopens it (it goes back to the observer as a draft) and the
--     observer deletes the draft. If the observer has left, delete it in the
--     Supabase SQL Editor.
-- =====================================================================

-- Who may write which form, for whom, on what date (admins: any staff for Forms 2/3)
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
      THEN p_teacher <> auth.uid()
       AND (public.pd_is_leader_of(p_teacher, public.pd_current_year_id()) OR public.is_admin())
    ELSE FALSE END;
$$;

-- Only the writer edits their own draft
CREATE OR REPLACE FUNCTION public.pd_can_edit_observation(p_obs UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pd_observations o
    WHERE o.id = p_obs AND o.status = 'draft' AND o.observer_id = auth.uid());
$$;

-- Observations
DROP POLICY IF EXISTS "create" ON pd_observations;
DROP POLICY IF EXISTS "observer edits draft" ON pd_observations;
DROP POLICY IF EXISTS "observer deletes draft" ON pd_observations;

CREATE POLICY "create" ON pd_observations FOR INSERT WITH CHECK (
  observer_id = auth.uid() AND status = 'draft'
  AND public.pd_observation_allowed(form_type, teacher_id, NULL, observation_date));

CREATE POLICY "observer edits draft" ON pd_observations FOR UPDATE
  USING (observer_id = auth.uid() AND status = 'draft')
  WITH CHECK (observer_id = auth.uid() AND status IN ('draft', 'published')
    AND public.pd_observation_allowed(form_type, teacher_id, NULL, observation_date));

CREATE POLICY "observer deletes draft" ON pd_observations FOR DELETE
  USING (observer_id = auth.uid() AND status = 'draft');

-- Sections and ratings: separate read and write rules (no FOR ALL)
DROP POLICY IF EXISTS "view" ON pd_observation_sections;
DROP POLICY IF EXISTS "edit" ON pd_observation_sections;
DROP POLICY IF EXISTS "insert" ON pd_observation_sections;
DROP POLICY IF EXISTS "update" ON pd_observation_sections;
DROP POLICY IF EXISTS "delete" ON pd_observation_sections;
CREATE POLICY "view"   ON pd_observation_sections FOR SELECT USING (public.pd_can_view_observation(observation_id));
CREATE POLICY "insert" ON pd_observation_sections FOR INSERT WITH CHECK (public.pd_can_edit_observation(observation_id));
CREATE POLICY "update" ON pd_observation_sections FOR UPDATE
  USING (public.pd_can_edit_observation(observation_id)) WITH CHECK (public.pd_can_edit_observation(observation_id));
CREATE POLICY "delete" ON pd_observation_sections FOR DELETE USING (public.pd_can_edit_observation(observation_id));

DROP POLICY IF EXISTS "view" ON pd_observation_ratings;
DROP POLICY IF EXISTS "edit" ON pd_observation_ratings;
DROP POLICY IF EXISTS "insert" ON pd_observation_ratings;
DROP POLICY IF EXISTS "update" ON pd_observation_ratings;
DROP POLICY IF EXISTS "delete" ON pd_observation_ratings;
CREATE POLICY "view"   ON pd_observation_ratings FOR SELECT USING (public.pd_can_view_observation(observation_id));
CREATE POLICY "insert" ON pd_observation_ratings FOR INSERT WITH CHECK (public.pd_can_edit_observation(observation_id));
CREATE POLICY "update" ON pd_observation_ratings FOR UPDATE
  USING (public.pd_can_edit_observation(observation_id)) WITH CHECK (public.pd_can_edit_observation(observation_id));
CREATE POLICY "delete" ON pd_observation_ratings FOR DELETE USING (public.pd_can_edit_observation(observation_id));

-- Belt and braces: block deletes of published/signed observations even if a
-- future policy is added by mistake (SQL Editor / owner can still delete).
CREATE OR REPLACE FUNCTION public.pd_guard_observation_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon', 'service_role') AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Published observations can''t be deleted. An admin must reopen it first.';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_obs_delete_guard ON pd_observations;
CREATE TRIGGER trg_pd_obs_delete_guard BEFORE DELETE ON pd_observations
  FOR EACH ROW EXECUTE FUNCTION public.pd_guard_observation_delete();

-- Done.
