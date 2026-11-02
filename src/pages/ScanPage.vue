<template>
  <q-page padding class="column items-center q-gutter-y-md">
    <div class="scan-frame">
      <video ref="videoEl" class="scan-video" playsinline muted></video>
      <div v-if="status !== 'scanning'" class="scan-overlay column items-center justify-center">
        <q-spinner v-if="status === 'starting'" size="40px" color="grey-6" />
        <q-icon v-else name="videocam_off" size="64px" color="grey-6" />
      </div>
    </div>

    <div class="text-caption text-grey-7 text-center" style="max-width: 340px">{{ hint }}</div>

    <q-btn
      v-if="canRetry"
      outline
      color="primary"
      no-caps
      icon="refresh"
      label="Try again"
      @click="startCamera"
    />

    <!-- Check attendance without the camera: search a student, then confirm as after a scan. -->
    <q-expansion-item
      v-model="manualOpen"
      dense
      icon="search"
      label="Check attendance without camera"
      header-class="text-grey-8"
      class="full-width"
      style="max-width: 340px"
    >
      <div class="column q-gutter-y-sm q-pa-sm">
        <q-input
          v-model="query"
          outlined
          dense
          clearable
          autocomplete="off"
          enterkeyhint="search"
          placeholder="Type a student's name"
          @keyup.enter="pickOnlyMatch"
        >
          <template #prepend><q-icon name="search" /></template>
        </q-input>

        <div v-if="!queryText" class="text-caption text-grey-7">
          Type part of a name (or class) to find the student.
        </div>
        <div v-else-if="!matches.length" class="text-caption text-grey-7">
          No student matches "{{ query?.trim() }}".
        </div>
        <template v-else>
          <q-list bordered separator class="rounded-borders">
            <q-item
              v-for="m in shown"
              :key="m.student.id"
              clickable
              v-ripple
              @click="handleScan(m.student.qrToken)"
            >
              <q-item-section>
                <q-item-label>{{ m.student.fullName }}</q-item-label>
                <q-item-label caption>{{ m.className }}</q-item-label>
              </q-item-section>
              <q-item-section side><q-icon name="chevron_right" /></q-item-section>
            </q-item>
          </q-list>
          <div v-if="matches.length > shown.length" class="text-caption text-grey-7">
            Showing {{ shown.length }} of {{ matches.length }} matches. Type more of the name to
            narrow it down.
          </div>
        </template>
      </div>
    </q-expansion-item>

    <q-dialog v-model="errorOpen" persistent>
      <q-card style="min-width: 280px">
        <q-card-section class="text-h6">Invalid QR code</q-card-section>
        <q-card-section>This QR code does not belong to a registered student.</q-card-section>
        <q-card-actions align="right">
          <q-btn color="primary" label="OK" @click="backHome" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import QrScanner from 'qr-scanner';
import { useAttendanceStore } from '../stores/attendance-store';

type Status = 'starting' | 'scanning' | 'denied' | 'nocamera' | 'insecure' | 'error';

const router = useRouter();
const store = useAttendanceStore();

const videoEl = ref<HTMLVideoElement | null>(null);
const status = ref<Status>('starting');
const errorOpen = ref(false);

let scanner: QrScanner | null = null;
let handled = false; // stops repeated reads of the same code

const hint = computed(
  () =>
    ({
      starting: 'Starting the camera...',
      scanning: "Point the camera at a student's QR code.",
      denied: 'Camera access is blocked. Allow it in your browser settings, then try again.',
      nocamera: 'No camera was found on this device.',
      insecure: 'The camera only works on HTTPS or localhost.',
      error: 'The camera could not be started.',
    })[status.value],
);
const canRetry = computed(() => ['denied', 'nocamera', 'error'].includes(status.value));

// ---- Check attendance without the camera ----
const MAX_SHOWN = 5; // only the matches are listed, never the whole class
const manualOpen = ref(false);
const query = ref<string | null>('');

// Without a working camera the search is the way to take attendance, so it opens by itself.
watch(status, (value) => {
  if (['denied', 'nocamera', 'insecure', 'error'].includes(value)) manualOpen.value = true;
});

// Lowercase, no accents, single spaces: "José  Peña" matches "jose pena".
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const queryText = computed(() => fold(query.value ?? ''));

// Every typed word must appear in the student's name or class, in any order ("cruz ana").
const matches = computed(() => {
  const words = queryText.value.split(' ').filter(Boolean);
  if (!words.length) return [];
  const classNames = new Map(store.classes.map((c) => [c.id, c.className]));
  return store.students
    .map((student) => ({ student, className: classNames.get(student.classId) ?? '' }))
    .filter(({ student, className }) => {
      const haystack = fold(`${student.fullName} ${className}`);
      return words.every((w) => haystack.includes(w));
    })
    .sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));
});
const shown = computed(() => matches.value.slice(0, MAX_SHOWN));

// Enter picks the student when only one matches.
function pickOnlyMatch() {
  const only = matches.value.length === 1 ? matches.value[0] : null;
  if (only) handleScan(only.student.qrToken);
}

function classify(e: unknown): Status {
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/NotAllowed|Permission|denied/i.test(text)) return 'denied';
  if (/NotFound|not found|no camera/i.test(text)) return 'nocamera';
  return 'error';
}

async function startCamera() {
  handled = false;
  if (!window.isSecureContext) {
    status.value = 'insecure';
    return;
  }
  const video = videoEl.value;
  if (!video) return;
  status.value = 'starting';
  try {
    if (!(await QrScanner.hasCamera())) {
      status.value = 'nocamera';
      return;
    }
    scanner ??= new QrScanner(video, (result) => onDecode(result.data), {
      returnDetailedScanResult: true,
      preferredCamera: 'environment',
      highlightScanRegion: true,
      highlightCodeOutline: true,
      maxScansPerSecond: 10,
    });
    await scanner.start();
    status.value = 'scanning';
  } catch (e) {
    status.value = classify(e);
  }
}

function onDecode(text: string) {
  const token = text.trim();
  if (token) handleScan(token);
}

// The camera and the name search both end up here with the student's QR text.
function handleScan(token: string) {
  if (handled) return;
  handled = true;
  scanner?.stop();
  if (store.studentByToken(token)) {
    store.pendingToken = token;
    void router.push({ name: 'confirm' });
  } else {
    errorOpen.value = true;
  }
}

function backHome() {
  errorOpen.value = false;
  void router.push({ name: 'home' });
}

onMounted(() => {
  void startCamera();
});

onBeforeUnmount(() => {
  scanner?.destroy();
  scanner = null;
});
</script>

<style scoped>
.scan-frame {
  position: relative;
  width: 100%;
  max-width: 340px;
  aspect-ratio: 1;
  /* A dark camera area with the logo's gradient as its border. */
  border: 4px solid transparent;
  background:
    linear-gradient(#0e1420, #0e1420) padding-box,
    linear-gradient(135deg, #3f80ea, #5fa95a) border-box;
  border-radius: 28px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(47, 111, 222, 0.22);
}
.scan-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.scan-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(160deg, #eaf1fc, #eaf5ec);
}
</style>
