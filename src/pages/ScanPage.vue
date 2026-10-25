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

    <!-- Test helper: remove before deploying. -->
    <q-expansion-item
      dense
      icon="science"
      label="Test without camera"
      header-class="text-grey-7"
      class="full-width"
      style="max-width: 340px"
    >
      <div class="column q-gutter-y-sm q-pa-sm">
        <q-btn
          v-for="s in store.students"
          :key="s.id"
          outline
          color="primary"
          no-caps
          :label="`Scan ${s.fullName}`"
          @click="handleScan(s.qrToken)"
        />
        <q-btn
          flat
          color="negative"
          no-caps
          label="Scan an invalid QR code"
          @click="handleScan('not-a-student')"
        />
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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

// The camera and the test buttons both end up here with the decoded text.
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
  background: #000;
  border-radius: 12px;
  overflow: hidden;
}
.scan-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.scan-overlay {
  position: absolute;
  inset: 0;
  background: #eee;
}
</style>