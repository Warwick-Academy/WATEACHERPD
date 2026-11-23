begin;

create or replace function public.replace_youtube_course_lesson(
  p_course_id integer, p_lesson_id integer, p_course_updated_at timestamptz,
  p_lesson_updated_at timestamptz, p_source_url text, p_lessons jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  course public.courses;
  original public.lessons;
  lesson jsonb;
  new_lesson_id integer;
  lesson_index integer := 0;
  total_minutes integer := 0;
  credit_hours numeric;
  time_text text;
begin
  select * into course from public.courses where id = p_course_id for update;
  if not found or course.updated_at is distinct from p_course_updated_at
      or course.source_url is distinct from p_source_url then
    raise exception 'Course changed. Reload the suggestions before replacing the lesson.';
  end if;
  select * into original from public.lessons where id = p_lesson_id and course_id = p_course_id for update;
  if not found or original.updated_at is distinct from p_lesson_updated_at
      or (select count(*) from public.lessons where course_id = p_course_id) <> 1 then
    raise exception 'The course must still have the original single lesson. Reload the suggestions.';
  end if;
  if exists (select 1 from public.enrollments where course_id = p_course_id)
      or exists (select 1 from public.progress where course_id = p_course_id)
      or exists (select 1 from public.quiz_attempts where course_id = p_course_id)
      or exists (select 1 from public.quiz_results where course_id = p_course_id)
      or exists (select 1 from public.certificates where course_id = p_course_id)
      or exists (select 1 from public.payments where course_id = p_course_id) then
    raise exception 'This course has learner enrolments or activity; its lesson cannot be replaced safely.';
  end if;
  if jsonb_typeof(p_lessons) is distinct from 'array' or jsonb_array_length(p_lessons) not between 2 and 40 then
    raise exception 'Invalid timestamped lessons.';
  end if;

  delete from public.lessons where id = p_lesson_id;
  for lesson in select value from jsonb_array_elements(p_lessons) loop
    if coalesce(lesson->>'title', '') = '' or coalesce(lesson->>'html', '') = ''
        or coalesce((lesson->>'durationMinutes')::integer, 0) <= 0 then
      raise exception 'Invalid timestamped lesson.';
    end if;
    total_minutes := total_minutes + (lesson->>'durationMinutes')::integer;
    insert into public.lessons (course_id, title, type, text_content, estimated_duration, levels, order_index, is_required)
      values (p_course_id, lesson->>'title', 'text', lesson->>'html',
        (lesson->>'durationMinutes')::integer, array[]::text[], lesson_index, true)
      returning id into new_lesson_id;
    insert into public.quiz_settings (lesson_id, enabled, shuffle_quiz, max_attempts, show_correct_answers, allow_multiple_attempts, passing_score)
      values (new_lesson_id, false, true, 3, true, true, 70);
    lesson_index := lesson_index + 1;
  end loop;

  credit_hours := ceil(total_minutes::numeric / 15) / 4;
  time_text := format('Approximate time: %s minutes. PD credit: %s hours.', total_minutes, credit_hours);
  update public.courses set
    pd_hours = credit_hours,
    description = case
      when description ~ 'Approximate time: [0-9]+ minutes\. PD credit: [0-9.]+ hours?\.' then
        regexp_replace(description, 'Approximate time: [0-9]+ minutes\. PD credit: [0-9.]+ hours?\.', time_text)
      else concat_ws(' ', nullif(description, ''), time_text)
    end,
    additional_text = case
      when coalesce(additional_text, '') ~ 'Professional development hours awarded: [0-9.]+' then
        regexp_replace(additional_text, 'Professional development hours awarded: [0-9.]+', format('Professional development hours awarded: %s', credit_hours))
      else concat_ws(' ', nullif(additional_text, ''), format('Professional development hours awarded: %s', credit_hours))
    end
    where id = p_course_id;
end;
$$;

revoke all on function public.replace_youtube_course_lesson(integer, integer, timestamptz, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_youtube_course_lesson(integer, integer, timestamptz, timestamptz, text, jsonb) to service_role;

commit;
