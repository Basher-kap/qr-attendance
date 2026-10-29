import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttendanceRecord, ClassItem, SavedData, Student } from './types';

// One change made on the device that still has to reach the account's cloud copy.
export type CloudOp =
  | { type: 'putClass'; id: number; className: string }
  | { type: 'deleteClass'; id: number }
  | { type: 'putStudent'; id: number; classId: number; fullName: string; qrToken: string }
  | { type: 'deleteStudent'; id: number }
  | { type: 'putRecord'; record: AttendanceRecord }
  | { type: 'deleteRecord'; id: string };

// retryable: the network or session was the problem, so the same change can be sent again later.
// Not retryable: the database refused the change itself (conflict, missing parent row, no access).
export class CloudError extends Error {
  retryable: boolean;
  code: string;
  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function toCloudError(e: { message: string; code?: string }): CloudError {
  const code = e.code ?? '';
  // Postgres classes 22 (bad data), 23 (constraint) and 42 (no permission) never fix themselves.
  const permanent = /^(22|23|42)/.test(code);
  return new CloudError(e.message, code, !permanent);
}

const PAGE = 1000; // PostgREST returns at most 1000 rows per request

async function fetchAll(client: SupabaseClient, table: string, columns: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw toCloudError(error);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

// Reads the signed-in account's whole dataset. Row level security limits it to that account.
export async function pullAll(client: SupabaseClient): Promise<SavedData> {
  const [classes, students, records] = await Promise.all([
    fetchAll(client, 'classes', 'id, class_name'),
    fetchAll(client, 'students', 'id, class_id, full_name, qr_token'),
    fetchAll(client, 'attendance', 'id, student_id, event_date, session, scan, scanned_at'),
  ]);
  return {
    classes: classes.map(
      (r) => ({ id: Number(r.id), className: String(r.class_name) }) satisfies ClassItem,
    ),
    students: students.map(
      (r) =>
        ({
          id: Number(r.id),
          classId: Number(r.class_id),
          fullName: String(r.full_name),
          qrToken: String(r.qr_token),
        }) satisfies Student,
    ),
    records: records.map(
      (r) =>
        ({
          id: String(r.id),
          studentId: Number(r.student_id),
          eventDate: String(r.event_date),
          session: r.session,
          scan: r.scan,
          scannedAt: String(r.scanned_at),
        }) as AttendanceRecord,
    ),
  };
}

const BATCH = 500;

// Sends a run of changes of the same kind in as few requests as possible.
export async function runOps(client: SupabaseClient, userId: string, ops: CloudOp[]) {
  const first = ops[0];
  if (!first) return;
  for (let i = 0; i < ops.length; i += BATCH) {
    const chunk = ops.slice(i, i + BATCH);
    const { error } = await send(client, userId, first.type, chunk);
    if (error) throw toCloudError(error);
  }
}

function send(client: SupabaseClient, userId: string, type: CloudOp['type'], ops: CloudOp[]) {
  // Later changes to the same row win, and one request may not touch a row twice.
  const last = <T extends { id: number | string }>(rows: T[]) => [
    ...new Map(rows.map((r) => [r.id, r])).values(),
  ];

  switch (type) {
    case 'putClass': {
      const rows = last(
        ops.flatMap((o) =>
          o.type === 'putClass' ? [{ owner_id: userId, id: o.id, class_name: o.className }] : [],
        ),
      );
      return client.from('classes').upsert(rows, { onConflict: 'owner_id,id' });
    }
    case 'putStudent': {
      const rows = last(
        ops.flatMap((o) =>
          o.type === 'putStudent'
            ? [
                {
                  owner_id: userId,
                  id: o.id,
                  class_id: o.classId,
                  full_name: o.fullName,
                  qr_token: o.qrToken,
                },
              ]
            : [],
        ),
      );
      return client.from('students').upsert(rows, { onConflict: 'owner_id,id' });
    }
    case 'putRecord': {
      const rows = last(
        ops.flatMap((o) =>
          o.type === 'putRecord'
            ? [
                {
                  owner_id: userId,
                  id: o.record.id,
                  student_id: o.record.studentId,
                  event_date: o.record.eventDate,
                  session: o.record.session,
                  scan: o.record.scan,
                  scanned_at: o.record.scannedAt,
                },
              ]
            : [],
        ),
      );
      // Sending the same record twice (a retry after a dropped connection) is harmless.
      return client
        .from('attendance')
        .upsert(rows, { onConflict: 'owner_id,id', ignoreDuplicates: true });
    }
    case 'deleteClass':
      return client
        .from('classes')
        .delete()
        .in(
          'id',
          ops.flatMap((o) => (o.type === 'deleteClass' ? [o.id] : [])),
        );
    case 'deleteStudent':
      return client
        .from('students')
        .delete()
        .in(
          'id',
          ops.flatMap((o) => (o.type === 'deleteStudent' ? [o.id] : [])),
        );
    case 'deleteRecord':
      return client
        .from('attendance')
        .delete()
        .in(
          'id',
          ops.flatMap((o) => (o.type === 'deleteRecord' ? [o.id] : [])),
        );
  }
}
