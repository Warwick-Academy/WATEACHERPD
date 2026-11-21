-- Run against an isolated database, or with a privileged connection; all fixtures are rolled back.
BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('31d5e0bb-fc78-4980-a969-1097e27cb101', 'policy-learner-test@example.invalid', '{"name":"Test Learner","user_type":"admin"}'),
  ('31d5e0bb-fc78-4980-a969-1097e27cb102', 'policy-admin-test@example.invalid', '{"name":"Test Admin"}');

DO $$
BEGIN
  IF (SELECT user_type FROM public.profiles WHERE id = '31d5e0bb-fc78-4980-a969-1097e27cb101') <> 'user' THEN
    RAISE EXCEPTION 'Signup metadata must not grant admin access';
  END IF;
END;
$$;

UPDATE public.profiles SET user_type = 'admin' WHERE id = '31d5e0bb-fc78-4980-a969-1097e27cb102';
INSERT INTO public.courses (id, title, description) VALUES (-2147483601, 'Policy test', 'Policy test');
INSERT INTO public.lessons (id, course_id, title, type, order_index)
VALUES (-2147483601, -2147483601, 'Policy test', 'text', 0);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31d5e0bb-fc78-4980-a969-1097e27cb101', true);

DO $$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM public.profiles;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'Learner must see only their own profile; saw %', visible_count;
  END IF;
  PERFORM count(*) FROM public.courses;
  PERFORM count(*) FROM public.enrollments;
  UPDATE public.profiles SET name = 'Updated learner' WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Learner could not update their own profile'; END IF;
  BEGIN
    UPDATE public.profiles SET user_type = 'admin' WHERE id = auth.uid();
    RAISE EXCEPTION 'Learner was able to grant themselves admin access';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  INSERT INTO public.progress (user_id, course_id, lesson_id)
    VALUES (auth.uid(), -2147483601, -2147483601);
  UPDATE public.progress SET completed = true WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT (SELECT completed FROM public.progress WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Learner could not read and update their own progress';
  END IF;
  BEGIN
    INSERT INTO public.progress (user_id, course_id, lesson_id)
      VALUES ('31d5e0bb-fc78-4980-a969-1097e27cb102', -2147483601, -2147483601);
    RAISE EXCEPTION 'Learner was able to create another user''s progress';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '31d5e0bb-fc78-4980-a969-1097e27cb102', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE id IN ('31d5e0bb-fc78-4980-a969-1097e27cb101', '31d5e0bb-fc78-4980-a969-1097e27cb102')) <> 2 THEN
    RAISE EXCEPTION 'Admin could not see both test profiles';
  END IF;
  IF (SELECT count(*) FROM public.progress WHERE user_id = '31d5e0bb-fc78-4980-a969-1097e27cb101') <> 0 THEN
    RAISE EXCEPTION 'Another user''s progress must remain private';
  END IF;
  PERFORM count(*) FROM public.courses;
  PERFORM count(*) FROM public.enrollments;
END;
$$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.profiles) <> 0 THEN
    RAISE EXCEPTION 'Anonymous user must not see profiles';
  END IF;
  PERFORM count(*) FROM public.courses;
END;
$$;

ROLLBACK;
