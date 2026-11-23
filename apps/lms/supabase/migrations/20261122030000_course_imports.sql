begin;

alter table public.courses
  add column if not exists source_url text,
  add column if not exists pd_hours numeric(5,2);

create index if not exists courses_source_url_idx on public.courses (source_url);

create table if not exists public.course_imports (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id),
  source_url text not null,
  status text not null default 'reading',
  step_log jsonb not null default '[]'::jsonb,
  state jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  course_id integer references public.courses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_imports_admin_created_idx
  on public.course_imports (admin_id, created_at desc);

alter table public.course_imports enable row level security;

create or replace function public.start_course_import(
  p_admin_id uuid, p_source_url text, p_title text, p_certificate_type text
)
returns public.course_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.course_imports;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_admin_id::text, 0));
  if (select count(*) from public.course_imports
      where admin_id = p_admin_id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Import limit reached: at most 5 imports per hour' using errcode = 'P0001';
  end if;

  insert into public.course_imports (admin_id, source_url, state, step_log)
    values (
      p_admin_id, p_source_url,
      jsonb_build_object('titleOverride', p_title, 'certificateType', p_certificate_type),
      jsonb_build_array(jsonb_build_object('message', 'Reading course page...', 'level', 'info'))
    )
    returning * into result;
  return result;
end;
$$;

revoke all on function public.start_course_import(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.start_course_import(uuid, text, text, text) to service_role;

create or replace function public.create_imported_course(
  p_import_id uuid, p_admin_id uuid, p_course jsonb, p_lessons jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.course_imports;
  new_course_id integer;
  new_lesson_id integer;
  lesson jsonb;
  question jsonb;
  lesson_index integer := 0;
  question_index integer;
begin
  select * into job from public.course_imports
    where id = p_import_id and admin_id = p_admin_id for update;
  if not found then raise exception 'Import not found'; end if;
  if job.course_id is not null then return job.course_id; end if;
  if jsonb_typeof(p_lessons) <> 'array' or jsonb_array_length(p_lessons) not between 1 and 40 then
    raise exception 'Invalid imported lessons';
  end if;

  insert into public.courses (
    title, description, requirements, who_is_this_for, source_url, pd_hours,
    enrollment_mode, is_published, minimum_quiz_score, created_by,
    certificate_enabled, certificate_type, certificate_template,
    certificate_description, additional_text, signature_image, signature_name, signature_title
  ) values (
    p_course->>'title', p_course->>'description', p_course->>'requirements', p_course->>'audience',
    job.source_url, (p_course->>'pdHours')::numeric,
    'free', false, 70, p_admin_id,
    true, p_course->>'certificateType', p_course->>'certificateTemplate',
    p_course->>'certificateDescription', p_course->>'additionalText',
    p_course->>'signatureImage', p_course->>'signatureName', p_course->>'signatureTitle'
  ) returning id into new_course_id;

  for lesson in select value from jsonb_array_elements(p_lessons) loop
    insert into public.lessons (
      course_id, title, type, text_content, estimated_duration, levels, order_index, is_required
    ) values (
      new_course_id, lesson->>'title', 'text', lesson->>'html',
      (lesson->>'durationMinutes')::integer,
      array(select jsonb_array_elements_text(lesson->'levels')),
      lesson_index, true
    ) returning id into new_lesson_id;

    insert into public.quiz_settings (
      lesson_id, enabled, shuffle_quiz, max_attempts, show_correct_answers,
      allow_multiple_attempts, passing_score
    ) values (
      new_lesson_id, jsonb_array_length(lesson->'questions') > 0,
      true, 3, true, true, 70
    );

    question_index := 0;
    for question in select value from jsonb_array_elements(lesson->'questions') loop
      insert into public.quiz_questions (
        lesson_id, question_type, question_text, question_data, points, explanation, order_index
      ) values (
        new_lesson_id, question->>'type', question->>'text',
        case when question->>'type' = 'multiple-choice' then jsonb_build_object(
          'options', question->'options', 'correctOption', (question->>'correctOption')::integer,
          'allowMultipleCorrect', false, 'partialCredit', false
        ) else jsonb_build_object('correctAnswer', (question->>'correctAnswer')::boolean) end,
        1, question->>'explanation', question_index
      );
      question_index := question_index + 1;
    end loop;
    lesson_index := lesson_index + 1;
  end loop;

  update public.course_imports set course_id = new_course_id, status = 'media',
    step_log = step_log || jsonb_build_array(jsonb_build_object('message', 'Course created.', 'level', 'info')),
    version = version + 1, updated_at = now()
    where id = p_import_id;
  return new_course_id;
end;
$$;

revoke all on function public.create_imported_course(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_imported_course(uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.publish_imported_course(
  p_import_id uuid, p_admin_id uuid, p_preview_url text, p_warning text
)
returns public.course_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.course_imports;
begin
  select * into job from public.course_imports
    where id = p_import_id and admin_id = p_admin_id for update;
  if not found or job.course_id is null then raise exception 'Import not found'; end if;
  if job.status = 'completed' then return job; end if;
  if coalesce(job.state->>'thumbnailUrl', '') = '' then raise exception 'Thumbnail not ready'; end if;
  if p_preview_url is not null and p_preview_url is distinct from job.state->>'previewUrl' then
    raise exception 'Invalid preview URL';
  end if;
  if p_preview_url is null and coalesce(p_warning, '') = '' then
    raise exception 'A preview or a reason for skipping it is required';
  end if;

  update public.courses set preview_video = p_preview_url, is_published = true where id = job.course_id;
  update public.course_imports set status = 'completed',
    state = jsonb_set(state, '{previewUrl}', coalesce(to_jsonb(p_preview_url), 'null'::jsonb)),
    step_log = step_log || jsonb_build_array(jsonb_build_object(
      'message', case when p_warning is null then 'Course published.' else 'Published. Preview skipped: ' || p_warning end,
      'level', case when p_warning is null then 'info' else 'warning' end
    )),
    version = version + 1, updated_at = now()
    where id = p_import_id returning * into job;
  return job;
end;
$$;

revoke all on function public.publish_imported_course(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.publish_imported_course(uuid, uuid, text, text) to service_role;

commit;
