import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import * as cloud from '../lib/cloud-data';
import { useAuthStore } from './auth-store';

export type Session = 'morning' | 'afternoon';
export type ScanType = 'check_in' | 'check_out';

export interface ClassItem {
  id: string;
  className: string;
}
export interface Student {
  id: string;
  classId: string;
  fullName: string;
  qrToken: string;
}
export interface AttendanceRecord {
  id: string;
  studentId: string;
  eventDate: string;
  session: Session;
  scan: ScanType;
  scannedAt: string;
}
export interface SavedData {
  classes: ClassItem[];
  students: Student[];
  records: AttendanceRecord[];
}

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
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

// ---- Guest data: saved in this browser (localStorage) ----
const STORAGE_KEY = 'qr-attendance:guest:v2';
const OLD_STORAGE_KEY = 'qr-attendance:guest:v1'; // numeric ids, converted once below

function parseSaved(raw: string): SavedData {
  const data = JSON.parse(raw) as Partial<SavedData>;
  return {
    classes: Array.isArray(data.classes) ? data.classes : [],
    students: Array.isArray(data.students) ? data.students : [],
    records: Array.isArray(data.records) ? data.records : [],
  };
}

// Version 1 used numbers as ids. Cloud data needs ids that are unique on every device, so
// the old numbers are replaced by random ids, keeping all links between the rows.
function migrateV1(raw: string): SavedData {
  const old = JSON.parse(raw) as {
    classes?: { id: number; className: string }[];
    students?: { id: number; classId: number; fullName: string; qrToken: string }[];
    records?: (Omit<AttendanceRecord, 'studentId'> & { studentId: number })[];
  };
  const classIds = new Map<number, string>();
  const studentIds = new Map<number, string>();
  const classes = (old.classes ?? []).map((c) => {
    const id = crypto.randomUUID();
    classIds.set(c.id, id);
    return { id, className: c.className };
  });
  const students: Student[] = [];
  for (const s of old.students ?? []) {
    const classId = classIds.get(s.classId);
    if (!classId) continue;
    const id = crypto.randomUUID();
    studentIds.set(s.id, id);
    students.push({ id, classId, fullName: s.fullName, qrToken: s.qrToken });
  }
  const records: AttendanceRecord[] = [];
  for (const r of old.records ?? []) {
    const studentId = studentIds.get(r.studentId);
    if (studentId) records.push({ ...r, studentId });
  }
  return { classes, students, records };
}

function loadSaved(): SavedData {
  const empty: SavedData = { classes: [], students: [], records: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseSaved(raw);
    const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldRaw) {
      const migrated = migrateV1(oldRaw);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(OLD_STORAGE_KEY);
      return migrated;
    }
    return empty;
  } catch {
    return empty;
  }
}

// Two places hold the data. Guest mode (not signed in) keeps it in this browser.
// Cloud mode (signed in with Google) keeps it in the user's own account. This store is the
// only place that touches data: screens call its functions and never know which mode is on.
export const useAttendanceStore = defineStore('attendance', () => {
  const auth = useAuthStore();
  const saved = loadSaved();
  const classes = ref<ClassItem[]>(saved.classes);
  const students = ref<Student[]>(saved.students);
  const records = ref<AttendanceRecord[]>(saved.records);
  const pendingToken = ref<string | null>(null);

  const mode = ref<'guest' | 'cloud'>('guest');
  const loading = ref(false);
  const loadError = ref('');
  const syncError = ref('');
  const saveFailed = ref(false); // the browser refused to save guest data
  const guestOffer = ref<SavedData | null>(null); // device data that can be uploaded after sign-in
  const uploading = ref(false);

  // False while the sign-in is being checked or the account's data is loading.
  const ready = computed(() => auth.ready && !loading.value && !loadError.value);

  // Guest data is written to the browser. In cloud mode this never runs, so the data of
  // the account can never overwrite the guest data that is still on the device.
  watch(
    [classes, students, records],
    () => {
      if (mode.value !== 'guest') return;
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            classes: classes.value,
            students: students.value,
            records: records.value,
          }),
        );
        saveFailed.value = false;
      } catch {
        saveFailed.value = true;
      }
    },
    { deep: true },
  );

  // ---- Cloud: changes are applied on screen at once, then sent in order ----
  let chain: Promise<void> = Promise.resolve();
  function sync(task: () => Promise<void>) {
    if (mode.value !== 'cloud') return;
    chain = chain.then(task).catch((e: unknown) => {
      if (mode.value === 'cloud') syncError.value = message(e);
    });
  }
  // Resolves when everything waiting to be sent has been sent.
  const flush = () => chain;

  let loadToken = 0;
  async function enterCloud() {
    const token = ++loadToken;
    mode.value = 'cloud';
    loading.value = true;
    loadError.value = '';
    syncError.value = '';
    guestOffer.value = null;
    try {
      const data = await cloud.fetchAllData();
      if (token !== loadToken) return;
      classes.value = data.classes;
      students.value = data.students;
      records.value = data.records;
      const accountIsEmpty = !data.classes.length && !data.students.length && !data.records.length;
      const guest = loadSaved();
      if (accountIsEmpty && (guest.classes.length || guest.students.length)) {
        guestOffer.value = guest;
      }
    } catch (e) {
      if (token === loadToken) loadError.value = message(e);
    } finally {
      if (token === loadToken) loading.value = false;
    }
  }

  function enterGuest() {
    loadToken++;
    mode.value = 'guest';
    loading.value = false;
    loadError.value = '';
    syncError.value = '';
    guestOffer.value = null;
    const guest = loadSaved();
    classes.value = guest.classes;
    students.value = guest.students;
    records.value = guest.records;
    pendingToken.value = null;
  }

  watch(
    () => auth.userId,
    (id, previous) => {
      if (id) void enterCloud();
      else if (previous) enterGuest();
    },
    { immediate: true },
  );

  async function reloadCloud() {
    await flush();
    await enterCloud();
  }

  // Uploads the data saved on this device to the signed-in account (only offered when the
  // account has no data yet). Rows that point to something missing are left out.
  async function uploadGuestData() {
    const offer = guestOffer.value;
    if (!offer) return;
    uploading.value = true;
    syncError.value = '';
    try {
      await flush();
      const classIds = new Set(offer.classes.map((c) => c.id));
      const studentList = offer.students.filter((s) => classIds.has(s.classId));
      const studentIds = new Set(studentList.map((s) => s.id));
      const recordList = offer.records.filter((r) => studentIds.has(r.studentId));
      await cloud.insertClasses(offer.classes);
      await cloud.insertStudents(studentList);
      await cloud.insertRecords(recordList);
      classes.value = offer.classes;
      students.value = studentList;
      records.value = recordList;
      guestOffer.value = null;
    } catch (e) {
      syncError.value = `The upload failed: ${message(e)}`;
    } finally {
      uploading.value = false;
    }
  }
  function dismissOffer() {
    guestOffer.value = null;
  }
  function clearSyncError() {
    syncError.value = '';
  }

  // ---- Reading ----
  function studentByToken(token: string) {
    return students.value.find((s) => s.qrToken === token);
  }
  function studentById(id: string) {
    return students.value.find((s) => s.id === id);
  }
  function classById(id: string) {
    return classes.value.find((c) => c.id === id);
  }
  function studentsOfClass(classId: string) {
    return students.value.filter((s) => s.classId === classId);
  }

  // ---- Classes ----
  function createClass(className: string) {
    const cls: ClassItem = { id: crypto.randomUUID(), className };
    classes.value.push(cls);
    return { ...cls };
  }
  function addClass(className: string) {
    const cls = createClass(className);
    sync(() => cloud.insertClasses([cls]));
    return cls.id;
  }
  // Class names are unique (case-insensitive), like the unique rule in the database.
  function classNameTaken(name: string, exceptId?: string) {
    const wanted = name.trim().toLowerCase();
    return classes.value.some(
      (c) => c.id !== exceptId && c.className.trim().toLowerCase() === wanted,
    );
  }
  function renameClass(id: string, className: string) {
    const cls = classById(id);
    if (!cls || classNameTaken(className, id)) return false;
    cls.className = className.trim();
    const name = cls.className;
    sync(() => cloud.renameClassRemote(id, name));
    return true;
  }
  // A class that still has students cannot be deleted (on delete restrict).
  function deleteClass(id: string): 'ok' | 'has-students' {
    if (students.value.some((s) => s.classId === id)) return 'has-students';
    classes.value = classes.value.filter((c) => c.id !== id);
    sync(() => cloud.deleteClassRemote(id));
    return 'ok';
  }

  // ---- Students ----
  function createStudent(classId: string, fullName: string, qrToken: string) {
    const student: Student = { id: crypto.randomUUID(), classId, fullName, qrToken };
    students.value.push(student);
    return { ...student };
  }
  function addStudent(classId: string, fullName: string, qrToken: string = crypto.randomUUID()) {
    const student = createStudent(classId, fullName, qrToken);
    sync(() => cloud.insertStudents([student]));
  }
  function updateStudent(id: string, changes: { fullName: string; classId: string }) {
    const student = studentById(id);
    if (!student) return;
    student.fullName = changes.fullName.trim();
    student.classId = changes.classId;
    const { fullName, classId } = student;
    sync(() => cloud.updateStudentRemote(id, fullName, classId));
  }
  // Deleting a student also deletes their attendance records (on delete cascade).
  function deleteStudent(id: string) {
    const student = studentById(id);
    if (student && pendingToken.value === student.qrToken) pendingToken.value = null;
    students.value = students.value.filter((s) => s.id !== id);
    records.value = records.value.filter((r) => r.studentId !== id);
    sync(() => cloud.deleteStudentRemote(id));
  }
  // Gives the student a new QR token. Attendance records stay linked by student id.
  function regenerateToken(id: string) {
    const student = studentById(id);
    if (!student) return null;
    if (pendingToken.value === student.qrToken) pendingToken.value = null;
    const token = crypto.randomUUID();
    student.qrToken = token;
    sync(() => cloud.updateTokenRemote(id, token));
    return token;
  }

  // ---- Spreadsheet import ----
  // Shows what an import would do, without changing anything.
  function previewImport(plan: ImportPlan): ImportPreviewRow[] {
    return plan.classes.map((c) => {
      const cls = classes.value.find((x) => sameText(x.className, c.name));
      const existing = cls ? studentsOfClass(cls.id) : [];
      const alreadyThere = c.students.filter((s) =>
        existing.some((e) => sameText(e.fullName, s.fullName)),
      ).length;
      return { name: c.name, isNewClass: !cls, toAdd: c.students.length - alreadyThere, alreadyThere };
    });
  }

  // Adds missing classes and students. Existing students (same name in the same class) are skipped.
  // A QR value from the file is kept when it is not used yet, so printed codes stay valid.
  // In cloud mode everything new is sent in one batch.
  function applyImport(plan: ImportPlan): ImportSummary {
    const summary: ImportSummary = {
      classesAdded: 0,
      studentsAdded: 0,
      studentsSkipped: 0,
      tokensReplaced: 0,
    };
    const usedTokens = new Set(students.value.map((s) => s.qrToken));
    const newClasses: ClassItem[] = [];
    const newStudents: Student[] = [];
    for (const c of plan.classes) {
      let cls: ClassItem | undefined = classes.value.find((x) => sameText(x.className, c.name));
      if (!cls) {
        cls = createClass(c.name.trim());
        newClasses.push(cls);
        summary.classesAdded++;
      }
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
        newStudents.push(createStudent(cls.id, s.fullName, token));
        summary.studentsAdded++;
      }
    }
    sync(async () => {
      await cloud.insertClasses(newClasses);
      await cloud.insertStudents(newStudents);
    });
    return summary;
  }

  // ---- Attendance ----
  // The date defaults to today (YYYY-MM-DD, local time).
  function recordFor(
    studentId: string,
    session: Session,
    scan: ScanType,
    date: string = today(),
  ) {
    return records.value.find(
      (r) =>
        r.studentId === studentId &&
        r.eventDate === date &&
        r.session === session &&
        r.scan === scan,
    );
  }
  // All records for one day (YYYY-MM-DD).
  function recordsOn(date: string) {
    return records.value.filter((r) => r.eventDate === date);
  }
  // Returns the saved record, or null when the same record already exists today.
  function addRecord(studentId: string, session: Session, scan: ScanType) {
    if (recordFor(studentId, session, scan)) return null;
    const record: AttendanceRecord = {
      id: crypto.randomUUID(),
      studentId,
      eventDate: today(),
      session,
      scan,
      scannedAt: new Date().toISOString(),
    };
    records.value.push(record);
    const row = { ...record };
    sync(() => cloud.insertRecords([row]));
    return record;
  }
  // Used by Undo right after a record is saved.
  function removeRecord(id: string) {
    records.value = records.value.filter((r) => r.id !== id);
    sync(() => cloud.deleteRecordRemote(id));
  }

  return {
    classes,
    students,
    records,
    pendingToken,
    mode,
    ready,
    loading,
    loadError,
    syncError,
    saveFailed,
    guestOffer,
    uploading,
    reloadCloud,
    flush,
    uploadGuestData,
    dismissOffer,
    clearSyncError,
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
    deleteStudent,
    regenerateToken,
    previewImport,
    applyImport,
    recordFor,
    recordsOn,
    addRecord,
    removeRecord,
  };
});
