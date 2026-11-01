import { ref } from 'vue';

// Set by the service worker registration (boot/register-sw.ts) when a new version of the app
// has been downloaded and is waiting. The new version is only used after a reload, so the
// page the user is working on is never swapped under them.
export const updateReady = ref(false);
let apply: (() => void) | null = null;

export function setUpdateHandler(fn: () => void) {
  apply = fn;
  updateReady.value = true;
}
export function applyUpdate() {
  apply?.();
}
