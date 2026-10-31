import { supabase } from './supabase';
import type { AttendanceRecord, ClassItem, Student } from '../stores/attendance-store';

// All calls to the user's cloud data (Supabase). Row level security makes every query
// return only the signed-in account's own rows, so no filtering by owner is needed here.

function client() {
  if (!supabase) throw new Error('The cloud is not set up.');
  return supabase;
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

interface ClassRow {
  id: string;
  class_name: string;
}
interface StudentRow {
  id: string;
  class_id: string;
  full_name: string;
  qr_token: string;
}
interface RecordRow {
  id: string;
  student_id: string;
  event_date: string;
  session: AttendanceRecord['session'];
  scan: AttendanceRecord['scan'];
  scanned_at: string;
}

const toClassRow = (c: ClassItem): ClassRow => ({ id: c.id, class_name: c.className });
const toStudentRow = (s: Student): StudentRow => ({
  id: s.id,
  class_id: s.classId,
  full_name: s.fullName,
  qr_token: s.qrToken,
});
const toRecordRow = (r: AttendanceRecord): RecordRow => ({
  id: r.id,
  student_id: r.studentId,
  event_date: r.eventDate,
  session: r.session,
  scan: r.scan,
  scanned_at: r.scannedAt,
});

// The server returns at most 1000 rows per request, so read page by page.
async function fetchAll<T>(table: string): Promise<T[]> {
  const rows: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await client()
      .from(table)
      .select('*')
      .order('id')
      .range(from, from + size - 1);
    fail(error);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < size) break;
  }
  return rows;
}

export async function fetchAllData() {
  const [classes, students, records] = await Promise.all([
    fetchAll<ClassRow>('classes'),
    fetchAll<StudentRow>('students'),
    fetchAll<RecordRow>('attendance'),
  ]);
  return {
    classes: classes.map((c): ClassItem => ({ id: c.id, className: c.class_name })),
    students: students.map(
      (s): Student => ({
        id: s.id,
        classId: s.class_id,
        fullName: s.full_name,
        qrToken: s.qr_token,
      }),
    ),
    records: records.map(
      (r): AttendanceRecord => ({
        id: r.id,
        studentId: r.student_id,
        eventDate: r.event_date,
        session: r.session,
        scan: r.scan,
        scannedAt: r.scanned_at,
      }),
    ),
  };
}

async function insertChunks(table: string, rows: object[], upsertOn?: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const query = client().from(table);
    const { error } = upsertOn
      ? await query.upsert(chunk, { onConflict: upsertOn, ignoreDuplicates: true })
      : await query.insert(chunk);
    fail(error);
  }
}

export const insertClasses = (list: ClassItem[]) => insertChunks('classes', list.map(toClassRow));
export const insertStudents = (list: Student[]) => insertChunks('students', list.map(toStudentRow));
// A repeated record (same student, day, session and type) is ignored instead of failing.
export const insertRecords = (list: AttendanceRecord[]) =>
  insertChunks('attendance', list.map(toRecordRow), 'student_id,event_date,session,scan');

export async function renameClassRemote(id: string, className: string) {
  const { error } = await client().from('classes').update({ class_name: className }).eq('id', id);
  fail(error);
}
export async function deleteClassRemote(id: string) {
  const { error } = await client().from('classes').delete().eq('id', id);
  fail(error);
}
export async function updateStudentRemote(id: string, fullName: string, classId: string) {
  const { error } = await client()
    .from('students')
    .update({ full_name: fullName, class_id: classId })
    .eq('id', id);
  fail(error);
}
export async function updateTokenRemote(id: string, qrToken: string) {
  const { error } = await client().from('students').update({ qr_token: qrToken }).eq('id', id);
  fail(error);
}
export async function deleteStudentRemote(id: string) {
  const { error } = await client().from('students').delete().eq('id', id);
  fail(error);
}
export async function deleteRecordRemote(id: string) {
  const { error } = await client().from('attendance').delete().eq('id', id);
  fail(error);
}
