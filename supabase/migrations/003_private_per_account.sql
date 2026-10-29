-- Moves the database from the shared clerk allow-list to private data per Google account:
-- every class, student and attendance record belongs to the account that created it.
-- Run once in the Supabase SQL editor. Safe to run again while the tables are still empty.
--
-- The old tables cannot be converted in place (their rows have no owner), so this script
-- recreates them. It stops without changing anything if they already contain rows.

do $$
declare
  t text;
  has_rows boolean;
begin
  foreach t in array array['classes', 'students', 'attendance'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I)', t) into has_rows;
      if has_rows then
        raise exception
          'The table % already contains rows. Export them from the app, or ask for a '
          'data-preserving migration, before running this script.', t;
      end if;
    end if;
  end loop;
end $$;

drop table if exists attendance, students, classes, app_users;
drop function if exists is_allowed_user();
drop function if exists staff_role_of_caller();
drop type if exists staff_role;

do $$ begin create type session_type as enum ('morning', 'afternoon');
exception when duplicate_object then null; end $$;
do $$ begin create type scan_type as enum ('check_in', 'check_out');
exception when duplicate_object then null; end $$;

create table classes (
  owner_id   uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         bigint not null,
  class_name text   not null,
  primary key (owner_id, id)
);
create unique index classes_owner_name on classes (owner_id, lower(class_name));

create table students (
  owner_id   uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         bigint not null,
  class_id   bigint not null,
  full_name  text   not null,
  qr_token   uuid   not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, qr_token),
  foreign key (owner_id, class_id) references classes (owner_id, id) on delete no action
);

create table attendance (
  owner_id   uuid         not null default auth.uid() references auth.users (id) on delete cascade,
  id         uuid         not null,
  student_id bigint       not null,
  event_date date         not null,
  session    session_type not null,
  scan       scan_type    not null,
  scanned_at timestamptz  not null,
  primary key (owner_id, id),
  unique (owner_id, student_id, event_date, session, scan),
  foreign key (owner_id, student_id) references students (owner_id, id) on delete cascade
);

create index on students (owner_id, class_id);
create index on attendance (owner_id, event_date, session);

alter table classes    enable row level security;
alter table students   enable row level security;
alter table attendance enable row level security;

create policy "own classes" on classes for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own students" on students for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own attendance" on attendance for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
