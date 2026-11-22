begin;

drop policy if exists "Users can view lessons for enrolled courses" on public.lessons;
create policy "Users can view lessons for enrolled courses" on public.lessons for select
  using (exists (
    select 1 from public.enrollments
    where course_id = lessons.course_id and user_id = auth.uid()
      and status in ('active', 'completed')
  ));

drop policy if exists "Users can view lesson resources for enrolled courses" on public.lesson_resources;
create policy "Users can view lesson resources for enrolled courses" on public.lesson_resources for select
  using (exists (
    select 1 from public.lessons
    join public.enrollments on enrollments.course_id = lessons.course_id
    where lessons.id = lesson_resources.lesson_id and enrollments.user_id = auth.uid()
      and enrollments.status in ('active', 'completed')
  ));

drop policy if exists "Users can view quiz questions for enrolled courses" on public.quiz_questions;
create policy "Users can view quiz questions for enrolled courses" on public.quiz_questions for select
  using (exists (
    select 1 from public.lessons
    join public.enrollments on enrollments.course_id = lessons.course_id
    where lessons.id = quiz_questions.lesson_id and enrollments.user_id = auth.uid()
      and enrollments.status in ('active', 'completed')
  ));

drop policy if exists "Users can view quiz settings for enrolled courses" on public.quiz_settings;
create policy "Users can view quiz settings for enrolled courses" on public.quiz_settings for select
  using (exists (
    select 1 from public.lessons
    join public.enrollments on enrollments.course_id = lessons.course_id
    where lessons.id = quiz_settings.lesson_id and enrollments.user_id = auth.uid()
      and enrollments.status in ('active', 'completed')
  ));

drop policy if exists "Users can update their own enrollments" on public.enrollments;
revoke update on public.enrollments from public, anon, authenticated;

drop policy if exists "Users can create their own progress" on public.progress;
create policy "Users can create their own progress" on public.progress for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.enrollments
    where enrollments.user_id = auth.uid() and enrollments.course_id = progress.course_id
      and enrollments.status in ('active', 'completed')
  ));

drop policy if exists "Users can update their own progress" on public.progress;
create policy "Users can update their own progress" on public.progress for update
  using (user_id = auth.uid() and exists (
    select 1 from public.enrollments
    where enrollments.user_id = auth.uid() and enrollments.course_id = progress.course_id
      and enrollments.status in ('active', 'completed')
  ))
  with check (user_id = auth.uid() and exists (
    select 1 from public.enrollments
    where enrollments.user_id = auth.uid() and enrollments.course_id = progress.course_id
      and enrollments.status in ('active', 'completed')
  ));

drop policy if exists "Users can create their own quiz attempts" on public.quiz_attempts;
create policy "Users can create their own quiz attempts" on public.quiz_attempts for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.enrollments
    where enrollments.user_id = auth.uid() and enrollments.course_id = quiz_attempts.course_id
      and enrollments.status in ('active', 'completed')
  ));

commit;
