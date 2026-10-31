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