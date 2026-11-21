BEGIN;

DROP POLICY IF EXISTS "Users can create their own quiz results" ON public.quiz_results;
REVOKE INSERT, UPDATE, DELETE ON public.quiz_results FROM PUBLIC, anon, authenticated;

COMMIT;
