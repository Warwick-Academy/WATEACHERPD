alter table lessons
  add column if not exists levels text[] not null default '{}'
  check (levels <@ array['beginner','intermediate','advanced']::text[]);
