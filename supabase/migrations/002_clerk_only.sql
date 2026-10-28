-- Puts the database on hold for admin rules: every account on the allow-list is a clerk
-- who can read and write classes, students and attendance.
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. Everyone on the allow-list is a clerk.
update app_users set role = 'clerk' where role = 'admin';

-- 2. One helper that answers "is this Google account on the allow-list?"
create or replace function is_allowed_user() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from app_users where email = auth.jwt() ->> 'email')
$$;

-- 3. Remove the admin-only policies.
drop policy if exists "staff read classes"    on classes;
drop policy if exists "admin write classes"   on classes;
drop policy if exists "staff read students"   on students;
drop policy if exists "admin write students"  on students;
drop policy if exists "staff read attendance"   on attendance;
drop policy if exists "staff insert attendance" on attendance;
drop policy if exists "admin manage users"    on app_users;
drop function if exists staff_role_of_caller();

-- 4. Clerk policies.
drop policy if exists "clerks manage classes"    on classes;
drop policy if exists "clerks manage students"   on students;
drop policy if exists "clerks read attendance"   on attendance;
drop policy if exists "clerks insert attendance" on attendance;
drop policy if exists "clerks delete attendance" on attendance;

create policy "clerks manage classes" on classes for all
  using (is_allowed_user()) with check (is_allowed_user());
create policy "clerks manage students" on students for all
  using (is_allowed_user()) with check (is_allowed_user());
create policy "clerks read attendance"   on attendance for select using (is_allowed_user());
create policy "clerks insert attendance" on attendance for insert with check (is_allowed_user());
create policy "clerks delete attendance" on attendance for delete using (is_allowed_user());

-- "read own user row" on app_users stays as it is.
-- The 'admin' value stays in the staff_role type, unused. Student access later:
--   alter type staff_role add value 'student';