<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-btn flat dense round icon="menu" aria-label="Menu" @click="drawer = !drawer" />
        <q-toolbar-title class="cursor-pointer" @click="router.push({ name: 'home' })">
          QR Attendance
        </q-toolbar-title>
        <div
          v-if="store.mode === 'cloud' && store.ready"
          class="row items-center no-wrap q-mr-sm text-caption"
          role="status"
          :aria-label="syncLabel"
        >
          <q-icon :name="syncIcon" size="20px" :class="{ 'spin-slow': syncActive }" />
          <span v-if="store.pendingSync" class="q-ml-xs">{{ store.pendingSync }}</span>
          <q-tooltip>{{ syncLabel }}</q-tooltip>
        </div>
        <q-btn
          v-if="auth.enabled && auth.ready"
          flat
          dense
          no-caps
          class="q-px-sm"
          @click="onAccountClick"
        >
          <q-avatar v-if="auth.signedIn && auth.avatarUrl" size="28px">
            <img :src="auth.avatarUrl" alt="" referrerpolicy="no-referrer" />
          </q-avatar>
          <q-icon v-else name="account_circle" size="28px" />
          <span class="q-ml-sm">{{ auth.signedIn ? 'Log out' : 'Sign in' }}</span>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-drawer v-model="drawer" bordered>
      <q-list>
        <q-item clickable v-ripple :to="{ name: 'home' }" exact @click="drawer = false">
          <q-item-section avatar><q-icon name="home" /></q-item-section>
          <q-item-section>Home</q-item-section>
        </q-item>
        <q-separator class="q-my-sm" />
        <q-item-label header>Classes</q-item-label>
        <q-item
          v-for="c in store.classes"
          :key="c.id"
          clickable
          v-ripple
          :to="{ name: 'manage', params: { classId: c.id } }"
          @click="drawer = false"
        >
          <q-item-section>{{ c.className }}</q-item-section>
          <q-item-section side>
            <q-badge color="grey-7" :label="store.studentsOfClass(c.id).length" />
          </q-item-section>
        </q-item>
        <q-item clickable v-ripple @click="addClassOpen = true">
          <q-item-section avatar><q-icon name="add" /></q-item-section>
          <q-item-section>Add class</q-item-section>
        </q-item>
        <q-separator class="q-my-sm" />
        <q-item-label header>Spreadsheet</q-item-label>
        <q-item clickable v-ripple @click="openSheet('import')">
          <q-item-section avatar><q-icon name="upload_file" /></q-item-section>
          <q-item-section>
            <q-item-label>Import</q-item-label>
            <q-item-label caption>Classes and students from .xlsx</q-item-label>
          </q-item-section>
        </q-item>
        <q-item clickable v-ripple @click="openSheet('export')">
          <q-item-section avatar><q-icon name="download" /></q-item-section>
          <q-item-section>
            <q-item-label>Export</q-item-label>
            <q-item-label caption>All classes to .xlsx</q-item-label>
          </q-item-section>
        </q-item>
        <q-separator class="q-my-sm" />
        <q-item-label caption class="q-px-md text-grey-7">
          {{ auth.signedIn ? `Signed in as ${auth.displayName}` : 'Guest' }}
        </q-item-label>
        <q-item-label caption class="q-px-md q-pb-sm text-grey-7">
          {{
            store.mode === 'cloud'
              ? 'Data is saved in your Google account.'
              : 'Data is saved on this device only.'
          }}
        </q-item-label>
        <q-item-label v-if="store.mode === 'guest'" caption class="q-px-md q-pb-sm text-negative">
          Clearing the browser's data or switching devices erases it. Export a spreadsheet to keep
          a copy, or sign in to save it in your account.
        </q-item-label>
      </q-list>
    </q-drawer>

    <q-page-container>
      <q-banner v-if="auth.errorMessage" dense class="bg-red-1 text-negative">
        {{ auth.errorMessage }}
        <template #action>
          <q-btn flat no-caps label="Dismiss" @click="auth.clearError" />
        </template>
      </q-banner>
      <q-banner v-if="updateReady" dense class="bg-blue-1 text-primary">
        A new version of the app is ready.
        <template #action>
          <q-btn flat no-caps label="Update now" @click="applyUpdate" />
        </template>
      </q-banner>
      <q-banner
        v-if="store.mode === 'cloud' && store.pendingSync > 0"
        dense
        class="bg-orange-2 text-grey-9"
      >
        <template v-if="!online">
          You are offline. Your changes are saved on this device and will be sent to your account
          when you are back online. {{ store.pendingSync }}
          {{ store.pendingSync === 1 ? 'change is' : 'changes are' }} waiting.
        </template>
        <template v-else-if="store.syncing">
          Sending {{ store.pendingSync }}
          {{ store.pendingSync === 1 ? 'change' : 'changes' }} to your account.
        </template>
        <template v-else>
          {{ store.pendingSync }}
          {{ store.pendingSync === 1 ? 'change is' : 'changes are' }} waiting to be sent to your
          account. They are saved on this device and will be tried again
          {{ store.retryReason ? `(${store.retryReason})` : '' }}.
        </template>
      </q-banner>
      <q-banner v-if="store.syncError" dense class="bg-red-1 text-negative">
        The account did not accept a change: {{ store.syncError }}
        <template #action>
          <q-btn flat no-caps label="Reload data" @click="store.reloadCloud" />
          <q-btn flat no-caps label="Dismiss" @click="store.clearSyncError" />
        </template>
      </q-banner>
      <q-banner v-if="store.saveFailed" dense class="bg-orange-2 text-grey-9">
        Your data could not be saved on this device. Export a spreadsheet to keep your work.
      </q-banner>

      <router-view v-if="store.ready" />
      <q-page v-else class="column items-center justify-center q-pa-md text-center q-gutter-y-md">
        <template v-if="store.loadError">
          <q-icon name="cloud_off" size="56px" color="negative" />
          <div class="text-h6">Could not load your data</div>
          <div class="text-grey-7" style="max-width: 320px">{{ store.loadError }}</div>
          <q-btn color="primary" no-caps icon="refresh" label="Try again" @click="store.reloadCloud" />
          <q-btn flat no-caps label="Log out" @click="onAccountClick" />
        </template>
        <q-spinner v-else size="40px" color="primary" />
      </q-page>
    </q-page-container>

    <ImportExportBar ref="sheets" />

    <q-dialog v-model="logoutOpen">
      <q-card style="min-width: 300px; max-width: 420px">
        <q-card-section class="text-h6">Log out with unsaved changes?</q-card-section>
        <q-card-section>
          <template v-if="store.syncError">
            Some changes could not be saved to your account: {{ store.syncError }}
          </template>
          <template v-else>
            {{ store.pendingSync }}
            {{ store.pendingSync === 1 ? 'change has' : 'changes have' }} not reached your account
            yet.
          </template>
          They stay on this device and are sent the next time you sign in with this account. They
          are lost if you clear the browser's data before then.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Stay signed in" v-close-popup />
          <q-btn color="negative" no-caps label="Log out anyway" @click="logOut" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog :model-value="!!store.guestOffer" persistent>
      <q-card style="min-width: 300px; max-width: 420px">
        <q-card-section class="text-h6">Upload this device's data?</q-card-section>
        <q-card-section v-if="store.guestOffer">
          Your account has no data yet, and this device has
          {{ store.guestOffer.classes.length }}
          {{ store.guestOffer.classes.length === 1 ? 'class' : 'classes' }},
          {{ store.guestOffer.students.length }}
          {{ store.guestOffer.students.length === 1 ? 'student' : 'students' }} and
          {{ store.guestOffer.records.length }}
          {{ store.guestOffer.records.length === 1 ? 'record' : 'records' }}. Upload them to your
          Google account to open them wherever you sign in. A copy stays on this device and shows
          again when you log out.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Not now" :disable="store.uploading" @click="store.dismissOffer" />
          <q-btn
            color="primary"
            no-caps
            label="Upload"
            :loading="store.uploading"
            @click="store.uploadGuestData"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="addClassOpen">
      <q-card style="min-width: 300px">
        <q-card-section class="text-h6">Add class</q-card-section>
        <q-card-section>
          <q-input
            v-model="newClassName"
            label="Class name"
            autofocus
            :error="classTaken"
            error-message="A class with this name already exists."
            @keyup.enter="saveClass"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Add"
            :disable="!newClassName.trim() || classTaken"
            @click="saveClass"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import ImportExportBar from '../components/ImportExportBar.vue';
import { useAttendanceStore } from '../stores/attendance-store';
import { useAuthStore } from '../stores/auth-store';
import { applyUpdate, updateReady } from '../lib/app-update';

const router = useRouter();
const store = useAttendanceStore();
const auth = useAuthStore();
const drawer = ref(false);
const sheets = ref<InstanceType<typeof ImportExportBar> | null>(null);

function openSheet(kind: 'import' | 'export') {
  drawer.value = false;
  if (kind === 'import') sheets.value?.openImport();
  else sheets.value?.openExport();
}

const logoutOpen = ref(false);

async function logOut() {
  logoutOpen.value = false;
  await store.flush(); // let pending changes reach the account before logging out
  await auth.signOut();
}

async function onAccountClick() {
  if (!auth.signedIn) {
    await auth.signIn();
  } else if (store.pendingSync > 0 || store.syncError) {
    logoutOpen.value = true; // changes would be lost: ask first
  } else {
    await logOut();
  }
}

const syncActive = computed(() => online.value && store.syncing);
const syncIcon = computed(() =>
  !online.value ? 'cloud_off' : store.syncing || store.pendingSync ? 'sync' : 'cloud_done',
);
const syncLabel = computed(() => {
  if (!online.value) return 'Offline. Changes are saved on this device.';
  if (store.syncing) return 'Sending changes to your account';
  if (store.pendingSync) return 'Changes are waiting to be sent';
  return 'All changes are saved in your account';
});

// Changes waiting to be sent are kept on the device, so closing the tab is safe. Only when
// the device itself refused to store them (see saveFailed) is the visitor warned.
const online = ref(true);
const setOnline = () => {
  online.value = navigator.onLine;
};
function warnBeforeLeaving(e: BeforeUnloadEvent) {
  if (store.mode === 'cloud' && store.saveFailed && store.pendingSync > 0) e.preventDefault();
}

onMounted(() => {
  void auth.init();
  setOnline();
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
  window.addEventListener('beforeunload', warnBeforeLeaving);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', setOnline);
  window.removeEventListener('offline', setOnline);
  window.removeEventListener('beforeunload', warnBeforeLeaving);
});

const addClassOpen = ref(false);
const newClassName = ref('');
const classTaken = computed(() => store.classNameTaken(newClassName.value));

function saveClass() {
  const name = newClassName.value.trim();
  if (!name || classTaken.value) return;
  const id = store.addClass(name);
  newClassName.value = '';
  addClassOpen.value = false;
  drawer.value = false;
  void router.push({ name: 'manage', params: { classId: id } });
}
</script>

<style scoped>
.spin-slow {
  animation: spin-slow 1.2s linear infinite;
}
@keyframes spin-slow {
  to {
    transform: rotate(360deg);
  }
}
</style>
