-- =====================================================================
-- WATEACHERPD — PD module fix 5: Training hours and CPD evidence
-- Run AFTER 20261127e_pd_observation_fix2.sql. Safe to re-run.
--  1. Feedback Leaders can open a CPD evidence file only if they lead that
--     person in the SAME year as the CPD entry. Evidence paths must sit in
--     the owner's own folder.
--  2. Signed-in users can no longer write their own enrollments, lesson
--     progress, quiz attempts or quiz results directly. (The original EaseLMS
--     allowed this, so anyone could mark a course "completed".) All of the
--     app's own writes to these tables already go through server API routes
--     using the service role key, so the app keeps working.
--     Training hours are also only awarded when every lesson in the course is
--     recorded as completed.
--  3. A course's PD hours are limited to 0–100, and awarding hours can never
--     block a course from being completed.
-- =====================================================================

-- 1. CPD evidence ---------------------------------------------------------
ALTER TABLE pd_cpd_activities DROP CONSTRAINT IF EXISTS pd_cpd_evidence_in_own_folder;
ALTER TABLE pd_cpd_activities ADD CONSTRAINT pd_cpd_evidence_in_own_folder
  CHECK (evidence_path IS NULL OR evidence_path LIKE user_id::text || '/%');

CREATE OR REPLACE FUNCTION public.pd_can_view_evidence(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pd_cpd_activities a
    WHERE a.evidence_path = p_path
      AND split_part(p_path, '/', 1) = a.user_id::text
      AND public.pd_is_leader_of(a.user_id, a.year_id));
$$;

DROP POLICY IF EXISTS "PD evidence: leader read" ON storage.objects;
CREATE POLICY "PD evidence: leader read" ON storage.objects FOR SELECT
  USING (bucket_id = 'pd-evidence' AND public.pd_can_view_evidence(name));

-- 2. No direct client writes to course completion data -------------------
DROP POLICY IF EXISTS "Users can create their own enrollments" ON enrollments;
DROP POLICY IF EXISTS "Users can update their own enrollments" ON enrollments;
DROP POLICY IF EXISTS "Users can create their own progress" ON progress;
DROP POLICY IF EXISTS "Users can update their own progress" ON progress;
DROP POLICY IF EXISTS "Users can create their own quiz attempts" ON quiz_attempts;
DROP POLICY IF EXISTS "Users can create their own quiz results" ON quiz_results;
-- Reading their own rows is unchanged.

-- 3. PD hours limit -------------------------------------------------------
UPDATE courses SET pd_hours = 100 WHERE pd_hours > 100;
UPDATE courses SET pd_hours = 0 WHERE pd_hours < 0 OR pd_hours IS NULL;
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_pd_hours_range;
ALTER TABLE courses ADD CONSTRAINT courses_pd_hours_range CHECK (pd_hours >= 0 AND pd_hours <= 100);

-- 2 + 3. Award hours only for genuine completion; never block completion ---
CREATE OR REPLACE FUNCTION public.pd_award_course_hours()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD; v_lessons INTEGER; v_done INTEGER;
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    BEGIN
      SELECT id, title, pd_hours INTO c FROM courses WHERE id = NEW.course_id;
      IF c.pd_hours IS NULL OR c.pd_hours <= 0 THEN RETURN NEW; END IF;

      SELECT COUNT(*) INTO v_lessons FROM lessons WHERE course_id = NEW.course_id;
      SELECT COUNT(DISTINCT p.lesson_id) INTO v_done
        FROM progress p JOIN lessons l ON l.id = p.lesson_id AND l.course_id = NEW.course_id
        WHERE p.user_id = NEW.user_id AND p.completed;
      IF v_lessons = 0 OR v_done < v_lessons THEN
        RAISE WARNING 'PD hours not awarded: user % has completed % of % lessons in course %',
          NEW.user_id, v_done, v_lessons, NEW.course_id;
        RETURN NEW;
      END IF;

      INSERT INTO pd_cpd_activities (user_id, title, activity_type, provider, activity_date, hours,
                                     source, course_id, created_by)
      VALUES (NEW.user_id, c.title, 'platform_course', 'WA Training',
              COALESCE(NEW.completed_at, NOW())::date, LEAST(c.pd_hours, 100), 'course', c.id, NEW.user_id)
      ON CONFLICT (user_id, course_id) WHERE source = 'course' DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- Never stop a course being completed because of the PD log
      RAISE WARNING 'PD hours not awarded for user % course %: %', NEW.user_id, NEW.course_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Done.
