-- Run with a privileged connection after the quiz-results migration; all fixtures are rolled back.
BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('31d5e0bb-fc78-4980-a969-1097e27cb103', 'quiz-policy-test@example.invalid', '{"name":"Quiz Test"}');
INSERT INTO public.courses (id, title, description)
VALUES (-2147483602, 'Quiz policy test', 'Quiz policy test');
INSERT INTO public.lessons (id, course_id, title, type, order_index)
VALUES (-2147483602, -2147483602, 'Quiz policy test', 'text', 0);
INSERT INTO public.quiz_questions (id, lesson_id, question_type, question_text, question_data, order_index)
VALUES (-2147483602, -2147483602, 'true-false', 'Test', '{"correctAnswer":true}', 0);
INSERT INTO public.quiz_settings (lesson_id, enabled, passing_score)
VALUES (-2147483602, true, 80);

DO $$
BEGIN
  IF (SELECT passing_score FROM public.quiz_settings WHERE lesson_id = -2147483602) <> 80 THEN
    RAISE EXCEPTION 'Quiz score of 80 did not persist';
  END IF;
  UPDATE public.quiz_settings SET passing_score = 0 WHERE lesson_id = -2147483602;
  IF (SELECT passing_score FROM public.quiz_settings WHERE lesson_id = -2147483602) <> 0 THEN
    RAISE EXCEPTION 'Quiz score of 0 did not persist';
  END IF;
  UPDATE public.quiz_settings SET passing_score = NULL WHERE lesson_id = -2147483602;
  IF (SELECT passing_score FROM public.quiz_settings WHERE lesson_id = -2147483602) IS NOT NULL THEN
    RAISE EXCEPTION 'Blank quiz score did not persist';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31d5e0bb-fc78-4980-a969-1097e27cb103', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.quiz_results (user_id, course_id, lesson_id, quiz_question_id, user_answer)
    VALUES (auth.uid(), -2147483602, -2147483602, -2147483602, '0');
    RAISE EXCEPTION 'Learner was able to write a quiz result directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO public.quiz_results (user_id, course_id, lesson_id, quiz_question_id, user_answer)
VALUES ('31d5e0bb-fc78-4980-a969-1097e27cb103', -2147483602, -2147483602, -2147483602, '0');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.quiz_results WHERE lesson_id = -2147483602) <> 1 THEN
    RAISE EXCEPTION 'Learner could not read their server-recorded result';
  END IF;
END;
$$;

ROLLBACK;
