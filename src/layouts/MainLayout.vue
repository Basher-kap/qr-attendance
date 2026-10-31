<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-btn flat dense round icon="menu" aria-label="Menu" @click="drawer = !drawer" />
        <q-toolbar-title class="cursor-pointer" @click="router.push({ name: 'home' })">
          QR Attendance
        </q-toolbar-title>
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
        <q-item-label header>Spreadsheet</q-item-label>
        <q-item clickable v-ripple @click="openImport">
          <q-item-section avatar><q-icon name="upload_file" /></q-item-section>
          <q-item-section>Import</q-item-section>
        </q-item>
        <q-item clickable v-ripple @click="openExport">
          <q-item-section avatar><q-icon name="download" /></q-item-section>
          <q-item-section>Export</q-item-section>
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
        <q-item v-if="auth.signedIn && store.deviceUpload" clickable v-ripple @click="openUpload">
          <q-item-section avatar><q-icon name="cloud_upload" /></q-item-section>
          <q-item-section>Upload device data</q-item-section>
        </q-item>
        <q-separator class="q-my-sm" />
        <q-item-label caption class="q-px-md text-grey-7">
          {{ auth.signedIn ? `Signed in as ${auth.displayName}` : 'Guest' }}
        </q-item-label>
        <q-item-label caption class="q-px-md q-pb-sm text-grey-7">
          {{
            auth.signedIn
              ? 'Data is saved to your account. Only this account can see it.'
              : 'Data is saved on this device.'
          }}
        </q-item-label>
      </q-list>
    </q-drawer>

    <q-page-container>
      <q-linear-progress v-if="store.syncing" indeterminate color="secondary" />
      <q-banner v-if="auth.errorMessage" dense class="bg-red-1 text-negative">
        {{ auth.errorMessage }}
        <template #action>
          <q-btn flat no-caps label="Dismiss" @click="auth.clearError" />
        </template>
      </q-banner>
      <q-banner v-if="store.saveFailed" dense class="bg-orange-2 text-grey-9">
        Your data could not be saved on this device. Export a spreadsheet to keep your work.
      </q-banner>
      <q-banner v-if="store.offlineTrouble" dense class="bg-orange-2 text-grey-9">
        {{ offlineText }}
        <template #action>
          <q-btn flat no-caps label="Try again" :disable="store.syncing" @click="store.sync" />
        </template>
      </q-banner>
      <q-banner v-if="store.syncProblem" dense class="bg-orange-2 text-grey-9">
        {{ store.syncProblem }}
        <template #action>
          <q-btn flat no-caps label="Dismiss" @click="store.clearSyncProblem" />
        </template>
      </q-banner>
      <router-view v-if="auth.ready" />
      <div v-else class="flex flex-center q-pa-xl">
        <q-spinner color="primary" size="40px" />
      </div>
    </q-page-container>

    <ImportExportBar ref="importExport" />

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
    <q-dialog v-model="uploadOpen" :persistent="uploadStep === 'working'">
      <q-card style="min-width: 300px; max-width: 420px">
        <template v-if="uploadStep === 'ask' || uploadStep === 'working'">
          <q-card-section class="text-h6">Upload device data?</q-card-section>
          <q-card-section>
            <div v-if="store.deviceUpload">
              This device has {{ countText(store.deviceUpload) }} saved as a guest. Upload them to
              your account so they are saved in the cloud.
            </div>
            <div class="text-caption text-grey-7 q-mt-sm">
              Items already in your account are not duplicated. The copy on this device stays, and
              you will see it again when you log out.
            </div>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps label="Not now" :disable="uploadStep === 'working'" v-close-popup />
            <q-btn
              color="primary"
              no-caps
              label="Upload"
              :loading="uploadStep === 'working'"
              @click="doUpload"
            />
          </q-card-actions>
        </template>
        <template v-else-if="uploadStep === 'offline'">
          <q-card-section class="text-h6">No connection</q-card-section>
          <q-card-section>
            The upload needs an internet connection. Your data is still safe on this device. You can
            upload it later from the menu.
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps label="OK" v-close-popup />
          </q-card-actions>
        </template>
        <template v-else>
          <q-card-section class="text-h6">Upload finished</q-card-section>
          <q-card-section v-if="uploadSummary">
            Added {{ uploadSummary.classesAdded }}
            {{ uploadSummary.classesAdded === 1 ? 'class' : 'classes' }},
            {{ uploadSummary.studentsAdded }}
            {{ uploadSummary.studentsAdded === 1 ? 'student' : 'students' }} and
            {{ uploadSummary.recordsAdded }}
            {{ uploadSummary.recordsAdded === 1 ? 'record' : 'records' }}.
            <div v-if="uploadSummary.studentsSkipped" class="q-mt-sm">
              {{ uploadSummary.studentsSkipped }}
              {{ uploadSummary.studentsSkipped === 1 ? 'student was' : 'students were' }} already in
              your account (same name and class) and kept as they are.
            </div>
            <div v-if="uploadSummary.tokensReplaced" class="q-mt-sm text-orange-9">
              {{ uploadSummary.tokensReplaced }} QR
              {{ uploadSummary.tokensReplaced === 1 ? 'code was' : 'codes were' }} already used in
              your account, so those students got new codes.
            </div>
            <div v-if="uploadStillSyncing" class="q-mt-sm text-grey-7">
              Some changes are still on their way to the cloud.
            </div>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps label="OK" v-close-popup />
          </q-card-actions>
        </template>
      </q-card>
    </q-dialog>

    <q-dialog v-model="logoutConfirmOpen">
      <q-card style="min-width: 300px; max-width: 420px">
        <q-card-section class="text-h6">Log out?</q-card-section>
        <q-card-section>
          {{ store.pendingCount }}
          {{ store.pendingCount === 1 ? 'change has' : 'changes have' }} not reached your account
          yet. They stay on this device and are sent the next time you sign in here.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Stay signed in" v-close-popup />
          <q-btn color="negative" no-caps label="Log out" v-close-popup @click="auth.signOut" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAttendanceStore, type UploadSummary } from '../stores/attendance-store';
import { useAuthStore } from '../stores/auth-store';
import ImportExportBar from '../components/ImportExportBar.vue';

const router = useRouter();
const store = useAttendanceStore();
const auth = useAuthStore();
const drawer = ref(false);

// Import and export open from the menu. One workbook holds every class, one sheet per class.
const importExport = ref<InstanceType<typeof ImportExportBar> | null>(null);
function openImport() {
  drawer.value = false;
  importExport.value?.openImport();
}
function openExport() {
  drawer.value = false;
  importExport.value?.openExport();
}

const logoutConfirmOpen = ref(false);
function onAccountClick() {
  if (!auth.signedIn) void auth.signIn();
  else if (store.pendingCount > 0) logoutConfirmOpen.value = true;
  else void auth.signOut();
}

const offlineText = computed(() =>
  store.pendingCount > 0
    ? `${store.pendingCount} ${store.pendingCount === 1 ? 'change is' : 'changes are'} saved on this device and will reach your account when you are back online.`
    : 'Could not reach your account. Showing the copy saved on this device.',
);

// Upload of the device's guest data to the signed-in account.
const uploadOpen = ref(false);
const uploadStep = ref<'ask' | 'working' | 'offline' | 'done'>('ask');
const uploadSummary = ref<UploadSummary | null>(null);
const uploadStillSyncing = ref(false);

// The store opens the prompt right after a real sign-in. Closing it any way means "not now".
watch(
  () => store.uploadPromptOpen,
  (open) => {
    if (open) {
      uploadStep.value = 'ask';
      uploadOpen.value = true;
    }
  },
);
watch(uploadOpen, (open) => {
  if (!open) store.dismissUploadPrompt();
});

function openUpload() {
  drawer.value = false;
  store.openUploadPrompt();
}

function countText(n: { classes: number; students: number; records: number }) {
  const part = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return [
    part(n.classes, 'class', 'classes'),
    part(n.students, 'student', 'students'),
    part(n.records, 'attendance record', 'attendance records'),
  ].join(', ');
}

async function doUpload() {
  uploadStep.value = 'working';
  const result = await store.uploadDeviceData();
  if (result.ok) {
    uploadSummary.value = result.summary;
    uploadStillSyncing.value = result.stillSyncing;
    uploadStep.value = 'done';
  } else {
    uploadStep.value = 'offline';
  }
}

onMounted(() => {
  void auth.init();
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
