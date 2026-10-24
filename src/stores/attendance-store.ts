import { defineStore } from 'pinia';
import { ref } from 'vue';

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

const today = () => new Date().toISOString().slice(0, 10);

// MOCK DATA: this store is the only place that touches data.
// Later, replace its functions with Supabase and Dexie calls.
export const useAttendanceStore = defineStore('attendance', () => {
  const classes = ref<ClassItem[]>([
    { id: 1, className: '1st Year' },
    { id: 2, className: '2nd Year' },
  ]);
  const students = ref<Student[]>([
    { id: 1, classId: 1, fullName: 'Ana Reyes', qrToken: 'mock-ana' },
    { id: 2, classId: 1, fullName: 'Ben Cruz', qrToken: 'mock-ben' },
    { id: 3, classId: 2, fullName: 'Carla Santos', qrToken: 'mock-carla' },
  ]);
  const records = ref<AttendanceRecord[]>([]);
  const pendingToken = ref<string | null>(null);

  function studentByToken(token: string) {
    return students.value.find((s) => s.qrToken === token);
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
  function addStudent(classId: number, fullName: string) {
    const id = Math.max(0, ...students.value.map((s) => s.id)) + 1;
    students.value.push({ id, classId, fullName, qrToken: crypto.randomUUID() });
  }
  function recordFor(studentId: number, session: Session, scan: ScanType) {
    return records.value.find(
      (r) =>
        r.studentId === studentId &&
        r.eventDate === today() &&
        r.session === session &&
        r.scan === scan,
    );
  }
  // Returns false when the same record already exists today.
  function addRecord(studentId: number, session: Session, scan: ScanType) {
    if (recordFor(studentId, session, scan)) return false;
    records.value.push({
      id: crypto.randomUUID(),
      studentId,
      eventDate: today(),
      session,
      scan,
      scannedAt: new Date().toISOString(),
    });
    return true;
  }

  return {
    classes,
    students,
    records,
    pendingToken,
    studentByToken,
    classById,
    studentsOfClass,
    addClass,
    addStudent,
    recordFor,
    addRecord,
  };
});