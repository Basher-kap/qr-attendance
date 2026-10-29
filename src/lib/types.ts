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

export interface SavedData {
  classes: ClassItem[];
  students: Student[];
  records: AttendanceRecord[];
}
