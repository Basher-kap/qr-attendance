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
        <q-item
          v-if="store.mode === 'cloud' && store.offerDeferred"
          clickable
          v-ripple
          @click="
            drawer = false;
            store.reopenOffer();
          "
        >
          <q-item-section avatar><q-icon name="cloud_upload" /></q-item-section>
          <q-item-section>
            <q-item-label>Sync device data</q-item-label>
            <q-item-label caption>Send what this device recorded as a guest</q-item-label>
          </q-item-section>
        </q-item>
        <q-item-label
          v-if="store.mode === 'cloud' && store.lastVerifiedAt"
          caption
          class="q-px-md q-pb-sm text-grey-7"
        >
          Last checked: {{ new Date(store.lastVerifiedAt).toLocaleString() }}
        </q-item-label>
        <q-item-label v-if="store.mode === 'guest'" caption class="q-px-md q-pb-sm text-negative">
          Clearing the browser's data or switching devices erases it. Export a spreadsheet to keep a
          copy, or sign in to save it in your account.
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
      <q-banner v-if="store.mode === 'cloud' && !online" dense class="bg-orange-2 text-grey-9">
        You are offline. Changes cannot be saved to your account until you reconnect, so do not rely
        on anything you record now. Keep this page open and check again when you are back online.
      </q-banner>
      <q-banner v-if="store.syncError" dense class="bg-red-1 text-negative">
        Could not save to your account: {{ store.syncError }}
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
          <q-btn
            color="primary"
            no-caps
            icon="refresh"
            label="Try again"
            @click="store.reloadCloud"
          />
          <q-btn flat no-caps label="Log out" @click="onAccountClick" />
        </template>
        <q-spinner v-else size="40px" color="primary" />
      </q-page>
    </q-page-container>

    <ImportExportBar ref="sheets" />

    <q-dialog v-model="signInOpen">
      <q-card style="min-width: 300px; max-width: 420px; width: 100%">
        <q-card-section class="text-h6">
          {{ authMode === 'signup' ? 'Create account' : 'Sign in' }}
        </q-card-section>
        <q-card-section class="column q-gutter-y-md">
          <q-btn
            outline
            no-caps
            color="primary"
            icon="login"
            label="Continue with Google"
            @click="googleSignIn"
          />
          <div class="row items-center no-wrap text-grey-7">
            <q-separator class="col" />
            <span class="q-px-sm">or use an email and password</span>
            <q-separator class="col" />
          </div>
          <q-input
            v-model="authEmail"
            outlined
            dense
            type="email"
            autocomplete="email"
            label="Gmail or other email address"
            :error="emailTouched && !emailValid"
            error-message="Enter a valid email address."
            @blur="emailTouched = true"
          />
          <q-input
            v-if="authMode !== 'forgot'"
            v-model="authPassword"
            outlined
            dense
            :type="showPassword ? 'text' : 'password'"
            :autocomplete="authMode === 'signup' ? 'new-password' : 'current-password'"
            label="Password"
            :hint="authMode === 'signup' ? 'At least 8 characters' : ''"
            @keyup.enter="submitAuth"
          >
            <template #append>
              <q-icon
                :name="showPassword ? 'visibility_off' : 'visibility'"
                class="cursor-pointer"
                @click="showPassword = !showPassword"
              />
            </template>
          </q-input>
          <q-banner dense class="bg-orange-1 text-grey-9">
            Use a password made for this app. Never type your Google password here. The app cannot
            check it, and Google sign-in is the button above.
          </q-banner>
          <q-banner
            v-if="authNotice"
            dense
            :class="authNoticeOk ? 'bg-green-1 text-grey-9' : 'bg-red-1 text-negative'"
          >
            {{ authNotice }}
          </q-banner>
          <div class="row justify-between text-caption">
            <a
              v-if="authMode !== 'signin'"
              class="text-primary cursor-pointer"
              @click="switchAuthMode('signin')"
              >Have an account? Sign in</a
            >
            <a v-else class="text-primary cursor-pointer" @click="switchAuthMode('signup')"
              >Create account</a
            >
            <a
              v-if="authMode !== 'forgot'"
              class="text-primary cursor-pointer"
              @click="switchAuthMode('forgot')"
              >Forgot password</a
            >
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            no-caps
            :loading="authBusy"
            :disable="!canSubmitAuth"
            :label="
              authMode === 'signup'
                ? 'Create account'
                : authMode === 'forgot'
                  ? 'Send reset link'
                  : 'Sign in'
            "
            @click="submitAuth"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog :model-value="auth.recovering" persistent>
      <q-card style="min-width: 300px; max-width: 420px; width: 100%">
        <q-card-section class="text-h6">Choose a new password</q-card-section>
        <q-card-section class="column q-gutter-y-sm">
          <q-input
            v-model="newPassword"
            outlined
            dense
            type="password"
            autocomplete="new-password"
            label="New password"
            hint="At least 8 characters"
            @keyup.enter="saveNewPassword"
          />
          <q-banner v-if="authNotice" dense class="bg-red-1 text-negative">
            {{ authNotice }}
          </q-banner>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            color="primary"
            no-caps
            label="Save password"
            :loading="authBusy"
            :disable="newPassword.length < 8"
            @click="saveNewPassword"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

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
          If you log out now, they may be lost.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Stay signed in" v-close-popup />
          <q-btn color="negative" no-caps label="Log out anyway" @click="logOut" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog :model-value="!!store.guestOffer" persistent>
      <q-card style="min-width: 300px; max-width: 420px">
        <q-card-section class="text-h6"
          >Sync this device's data to your Google account?</q-card-section
        >
        <q-card-section v-if="store.guestOffer && store.mergeStats" class="column q-gutter-y-sm">
          <div>
            Before you signed in, this device recorded {{ store.guestOffer.classes.length }}
            {{ store.guestOffer.classes.length === 1 ? 'class' : 'classes' }},
            {{ store.guestOffer.students.length }}
            {{ store.guestOffer.students.length === 1 ? 'student' : 'students' }} and
            {{ store.guestOffer.records.length }} attendance
            {{ store.guestOffer.records.length === 1 ? 'record' : 'records' }}.
          </div>
          <div>
            Syncing adds {{ store.mergeStats.classesAdded }}
            {{ store.mergeStats.classesAdded === 1 ? 'class' : 'classes' }},
            {{ store.mergeStats.studentsAdded }}
            {{ store.mergeStats.studentsAdded === 1 ? 'student' : 'students' }} and
            {{ store.mergeStats.recordsAdded }} attendance
            {{ store.mergeStats.recordsAdded === 1 ? 'record' : 'records' }} to your account.
            Afterwards the app checks that every one arrived.
          </div>
          <div
            v-if="store.mergeStats.studentsMatched || store.mergeStats.recordsSkipped"
            class="text-grey-7"
          >
            Classes and students with the same name are treated as the same, and records that are
            already in your account are skipped. Nothing in your account is changed or deleted.
          </div>
          <q-banner v-if="store.mergeStats.tokensReplaced" dense class="bg-orange-1 text-grey-9">
            {{ store.mergeStats.tokensReplaced }}
            {{ store.mergeStats.tokensReplaced === 1 ? 'student gets' : 'students get' }} a new QR
            code because the old one is already used by another student in your account. Print
            {{ store.mergeStats.tokensReplaced === 1 ? 'it' : 'them' }} again.
          </q-banner>
          <div class="text-grey-7">
            A copy stays on this device and shows again when you log out.
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Not now" @click="store.dismissOffer" />
          <q-btn color="primary" no-caps label="Sync now" @click="store.uploadGuestData" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="store.syncReportOpen">
      <q-card v-if="store.syncReport" style="min-width: 300px; max-width: 420px">
        <q-card-section class="text-h6">Syncing to your Google account</q-card-section>
        <q-card-section class="column q-gutter-y-sm">
          <div class="row items-center no-wrap q-gutter-x-sm">
            <q-spinner
              v-if="store.syncReport.phase === 'sending' || store.syncReport.phase === 'verifying'"
              color="primary"
              size="24px"
            />
            <q-icon
              v-else-if="store.syncReport.phase === 'done'"
              name="check_circle"
              color="positive"
              size="24px"
            />
            <q-icon v-else name="error" color="negative" size="24px" />
            <div>
              <template v-if="store.syncReport.phase === 'sending'">
                Sending to your account…
              </template>
              <template v-else-if="store.syncReport.phase === 'verifying'">
                Checking that everything arrived…
              </template>
              <template v-else-if="store.syncReport.phase === 'done'">
                Done. Everything from this device is in your account.
              </template>
              <template v-else>Some data could not be confirmed in your account.</template>
            </div>
          </div>
          <div class="text-grey-7">
            {{ store.syncReport.added.classes }}
            {{ store.syncReport.added.classes === 1 ? 'class' : 'classes' }},
            {{ store.syncReport.added.students }}
            {{ store.syncReport.added.students === 1 ? 'student' : 'students' }} and
            {{ store.syncReport.added.records }} attendance
            {{ store.syncReport.added.records === 1 ? 'record' : 'records' }} sent.
          </div>
          <div v-if="store.syncReport.phase === 'done'" class="text-grey-7">
            Your account now holds {{ store.syncReport.verifiedRecords }} attendance
            {{ store.syncReport.verifiedRecords === 1 ? 'record' : 'records' }} in total.
          </div>
          <q-banner v-if="store.syncReport.phase === 'issues'" dense class="bg-red-1 text-negative">
            Not confirmed: {{ store.syncReport.missing.classes }} classes,
            {{ store.syncReport.missing.students }} students,
            {{ store.syncReport.missing.records }} attendance records.
            {{ store.syncReport.error }} They are still on this device, and you will be asked to
            sync again at your next sign-in.
          </q-banner>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            v-if="store.syncReport.phase === 'issues'"
            flat
            no-caps
            label="Try again"
            @click="store.retryVerify"
          />
          <q-btn color="primary" no-caps label="Close" v-close-popup />
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import ImportExportBar from '../components/ImportExportBar.vue';
import { useAttendanceStore } from '../stores/attendance-store';
import { useAuthStore } from '../stores/auth-store';

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

// ---- Sign-in dialog: Google, or an email and a password made for this app ----
const signInOpen = ref(false);
const authMode = ref<'signin' | 'signup' | 'forgot'>('signin');
const authEmail = ref('');
const authPassword = ref('');
const showPassword = ref(false);
const emailTouched = ref(false);
const authBusy = ref(false);
const authNotice = ref('');
const authNoticeOk = ref(false);
const newPassword = ref('');

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail.value.trim()));
const canSubmitAuth = computed(
  () =>
    emailValid.value &&
    (authMode.value === 'forgot' ||
      (authMode.value === 'signup'
        ? authPassword.value.length >= 8
        : authPassword.value.length > 0)),
);

function switchAuthMode(mode: 'signin' | 'signup' | 'forgot') {
  authMode.value = mode;
  authNotice.value = '';
}

async function googleSignIn() {
  signInOpen.value = false;
  await auth.signIn();
}

async function submitAuth() {
  if (!canSubmitAuth.value || authBusy.value) return;
  authBusy.value = true;
  authNotice.value = '';
  try {
    const email = authEmail.value;
    const result =
      authMode.value === 'signup'
        ? await auth.signUpWithPassword(email, authPassword.value)
        : authMode.value === 'forgot'
          ? await auth.sendPasswordReset(email)
          : await auth.signInWithPassword(email, authPassword.value);
    authNotice.value = result.message;
    authNoticeOk.value = result.ok;
    if (result.ok && authMode.value === 'signup' && result.message) authMode.value = 'signin';
    authPassword.value = '';
    // A successful sign-in closes the dialog through the watch below.
  } finally {
    authBusy.value = false;
  }
}

async function saveNewPassword() {
  authBusy.value = true;
  authNotice.value = '';
  try {
    const result = await auth.setNewPassword(newPassword.value);
    if (result.ok) newPassword.value = '';
    else authNotice.value = result.message;
  } finally {
    authBusy.value = false;
  }
}

watch(
  () => auth.signedIn,
  (signedIn) => {
    if (signedIn) {
      signInOpen.value = false;
      authPassword.value = '';
      authNotice.value = '';
    }
  },
);

async function onAccountClick() {
  if (!auth.signedIn) {
    authMode.value = 'signin';
    authNotice.value = '';
    emailTouched.value = false;
    signInOpen.value = true;
  } else if (store.pendingSync > 0 || store.syncError) {
    logoutOpen.value = true; // changes would be lost: ask first
  } else {
    await logOut();
  }
}

// Warn when the connection is lost, and when the tab is closed with changes still being sent.
const online = ref(true);
const setOnline = () => {
  online.value = navigator.onLine;
};
function warnBeforeLeaving(e: BeforeUnloadEvent) {
  if (store.mode === 'cloud' && (store.pendingSync > 0 || store.syncError)) e.preventDefault();
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
