BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, user_type)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    'user'
  );
  RETURN NEW;
END;
$$;

ALTER TABLE public.profiles ALTER COLUMN user_type SET DEFAULT 'user';

CREATE OR REPLACE FUNCTION public.current_user_profile_type()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT user_type FROM public.profiles WHERE id = (SELECT auth.uid())
$$;

REVOKE ALL ON FUNCTION public.current_user_profile_type() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_profile_type() TO anon, authenticated;

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING ((SELECT public.current_user_profile_type()) = 'admin');

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING ((SELECT auth.uid()) = id)
  WITH CHECK (
    (SELECT auth.uid()) = id
    AND user_type IS NOT DISTINCT FROM (SELECT public.current_user_profile_type())
  );

COMMIT;
