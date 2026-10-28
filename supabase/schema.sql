-- QR Code-Based Student Attendance Monitoring System
-- Run in the Supabase SQL editor on a new project.
-- Existing project? Run supabase/migrations/002_clerk_only.sql instead.

create type session_type as enum ('morning', 'afternoon');
create type scan_type    as enum ('check_in', 'check_out');
-- Clerks only for now. Student access is planned: alter type staff_role add value 'student';
create type staff_role   as enum ('clerk');

-- Allow-list: only these Google accounts may use the app.
create table app_users (
  email text primary key,
  role  staff_role not null default 'clerk'
);

create table classes (
  id         bigint generated always as identity primary key,
  class_name text not null unique
);

create table students (
  id         bigint generated always as identity primary key,
  class_id   bigint not null references classes(id) on delete restrict,
  full_name  text   not null,
  -- Value encoded in the QR code. Unguessable, so IDs cannot be forged.
  qr_token   uuid   not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- One row per check-in or check-out (replaces the four BOOLEAN columns).
create table attendance (
  id         uuid primary key,  -- generated on the device, so offline sync can retry safely
  student_id bigint       not null references students(id) on delete cascade,
  event_date date         not null,
  session    session_type not null,
  scan       scan_type    not null,
  scanned_at timestamptz  not null,  -- time shown on the confirmation screen
  scanned_by text references app_users(email),
  unique (student_id, event_date, session, scan)  -- duplicate scans are ignored
);

create index on students (class_id);
create index on attendance (event_date, session);

-- Row level security: every account on the allow-list (a clerk) can use the data.
create function is_allowed_user() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from app_users where email = auth.jwt() ->> 'email')
$$;

alter table app_users  enable row level security;
alter table classes    enable row level security;
alter table students   enable row level security;
alter table attendance enable row level security;

create policy "clerks manage classes" on classes for all
  using (is_allowed_user()) with check (is_allowed_user());
create policy "clerks manage students" on students for all
  using (is_allowed_user()) with check (is_allowed_user());

create policy "clerks read attendance"   on attendance for select using (is_allowed_user());
create policy "clerks insert attendance" on attendance for insert with check (is_allowed_user());
create policy "clerks delete attendance" on attendance for delete using (is_allowed_user());

-- People can read their own allow-list row. The allow-list itself is edited in the Supabase dashboard.
create policy "read own user row" on app_users for select
  using (email = auth.jwt() ->> 'email');

-- First clerk (replace with your Google account), then add the others.
-- insert into app_users (email, role) values ('you@gmail.com', 'clerk');