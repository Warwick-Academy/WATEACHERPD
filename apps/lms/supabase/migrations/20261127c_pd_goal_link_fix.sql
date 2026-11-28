-- =====================================================================
-- WATEACHERPD — PD module fix 2: goal links enforced on every write
-- Run AFTER 20261127b_pd_goals_fix.sql. Safe to re-run.
-- Any CPD entry or observation with a goal_id must point to a goal that
-- belongs to the same person (CPD owner / observed teacher) and the same
-- academic year. Enforced by trigger, so it applies to direct inserts and
-- updates, the RPC functions, and admins alike. Re-checked whenever the
-- record changes (e.g. a CPD date moved into another year).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.pd_check_cpd_goal_link()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pd_goals g
    WHERE g.id = NEW.goal_id AND g.user_id = NEW.user_id AND g.year_id = NEW.year_id) THEN
    RAISE EXCEPTION 'A CPD entry can only be linked to the same person''s goal from the same year.';
  END IF;
  RETURN NEW;
END;
$$;
-- Trigger name sorts after trg_pd_cpd_defaults, so year_id is already set.
DROP TRIGGER IF EXISTS trg_pd_cpd_goal_link ON pd_cpd_activities;
CREATE TRIGGER trg_pd_cpd_goal_link BEFORE INSERT OR UPDATE ON pd_cpd_activities
  FOR EACH ROW EXECUTE FUNCTION public.pd_check_cpd_goal_link();

CREATE OR REPLACE FUNCTION public.pd_check_observation_goal_link()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pd_goals g
    WHERE g.id = NEW.goal_id AND g.user_id = NEW.teacher_id AND g.year_id = NEW.year_id) THEN
    RAISE EXCEPTION 'An observation can only be linked to the observed teacher''s goal from the same year.';
  END IF;
  RETURN NEW;
END;
$$;
-- Trigger name sorts after trg_pd_obs_defaults, so year_id is already set.
DROP TRIGGER IF EXISTS trg_pd_obs_goal_link ON pd_observations;
CREATE TRIGGER trg_pd_obs_goal_link BEFORE INSERT OR UPDATE ON pd_observations
  FOR EACH ROW EXECUTE FUNCTION public.pd_check_observation_goal_link();

-- If a goal is deleted, linked records are unlinked (ON DELETE SET NULL),
-- which passes the checks above.

-- Done.
