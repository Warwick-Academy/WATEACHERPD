begin;

alter table public.courses add column if not exists section_level text
  check (section_level in ('beginner', 'intermediate', 'advanced'));

create table if not exists public.course_splits (
  id uuid primary key,
  admin_id uuid not null references public.profiles(id),
  source_course_id integer not null references public.courses(id) on delete cascade,
  sections jsonb not null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.course_splits enable row level security;

create or replace function public.create_course_split(
  p_split_id uuid, p_admin_id uuid, p_course_id integer, p_sections jsonb
)
returns public.course_splits
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.courses;
  result public.course_splits;
  section jsonb;
  source_lesson public.lessons;
  selected_id integer;
  new_course_id integer;
  new_lesson_id integer;
  minutes integer;
  pd_hours numeric;
  lesson_index integer;
  result_sections jsonb := '[]'::jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_split_id::text, 0));
  select * into result from public.course_splits where id = p_split_id;
  if found then
    if result.admin_id <> p_admin_id or result.source_course_id <> p_course_id then
      raise exception 'Split request does not match existing split';
    end if;
    return result;
  end if;
  select * into original from public.courses where id = p_course_id for update;
  if not found then raise exception 'Source course not found'; end if;
  perform 1 from public.lessons where course_id = p_course_id for share;
  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) not between 2 and 40 then
    raise exception 'Choose between 2 and 40 sections';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_sections) s
    where coalesce(jsonb_typeof(s->'lessonIds'), '') <> 'array'
       or case when jsonb_typeof(s->'lessonIds') = 'array' then jsonb_array_length(s->'lessonIds') = 0 else true end
       or length(trim(coalesce(s->>'title', ''))) not between 1 and 200
       or coalesce(s->>'level', '') not in ('beginner', 'intermediate', 'advanced')
  ) then raise exception 'Every section needs a title, level and lessons'; end if;
  if (select count(*) from jsonb_array_elements(p_sections) s
      cross join lateral jsonb_array_elements_text(s->'lessonIds') l)
     <> (select count(distinct l::integer) from jsonb_array_elements(p_sections) s
      cross join lateral jsonb_array_elements_text(s->'lessonIds') l)
     or (select count(*) from jsonb_array_elements(p_sections) s
      cross join lateral jsonb_array_elements_text(s->'lessonIds') l)
     <> (select count(*) from public.lessons where course_id = p_course_id)
     or exists (
       select 1 from jsonb_array_elements(p_sections) s
       cross join lateral jsonb_array_elements_text(s->'lessonIds') l
       where not exists (select 1 from public.lessons where id = l::integer and course_id = p_course_id)
     ) then raise exception 'Assign every source lesson to exactly one section'; end if;

  for section in select value from jsonb_array_elements(p_sections) loop
    select coalesce(sum(greatest(coalesce(l.estimated_duration, 0), 0) +
      case when coalesce(qs.enabled, true) and exists (select 1 from public.quiz_questions q where q.lesson_id = l.id)
        then 3 else 0 end), 0)::integer into minutes
    from public.lessons l left join public.quiz_settings qs on qs.lesson_id = l.id
    where l.id in (select value::integer from jsonb_array_elements_text(section->'lessonIds'));
    pd_hours := ceil(minutes::numeric / 15) / 4;

    insert into public.courses (
      title, description, requirements, who_is_this_for, source_url, pd_hours, section_level,
      enrollment_mode, price, currency, recurring_price, requires_sequential_progress, is_published, minimum_quiz_score, created_by,
      certificate_enabled, certificate_type, certificate_template, certificate_title,
      certificate_description, additional_text, signature_image, signature_name, signature_title
    ) values (
      trim(section->>'title'),
      'Part of ' || original.title || '. Approximate time: ' || minutes ||
        ' minutes. PD credit: ' || pd_hours || ' hours.',
      original.requirements, original.who_is_this_for, original.source_url, pd_hours, section->>'level',
      original.enrollment_mode, original.price, original.currency, original.recurring_price,
      original.requires_sequential_progress, false, original.minimum_quiz_score, p_admin_id,
      true, coalesce(original.certificate_type, 'completion'), original.certificate_template,
      original.certificate_title, original.certificate_description,
      'Professional development hours awarded: ' || pd_hours,
      original.signature_image, original.signature_name, original.signature_title
    ) returning id into new_course_id;

    lesson_index := 0;
    for selected_id in select value::integer from jsonb_array_elements_text(section->'lessonIds') loop
      select * into source_lesson from public.lessons where id = selected_id and course_id = p_course_id;
      insert into public.lessons (
        course_id, title, type, content, order_index, is_required, video_progression,
        allow_skip, time_limit, video_url, text_content, estimated_duration, levels
      ) values (
        new_course_id, source_lesson.title, source_lesson.type, source_lesson.content, lesson_index,
        source_lesson.is_required, source_lesson.video_progression, source_lesson.allow_skip,
        source_lesson.time_limit, source_lesson.video_url, source_lesson.text_content,
        source_lesson.estimated_duration, source_lesson.levels
      ) returning id into new_lesson_id;

      insert into public.quiz_settings (lesson_id, enabled, shuffle_quiz, max_attempts, show_correct_answers, allow_multiple_attempts, time_limit, passing_score)
      select new_lesson_id, enabled, shuffle_quiz, max_attempts, show_correct_answers, allow_multiple_attempts, time_limit, passing_score
      from public.quiz_settings where lesson_id = selected_id;
      insert into public.quiz_questions (lesson_id, question_type, question_text, question_data, points, explanation, difficulty, time_limit, image_url, order_index)
      select new_lesson_id, question_type, question_text, question_data, points, explanation, difficulty, time_limit, image_url, order_index
      from public.quiz_questions where lesson_id = selected_id;
      insert into public.lesson_resources (lesson_id, resource_id, order_index)
      select new_lesson_id, resource_id, order_index from public.lesson_resources where lesson_id = selected_id;
      lesson_index := lesson_index + 1;
    end loop;
    result_sections := result_sections || jsonb_build_array(section || jsonb_build_object(
      'courseId', new_course_id, 'minutes', minutes, 'pdHours', pd_hours,
      'thumbnailUrl', null, 'previewUrl', null
    ));
  end loop;

  insert into public.course_splits (id, admin_id, source_course_id, sections)
  values (p_split_id, p_admin_id, p_course_id, result_sections) returning * into result;
  return result;
end;
$$;

revoke all on function public.create_course_split(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.create_course_split(uuid, uuid, integer, jsonb) to service_role;

commit;
