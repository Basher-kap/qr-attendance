-- QR Code-Based Student Attendance Monitoring System
-- Run in the Supabase SQL editor on a new project.
-- Existing project with the older shared-clerk schema? Run
-- supabase/migrations/003_private_per_account.sql instead.

create type session_type as enum ('morning', 'afternoon');
create type scan_type    as enum ('check_in', 'check_out');

-- Every row belongs to the Google account that created it (owner_id) and is visible only to
-- that account. Several clerks share data by signing in with the same account.
-- Ids are made on the device (not by the database), so changes made offline can be sent later
-- and retried safely. An id only has to be unique within one account, hence (owner_id, id).

create table classes (
  owner_id   uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         bigint not null,
  class_name text   not null,
  primary key (owner_id, id)
);
-- Class names are unique per account, ignoring upper and lower case.
create unique index classes_owner_name on classes (owner_id, lower(class_name));

create table students (
  owner_id   uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         bigint not null,
  class_id   bigint not null,
  full_name  text   not null,
  -- Value encoded in the QR code. Unguessable, so IDs cannot be forged.
  qr_token   uuid   not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, qr_token),
  -- A class that still has students cannot be deleted. "no action" (not "restrict") so that
  -- deleting a whole account, which removes classes and students together, still works.
  foreign key (owner_id, class_id) references classes (owner_id, id) on delete no action
);

-- One row per check-in or check-out (replaces the four BOOLEAN columns).
create table attendance (
  owner_id   uuid         not null default auth.uid() references auth.users (id) on delete cascade,
  id         uuid         not null,  -- generated on the device, so offline sync can retry safely
  student_id bigint       not null,
  event_date date         not null,
  session    session_type not null,
  scan       scan_type    not null,
  scanned_at timestamptz  not null,  -- time shown on the confirmation screen
  primary key (owner_id, id),
  unique (owner_id, student_id, event_date, session, scan),  -- duplicate scans are ignored
  foreign key (owner_id, student_id) references students (owner_id, id) on delete cascade
);

create index on students (owner_id, class_id);
create index on attendance (owner_id, event_date, session);

-- Row level security: an account can only read and write its own rows. The composite foreign
-- keys above also stop a row from pointing at another account's class or student.
alter table classes    enable row level security;
alter table students   enable row level security;
alter table attendance enable row level security;

create policy "own classes" on classes for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own students" on students for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own attendance" on attendance for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
