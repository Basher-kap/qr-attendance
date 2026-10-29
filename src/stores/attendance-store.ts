import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { supabase } from '../lib/supabase';
import { CloudError, pullAll, runOps, type CloudOp } from '../lib/cloud';
import type {
  AttendanceRecord,
  ClassItem,
  SavedData,
  ScanType,
  Session,
  Student,
} from '../lib/types';

export type { AttendanceRecord, ClassItem, ScanType, Session, Student };

// Local calendar date (YYYY-MM-DD) from the device clock.
// Do not use toISOString() here: it returns the UTC date, which is
// yesterday for scans made between midnight and 8 AM in UTC+8.
export const localDate = (d: Date = new Date()) => {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};
const today = () => localDate();

// Spreadsheet import types.
export interface ParsedStudent {
  fullName: string;
  qrToken?: string;
}
export interface ImportPlan {
  classes: { name: string; students: ParsedStudent[] }[];
  warnings: string[];
}
export interface ImportPreviewRow {
  name: string;
  isNewClass: boolean;
  toAdd: number;
  alreadyThere: number;
}
export interface ImportSummary {
  classesAdded: number;
  studentsAdded: number;
  studentsSkipped: number;
  tokensReplaced: number;
}

// Result of uploading the device's guest data to the signed-in account.
export interface UploadSummary {
  classesAdded: number;
  studentsAdded: number;
  studentsSkipped: number;
  recordsAdded: number;
  recordsSkipped: number;
  tokensReplaced: number;
}
export type UploadResult =
  { ok: true; summary: UploadSummary; stillSyncing: boolean } | { ok: false; reason: 'offline' };

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Where the data lives. Guests: one copy on the device. Signed in: a private copy per account,
// kept on the device as a working copy (so scanning works offline) and synced to the cloud.
const GUEST_KEY = 'qr-attendance:guest:v1';
const userKey = (id: string) => `qr-attendance:user:${id}:v1`;
// Fingerprint of the device data that was last uploaded to an account, so it is not offered twice.
const uploadedKey = (id: string) => `qr-attendance:uploaded:${id}`;
// Set just before Google sign-in starts, so the upload prompt shows after a real sign-in only.
const FRESH_SIGNIN_KEY = 'qr-attendance:fresh-signin';

export function markFreshSignIn() {
  try {
    localStorage.setItem(FRESH_SIGNIN_KEY, '1');
  } catch {
    /* the upload prompt is simply skipped */
  }
}
export function consumeFreshSignIn(): boolean {
  try {
    const fresh = localStorage.getItem(FRESH_SIGNIN_KEY) === '1';
    localStorage.removeItem(FRESH_SIGNIN_KEY);
    return fresh;
  } catch {
    return false;
  }
}

interface Stored extends SavedData {
  pending: CloudOp[];
}

function loadFromStorage(key: string): Stored {
  const empty: Stored = { classes: [], students: [], records: [], pending: [] };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return empty;
    const data = JSON.parse(raw) as Partial<Stored>;
    return {
      classes: Array.isArray(data.classes) ? data.classes : [],
      students: Array.isArray(data.students) ? data.students : [],
      records: Array.isArray(data.records) ? data.records : [],
      pending: Array.isArray(data.pending) ? data.pending : [],
    };
  } catch {
    return empty;
  }
}

function signatureOf(d: SavedData): string {
  const text = JSON.stringify([d.classes, d.students, d.records]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${d.classes.length}.${d.students.length}.${d.records.length}.${h >>> 0}`;
}

// Ids made on a device must not clash with ids made on another phone using the same account,
// so cloud ids come from the clock plus a random part, and always grow on this device.
let lastCloudId = 0;
function newCloudId() {
  lastCloudId = Math.max(Date.now() * 1000 + Math.floor(Math.random() * 1000), lastCloudId + 1);
  return lastCloudId;
}

export const useAttendanceStore = defineStore('attendance', () => {
  const saved = loadFromStorage(GUEST_KEY);
  const classes = ref<ClassItem[]>(saved.classes);
  const students = ref<Student[]>(saved.students);
  const records = ref<AttendanceRecord[]>(saved.records);
  const pendingToken = ref<string | null>(null);

  // null = guest (data only on this device). Otherwise the id of the signed-in Google account.
  const userId = ref<string | null>(null);
  // Changes made on this device that the cloud has not received yet (signed-in only).
  const pending = ref<CloudOp[]>([]);
  const pendingCount = computed(() => pending.value.length);
  const syncing = ref(false);
  // True when the last attempt to reach the cloud failed (offline, session expired, server down).
  const offlineTrouble = ref(false);
  // Set when the cloud refused some changes, e.g. a class created on two phones at the same time.
  const syncProblem = ref('');
  // Counts of the device's guest data that can still be uploaded to this account, else null.
  const deviceUpload = ref<{ classes: number; students: number; records: number } | null>(null);
  const uploadPromptOpen = ref(false);

  // True when the browser refused to save (storage full or blocked).
  const saveFailed = ref(false);
  watch(
    [classes, students, records, pending, userId],
    () => {
      try {
        const id = userId.value;
        const data = { classes: classes.value, students: students.value, records: records.value };
        localStorage.setItem(
          id ? userKey(id) : GUEST_KEY,
          JSON.stringify(id ? { ...data, pending: pending.value } : data),
        );
        saveFailed.value = false;
      } catch {
        saveFailed.value = true;
      }
    },
    { deep: true },
  );

  // ---- Cloud sync -------------------------------------------------------------------------

  function queue(op: CloudOp) {
    if (!userId.value) return;
    pending.value.push(op);
    // Wait a tick so a burst of changes (an import) goes out as a few large requests.
    queueMicrotask(() => void sync());
  }

  function headRun(): CloudOp[] {
    const type = pending.value[0]?.type;
    const run: CloudOp[] = [];
    for (const op of pending.value) {
      if (op.type !== type) break;
      run.push(op);
    }
    return run;
  }

  const isPermanent = (e: unknown) => e instanceof CloudError && !e.retryable;

  // Sends the queued changes in order. Returns false when it had to stop.
  async function pushPending(uid: string, dropped: { n: number }): Promise<boolean> {
    const client = supabase;
    if (!client) return false;
    const drop = (op: CloudOp, e: unknown) => {
      // The same scan made on another phone first: the account already has this record.
      const alreadyRecorded =
        op.type === 'putRecord' && e instanceof CloudError && e.code === '23505';
      if (!alreadyRecorded) dropped.n++;
    };
    while (pending.value.length) {
      const run = headRun();
      try {
        await runOps(client, uid, run);
      } catch (e) {
        if (userId.value !== uid) return false;
        if (!isPermanent(e)) {
          offlineTrouble.value = true;
          return false;
        }
        // The database refused something in this run. Find out which changes, one by one.
        if (run.length === 1 && run[0]) {
          drop(run[0], e);
          pending.value.splice(0, 1);
          continue;
        }
        for (const op of run) {
          try {
            await runOps(client, uid, [op]);
          } catch (e2) {
            if (userId.value !== uid) return false;
            if (!isPermanent(e2)) {
              offlineTrouble.value = true;
              return false;
            }
            drop(op, e2);
          }
          if (userId.value !== uid) return false;
          pending.value.splice(0, 1);
        }
        continue;
      }
      if (userId.value !== uid) return false;
      pending.value.splice(0, run.length);
    }
    return true;
  }

  async function doSync() {
    const uid = userId.value;
    const client = supabase;
    if (!uid || !client) return;
    syncing.value = true;
    const dropped = { n: 0 };
    try {
      for (;;) {
        if (!(await pushPending(uid, dropped))) return;
        const data = await pullAll(client);
        if (userId.value !== uid) return;
        // Changed again while reading: send that first, then read again.
        if (pending.value.length) continue;
        classes.value = data.classes;
        students.value = data.students;
        records.value = data.records;
        offlineTrouble.value = false;
        return;
      }
    } catch {
      if (userId.value === uid) offlineTrouble.value = true;
    } finally {
      if (userId.value === uid) {
        syncing.value = false;
        if (dropped.n) {
          syncProblem.value =
            'Some changes could not be saved because they clashed with changes made on another device. ' +
            "Your account's version was kept.";
        }
      }
    }
  }

  let running: { uid: string; promise: Promise<void> } | null = null;
  // Sends waiting changes, then reads the account's data. Safe to call at any time.
  function sync(): Promise<void> {
    const uid = userId.value;
    if (!supabase || !uid) return Promise.resolve();
    if (running && running.uid === uid) return running.promise;
    const entry = { uid, promise: Promise.resolve() };
    entry.promise = doSync().finally(() => {
      if (running === entry) running = null;
    });
    running = entry;
    return entry.promise;
  }

  // Phones sharing an account see each other's changes when the app comes back to the front.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void sync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sync();
    });
  }

  function refreshDeviceData() {
    const id = userId.value;
    if (!id) {
      deviceUpload.value = null;
      return;
    }
    const d = loadFromStorage(GUEST_KEY);
    const empty = !d.classes.length && !d.students.length && !d.records.length;
    let uploaded = false;
    try {
      uploaded = localStorage.getItem(uploadedKey(id)) === signatureOf(d);
    } catch {
      /* treat as not uploaded */
    }
    deviceUpload.value =
      empty || uploaded
        ? null
        : { classes: d.classes.length, students: d.students.length, records: d.records.length };
  }

  // Called when the signed-in account changes. Shows that account's data, or the device's
  // guest data again after logging out. The guest data is never touched while signed in.
  async function switchScope(id: string | null, opts: { fresh?: boolean } = {}) {
    if (id === userId.value) return;
    const previous = userId.value;
    const previousWasSynced = pending.value.length === 0;
    userId.value = id;
    const data = loadFromStorage(id ? userKey(id) : GUEST_KEY);
    classes.value = data.classes;
    students.value = data.students;
    records.value = data.records;
    pending.value = id ? data.pending : [];
    pendingToken.value = null;
    offlineTrouble.value = false;
    syncProblem.value = '';
    uploadPromptOpen.value = false;
    // Do not leave a copy of an account's data on the device once it is fully in the cloud.
    if (previous && previousWasSynced) {
      try {
        localStorage.removeItem(userKey(previous));
      } catch {
        /* nothing to do */
      }
    }
    refreshDeviceData();
    if (!id) return;
    await sync();
    if (opts.fresh && userId.value === id && deviceUpload.value) uploadPromptOpen.value = true;
  }

  // Last chance to send waiting changes before the session ends.
  async function flushBeforeSignOut() {
    await sync();
  }

  function openUploadPrompt() {
    refreshDeviceData();
    if (deviceUpload.value) uploadPromptOpen.value = true;
  }
  function dismissUploadPrompt() {
    uploadPromptOpen.value = false;
  }
  function clearSyncProblem() {
    syncProblem.value = '';
  }

  // Copies the device's guest data into the signed-in account. Matches by name, like a
  // spreadsheet import, so running it twice never creates duplicates. The device copy stays.
  async function uploadDeviceData(): Promise<UploadResult> {
    const uid = userId.value;
    if (!uid) return { ok: false, reason: 'offline' };
    // Merge into the account's latest data, which needs a connection.
    await sync();
    if (offlineTrouble.value || userId.value !== uid) return { ok: false, reason: 'offline' };

    const device = loadFromStorage(GUEST_KEY);
    const summary: UploadSummary = {
      classesAdded: 0,
      studentsAdded: 0,
      studentsSkipped: 0,
      recordsAdded: 0,
      recordsSkipped: 0,
      tokensReplaced: 0,
    };
    const classMap = new Map<number, number>();
    for (const c of device.classes) {
      let target = classes.value.find((x) => sameText(x.className, c.className));
      if (!target) {
        target = classById(addClass(c.className.trim()));
        summary.classesAdded++;
      }
      if (target) classMap.set(c.id, target.id);
    }
    const usedTokens = new Set(students.value.map((s) => s.qrToken));
    const studentMap = new Map<number, number>();
    for (const s of device.students) {
      const classId = classMap.get(s.classId);
      if (classId === undefined) continue;
      const existing = studentsOfClass(classId).find((e) => sameText(e.fullName, s.fullName));
      if (existing) {
        studentMap.set(s.id, existing.id);
        summary.studentsSkipped++;
        continue;
      }
      let token = s.qrToken;
      if (!token || usedTokens.has(token)) {
        token = crypto.randomUUID();
        summary.tokensReplaced++;
      }
      usedTokens.add(token);
      studentMap.set(s.id, addStudent(classId, s.fullName, token));
      summary.studentsAdded++;
    }
    for (const r of device.records) {
      const studentId = studentMap.get(r.studentId);
      if (studentId === undefined) continue;
      if (recordFor(studentId, r.session, r.scan, r.eventDate)) {
        summary.recordsSkipped++;
        continue;
      }
      insertRecord({ ...r, studentId });
      summary.recordsAdded++;
    }
    try {
      localStorage.setItem(uploadedKey(uid), signatureOf(device));
    } catch {
      /* the prompt may show again, and uploading again is harmless */
    }
    deviceUpload.value = null;
    uploadPromptOpen.value = false;
    await sync();
    return { ok: true, summary, stillSyncing: pending.value.length > 0 };
  }

  // ---- Data -------------------------------------------------------------------------------

  const nextId = (list: { id: number }[]) =>
    userId.value ? newCloudId() : Math.max(0, ...list.map((x) => x.id)) + 1;

  function studentByToken(token: string) {
    return students.value.find((s) => s.qrToken === token);
  }
  function studentById(id: number) {
    return students.value.find((s) => s.id === id);
  }
  function classById(id: number) {
    return classes.value.find((c) => c.id === id);
  }
  function studentsOfClass(classId: number) {
    return students.value.filter((s) => s.classId === classId);
  }
  function addClass(className: string) {
    const id = nextId(classes.value);
    classes.value.push({ id, className });
    queue({ type: 'putClass', id, className });
    return id;
  }
  // Class names are unique (case-insensitive), like the unique rule in the database.
  function classNameTaken(name: string, exceptId?: number) {
    const wanted = name.trim().toLowerCase();
    return classes.value.some(
      (c) => c.id !== exceptId && c.className.trim().toLowerCase() === wanted,
    );
  }
  function renameClass(id: number, className: string) {
    const cls = classById(id);
    if (!cls || classNameTaken(className, id)) return false;
    cls.className = className.trim();
    queue({ type: 'putClass', id, className: cls.className });
    return true;
  }
  // A class that still has students cannot be deleted (on delete restrict).
  function deleteClass(id: number): 'ok' | 'has-students' {
    if (students.value.some((s) => s.classId === id)) return 'has-students';
    classes.value = classes.value.filter((c) => c.id !== id);
    queue({ type: 'deleteClass', id });
    return 'ok';
  }
  function putStudent(student: Student) {
    queue({
      type: 'putStudent',
      id: student.id,
      classId: student.classId,
      fullName: student.fullName,
      qrToken: student.qrToken,
    });
  }
  function updateStudent(id: number, changes: { fullName: string; classId: number }) {
    const student = studentById(id);
    if (!student) return;
    student.fullName = changes.fullName.trim();
    student.classId = changes.classId;
    putStudent(student);
  }
  // Deleting a student also deletes their attendance records (on delete cascade).
  function deleteStudent(id: number) {
    const student = studentById(id);
    if (student && pendingToken.value === student.qrToken) pendingToken.value = null;
    students.value = students.value.filter((s) => s.id !== id);
    records.value = records.value.filter((r) => r.studentId !== id);
    queue({ type: 'deleteStudent', id });
  }
  // Gives the student a new QR token. Attendance records stay linked by student id.
  function regenerateToken(id: number) {
    const student = studentById(id);
    if (!student) return null;
    if (pendingToken.value === student.qrToken) pendingToken.value = null;
    student.qrToken = crypto.randomUUID();
    putStudent(student);
    return student.qrToken;
  }
  // Returns the new student's id.
  function addStudent(classId: number, fullName: string, qrToken: string = crypto.randomUUID()) {
    const id = nextId(students.value);
    const student: Student = { id, classId, fullName, qrToken };
    students.value.push(student);
    putStudent(student);
    return id;
  }

  // Shows what an import would do, without changing anything.
  function previewImport(plan: ImportPlan): ImportPreviewRow[] {
    return plan.classes.map((c) => {
      const cls = classes.value.find((x) => sameText(x.className, c.name));
      const existing = cls ? studentsOfClass(cls.id) : [];
      const alreadyThere = c.students.filter((s) =>
        existing.some((e) => sameText(e.fullName, s.fullName)),
      ).length;
      return {
        name: c.name,
        isNewClass: !cls,
        toAdd: c.students.length - alreadyThere,
        alreadyThere,
      };
    });
  }

  // Adds missing classes and students. Existing students (same name in the same class) are skipped.
  // A QR value from the file is kept when it is not used yet, so printed codes stay valid.
  function applyImport(plan: ImportPlan): ImportSummary {
    const summary: ImportSummary = {
      classesAdded: 0,
      studentsAdded: 0,
      studentsSkipped: 0,
      tokensReplaced: 0,
    };
    const usedTokens = new Set(students.value.map((s) => s.qrToken));
    for (const c of plan.classes) {
      let cls = classes.value.find((x) => sameText(x.className, c.name));
      if (!cls) {
        cls = classById(addClass(c.name.trim()));
        summary.classesAdded++;
      }
      if (!cls) continue;
      for (const s of c.students) {
        if (studentsOfClass(cls.id).some((e) => sameText(e.fullName, s.fullName))) {
          summary.studentsSkipped++;
          continue;
        }
        let token = s.qrToken;
        if (!token || usedTokens.has(token)) {
          if (token) summary.tokensReplaced++;
          token = crypto.randomUUID();
        }
        usedTokens.add(token);
        addStudent(cls.id, s.fullName, token);
        summary.studentsAdded++;
      }
    }
    return summary;
  }
  // The date defaults to today (YYYY-MM-DD, local time).
  function recordFor(studentId: number, session: Session, scan: ScanType, date: string = today()) {
    return records.value.find(
      (r) =>
        r.studentId === studentId &&
        r.eventDate === date &&
        r.session === session &&
        r.scan === scan,
    );
  }
  // All records for one day (YYYY-MM-DD), used by the future records screen.
  function recordsOn(date: string) {
    return records.value.filter((r) => r.eventDate === date);
  }
  function insertRecord(record: AttendanceRecord) {
    records.value.push(record);
    queue({ type: 'putRecord', record });
  }
  // Returns the saved record, or null when the same record already exists today.
  function addRecord(studentId: number, session: Session, scan: ScanType) {
    if (recordFor(studentId, session, scan)) return null;
    const record: AttendanceRecord = {
      id: crypto.randomUUID(),
      studentId,
      eventDate: today(),
      session,
      scan,
      scannedAt: new Date().toISOString(),
    };
    insertRecord(record);
    return record;
  }
  // Used by Undo right after a record is saved.
  function removeRecord(id: string) {
    records.value = records.value.filter((r) => r.id !== id);
    queue({ type: 'deleteRecord', id });
  }

  return {
    classes,
    students,
    records,
    pendingToken,
    saveFailed,
    userId,
    pendingCount,
    syncing,
    offlineTrouble,
    syncProblem,
    deviceUpload,
    uploadPromptOpen,
    switchScope,
    sync,
    flushBeforeSignOut,
    openUploadPrompt,
    dismissUploadPrompt,
    clearSyncProblem,
    uploadDeviceData,
    studentByToken,
    studentById,
    classById,
    studentsOfClass,
    addClass,
    classNameTaken,
    renameClass,
    deleteClass,
    addStudent,
    updateStudent,
    previewImport,
    applyImport,
    deleteStudent,
    regenerateToken,
    recordFor,
    recordsOn,
    addRecord,
    removeRecord,
  };
});
