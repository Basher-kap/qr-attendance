import type { Op } from './cloud-data';
import type { SavedData } from '../stores/attendance-store';

// What a signed-in account keeps on this device so the app works without a connection:
//  - the outbox: changes made but not yet sent to the account (kept until they are sent)
//  - the cache: a copy of the account's data, shown at once and when offline
// Both are stored per account. Every function returns quietly when the browser refuses to
// store (private mode, full storage); the write functions return false so the app can warn.

const PREFIX = 'qr-attendance:cloud:';
const outboxKey = (uid: string) => `${PREFIX}${uid}:outbox`;
const cacheKey = (uid: string) => `${PREFIX}${uid}:cache`;
const PROFILE_KEY = `${PREFIX}profile`;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadOutbox(uid: string): Op[] {
  const ops = read<Op[]>(outboxKey(uid));
  return Array.isArray(ops) ? ops : [];
}

export function saveOutbox(uid: string, ops: Op[]) {
  if (!ops.length) {
    try {
      localStorage.removeItem(outboxKey(uid));
    } catch {
      /* nothing to clean up */
    }
    return true;
  }
  return write(outboxKey(uid), ops);
}

export function loadCache(uid: string): SavedData | null {
  const data = read<Partial<SavedData>>(cacheKey(uid));
  if (!data || !Array.isArray(data.classes) || !Array.isArray(data.students)) return null;
  return {
    classes: data.classes,
    students: data.students,
    records: Array.isArray(data.records) ? data.records : [],
  };
}

export function saveCache(uid: string, data: SavedData) {
  return write(cacheKey(uid), data);
}

// The copy of the account's data is removed on log out, so the next person using this
// device cannot read it. Waiting changes (the outbox) stay and are sent at the next sign-in.
export function clearCache(uid: string) {
  try {
    localStorage.removeItem(cacheKey(uid));
  } catch {
    /* nothing to clean up */
  }
}

// Who was signed in last. Lets the app open offline when the sign-in cannot be renewed
// without a connection.
export interface CachedProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
}
export const loadProfile = () => read<CachedProfile>(PROFILE_KEY);
export const saveProfile = (profile: CachedProfile) => write(PROFILE_KEY, profile);
export function clearProfile() {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* nothing to clean up */
  }
}
