import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import * as cloud from '../lib/cloud-data';
import { cleanName } from '../utils/limits';
import { findMissing, fingerprint, isEmptyData, planMerge, type MergePlan } from '../lib/merge';
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
export interface ParsedRecord {
  eventDate: string;
  session: Session;
  scan: ScanType;
  scannedAt: string;
}
export interface ParsedStudent {
  fullName: string;
  qrToken?: string;
  records?: ParsedRecord[]; // attendance read from the Morning/Afternoon in/out columns
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
  recordsToAdd: number;
  recordsAlreadyThere: number;
}
export interface ImportSummary {
  classesAdded: number;
  studentsAdded: number;
  studentsSkipped: number;
  tokensReplaced: number;
  recordsAdded: number;
  recordsSkipped: number;
}

// Progress of the last "sync this device's data to my account", from sending to the check that
// every row is really in the account.
export interface SyncReport {
  phase: 'sending' | 'verifying' | 'done' | 'issues';
  added: { classes: number; students: number; records: number };
  missing: { classes: number; students: number; records: number };
  verifiedRecords: number; // attendance records confirmed in the account
  error: string;
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

// The device data that was last synced to an account, as a fingerprint, so the same data is not
// offered again at every sign-in. Saved only after the account was confirmed to hold it.
const mergedKey = (uid: string) => `qr-attendance:merged:${uid}`;
const loadMerged = (uid: string) => {
  try {
    return localStorage.getItem(mergedKey(uid));
  } catch {
    return null;
  }
};
const saveMerged = (uid: string, value: string) => {
  try {
    localStorage.setItem(mergedKey(uid), value);
  } catch {
    /* the data is offered again next time */
  }
};

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
  const guestOffer = ref<SavedData | null>(null); // device data that can be synced after sign-in
  const mergeStats = ref<MergePlan['stats'] | null>(null); // what syncing it would do
  const offerDeferred = ref(false); // the person chose "Not now": can be reopened from the menu
  const syncReport = ref<SyncReport | null>(null);
  const syncReportOpen = ref(false);
  const lastVerifiedAt = ref(''); // when the account was last confirmed to hold everything

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
  const pendingSync = ref(0); // changes shown on screen that have not reached the account yet
  let version = 0; // counts changes made on screen, so a check never compares against stale data
  function sync(task: () => Promise<void>) {
    if (mode.value !== 'cloud') return;
    version++;
    pendingSync.value++;
    chain = chain
      .then(task)
      .catch((e: unknown) => {
        if (mode.value === 'cloud') syncError.value = message(e);
      })
      .finally(() => {
        pendingSync.value--;
      });
  }
  // Resolves when everything waiting to be sent has been sent.
  const flush = () => chain;

  // Offers to sync the data recorded on this device (as a guest) to the signed-in account, unless
  // it has nothing new for the account or it is the same data that was synced before. Called with
  // the account's data freshly downloaded, so the comparison is accurate.
  let forceOffer = false;
  function offerDeviceData(force: boolean) {
    if (mode.value !== 'cloud' || !auth.userId) return;
    const guest = loadSaved();
    if (isEmptyData(guest)) return;
    if (!force && loadMerged(auth.userId) === fingerprint(guest)) return;
    const { stats } = planMerge(guest, {
      classes: classes.value,
      students: students.value,
      records: records.value,
    });
    if (stats.classesAdded + stats.studentsAdded + stats.recordsAdded === 0) return;
    // Signing in never opens a prompt by itself: a fellow clerk who signs in on this device must
    // not be asked to add this device's data to their account by accident. The person has to ask
    // for it from the menu ("Sync device data"), which names the account the data would go to.
    if (!force) {
      offerDeferred.value = true;
      return;
    }
    guestOffer.value = guest;
    mergeStats.value = stats;
  }
  // From the menu, after "Not now": download the account again and offer once more.
  async function reopenOffer() {
    forceOffer = true;
    await reloadCloud();
  }

  let loadToken = 0;
  async function enterCloud() {
    const token = ++loadToken;
    mode.value = 'cloud';
    loading.value = true;
    loadError.value = '';
    syncError.value = '';
    guestOffer.value = null;
    mergeStats.value = null;
    offerDeferred.value = false;
    try {
      const data = await cloud.fetchAllData();
      if (token !== loadToken) return;
      classes.value = data.classes;
      students.value = data.students;
      records.value = data.records;
      offerDeviceData(forceOffer);
      forceOffer = false;
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
    mergeStats.value = null;
    offerDeferred.value = false;
    syncReport.value = null;
    syncReportOpen.value = false;
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

  // Syncs the data recorded on this device to the signed-in account (see lib/merge.ts). Only what
  // is missing is added: classes and students with the same name are treated as the same, and an
  // attendance record that is already in the account is skipped. Then the account is downloaded
  // again and compared with the screen, and anything that did not arrive is sent once more
  // (see verifyCloud).
  function uploadGuestData() {
    const offer = guestOffer.value;
    if (!offer || mode.value !== 'cloud') return;
    const plan = planMerge(offer, {
      classes: classes.value,
      students: students.value,
      records: records.value,
    });
    classes.value = classes.value.concat(plan.classes);
    students.value = students.value.concat(plan.students);
    records.value = records.value.concat(plan.records);
    sync(async () => {
      await cloud.insertClasses(plan.classes);
      await cloud.insertStudents(plan.students);
      await cloud.insertRecords(plan.records);
    });
    guestOffer.value = null;
    mergeStats.value = null;
    offerDeferred.value = false;
    syncReport.value = {
      phase: 'sending',
      added: {
        classes: plan.classes.length,
        students: plan.students.length,
        records: plan.records.length,
      },
      missing: { classes: 0, students: 0, records: 0 },
      verifiedRecords: 0,
      error: '',
    };
    syncReportOpen.value = true;
    void verifyCloud(fingerprint(offer));
  }
  function dismissOffer() {
    guestOffer.value = null;
    mergeStats.value = null;
    offerDeferred.value = true;
  }

  // Confirms that the account holds everything shown on the screen: waits until everything is
  // sent, downloads the account, and looks for classes, students and attendance records that are
  // missing. Missing ones are sent once more and the check runs again. The device data counts as
  // synced (and is not offered again) only when the check passes.
  let verifying = false;
  async function verifyCloud(deviceFingerprint: string) {
    const report = syncReport.value;
    const token = loadToken;
    const who = auth.userId;
    if (verifying || !report || mode.value !== 'cloud' || !who) return;
    verifying = true;
    pendingDeviceFingerprint = deviceFingerprint;
    report.phase = 'sending';
    report.error = '';
    try {
      let resent = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        await flush();
        if (token !== loadToken) return;
        report.phase = 'verifying';
        const seen = version;
        const remote = await cloud.fetchAllData();
        if (token !== loadToken) return;
        if (seen !== version || pendingSync.value) continue; // changed meanwhile: check again
        const missing = findMissing(
          { classes: classes.value, students: students.value, records: records.value },
          remote,
        );
        const count = {
          classes: missing.classes.length,
          students: missing.students.length,
          records: missing.records.length,
        };
        report.missing = count;
        if (!count.classes && !count.students && !count.records) {
          report.verifiedRecords = records.value.length;
          report.phase = 'done';
          lastVerifiedAt.value = new Date().toISOString();
          saveMerged(who, pendingDeviceFingerprint);
          return;
        }
        if (resent) break;
        resent = true;
        sync(async () => {
          await cloud.insertClasses(missing.classes);
          await cloud.insertStudents(missing.students);
          await cloud.insertRecords(missing.records);
        });
      }
      report.phase = 'issues';
      report.error = syncError.value || 'Some data could not be confirmed in your account.';
    } catch (e) {
      if (token !== loadToken) return;
      report.phase = 'issues';
      report.error = message(e);
    } finally {
      verifying = false;
    }
  }
  let pendingDeviceFingerprint = '';
  function retryVerify() {
    if (syncReport.value) void verifyCloud(pendingDeviceFingerprint);
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
    const cls: ClassItem = {
      id: crypto.randomUUID(),
      className: cleanName(className) || 'Unnamed',
    };
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
    const wanted = cleanName(name).toLowerCase();
    return classes.value.some(
      (c) => c.id !== exceptId && c.className.trim().toLowerCase() === wanted,
    );
  }
  function renameClass(id: string, className: string) {
    const cls = classById(id);
    if (!cls || classNameTaken(className, id)) return false;
    cls.className = cleanName(className) || cls.className;
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
    const student: Student = {
      id: crypto.randomUUID(),
      classId,
      fullName: cleanName(fullName) || 'Unnamed',
      qrToken,
    };
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
    student.fullName = cleanName(changes.fullName) || student.fullName;
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
  // One attendance record per student, day, session and type, like the rule in the database.
  const recordKey = (
    studentId: string,
    r: { eventDate: string; session: Session; scan: ScanType },
  ) => `${studentId}|${r.eventDate}|${r.session}|${r.scan}`;
  const recordKeys = () => new Set(records.value.map((r) => recordKey(r.studentId, r)));

  // Shows what an import would do, without changing anything.
  function previewImport(plan: ImportPlan): ImportPreviewRow[] {
    const have = recordKeys();
    return plan.classes.map((c) => {
      const cls = classes.value.find((x) => sameText(x.className, c.name));
      const existing = cls ? studentsOfClass(cls.id) : [];
      let alreadyThere = 0;
      let recordsToAdd = 0;
      let recordsAlreadyThere = 0;
      for (const s of c.students) {
        const match = existing.find((e) => sameText(e.fullName, s.fullName));
        if (match) alreadyThere++;
        for (const r of s.records ?? []) {
          if (match && have.has(recordKey(match.id, r))) recordsAlreadyThere++;
          else recordsToAdd++;
        }
      }
      return {
        name: c.name,
        isNewClass: !cls,
        toAdd: c.students.length - alreadyThere,
        alreadyThere,
        recordsToAdd,
        recordsAlreadyThere,
      };
    });
  }

  // Adds missing classes and students. Existing students (same name in the same class) are skipped.
  // A QR value from the file is kept when it is not used yet, so printed codes stay valid.
  // Attendance in the file is added too (duplicates skipped). In cloud mode everything new is sent
  // in one batch, students before their records.
  function applyImport(plan: ImportPlan): ImportSummary {
    const summary: ImportSummary = {
      classesAdded: 0,
      studentsAdded: 0,
      studentsSkipped: 0,
      tokensReplaced: 0,
      recordsAdded: 0,
      recordsSkipped: 0,
    };
    const usedTokens = new Set(students.value.map((s) => s.qrToken));
    const newClasses: ClassItem[] = [];
    const newStudents: Student[] = [];
    const newRecords: AttendanceRecord[] = [];
    const have = recordKeys();
    // Attendance read from the file, added for new and existing students alike.
    const addRecords = (studentId: string, parsed: ParsedStudent) => {
      for (const r of parsed.records ?? []) {
        const key = recordKey(studentId, r);
        if (have.has(key)) {
          summary.recordsSkipped++;
          continue;
        }
        have.add(key);
        newRecords.push({ id: crypto.randomUUID(), studentId, ...r });
        summary.recordsAdded++;
      }
    };
    for (const c of plan.classes) {
      let cls: ClassItem | undefined = classes.value.find((x) => sameText(x.className, c.name));
      if (!cls) {
        cls = createClass(c.name);
        newClasses.push(cls);
        summary.classesAdded++;
      }
      for (const s of c.students) {
        const existing = studentsOfClass(cls.id).find((e) => sameText(e.fullName, s.fullName));
        if (existing) {
          summary.studentsSkipped++;
          addRecords(existing.id, s);
          continue;
        }
        let token = s.qrToken;
        if (!token || usedTokens.has(token)) {
          if (token) summary.tokensReplaced++;
          token = crypto.randomUUID();
        }
        usedTokens.add(token);
        const created = createStudent(cls.id, s.fullName, token);
        newStudents.push(created);
        summary.studentsAdded++;
        addRecords(created.id, s);
      }
    }
    if (newRecords.length) records.value = records.value.concat(newRecords);
    sync(async () => {
      await cloud.insertClasses(newClasses);
      await cloud.insertStudents(newStudents);
      await cloud.insertRecords(newRecords);
    });
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
    pendingSync,
    saveFailed,
    guestOffer,
    mergeStats,
    offerDeferred,
    syncReport,
    syncReportOpen,
    lastVerifiedAt,
    reloadCloud,
    reopenOffer,
    retryVerify,
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
