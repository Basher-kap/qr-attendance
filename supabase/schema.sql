-- QR Code-Based Student Attendance Monitoring System
-- Run in the Supabase SQL editor on a NEW project.
-- Existing project? Run supabase/migrations/003_private_per_account.sql instead.
--
-- Private data per Google account: every row has an owner_id, and each account
-- can only see its own rows. Shared team data (an allow-list) is on hold for later.

create type session_type as enum ('morning', 'afternoon');
create type scan_type    as enum ('check_in', 'check_out');

create table classes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_name text not null,
  unique (owner_id, class_name)
);

create table students (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id   uuid not null references classes(id) on delete restrict,
  full_name  text not null,
  -- Value encoded in the QR code. Unguessable, so it cannot be forged.
  qr_token   uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (owner_id, qr_token)
);

-- One row per check-in or check-out. The id is created on the device, so a retry is safe.
create table attendance (
  id         uuid primary key,
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  event_date date         not null,
  session    session_type not null,
  scan       scan_type    not null,
  scanned_at timestamptz  not null,
  unique (student_id, event_date, session, scan)  -- duplicate scans are ignored
);

create index on classes (owner_id);
create index on students (owner_id);
create index on students (class_id);
create index on attendance (owner_id);
create index on attendance (event_date, session);

alter table classes    enable row level security;
alter table students   enable row level security;
alter table attendance enable row level security;

create policy "own classes" on classes for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own students" on students for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own attendance" on attendance for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on classes, students, attendance to authenticated;

-- ===== Security hardening (same as migrations/004_security_hardening.sql) =====
-- ---- 1. Same-owner references ----
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'classes_id_owner_key') then
    alter table classes add constraint classes_id_owner_key unique (id, owner_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'students_id_owner_key') then
    alter table students add constraint students_id_owner_key unique (id, owner_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'students_class_same_owner') then
    alter table students add constraint students_class_same_owner
      foreign key (class_id, owner_id) references classes (id, owner_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_student_same_owner') then
    alter table attendance add constraint attendance_student_same_owner
      foreign key (student_id, owner_id) references students (id, owner_id) on delete cascade;
  end if;
end $$;

-- ---- 2. No access for guests ----
revoke all on classes, students, attendance from anon;
grant select, insert, update, delete on classes, students, attendance to authenticated;

-- ---- 3. Name lengths (checked for new and changed rows) ----
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'classes_name_length') then
    alter table classes add constraint classes_name_length
      check (char_length(btrim(class_name)) between 1 and 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'students_name_length') then
    alter table students add constraint students_name_length
      check (char_length(btrim(full_name)) between 1 and 100) not valid;
  end if;
end $$;

-- ---- 4. Leftover allow-list from migration 002 (unused since 003) ----
-- The function is removed (guests could call it through the API), and the table is locked.
do $$
begin
  drop function if exists is_allowed_user();
exception when dependent_objects_still_exist then
  revoke execute on function is_allowed_user() from public, anon, authenticated;
end $$;
do $$
begin
  if to_regclass('public.app_users') is not null then
    execute 'alter table app_users enable row level security';
    execute 'revoke all on app_users from anon, authenticated';
  end if;
end $$;
