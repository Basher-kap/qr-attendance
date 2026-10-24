-- QR Code-Based Student Attendance Monitoring System
-- Run in the Supabase SQL editor.

create type session_type as enum ('morning', 'afternoon');
create type scan_type    as enum ('check_in', 'check_out');
create type staff_role   as enum ('admin', 'clerk');

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

-- Row level security
create function staff_role_of_caller() returns staff_role
language sql security definer set search_path = public stable as $$
  select role from app_users where email = auth.jwt() ->> 'email'
$$;

alter table app_users  enable row level security;
alter table classes    enable row level security;
alter table students   enable row level security;
alter table attendance enable row level security;

create policy "staff read classes"  on classes  for select using (staff_role_of_caller() is not null);
create policy "admin write classes" on classes  for all
  using (staff_role_of_caller() = 'admin') with check (staff_role_of_caller() = 'admin');

create policy "staff read students"  on students for select using (staff_role_of_caller() is not null);
create policy "admin write students" on students for all
  using (staff_role_of_caller() = 'admin') with check (staff_role_of_caller() = 'admin');

create policy "staff read attendance"   on attendance for select using (staff_role_of_caller() is not null);
create policy "staff insert attendance" on attendance for insert with check (staff_role_of_caller() is not null);

create policy "admin manage users" on app_users for all
  using (staff_role_of_caller() = 'admin') with check (staff_role_of_caller() = 'admin');
create policy "read own user row" on app_users for select
  using (email = auth.jwt() ->> 'email');

-- First admin (replace with your Google account), then add clerks.
-- insert into app_users (email, role) values ('you@gmail.com', 'admin');
