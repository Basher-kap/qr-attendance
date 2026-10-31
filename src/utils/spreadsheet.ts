import type { Worksheet } from 'exceljs';
import type { AttendanceRecord, ClassItem, ImportPlan, Student } from '../stores/attendance-store';

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
  ws.columns = [{ width: 8 }, { width: 30 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 40 }];
  const header = ws.addRow([...HEADERS]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin' } };
  });
  for (const col of [3, 4, 5, 6]) ws.getColumn(col).alignment = { horizontal: 'center' };
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

// One sheet per class. Each check-in and check-out column shows the day(s) (YYYY-MM-DD) on which
// the student was confirmed after scanning. Several days are separated by commas.
export async function buildExport(data: ExportData) {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();

  const daysBySlot = new Map<string, Set<string>>();
  for (const r of data.records) {
    const key = `${r.studentId}|${r.session}|${r.scan}`;
    let days = daysBySlot.get(key);
    if (!days) {
      days = new Set();
      daysBySlot.set(key, days);
    }
    days.add(r.eventDate);
  }
  const confirmedDays = (id: string, session: string, scan: string) =>
    [...(daysBySlot.get(`${id}|${session}|${scan}`) ?? [])].sort().join(', ');

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
          confirmedDays(s.id, 'morning', 'check_in'),
          confirmedDays(s.id, 'morning', 'check_out'),
          confirmedDays(s.id, 'afternoon', 'check_in'),
          confirmedDays(s.id, 'afternoon', 'check_out'),
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
// The attendance columns are ignored. A QR Code value is kept when it contains a valid code.
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
    for (let r = 1; r <= Math.min(ws.rowCount, 5) && !headerRow; r++) {
      const row = ws.getRow(r);
      for (let col = 1; col <= ws.columnCount; col++) {
        const key = normalize(row.getCell(col).text);
        if (key === 'fullname') nameCol = col;
        else if (key === 'qrcode') qrCol = col;
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
        plan.warnings.push(`"${className}": the repeated name "${fullName}" (row ${r}) was ignored.`);
        continue;
      }
      seen.add(key);
      const qrText = qrCol ? row.getCell(qrCol).text : '';
      const qrToken = UUID.exec(qrText)?.[0]?.toLowerCase();
      students.push(qrToken ? { fullName, qrToken } : { fullName });
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
