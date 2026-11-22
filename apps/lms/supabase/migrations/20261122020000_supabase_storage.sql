-- Supabase Storage buckets and policies, plus platform-wide certificate defaults.
-- Run this in the Supabase SQL Editor before using the new upload features.

begin;

-- ---------------------------------------------------------------------------
-- 1. Storage buckets
-- ---------------------------------------------------------------------------

-- Public media: course thumbnails, preview videos, lesson videos, lesson
-- resources, certificate templates, signature images and profile pictures.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-media',
  'public-media',
  true,
  52428800, -- 50 MB (largest single file on the Supabase free plan)
  array[
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/ogg',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'application/zip', 'application/x-zip-compressed'
  ]
)
on conflict (id) do nothing;

-- Private certificates: generated certificate PDFs, only readable through the
-- certificate download API (service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificates',
  'certificates',
  false,
  20971520, -- 20 MB
  array['application/pdf']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Storage policies
-- Anyone can read public-media. Nobody except the server (service role, which
-- bypasses RLS) can write to either bucket. Browser uploads are only possible
-- through signed upload URLs created by our server after checking the user,
-- because those tokens are authorised by their signature, not by policies.
-- ---------------------------------------------------------------------------

drop policy if exists "Public can read public media" on storage.objects;
create policy "Public can read public media" on storage.objects
  for select using (bucket_id = 'public-media');

-- No INSERT/UPDATE/DELETE policies for either bucket, and no SELECT policy for
-- the certificates bucket: the service role bypasses RLS and is the only writer.

-- ---------------------------------------------------------------------------
-- 3. Platform-wide certificate defaults
-- Used when a course has no certificate settings of its own.
-- ---------------------------------------------------------------------------

alter table public.platform_settings
  add column if not exists certificate_template_completion text
    default 'https://wateacherpd.netlify.app/brand/certificates/certificate-completion.png',
  add column if not exists certificate_template_participation text
    default 'https://wateacherpd.netlify.app/brand/certificates/certificate-participation.png',
  add column if not exists certificate_template_achievement text
    default 'https://wateacherpd.netlify.app/brand/certificates/certificate-achievement.png',
  add column if not exists certificate_description_completion text
    default 'This certifies that [Student Name] has successfully completed [Course Name] with a final score of [Grade].',
  add column if not exists certificate_description_participation text
    default 'This certifies that [Student Name] has participated in [Course Name], a Warwick Academy professional development session.',
  add column if not exists certificate_description_achievement text
    default 'This certifies that [Student Name] has achieved distinction in [Course Name] with a final score of [Grade].',
  add column if not exists certificate_additional_text_completion text
    default 'Professional development hours awarded: [PD Hours]',
  add column if not exists certificate_additional_text_participation text
    default 'Professional development hours awarded: [PD Hours]',
  add column if not exists certificate_additional_text_achievement text
    default 'Professional development hours awarded: [PD Hours]',
  add column if not exists certificate_signature_image text,
  add column if not exists certificate_signature_name text,
  add column if not exists certificate_signature_title text;

-- ---------------------------------------------------------------------------
-- 4. New courses get certificates enabled by default, type "completion"
-- ---------------------------------------------------------------------------

alter table public.courses alter column certificate_enabled set default true;
alter table public.courses alter column certificate_type set default 'completion';

commit;
