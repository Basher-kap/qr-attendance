-- Security hardening. Safe to run more than once. Run it in the Supabase SQL editor.
--
-- 1. Rows can only point at rows of the SAME account.
--    Row level security checks owner_id, but a foreign key is checked without it, so before this
--    a signed-in user who knew another account's class id could attach a student to it. The
--    composite keys below make the database refuse that.
-- 2. Guests (the "anon" role) get no table privileges at all, as a second lock behind RLS.
-- 3. Names have a length limit (also enforced in the app), so a huge value cannot be stored.
-- 4. The old allow-list table from migration 002 is locked down (it is unused).

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
