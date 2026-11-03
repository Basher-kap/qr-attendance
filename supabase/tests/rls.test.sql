-- Database security test: proves that one account can never read, change, delete or attach
-- anything to another account's classes, students or attendance, and that guests get nothing.
--
-- Run it in the Supabase SQL editor (or with psql). It works inside a transaction that is rolled
-- back at the end, so it leaves no data behind. Every check prints PASS, and the first failed
-- check stops the script with an error that says which one.
begin;

create function public._t_ok(cond boolean, what text) returns void language plpgsql as $f$
begin
  if cond is not true then raise exception 'FAIL: %', what; end if;
  raise notice 'PASS: %', what;
end $f$;

-- Runs a statement and reports whether it was refused (and with which error code).
create function public._t_refused(stmt text, code text) returns boolean language plpgsql as $f$
begin
  execute stmt;
  return false;
exception when others then
  return sqlstate = code;
end $f$;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  a_class uuid; a_student uuid; b_class uuid; n int;
begin
  -- ===== Account A creates its data =====
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  insert into classes (class_name) values ('Grade 7') returning id into a_class;
  insert into students (class_id, full_name) values (a_class, 'Ana Cruz') returning id into a_student;
  insert into attendance (id, student_id, event_date, session, scan, scanned_at)
    values (gen_random_uuid(), a_student, current_date, 'morning', 'check_in', now());
  perform public._t_ok((select count(*) from attendance) = 1, 'A can read its own attendance');
  perform public._t_ok(public._t_refused(
    format($s$insert into attendance (id, student_id, event_date, session, scan, scanned_at)
      values (gen_random_uuid(), %L, current_date, 'morning', 'check_in', now())$s$, a_student), '23505'),
    'the same scan twice is refused');
  perform public._t_ok(public._t_refused(
    format($s$insert into classes (owner_id, class_name) values (%L, 'Stolen')$s$, b), '42501'),
    'A cannot create a class that belongs to B');
  perform public._t_ok(public._t_refused($s$insert into classes (class_name) values ('   ')$s$, '23514'),
    'an empty class name is refused');
  perform public._t_ok(public._t_refused(
    format($s$insert into students (class_id, full_name) values (%L, %L)$s$, a_class, repeat('x', 101)), '23514'),
    'a student name over 100 characters is refused');
  reset role;

  -- ===== Account B tries to reach A's data =====
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  perform public._t_ok((select count(*) from classes) = 0, 'B sees none of A''s classes');
  perform public._t_ok((select count(*) from students) = 0, 'B sees none of A''s students');
  perform public._t_ok((select count(*) from attendance) = 0, 'B sees none of A''s attendance');
  update classes set class_name = 'Hacked' where id = a_class;
  get diagnostics n = row_count;
  perform public._t_ok(n = 0, 'B cannot rename A''s class');
  delete from students where id = a_student;
  get diagnostics n = row_count;
  perform public._t_ok(n = 0, 'B cannot delete A''s student');
  delete from attendance;
  get diagnostics n = row_count;
  perform public._t_ok(n = 0, 'B cannot delete A''s attendance');
  perform public._t_ok(public._t_refused(
    format($s$insert into students (class_id, full_name) values (%L, 'Intruder')$s$, a_class), '23503'),
    'B cannot attach a student to A''s class');
  insert into classes (class_name) values ('Grade 7') returning id into b_class;
  perform public._t_ok(true, 'B can use the same class name as A in its own account');
  perform public._t_ok(public._t_refused(
    format($s$insert into attendance (id, student_id, event_date, session, scan, scanned_at)
      values (gen_random_uuid(), %L, current_date, 'afternoon', 'check_in', now())$s$, a_student), '23503'),
    'B cannot add attendance for A''s student');
  reset role;

  -- ===== Guests (not signed in) =====
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  perform public._t_ok(public._t_refused('select * from classes', '42501'), 'a guest cannot read classes');
  perform public._t_ok(public._t_refused('select * from students', '42501'), 'a guest cannot read students');
  perform public._t_ok(public._t_refused('select * from attendance', '42501'), 'a guest cannot read attendance');
  perform public._t_ok(public._t_refused($s$insert into classes (class_name) values ('x')$s$, '42501'),
    'a guest cannot write');
  reset role;

  -- ===== The owner still has full control =====
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  delete from students where id = a_student;
  get diagnostics n = row_count;
  perform public._t_ok(n = 1, 'A can delete its own student');
  perform public._t_ok((select count(*) from attendance) = 0, 'deleting a student removes its attendance');
  reset role;
end $$;

rollback;
