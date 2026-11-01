import type { AttendanceRecord, ClassItem, SavedData, Student } from '../stores/attendance-store';

// Merges the data saved on this device (guest data) into the data of the signed-in account.
// Nothing in the account is changed or deleted: the merge only adds what is missing.
//
//  - A class matches by id, or else by name (ignoring capitals and extra spaces).
//  - A student matches by id, or else by name inside the matching class.
//  - A record matches by id, or else by student, day, session and check-in/out. When both
//    sides have it, the account's record is kept.
// Matching by id makes a second merge of the same data add nothing.

export interface MergePlan {
  classes: ClassItem[]; // to add
  students: Student[]; // to add
  records: AttendanceRecord[]; // to add
  stats: {
    classesAdded: number;
    classesMatched: number;
    studentsAdded: number;
    studentsMatched: number;
    recordsAdded: number;
    recordsSkipped: number;
    tokensReplaced: number; // a QR code already used by another student got a new value
  };
}

const norm = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
const recordKey = (studentId: string, r: AttendanceRecord) =>
  `${studentId}|${r.eventDate}|${r.session}|${r.scan}`;

export function planMerge(guest: SavedData, account: SavedData): MergePlan {
  const stats: MergePlan['stats'] = {
    classesAdded: 0,
    classesMatched: 0,
    studentsAdded: 0,
    studentsMatched: 0,
    recordsAdded: 0,
    recordsSkipped: 0,
    tokensReplaced: 0,
  };

  // Classes
  const accountClassById = new Map(account.classes.map((c) => [c.id, c]));
  const accountClassByName = new Map(account.classes.map((c) => [norm(c.className), c]));
  const classMap = new Map<string, string>(); // guest class id -> id in the account
  const newClasses: ClassItem[] = [];
  for (const c of guest.classes) {
    const match = accountClassById.get(c.id) ?? accountClassByName.get(norm(c.className));
    if (match) {
      classMap.set(c.id, match.id);
      stats.classesMatched++;
    } else {
      newClasses.push({ id: c.id, className: c.className.trim() });
      classMap.set(c.id, c.id);
      stats.classesAdded++;
    }
  }

  // Students
  const accountStudentById = new Map(account.students.map((s) => [s.id, s]));
  const accountStudentByName = new Map(
    account.students.map((s) => [`${s.classId}|${norm(s.fullName)}`, s]),
  );
  const usedTokens = new Set(account.students.map((s) => s.qrToken));
  const studentMap = new Map<string, string>(); // guest student id -> id in the account
  const newStudents: Student[] = [];
  for (const s of guest.students) {
    const classId = classMap.get(s.classId);
    if (!classId) continue; // belongs to a class that does not exist: left out
    const match =
      accountStudentById.get(s.id) ?? accountStudentByName.get(`${classId}|${norm(s.fullName)}`);
    if (match) {
      studentMap.set(s.id, match.id);
      stats.studentsMatched++;
      continue;
    }
    let qrToken = s.qrToken;
    if (!qrToken || usedTokens.has(qrToken)) {
      if (qrToken) stats.tokensReplaced++;
      qrToken = crypto.randomUUID();
    }
    usedTokens.add(qrToken);
    newStudents.push({ id: s.id, classId, fullName: s.fullName.trim(), qrToken });
    studentMap.set(s.id, s.id);
    stats.studentsAdded++;
  }

  // Records
  const accountRecordIds = new Set(account.records.map((r) => r.id));
  const accountRecordKeys = new Set(account.records.map((r) => recordKey(r.studentId, r)));
  const newRecords: AttendanceRecord[] = [];
  for (const r of guest.records) {
    const studentId = studentMap.get(r.studentId);
    if (!studentId) continue; // belongs to a student that does not exist: left out
    const key = recordKey(studentId, r);
    if (accountRecordIds.has(r.id) || accountRecordKeys.has(key)) {
      stats.recordsSkipped++;
      continue;
    }
    accountRecordKeys.add(key);
    newRecords.push({ ...r, studentId });
    stats.recordsAdded++;
  }

  return { classes: newClasses, students: newStudents, records: newRecords, stats };
}

// A short fingerprint of the data, to tell whether the device data changed since it was last
// merged. This is a change check, not a security feature.
export function fingerprint(data: SavedData) {
  const text = JSON.stringify([data.classes, data.students, data.records]);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash}`;
}

export const isEmptyData = (d: SavedData) =>
  !d.classes.length && !d.students.length && !d.records.length;

// What is on the screen but not in the account (compared after downloading the account again).
// Used to confirm that a sync arrived: classes and students match by id, records by id or by
// student, day, session and check-in/out (the account ignores a repeated record).
export function findMissing(local: SavedData, remote: SavedData): SavedData {
  const classIds = new Set(remote.classes.map((c) => c.id));
  const studentIds = new Set(remote.students.map((s) => s.id));
  const recordIds = new Set(remote.records.map((r) => r.id));
  const recordKeys = new Set(remote.records.map((r) => recordKey(r.studentId, r)));
  return {
    classes: local.classes.filter((c) => !classIds.has(c.id)),
    students: local.students.filter((s) => !studentIds.has(s.id)),
    records: local.records.filter(
      (r) => !recordIds.has(r.id) && !recordKeys.has(recordKey(r.studentId, r)),
    ),
  };
}
