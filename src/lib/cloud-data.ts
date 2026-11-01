import { supabase } from './supabase';
import type { AttendanceRecord, ClassItem, Student } from '../stores/attendance-store';

// All calls to the user's cloud data (Supabase). Row level security makes every query
// return only the signed-in account's own rows, so no filtering by owner is needed here.

function client() {
  if (!supabase) throw new Error('The cloud is not set up.');
  return supabase;
}

// An error from the cloud. `retryable` means it is worth trying again later: there is no
// connection, the server is busy, or the sign-in is being renewed. Anything else (a rule of
// the database, a missing permission) will fail the same way every time.
export class CloudError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}
export const isRetryable = (e: unknown) => !(e instanceof CloudError) || e.retryable;

interface Result {
  error: { message: string; code?: string } | null;
  status?: number;
}
function check(res: Result) {
  const e = res.error;
  if (!e) return;
  const status = res.status ?? 0; // 0: the request never got an answer (offline)
  const retryable =
    status === 0 ||
    status === 401 ||
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    e.code === 'PGRST301' ||
    /jwt|fetch|network|load failed|timeout/i.test(e.message);
  throw new CloudError(e.message, retryable);
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
    const res = await client()
      .from(table)
      .select('*')
      .order('id')
      .range(from, from + size - 1);
    check(res);
    const page = (res.data ?? []) as T[];
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

// Rows are added with "do nothing if it exists", so sending the same change twice (for example
// after a connection dropped before the answer arrived) is harmless.
async function insertChunks(table: string, rows: object[], upsertOn: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const query = client().from(table);
    const res = await query.upsert(chunk, { onConflict: upsertOn, ignoreDuplicates: true });
    check(res);
  }
}

export const insertClasses = (list: ClassItem[]) =>
  insertChunks('classes', list.map(toClassRow), 'id');
export const insertStudents = (list: Student[]) =>
  insertChunks('students', list.map(toStudentRow), 'id');
// A repeated record (same student, day, session and type) is ignored instead of failing.
export const insertRecords = (list: AttendanceRecord[]) =>
  insertChunks('attendance', list.map(toRecordRow), 'student_id,event_date,session,scan');

export async function renameClassRemote(id: string, className: string) {
  check(await client().from('classes').update({ class_name: className }).eq('id', id));
}
export async function deleteClassRemote(id: string) {
  check(await client().from('classes').delete().eq('id', id));
}
export async function updateStudentRemote(id: string, fullName: string, classId: string) {
  check(
    await client().from('students').update({ full_name: fullName, class_id: classId }).eq('id', id),
  );
}
export async function updateTokenRemote(id: string, qrToken: string) {
  check(await client().from('students').update({ qr_token: qrToken }).eq('id', id));
}
export async function deleteStudentRemote(id: string) {
  check(await client().from('students').delete().eq('id', id));
}
export async function deleteRecordRemote(id: string) {
  check(await client().from('attendance').delete().eq('id', id));
}

// A change made on this device that still has to reach the account. Plain data only, so a
// waiting change can be saved on the device and sent later, even after the app was closed.
export type Op =
  | { k: 'classes'; rows: ClassItem[] }
  | { k: 'students'; rows: Student[] }
  | { k: 'records'; rows: AttendanceRecord[] }
  | { k: 'renameClass'; id: string; name: string }
  | { k: 'deleteClass'; id: string }
  | { k: 'updateStudent'; id: string; fullName: string; classId: string }
  | { k: 'setToken'; id: string; token: string }
  | { k: 'deleteStudent'; id: string }
  | { k: 'deleteRecord'; id: string };

export async function sendOp(op: Op) {
  switch (op.k) {
    case 'classes':
      return insertClasses(op.rows);
    case 'students':
      return insertStudents(op.rows);
    case 'records':
      return insertRecords(op.rows);
    case 'renameClass':
      return renameClassRemote(op.id, op.name);
    case 'deleteClass':
      return deleteClassRemote(op.id);
    case 'updateStudent':
      return updateStudentRemote(op.id, op.fullName, op.classId);
    case 'setToken':
      return updateTokenRemote(op.id, op.token);
    case 'deleteStudent':
      return deleteStudentRemote(op.id);
    case 'deleteRecord':
      return deleteRecordRemote(op.id);
  }
}
