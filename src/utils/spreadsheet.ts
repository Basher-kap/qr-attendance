import type { Cell, Worksheet } from 'exceljs';
import type {
  AttendanceRecord,
  ClassItem,
  ImportPlan,
  ParsedRecord,
  Session,
  ScanType,
  Student,
} from '../stores/attendance-store';

// Column headers of the QR Attendee spreadsheet template.
export const HEADERS = [
  'No.#',
  'Full Name',
  'Morning-in',
  'Morning-out',
  'Afternoon-in',
  'Afternoon-out',
  'QR Code',
] as const;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ExcelJS is large, so it is only loaded when someone imports or exports.
async function loadExcel() {
  const mod = await import('exceljs');
  return (mod as unknown as { default?: typeof mod }).default ?? mod;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const byName = (a: Student, b: Student) =>
  a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' });

const pad = (n: number) => String(n).padStart(2, '0');

// The four attendance columns of the template, in order, with the session and scan type each one holds.
const SLOTS: { header: string; session: Session; scan: ScanType; hour: number }[] = [
  { header: 'morningin', session: 'morning', scan: 'check_in', hour: 8 },
  { header: 'morningout', session: 'morning', scan: 'check_out', hour: 12 },
  { header: 'afternoonin', session: 'afternoon', scan: 'check_in', hour: 13 },
  { header: 'afternoonout', session: 'afternoon', scan: 'check_out', hour: 17 },
];

// How a scan is written in the file: "YYYY-MM-DD HH:mm:ss" in the device's local time. The date
// is the record's own date. Several scans in one cell (different days) go on separate lines.
export function scanStamp(r: AttendanceRecord) {
  const d = new Date(r.scannedAt);
  if (Number.isNaN(d.getTime())) return r.eventDate;
  return `${r.eventDate} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Reads the scans written in one attendance cell. Accepts the format above, a date alone
// (files made by older versions of the app: the scan gets a default time of the session), and
// any separator between the entries. `unreadable` is true when the cell holds other text too.
const STAMP = /(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/g;
export function parseScans(
  text: string,
  slot: { session: Session; scan: ScanType; hour: number },
): { records: ParsedRecord[]; unreadable: boolean } {
  const byDay = new Map<string, ParsedRecord>();
  let unreadable = false;
  for (const m of text.matchAll(STAMP)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const hasTime = m[4] !== undefined;
    const [h, mi, se] = hasTime
      ? [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)]
      : [slot.hour, 0, 0];
    const date = new Date(y, mo - 1, d, h, mi, se);
    const valid =
      date.getFullYear() === y &&
      date.getMonth() === mo - 1 &&
      date.getDate() === d &&
      h < 24 &&
      mi < 60 &&
      se < 60;
    if (!valid) {
      unreadable = true;
      continue;
    }
    const eventDate = `${y}-${pad(mo)}-${pad(d)}`;
    const found = byDay.get(eventDate);
    // One scan per student, day, session and type: when a day appears twice, the first stays.
    if (!found || date.toISOString() < found.scannedAt) {
      byDay.set(eventDate, {
        eventDate,
        session: slot.session,
        scan: slot.scan,
        scannedAt: date.toISOString(),
      });
    }
  }
  if (text.replace(STAMP, '').replace(/[\s,;]+/g, '')) unreadable = true;
  return { records: [...byDay.values()], unreadable };
}

// A cell can hold text or, when Excel turned it into a date, a Date (its UTC parts are the
// wall-clock values that were typed).
function cellText(cell: Cell) {
  const v = cell.value;
  if (v instanceof Date) {
    const date = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    const time = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
    return time === '00:00:00' ? date : `${date} ${time}`;
  }
  return cell.text;
}

// Excel sheet names: max 31 characters, no \ / ? * : [ ], and unique.
function sheetName(raw: string, used: Set<string>) {
  const base =
    raw
      .replace(/[\\/?*:[\]]/g, '-')
      .replace(/^'+|'+$/g, '')
      .trim()
      .slice(0, 31) || 'Class';
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

function addHeader(ws: Worksheet) {
  ws.columns = [
    { width: 8 },
    { width: 30 },
    { width: 24 },
    { width: 24 },
    { width: 24 },
    { width: 24 },
    { width: 40 },
  ];
  const header = ws.addRow([...HEADERS]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin' } };
  });
  for (const col of [3, 4, 5, 6]) {
    ws.getColumn(col).alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: 'G1' };
}

async function toBlob(wb: { xlsx: { writeBuffer: () => Promise<unknown> } }) {
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer as BlobPart], { type: XLSX_TYPE });
}

export interface ExportData {
  classes: ClassItem[];
  students: Student[];
  records: AttendanceRecord[];
}

// One sheet per class. Each check-in and check-out column holds every scan of the student for that
// slot as "YYYY-MM-DD HH:mm:ss" (one per line when there are several days), so importing the
// file again restores the attendance records exactly (see parseStudents).
export async function buildExport(data: ExportData) {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();

  const bySlot = new Map<string, AttendanceRecord[]>();
  for (const r of data.records) {
    const key = `${r.studentId}|${r.session}|${r.scan}`;
    const list = bySlot.get(key);
    if (list) list.push(r);
    else bySlot.set(key, [r]);
  }
  const scans = (id: string, session: string, scan: string) =>
    (bySlot.get(`${id}|${session}|${scan}`) ?? [])
      .sort(
        (a, b) => a.eventDate.localeCompare(b.eventDate) || a.scannedAt.localeCompare(b.scannedAt),
      )
      .map(scanStamp)
      .join('\n');

  const used = new Set<string>();
  const classes = [...data.classes].sort((a, b) =>
    a.className.localeCompare(b.className, undefined, { numeric: true, sensitivity: 'base' }),
  );
  for (const c of classes) {
    const ws = wb.addWorksheet(sheetName(c.className, used));
    addHeader(ws);
    data.students
      .filter((s) => s.classId === c.id)
      .sort(byName)
      .forEach((s, i) => {
        ws.addRow([
          i + 1,
          s.fullName,
          scans(s.id, 'morning', 'check_in'),
          scans(s.id, 'morning', 'check_out'),
          scans(s.id, 'afternoon', 'check_in'),
          scans(s.id, 'afternoon', 'check_out'),
          s.qrToken,
        ]);
      });
  }
  if (!classes.length) addHeader(wb.addWorksheet('Class 1'));
  return toBlob(wb);
}

// An empty workbook with the expected sheet layout.
export async function buildTemplate() {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  addHeader(wb.addWorksheet('Class 1'));
  addHeader(wb.addWorksheet('Class 2'));
  return toBlob(wb);
}

// Reads classes (one per sheet) and students (Full Name column) from a workbook.
// The attendance columns are read too (see parseScans), so a file made by the export restores each
// student's attendance. A QR Code value is kept when it contains a valid code.
export async function parseStudents(buffer: ArrayBuffer): Promise<ImportPlan> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  await wb.xlsx.load(buffer);

  const plan: ImportPlan = { classes: [], warnings: [] };
  wb.eachSheet((ws) => {
    const className = ws.name.replace(/\s+/g, ' ').trim();
    if (!className) return;

    let headerRow = 0;
    let nameCol = 0;
    let qrCol = 0;
    const slotCols: { col: number; slot: (typeof SLOTS)[number]; label: string }[] = [];
    for (let r = 1; r <= Math.min(ws.rowCount, 5) && !headerRow; r++) {
      const row = ws.getRow(r);
      for (let col = 1; col <= ws.columnCount; col++) {
        const key = normalize(row.getCell(col).text);
        if (key === 'fullname') nameCol = col;
        else if (key === 'qrcode') qrCol = col;
        else {
          const slot = SLOTS.find((x) => x.header === key);
          if (slot) slotCols.push({ col, slot, label: row.getCell(col).text.trim() });
        }
      }
      if (nameCol) headerRow = r;
    }
    if (!headerRow) {
      plan.warnings.push(`Sheet "${className}" was skipped because it has no "Full Name" column.`);
      return;
    }

    const seen = new Set<string>();
    const students: ImportPlan['classes'][number]['students'] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const fullName = row.getCell(nameCol).text.replace(/\s+/g, ' ').trim();
      if (!fullName) continue;
      const key = fullName.toLowerCase();
      if (seen.has(key)) {
        plan.warnings.push(
          `"${className}": the repeated name "${fullName}" (row ${r}) was ignored.`,
        );
        continue;
      }
      seen.add(key);
      const qrText = qrCol ? row.getCell(qrCol).text : '';
      const qrToken = UUID.exec(qrText)?.[0]?.toLowerCase();
      const records: ParsedRecord[] = [];
      for (const { col, slot, label } of slotCols) {
        const text = cellText(row.getCell(col)).trim();
        if (!text) continue;
        const scans = parseScans(text, slot);
        records.push(...scans.records);
        if (scans.unreadable) {
          plan.warnings.push(
            `"${className}": ${label} of "${fullName}" (row ${r}) has text that is not a date, so part of it was ignored.`,
          );
        }
      }
      students.push({
        fullName,
        ...(qrToken ? { qrToken } : {}),
        ...(records.length ? { records } : {}),
      });
    }
    plan.classes.push({ name: className, students });
  });
  return plan;
}

export function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Clock time of a scan, e.g. "8:02 AM", from the device's local time.
function clockTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${minutes} ${h < 12 ? 'AM' : 'PM'}`;
}

const DAILY_HEADERS = [
  'No.#',
  'Full Name',
  'Class',
  'Morning-in',
  'Morning-out',
  'Afternoon-in',
  'Afternoon-out',
  'Status',
] as const;

// One sheet named "{date} Attendance" with every student of every class and the time of each
// check-in and check-out on that date, so a cell never holds more than one value.
// Status: Present when all four check-ins and check-outs exist, Incomplete when some are
// missing, Absent when the student has no record on the date.
export async function buildDailyExport(data: ExportData, date: string) {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet(sheetName(`${date} Attendance`, new Set()));
  ws.columns = [
    { width: 8 },
    { width: 30 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
  ];
  const header = ws.addRow([...DAILY_HEADERS]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin' } };
  });
  for (const col of [4, 5, 6, 7, 8]) ws.getColumn(col).alignment = { horizontal: 'center' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: 'H1' };

  const timeBySlot = new Map<string, string>();
  for (const r of data.records) {
    if (r.eventDate !== date) continue;
    timeBySlot.set(`${r.studentId}|${r.session}|${r.scan}`, clockTime(r.scannedAt));
  }
  const time = (id: string, session: string, scan: string) =>
    timeBySlot.get(`${id}|${session}|${scan}`) ?? '';

  const status = (id: string) => {
    let count = 0;
    for (const session of ['morning', 'afternoon'])
      for (const scan of ['check_in', 'check_out'])
        if (timeBySlot.has(`${id}|${session}|${scan}`)) count++;
    return count === 4 ? 'Present' : count === 0 ? 'Absent' : 'Incomplete';
  };

  const classes = [...data.classes].sort((a, b) =>
    a.className.localeCompare(b.className, undefined, { numeric: true, sensitivity: 'base' }),
  );
  let n = 0;
  for (const c of classes) {
    for (const st of data.students.filter((x) => x.classId === c.id).sort(byName)) {
      ws.addRow([
        ++n,
        st.fullName,
        c.className,
        time(st.id, 'morning', 'check_in'),
        time(st.id, 'morning', 'check_out'),
        time(st.id, 'afternoon', 'check_in'),
        time(st.id, 'afternoon', 'check_out'),
        status(st.id),
      ]);
    }
  }
  return toBlob(wb);
}
