import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type Session = 'morning' | 'afternoon';
export type ScanType = 'check_in' | 'check_out';

export interface ClassItem {
  id: number;
  className: string;
}
export interface Student {
  id: number;
  classId: number;
  fullName: string;
  qrToken: string;
}
export interface AttendanceRecord {
  id: string;
  studentId: number;
  eventDate: string;
  session: Session;
  scan: ScanType;
  scannedAt: string;
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

// Guest mode: everything is saved in this browser (localStorage), so it survives a refresh.
// Signing in with Google will later load and save the same data in the cloud instead.
// This store is the only place that touches data.
const STORAGE_KEY = 'qr-attendance:guest:v1';

interface SavedData {
  classes: ClassItem[];
  students: Student[];
  records: AttendanceRecord[];
}

function loadSaved(): SavedData {
  const empty: SavedData = { classes: [], students: [], records: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw) as Partial<SavedData>;
    return {
      classes: Array.isArray(data.classes) ? data.classes : [],
      students: Array.isArray(data.students) ? data.students : [],
      records: Array.isArray(data.records) ? data.records : [],
    };
  } catch {
    return empty;
  }
}

export const useAttendanceStore = defineStore('attendance', () => {
  const saved = loadSaved();
  const classes = ref<ClassItem[]>(saved.classes);
  const students = ref<Student[]>(saved.students);
  const records = ref<AttendanceRecord[]>(saved.records);
  const pendingToken = ref<string | null>(null);

  // True when the browser refused to save (storage full or blocked).
  const saveFailed = ref(false);
  watch(
    [classes, students, records],
    () => {
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
    const id = Math.max(0, ...classes.value.map((c) => c.id)) + 1;
    classes.value.push({ id, className });
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
    return true;
  }
  // A class that still has students cannot be deleted (on delete restrict).
  function deleteClass(id: number): 'ok' | 'has-students' {
    if (students.value.some((s) => s.classId === id)) return 'has-students';
    classes.value = classes.value.filter((c) => c.id !== id);
    return 'ok';
  }
  function updateStudent(id: number, changes: { fullName: string; classId: number }) {
    const student = studentById(id);
    if (!student) return;
    student.fullName = changes.fullName.trim();
    student.classId = changes.classId;
  }
  // Deleting a student also deletes their attendance records (on delete cascade).
  function deleteStudent(id: number) {
    const student = studentById(id);
    if (student && pendingToken.value === student.qrToken) pendingToken.value = null;
    students.value = students.value.filter((s) => s.id !== id);
    records.value = records.value.filter((r) => r.studentId !== id);
  }
  // Gives the student a new QR token. Attendance records stay linked by student id.
  function regenerateToken(id: number) {
    const student = studentById(id);
    if (!student) return null;
    if (pendingToken.value === student.qrToken) pendingToken.value = null;
    student.qrToken = crypto.randomUUID();
    return student.qrToken;
  }
  function addStudent(classId: number, fullName: string, qrToken: string = crypto.randomUUID()) {
    const id = Math.max(0, ...students.value.map((s) => s.id)) + 1;
    students.value.push({ id, classId, fullName, qrToken });
  }

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
  function recordFor(
    studentId: number,
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
  // All records for one day (YYYY-MM-DD), used by the future records screen.
  function recordsOn(date: string) {
    return records.value.filter((r) => r.eventDate === date);
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
    records.value.push(record);
    return record;
  }
  // Used by Undo right after a record is saved.
  function removeRecord(id: string) {
    records.value = records.value.filter((r) => r.id !== id);
  }

  return {
    classes,
    students,
    records,
    pendingToken,
    saveFailed,
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
