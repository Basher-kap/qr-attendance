// Limits and clean-up for text that comes from people or files. The same limits are enforced by
// the database (supabase/migrations/004_security_hardening.sql), so they hold even if the app is
// bypassed.

export const MAX_NAME_LENGTH = 100;

// Passwords. The app refuses a short password before sending it, and Supabase Auth must be set to
// the same minimum (Authentication > Sign In / Providers > Email > Minimum password length), because
// only that setting holds when the app is bypassed. Passwords are never trimmed or changed.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt, used by Supabase Auth, ignores anything longer

export function passwordProblem(password: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `The password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return '';
}

// Spreadsheet import. An .xlsx file is a zip, so it is checked before it is opened.
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_SHEETS = 50;
export const MAX_IMPORT_ROWS_PER_SHEET = 2000;
export const MAX_SCANS_PER_CELL = 400;

export class ImportLimitError extends Error {}

// Control characters, zero-width marks and text-direction overrides can hide or reorder text
// (a name that looks like another name), so they are removed. Spaces are collapsed and the
// length is cut to the limit.
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function cleanName(text: string): string {
  return text.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}
