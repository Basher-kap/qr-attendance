import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import * as cloud from '../lib/cloud-data';
import * as offline from '../lib/offline-store';
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

  // ---- Cloud: changes are applied on screen at once, saved on the device, then sent ----
  // Every change goes into the outbox first. The outbox is stored on the device, so a change
  // made offline (or just before the page is closed) is still sent later, in the same order.
  const outbox = ref<cloud.Op[]>([]);
  const pendingSync = computed(() => outbox.value.length);
  const syncing = ref(false);
  const retryReason = ref(''); // why waiting changes could not be sent yet (shown while online)
  let owner = ''; // the account the outbox and the cached copy belong to
  let cloudReady = false; // the screen holds this account's data, so it may be cached
  let version = 0; // counts local changes, so a slow download never overwrites newer ones
  let draining: Promise<void> | null = null;

  function persistOutbox() {
    if (owner && !offline.saveOutbox(owner, outbox.value)) saveFailed.value = true;
  }
  let cacheTimer: ReturnType<typeof setTimeout> | undefined;
  function persistCacheNow() {
    clearTimeout(cacheTimer);
    if (mode.value !== 'cloud' || !cloudReady || !owner) return;
    const ok = offline.saveCache(owner, {
      classes: classes.value,
      students: students.value,
      records: records.value,
    });
    saveFailed.value = !ok;
  }
  watch(
    [classes, students, records],
    () => {
      if (mode.value !== 'cloud' || !cloudReady) return;
      clearTimeout(cacheTimer);
      cacheTimer = setTimeout(persistCacheNow, 500);
    },
    { deep: true },
  );

  function enqueue(op: cloud.Op) {
    if (mode.value !== 'cloud') return;
    version++;
    outbox.value.push(op);
    persistOutbox();
    void drain();
  }

  // Sends the waiting changes one by one. Stops at the first one that cannot be sent yet
  // (no connection, server busy) and keeps it for the next try. A change the server rejects
  // for good is dropped and reported, so it cannot block everything behind it.
  function drain(): Promise<void> {
    if (mode.value !== 'cloud' || !owner) return Promise.resolve();
    if (draining) return draining;
    const who = owner;
    syncing.value = true;
    const run = (async () => {
      while (outbox.value.length && owner === who && navigator.onLine) {
        const op = outbox.value[0]!;
        try {
          await cloud.sendOp(op);
          retryReason.value = '';
        } catch (e) {
          if (owner !== who) return;
          if (cloud.isRetryable(e)) {
            retryReason.value = message(e);
            return;
          }
          syncError.value ||= message(e);
        }
        if (owner !== who) return;
        outbox.value.shift();
        persistOutbox();
      }
    })();
    // Cleared only after `draining` is set, even when there was nothing to send.
    draining = run.finally(() => {
      syncing.value = false;
      draining = null;
    });
    return draining;
  }
  // Resolves when everything that could be sent has been sent.
  const flush = () => drain();

  // Try again when the connection returns, when the app comes back to the front, and every
  // 15 seconds while changes are waiting.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void drain());
    window.addEventListener('pagehide', persistCacheNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void drain();
      else persistCacheNow();
    });
    setInterval(() => {
      if (outbox.value.length) void drain();
    }, 15000);
  }

  function useData(data: SavedData) {
    classes.value = data.classes;
    students.value = data.students;
    records.value = data.records;
  }

  let loadToken = 0;
  // Opens the signed-in account. The copy kept on the device is shown at once, waiting
  // changes are sent, and then the account's data is downloaded. Without a connection the
  // copy on the device is used.
  async function enterCloud() {
    const token = ++loadToken;
    mode.value = 'cloud';
    loadError.value = '';
    syncError.value = '';
    retryReason.value = '';
    guestOffer.value = null;
    cloudReady = false;
    owner = auth.userId;
    outbox.value = offline.loadOutbox(owner);
    const cached = offline.loadCache(owner);
    if (cached) {
      useData(cached);
      cloudReady = true;
      loading.value = false;
    } else {
      loading.value = true;
    }
    try {
      await drain();
      if (token !== loadToken) return;
      // Changes still waiting: the screen already shows them, so do not replace it.
      if (cached && outbox.value.length) return;
      const seen = version;
      let data: SavedData;
      try {
        data = await cloud.fetchAllData();
      } catch (e) {
        if (cached) return; // offline or busy: keep working from the copy on this device
        throw e;
      }
      if (token !== loadToken) return;
      if (seen !== version) return; // changed while downloading: the next refresh will catch up
      useData(data);
      cloudReady = true;
      persistCacheNow();
      const accountIsEmpty = !data.classes.length && !data.students.length && !data.records.length;
      const guest = loadSaved();
      if (accountIsEmpty && (guest.classes.length || guest.students.length)) {
        guestOffer.value = guest;
      }
    } catch (e) {
      if (token === loadToken) {
        loadError.value = navigator.onLine
          ? message(e)
          : 'You are offline, and this account has not been opened on this device before. Connect to the internet once to load it.';
      }
    } finally {
      if (token === loadToken) loading.value = false;
    }
  }

  function enterGuest() {
    loadToken++;
    clearTimeout(cacheTimer);
    if (owner) offline.clearCache(owner); // the next person on this device must not see it
    owner = '';
    cloudReady = false;
    outbox.value = [];
    retryReason.value = '';
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
      useData({ classes: offer.classes, students: studentList, records: recordList });
      cloudReady = true;
      persistCacheNow();
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
    enqueue({ k: 'classes', rows: [cls] });
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
    enqueue({ k: 'renameClass', id, name });
    return true;
  }
  // A class that still has students cannot be deleted (on delete restrict).
  function deleteClass(id: string): 'ok' | 'has-students' {
    if (students.value.some((s) => s.classId === id)) return 'has-students';
    classes.value = classes.value.filter((c) => c.id !== id);
    enqueue({ k: 'deleteClass', id });
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
    enqueue({ k: 'students', rows: [student] });
  }
  function updateStudent(id: string, changes: { fullName: string; classId: string }) {
    const student = studentById(id);
    if (!student) return;
    student.fullName = changes.fullName.trim();
    student.classId = changes.classId;
    const { fullName, classId } = student;
    enqueue({ k: 'updateStudent', id, fullName, classId });
  }
  // Deleting a student also deletes their attendance records (on delete cascade).
  function deleteStudent(id: string) {
    const student = studentById(id);
    if (student && pendingToken.value === student.qrToken) pendingToken.value = null;
    students.value = students.value.filter((s) => s.id !== id);
    records.value = records.value.filter((r) => r.studentId !== id);
    enqueue({ k: 'deleteStudent', id });
  }
  // Gives the student a new QR token. Attendance records stay linked by student id.
  function regenerateToken(id: string) {
    const student = studentById(id);
    if (!student) return null;
    if (pendingToken.value === student.qrToken) pendingToken.value = null;
    const token = crypto.randomUUID();
    student.qrToken = token;
    enqueue({ k: 'setToken', id, token });
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
    if (newClasses.length) enqueue({ k: 'classes', rows: newClasses });
    if (newStudents.length) enqueue({ k: 'students', rows: newStudents });
    return summary;
  }

  // ---- Attendance ----
  // The date defaults to today (YYYY-MM-DD, local time).
  function recordFor(studentId: string, session: Session, scan: ScanType, date: string = today()) {
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
    enqueue({ k: 'records', rows: [row] });
    return record;
  }
  // Used by Undo right after a record is saved.
  function removeRecord(id: string) {
    records.value = records.value.filter((r) => r.id !== id);
    enqueue({ k: 'deleteRecord', id });
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
    pendingSync,
    syncing,
    retryReason,
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
