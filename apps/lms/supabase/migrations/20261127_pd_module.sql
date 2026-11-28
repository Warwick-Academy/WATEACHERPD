-- =====================================================================
-- WATEACHERPD — Professional Development module (main feature)
-- Goals, Feedback Leaders, Observations (Learning Walks / Appraisal),
-- CPD log, and automatic PD hours from Training courses.
--
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to re-run. Does not change or delete any existing training data.
-- All new tables start with "pd_".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Profiles: roles and staff details
-- ---------------------------------------------------------------------
-- Allow the extra roles. 'leadership' = read-only school-wide reports.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.profiles'::regclass AND con.contype = 'c' AND att.attname = 'user_type'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

UPDATE profiles SET user_type = 'user' WHERE user_type NOT IN ('user', 'admin', 'instructor', 'leadership');
ALTER TABLE profiles ALTER COLUMN user_type SET DEFAULT 'user';
ALTER TABLE profiles ADD CONSTRAINT profiles_user_type_check
  CHECK (user_type IN ('user', 'admin', 'instructor', 'leadership'));

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT 'secondary'
  CHECK (phase IN ('primary', 'secondary', 'both'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Staff can switch off optional reminder emails (essential notices still send)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pd_email_reminders BOOLEAN NOT NULL DEFAULT TRUE;

-- SECURITY FIX: new sign-ups always start as 'user'. The original function
-- let a sign-up choose its own user_type (including 'admin') via metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, user_type)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- 1. Academic years and settings
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pd_academic_years (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,            -- e.g. '2026–27'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (end_date > start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pd_one_current_year ON pd_academic_years(is_current) WHERE is_current;
INSERT INTO pd_academic_years (name, start_date, end_date, is_current)
VALUES ('2026–27', '2026-09-01', '2027-08-31', TRUE)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS pd_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  annual_cpd_target_hours NUMERIC(5,2) NOT NULL DEFAULT 30,
  max_goals_per_year INTEGER NOT NULL DEFAULT 3 CHECK (max_goals_per_year BETWEEN 1 AND 10),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO pd_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- PD hours awarded for completing a Training course
ALTER TABLE courses ADD COLUMN IF NOT EXISTS pd_hours NUMERIC(5,2) DEFAULT 0;

-- ---------------------------------------------------------------------
-- 2. Helper functions (SECURITY DEFINER avoids RLS recursion)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin');
$$;

-- Admins and leadership can view everything
CREATE OR REPLACE FUNCTION public.pd_can_view_all()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type IN ('admin', 'leadership'));
$$;

CREATE OR REPLACE FUNCTION public.pd_current_year_id()
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM pd_academic_years WHERE is_current LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.pd_year_for_date(d DATE)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM pd_academic_years WHERE d BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1),
    (SELECT id FROM pd_academic_years WHERE is_current LIMIT 1)
  );
$$;

-- ---------------------------------------------------------------------
-- 2b. SECURITY FIXES to original EaseLMS profile rules
-- ---------------------------------------------------------------------
-- (a) The original "Admins can view all profiles" policy queried profiles
--     inside its own rule, which causes "infinite recursion" errors.
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS "PD: admins update profiles" ON profiles;
CREATE POLICY "PD: admins update profiles" ON profiles FOR UPDATE
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- (b) Users could update their own profile, including making themselves admin.
--     Only admins (or server code using the service role key) may change
--     role, active status, job title, department or phase.
CREATE OR REPLACE FUNCTION public.pd_protect_profile_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (
       NEW.user_type IS DISTINCT FROM OLD.user_type
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.job_title IS DISTINCT FROM OLD.job_title
    OR NEW.department IS DISTINCT FROM OLD.department
    OR NEW.phase IS DISTINCT FROM OLD.phase) THEN
    RAISE EXCEPTION 'Only an administrator can change role or staff details.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_protect_profile_fields ON profiles;
CREATE TRIGGER trg_pd_protect_profile_fields BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.pd_protect_profile_fields();

-- ---------------------------------------------------------------------
-- 3. Feedback Leader assignments (per year, more than one allowed)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pd_feedback_assignments (
  id SERIAL PRIMARY KEY,
  year_id INTEGER NOT NULL REFERENCES pd_academic_years(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leader_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_lead BOOLEAN NOT NULL DEFAULT FALSE,   -- the lead appraiser if more than one
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (year_id, staff_id, leader_id),
  CHECK (staff_id <> leader_id)
);
CREATE INDEX IF NOT EXISTS idx_pd_fa_leader ON pd_feedback_assignments(leader_id, year_id);
CREATE INDEX IF NOT EXISTS idx_pd_fa_staff ON pd_feedback_assignments(staff_id, year_id);

CREATE OR REPLACE FUNCTION public.pd_is_leader_of(p_staff UUID, p_year INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pd_feedback_assignments
    WHERE staff_id = p_staff AND leader_id = auth.uid() AND year_id = p_year
  );
$$;

-- ---------------------------------------------------------------------
-- 4. Goals
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pd_school_goals (
  id SERIAL PRIMARY KEY,
  year_id INTEGER NOT NULL REFERENCES pd_academic_years(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pd_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year_id INTEGER NOT NULL DEFAULT public.pd_current_year_id() REFERENCES pd_academic_years(id),
  title TEXT NOT NULL,
  smart_description TEXT NOT NULL,
  action_plan TEXT,
  support_required TEXT,              -- PD / support required
  target_date DATE,
  school_goal_id INTEGER REFERENCES pd_school_goals(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'on_track', 'needs_support', 'complete')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pd_goals_user_year ON pd_goals(user_id, year_id);

-- Running record of progress (staff updates and Feedback Leader comments)
CREATE TABLE IF NOT EXISTS pd_goal_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id UUID NOT NULL REFERENCES pd_goals(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  status TEXT CHECK (status IN ('not_started', 'on_track', 'needs_support', 'complete')),
  is_checkin BOOLEAN NOT NULL DEFAULT FALSE,  -- formal mid-year check-in
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pd_goal_updates_goal ON pd_goal_updates(goal_id);

-- Enforce the 1–3 goals limit per person per year
CREATE OR REPLACE FUNCTION public.pd_check_goal_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_max INTEGER; v_count INTEGER;
BEGIN
  SELECT max_goals_per_year INTO v_max FROM pd_settings WHERE id = 1;
  SELECT COUNT(*) INTO v_count FROM pd_goals
    WHERE user_id = NEW.user_id AND year_id = NEW.year_id AND id <> NEW.id;
  IF v_count >= COALESCE(v_max, 3) THEN
    RAISE EXCEPTION 'You can have up to % goals per year.', COALESCE(v_max, 3);
  END IF;
  IF NEW.status = 'complete' AND NEW.completed_at IS NULL THEN NEW.completed_at := NOW(); END IF;
  IF NEW.status <> 'complete' THEN NEW.completed_at := NULL; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_goal_limit ON pd_goals;
CREATE TRIGGER trg_pd_goal_limit BEFORE INSERT OR UPDATE OF user_id, year_id, status ON pd_goals
  FOR EACH ROW EXECUTE FUNCTION public.pd_check_goal_limit();

DROP TRIGGER IF EXISTS trg_pd_goals_updated ON pd_goals;
CREATE TRIGGER trg_pd_goals_updated BEFORE UPDATE ON pd_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- A status set in an update also updates the goal
CREATE OR REPLACE FUNCTION public.pd_goal_update_sets_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS NOT NULL THEN
    UPDATE pd_goals SET status = NEW.status WHERE id = NEW.goal_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_goal_update_status ON pd_goal_updates;
CREATE TRIGGER trg_pd_goal_update_status AFTER INSERT ON pd_goal_updates
  FOR EACH ROW EXECUTE FUNCTION public.pd_goal_update_sets_status();

CREATE OR REPLACE FUNCTION public.pd_can_view_goal(p_goal UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pd_goals g WHERE g.id = p_goal AND (
      g.user_id = auth.uid() OR public.pd_can_view_all() OR public.pd_is_leader_of(g.user_id, g.year_id)
    )
  );
$$;

-- ---------------------------------------------------------------------
-- 5. Observation criteria (admin-editable; seeded from the WA form)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pd_obs_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  guidance TEXT,                        -- shown above the comment box
  student_questions TEXT[] DEFAULT '{}',-- prompts for the observer to ask students
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pd_obs_criteria (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES pd_obs_categories(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  secondary_only BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (category_id, label)
);

INSERT INTO pd_obs_categories (name, sort_order, guidance, student_questions) VALUES
  ('Planning and Preparation', 1,
   'Add evidence for what you observed and teacher reflection questions.', '{}'),
  ('Classroom Environment', 2,
   'Add evidence for what you observed and teacher reflection questions.',
   ARRAY[
     'What are you learning?',
     'How does it connect with what you''ve done previously?',
     'Where do you think (predict) you''re headed next?',
     'How are you doing in this class?',
     'How do you know? What evidence can you provide to support your opinion?',
     'What do you do if you''re struggling with a task and the teacher is busy?'
   ]),
  ('Instruction', 3,
   'Add evidence for what you observed and teacher reflection questions.', '{}'),
  ('Professional Responsibilities', 4,
   'Add evidence for what you observed and teacher reflection questions.', '{}')
ON CONFLICT (name) DO NOTHING;

INSERT INTO pd_obs_criteria (category_id, label, sort_order, secondary_only)
SELECT c.id, v.label, v.sort_order, v.secondary_only
FROM (VALUES
  ('Planning and Preparation', 'Is there evidence of planning?', 1, FALSE),
  ('Planning and Preparation', 'Are lessons well-structured?', 2, FALSE),
  ('Planning and Preparation', 'Are materials prepared in advance?', 3, FALSE),
  ('Planning and Preparation', 'Is the lesson planned to incorporate all learners? Is there evidence of differentiation including modifications and accommodations?', 4, FALSE),
  ('Classroom Environment', 'Have routines and classroom norms been established?', 1, FALSE),
  ('Classroom Environment', 'Have positive relationships been established with the students?', 2, FALSE),
  ('Classroom Environment', 'Does the teacher set high expectations which inspire, motivate and challenge students?', 3, FALSE),
  ('Classroom Environment', 'Are behaviours managed appropriately?', 4, FALSE),
  ('Classroom Environment', 'Is the environment organised, safe and conducive to learning?', 5, FALSE),
  ('Instruction', 'Does the teacher follow the curriculum and schemes of work as outlined by their department?', 1, FALSE),
  ('Instruction', 'Is the teacher knowledgeable about the content they are teaching?', 2, FALSE),
  ('Instruction', 'Does the teacher use quality questions and lead meaningful discussion?', 3, FALSE),
  ('Instruction', 'Does the teacher respond to student questions in an appropriate manner?', 4, FALSE),
  ('Instruction', 'Is the teacher flexible in their delivery of the lesson, adapting teaching to respond to the strengths and needs of all students?', 5, FALSE),
  ('Instruction', 'Does the teacher engage students in learning/activities?', 6, FALSE),
  ('Instruction', 'Does the teacher provide timely and effective feedback?', 7, FALSE),
  ('Instruction', 'Does the teacher make accurate and productive use of assessment? (Using data to drive instruction)', 8, FALSE),
  ('Instruction', 'Does the teacher keep records of grades and levels?', 9, FALSE),
  ('Instruction', 'Does the teacher use the VLE to assign work?', 10, TRUE),
  ('Professional Responsibilities', 'Is the teacher punctual to school, lessons, activities and duties?', 1, FALSE),
  ('Professional Responsibilities', 'Does the teacher participate in co-curricular activities?', 2, FALSE),
  ('Professional Responsibilities', 'Does the teacher meet deadlines?', 3, FALSE),
  ('Professional Responsibilities', 'Does the teacher communicate with parents and students in an appropriate manner?', 4, FALSE),
  ('Professional Responsibilities', 'Does the teacher dress appropriately?', 5, FALSE),
  ('Professional Responsibilities', 'Does the teacher attend meetings and assemblies as required?', 6, FALSE),
  ('Professional Responsibilities', 'Does the teacher report their absence in advance and leave cover work when necessary?', 7, FALSE),
  ('Professional Responsibilities', 'Does the teacher follow school policies?', 8, FALSE)
) AS v(category, label, sort_order, secondary_only)
JOIN pd_obs_categories c ON c.name = v.category
ON CONFLICT (category_id, label) DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. Observations
--   learning_walk     = Form 1, informal, any staff on any other staff
--   fl_learning_walk  = Form 2, Feedback Leader, categories + comments
--   appraisal         = Form 3, end of year, adds ratings + overall rating
--   self_reflection   = teacher rates themselves on the Form 3 criteria
-- Status: draft (observer only) -> published (teacher can respond/acknowledge)
--         -> signed (appraisal only, both parties signed; locked)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pd_observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year_id INTEGER REFERENCES pd_academic_years(id),
  form_type TEXT NOT NULL CHECK (form_type IN ('learning_walk', 'fl_learning_walk', 'appraisal', 'self_reflection')),
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  observer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  observation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  year_group TEXT,
  subject TEXT,
  comment TEXT,                         -- Form 1 comment box
  overall_comment TEXT,                 -- Form 3 final overall comments
  overall_rating TEXT CHECK (overall_rating IN ('exceeding', 'meeting', 'almost_meeting', 'not_meeting')),
  goal_id UUID REFERENCES pd_goals(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'signed')),
  published_at TIMESTAMPTZ,
  teacher_response TEXT,                -- teacher's overall reply / notes
  teacher_acknowledged_at TIMESTAMPTZ,
  observer_signed_at TIMESTAMPTZ,
  teacher_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((form_type = 'self_reflection') = (teacher_id = observer_id)),
  CHECK (overall_rating IS NULL OR form_type = 'appraisal')
);
CREATE INDEX IF NOT EXISTS idx_pd_obs_teacher ON pd_observations(teacher_id, year_id);
CREATE INDEX IF NOT EXISTS idx_pd_obs_observer ON pd_observations(observer_id);

CREATE TABLE IF NOT EXISTS pd_observation_sections (
  observation_id UUID NOT NULL REFERENCES pd_observations(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES pd_obs_categories(id) ON DELETE CASCADE,
  evidence_comment TEXT,
  reflection_questions TEXT,
  teacher_response TEXT,
  PRIMARY KEY (observation_id, category_id)
);

CREATE TABLE IF NOT EXISTS pd_observation_ratings (
  observation_id UUID NOT NULL REFERENCES pd_observations(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES pd_obs_criteria(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('always_mostly', 'sometimes', 'no', 'na')),
  PRIMARY KEY (observation_id, criterion_id)
);

CREATE OR REPLACE FUNCTION public.pd_observation_defaults()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.year_id IS NULL THEN NEW.year_id := public.pd_year_for_date(NEW.observation_date); END IF;
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN NEW.published_at := NOW(); END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := NOW(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_obs_defaults ON pd_observations;
CREATE TRIGGER trg_pd_obs_defaults BEFORE INSERT OR UPDATE ON pd_observations
  FOR EACH ROW EXECUTE FUNCTION public.pd_observation_defaults();

CREATE OR REPLACE FUNCTION public.pd_can_view_observation(p_obs UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pd_observations o WHERE o.id = p_obs AND (
      o.observer_id = auth.uid()
      OR public.pd_can_view_all()
      OR (o.status <> 'draft' AND o.teacher_id = auth.uid())
      OR (o.status <> 'draft' AND public.pd_is_leader_of(o.teacher_id, o.year_id))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.pd_can_edit_observation(p_obs UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pd_observations o WHERE o.id = p_obs AND (
      (o.observer_id = auth.uid() AND o.status = 'draft') OR public.is_admin()
    )
  );
$$;

-- Who may write which form for whom
CREATE OR REPLACE FUNCTION public.pd_observation_allowed(p_form TEXT, p_teacher UUID, p_year INTEGER, p_date DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_form = 'learning_walk'   THEN p_teacher <> auth.uid()
    WHEN p_form = 'self_reflection' THEN p_teacher = auth.uid()
    WHEN p_form IN ('fl_learning_walk', 'appraisal')
      THEN public.pd_is_leader_of(p_teacher, COALESCE(p_year, public.pd_year_for_date(p_date)))
    ELSE FALSE END;
$$;

-- Teacher replies to a published observation (overall + per section),
-- and can optionally link it to one of their own goals.
-- p_sections format: [{"category_id": 1, "teacher_response": "..."}, ...]
DROP FUNCTION IF EXISTS public.pd_respond_to_observation(UUID, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.pd_respond_to_observation(
  p_obs UUID, p_response TEXT, p_sections JSONB DEFAULT '[]'::jsonb, p_goal UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o pd_observations; s JSONB;
BEGIN
  SELECT * INTO o FROM pd_observations WHERE id = p_obs;
  IF o.id IS NULL OR o.teacher_id <> auth.uid() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF o.status <> 'published' THEN RAISE EXCEPTION 'This observation is not open for responses.'; END IF;
  IF p_goal IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pd_goals WHERE id = p_goal AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not your goal';
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
BEGIN
  UPDATE pd_observations SET teacher_acknowledged_at = COALESCE(teacher_acknowledged_at, NOW())
  WHERE id = p_obs AND teacher_id = auth.uid() AND status IN ('published', 'signed');
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
END;
$$;

-- Appraisal sign-off: observer and teacher each sign; when both have, it locks.
CREATE OR REPLACE FUNCTION public.pd_sign_appraisal(p_obs UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o pd_observations;
BEGIN
  SELECT * INTO o FROM pd_observations WHERE id = p_obs;
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

-- Admin can reopen a published/signed observation for correction
CREATE OR REPLACE FUNCTION public.pd_reopen_observation(p_obs UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE pd_observations SET status = 'draft', observer_signed_at = NULL, teacher_signed_at = NULL
  WHERE id = p_obs;
END;
$$;

-- ---------------------------------------------------------------------
-- 7. CPD log (manual entries, admin bulk entries, Training course hours)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pd_cpd_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year_id INTEGER REFERENCES pd_academic_years(id),
  title TEXT NOT NULL,
  description TEXT,
  activity_type TEXT NOT NULL DEFAULT 'other' CHECK (activity_type IN (
    'platform_course', 'workshop_inset', 'microsoft_learn', 'external_course',
    'conference', 'peer_observation', 'reading_research', 'other')),
  provider TEXT,
  activity_date DATE NOT NULL,
  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 100),
  impact_reflection TEXT,               -- "What will you change in your teaching?"
  evidence_path TEXT,                   -- path in private 'pd-evidence' bucket
  evidence_name TEXT,
  goal_id UUID REFERENCES pd_goals(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'admin', 'course')),
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  batch_id UUID,                        -- groups an admin bulk assignment
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pd_cpd_user_year ON pd_cpd_activities(user_id, year_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pd_cpd_course ON pd_cpd_activities(user_id, course_id) WHERE source = 'course';

CREATE OR REPLACE FUNCTION public.pd_cpd_defaults()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.year_id := public.pd_year_for_date(NEW.activity_date);
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := NOW(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_cpd_defaults ON pd_cpd_activities;
CREATE TRIGGER trg_pd_cpd_defaults BEFORE INSERT OR UPDATE ON pd_cpd_activities
  FOR EACH ROW EXECUTE FUNCTION public.pd_cpd_defaults();

-- Completing a Training course adds its PD hours automatically
CREATE OR REPLACE FUNCTION public.pd_award_course_hours()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD;
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT id, title, pd_hours INTO c FROM courses WHERE id = NEW.course_id;
    IF c.pd_hours IS NOT NULL AND c.pd_hours > 0 THEN
      INSERT INTO pd_cpd_activities (user_id, title, activity_type, provider, activity_date, hours,
                                     source, course_id, created_by)
      VALUES (NEW.user_id, c.title, 'platform_course', 'WA Training',
              COALESCE(NEW.completed_at, NOW())::date, c.pd_hours, 'course', c.id, NEW.user_id)
      ON CONFLICT (user_id, course_id) WHERE source = 'course' DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pd_award_course_hours ON enrollments;
CREATE TRIGGER trg_pd_award_course_hours AFTER INSERT OR UPDATE OF status ON enrollments
  FOR EACH ROW EXECUTE FUNCTION public.pd_award_course_hours();

-- Backfill courses already completed (only does anything once courses have pd_hours set;
-- re-run this INSERT after setting hours on existing courses)
INSERT INTO pd_cpd_activities (user_id, title, activity_type, provider, activity_date, hours, source, course_id, created_by)
SELECT e.user_id, c.title, 'platform_course', 'WA Training', COALESCE(e.completed_at, NOW())::date,
       c.pd_hours, 'course', c.id, e.user_id
FROM enrollments e JOIN courses c ON c.id = e.course_id
WHERE e.status = 'completed' AND c.pd_hours > 0
ON CONFLICT (user_id, course_id) WHERE source = 'course' DO NOTHING;

-- Admin adds one CPD activity to many staff at once. Returns number added.
CREATE OR REPLACE FUNCTION public.pd_assign_cpd_bulk(
  p_user_ids UUID[], p_title TEXT, p_activity_type TEXT, p_provider TEXT,
  p_activity_date DATE, p_hours NUMERIC, p_description TEXT DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch UUID := uuid_generate_v4(); v_count INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO pd_cpd_activities (user_id, title, description, activity_type, provider, activity_date,
                                 hours, source, batch_id, created_by)
  SELECT DISTINCT u, p_title, p_description, p_activity_type, p_provider, p_activity_date,
         p_hours, 'admin', v_batch, auth.uid()
  FROM unnest(p_user_ids) AS u;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------
-- 8. New academic year (archive old year, optionally copy assignments)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_start_new_year(
  p_name TEXT, p_start DATE, p_end DATE, p_copy_assignments BOOLEAN DEFAULT TRUE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old INTEGER; v_new INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  v_old := public.pd_current_year_id();
  UPDATE pd_academic_years SET is_current = FALSE WHERE is_current;
  INSERT INTO pd_academic_years (name, start_date, end_date, is_current)
  VALUES (p_name, p_start, p_end, TRUE) RETURNING id INTO v_new;
  IF p_copy_assignments AND v_old IS NOT NULL THEN
    INSERT INTO pd_feedback_assignments (year_id, staff_id, leader_id, is_lead)
    SELECT v_new, staff_id, leader_id, is_lead FROM pd_feedback_assignments WHERE year_id = v_old
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_new;
END;
$$;

-- ---------------------------------------------------------------------
-- 9. Reporting views (security_invoker: each viewer only sees rows RLS allows)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW pd_v_staff_year_summary WITH (security_invoker = true) AS
SELECT
  p.id AS user_id, p.name, p.email, p.department, p.job_title, p.phase,
  y.id AS year_id, y.name AS year_name,
  (SELECT COUNT(*) FROM pd_goals g WHERE g.user_id = p.id AND g.year_id = y.id) AS goals_total,
  (SELECT COUNT(*) FROM pd_goals g WHERE g.user_id = p.id AND g.year_id = y.id AND g.status = 'complete') AS goals_complete,
  (SELECT COUNT(*) FROM pd_goals g WHERE g.user_id = p.id AND g.year_id = y.id AND g.status = 'needs_support') AS goals_needs_support,
  (SELECT COALESCE(SUM(hours), 0) FROM pd_cpd_activities a WHERE a.user_id = p.id AND a.year_id = y.id) AS cpd_hours,
  (SELECT COALESCE(SUM(hours), 0) FROM pd_cpd_activities a WHERE a.user_id = p.id AND a.year_id = y.id AND a.source = 'course') AS training_hours,
  (SELECT COUNT(*) FROM pd_observations o WHERE o.teacher_id = p.id AND o.year_id = y.id AND o.status <> 'draft' AND o.form_type = 'learning_walk') AS learning_walks,
  (SELECT COUNT(*) FROM pd_observations o WHERE o.teacher_id = p.id AND o.year_id = y.id AND o.status <> 'draft' AND o.form_type = 'fl_learning_walk') AS fl_learning_walks,
  (SELECT o.overall_rating FROM pd_observations o WHERE o.teacher_id = p.id AND o.year_id = y.id AND o.form_type = 'appraisal' AND o.status <> 'draft' ORDER BY o.observation_date DESC LIMIT 1) AS appraisal_rating,
  (SELECT o.status FROM pd_observations o WHERE o.teacher_id = p.id AND o.year_id = y.id AND o.form_type = 'appraisal' ORDER BY o.observation_date DESC LIMIT 1) AS appraisal_status
FROM profiles p CROSS JOIN pd_academic_years y
WHERE p.is_active;

-- Which criteria are rated Sometimes / No most often (appraisals only)
CREATE OR REPLACE VIEW pd_v_criteria_trends WITH (security_invoker = true) AS
SELECT o.year_id, cat.name AS category, cr.id AS criterion_id, cr.label AS criterion, cat.sort_order, cr.sort_order AS criterion_order,
  COUNT(*) FILTER (WHERE r.rating = 'always_mostly') AS always_mostly,
  COUNT(*) FILTER (WHERE r.rating = 'sometimes') AS sometimes,
  COUNT(*) FILTER (WHERE r.rating = 'no') AS no,
  COUNT(*) FILTER (WHERE r.rating = 'na') AS na
FROM pd_observation_ratings r
JOIN pd_observations o ON o.id = r.observation_id AND o.form_type = 'appraisal' AND o.status <> 'draft'
JOIN pd_obs_criteria cr ON cr.id = r.criterion_id
JOIN pd_obs_categories cat ON cat.id = cr.category_id
GROUP BY o.year_id, cat.name, cr.id, cr.label, cat.sort_order, cr.sort_order;

-- ---------------------------------------------------------------------
-- 10. Row Level Security
-- ---------------------------------------------------------------------
ALTER TABLE pd_academic_years       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_feedback_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_school_goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_goals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_goal_updates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_obs_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_obs_criteria         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_observations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_observation_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_observation_ratings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_cpd_activities       ENABLE ROW LEVEL SECURITY;

-- Drop all existing pd_ policies so this file can be re-run cleanly
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename LIKE 'pd\_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Reference tables: everyone signed in can read; admins write
CREATE POLICY "read" ON pd_academic_years FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin write" ON pd_academic_years FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "read" ON pd_settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin write" ON pd_settings FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "read" ON pd_school_goals FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin write" ON pd_school_goals FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "read" ON pd_obs_categories FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin write" ON pd_obs_categories FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "read" ON pd_obs_criteria FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin write" ON pd_obs_criteria FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Feedback Leader assignments
CREATE POLICY "view own or all" ON pd_feedback_assignments FOR SELECT
  USING (staff_id = auth.uid() OR leader_id = auth.uid() OR public.pd_can_view_all());
CREATE POLICY "admin write" ON pd_feedback_assignments FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Goals: owner edits; Feedback Leaders, leadership and admins view
CREATE POLICY "view" ON pd_goals FOR SELECT
  USING (user_id = auth.uid() OR public.pd_can_view_all() OR public.pd_is_leader_of(user_id, year_id));
CREATE POLICY "owner insert" ON pd_goals FOR INSERT WITH CHECK (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "owner update" ON pd_goals FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin()) WITH CHECK (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "owner delete" ON pd_goals FOR DELETE USING (user_id = auth.uid() OR public.is_admin());

-- Goal updates: owner and their Feedback Leaders can add
CREATE POLICY "view" ON pd_goal_updates FOR SELECT USING (public.pd_can_view_goal(goal_id));
CREATE POLICY "add" ON pd_goal_updates FOR INSERT WITH CHECK (
  author_id = auth.uid() AND EXISTS (
    SELECT 1 FROM pd_goals g WHERE g.id = goal_id AND (
      g.user_id = auth.uid() OR public.pd_is_leader_of(g.user_id, g.year_id) OR public.is_admin())));
CREATE POLICY "author delete" ON pd_goal_updates FOR DELETE USING (author_id = auth.uid() OR public.is_admin());

-- Observations
CREATE POLICY "view" ON pd_observations FOR SELECT USING (
  observer_id = auth.uid()
  OR public.pd_can_view_all()
  OR (status <> 'draft' AND teacher_id = auth.uid())
  OR (status <> 'draft' AND public.pd_is_leader_of(teacher_id, year_id)));
CREATE POLICY "create" ON pd_observations FOR INSERT WITH CHECK (
  public.is_admin() OR (observer_id = auth.uid() AND status = 'draft'
    AND public.pd_observation_allowed(form_type, teacher_id, year_id, observation_date)));
CREATE POLICY "observer edits draft" ON pd_observations FOR UPDATE
  USING ((observer_id = auth.uid() AND status = 'draft') OR public.is_admin())
  WITH CHECK (public.is_admin() OR (observer_id = auth.uid() AND status IN ('draft', 'published')
    AND public.pd_observation_allowed(form_type, teacher_id, year_id, observation_date)));
CREATE POLICY "observer deletes draft" ON pd_observations FOR DELETE
  USING ((observer_id = auth.uid() AND status = 'draft') OR public.is_admin());

CREATE POLICY "view" ON pd_observation_sections FOR SELECT USING (public.pd_can_view_observation(observation_id));
CREATE POLICY "edit" ON pd_observation_sections FOR ALL
  USING (public.pd_can_edit_observation(observation_id)) WITH CHECK (public.pd_can_edit_observation(observation_id));
CREATE POLICY "view" ON pd_observation_ratings FOR SELECT USING (public.pd_can_view_observation(observation_id));
CREATE POLICY "edit" ON pd_observation_ratings FOR ALL
  USING (public.pd_can_edit_observation(observation_id)) WITH CHECK (public.pd_can_edit_observation(observation_id));

-- CPD: staff manage their own manual entries; course and admin entries are read-only to them
CREATE POLICY "view" ON pd_cpd_activities FOR SELECT
  USING (user_id = auth.uid() OR public.pd_can_view_all() OR public.pd_is_leader_of(user_id, year_id));
CREATE POLICY "own manual insert" ON pd_cpd_activities FOR INSERT
  WITH CHECK ((user_id = auth.uid() AND source = 'manual') OR public.is_admin());
CREATE POLICY "own manual update" ON pd_cpd_activities FOR UPDATE
  USING ((user_id = auth.uid() AND source = 'manual') OR public.is_admin())
  WITH CHECK ((user_id = auth.uid() AND source = 'manual') OR public.is_admin());
CREATE POLICY "own manual delete" ON pd_cpd_activities FOR DELETE
  USING ((user_id = auth.uid() AND source = 'manual') OR public.is_admin());

-- Staff can link their own course/admin CPD entries to a goal (the only field they may change)
CREATE OR REPLACE FUNCTION public.pd_link_cpd_to_goal(p_cpd UUID, p_goal UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_goal IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pd_goals WHERE id = p_goal AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not your goal';
  END IF;
  UPDATE pd_cpd_activities SET goal_id = p_goal WHERE id = p_cpd AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
END;
$$;

-- Profiles: let Feedback Leaders and leadership see names of the staff they need.
-- (Existing policies already let users see themselves and admins see all.)
DROP POLICY IF EXISTS "PD: staff directory" ON profiles;
CREATE POLICY "PD: staff directory" ON profiles FOR SELECT USING (auth.uid() IS NOT NULL);
-- Note: every signed-in staff member can see colleagues' name/email/department.
-- That is needed so anyone can pick a colleague for a Learning Walk.

-- ---------------------------------------------------------------------
-- 11. Private storage bucket for CPD evidence  (<user_id>/<file>)
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pd-evidence', 'pd-evidence', FALSE, 10485760,
        ARRAY['application/pdf', 'image/png', 'image/jpeg',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "PD evidence: own read"    ON storage.objects;
DROP POLICY IF EXISTS "PD evidence: own upload"  ON storage.objects;
DROP POLICY IF EXISTS "PD evidence: own delete"  ON storage.objects;
DROP POLICY IF EXISTS "PD evidence: leader read" ON storage.objects;
DROP POLICY IF EXISTS "PD evidence: admin access" ON storage.objects;
DROP POLICY IF EXISTS "PD evidence: leadership read" ON storage.objects;

CREATE POLICY "PD evidence: own read" ON storage.objects FOR SELECT
  USING (bucket_id = 'pd-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "PD evidence: own upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'pd-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "PD evidence: own delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'pd-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "PD evidence: leader read" ON storage.objects FOR SELECT
  USING (bucket_id = 'pd-evidence' AND EXISTS (
    SELECT 1 FROM pd_feedback_assignments fa
    WHERE fa.leader_id = auth.uid() AND fa.year_id = public.pd_current_year_id()
      AND fa.staff_id::text = (storage.foldername(name))[1]));
CREATE POLICY "PD evidence: leadership read" ON storage.objects FOR SELECT
  USING (bucket_id = 'pd-evidence' AND public.pd_can_view_all());
CREATE POLICY "PD evidence: admin access" ON storage.objects FOR ALL
  USING (bucket_id = 'pd-evidence' AND public.is_admin())
  WITH CHECK (bucket_id = 'pd-evidence' AND public.is_admin());

-- Done.
