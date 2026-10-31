<template>
  <q-page padding>
    <div v-if="student" class="column q-gutter-y-md" style="max-width: 480px; margin: 0 auto">
      <div>
        <q-btn
          flat
          dense
          no-caps
          icon="arrow_back"
          :label="className"
          @click="router.push({ name: 'manage', params: { classId: student.classId } })"
        />
        <div class="row items-center no-wrap q-mt-sm">
          <div class="text-h6 col">{{ student.fullName }}</div>
          <q-btn flat round icon="more_vert" aria-label="Student options">
            <q-menu>
              <q-list style="min-width: 200px">
                <q-item clickable v-close-popup @click="showQr">
                  <q-item-section avatar><q-icon name="qr_code_2" /></q-item-section>
                  <q-item-section>Show QR code</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="openEdit">
                  <q-item-section avatar><q-icon name="edit" /></q-item-section>
                  <q-item-section>Edit student</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="regenOpen = true">
                  <q-item-section avatar><q-icon name="autorenew" /></q-item-section>
                  <q-item-section>Regenerate QR code</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="deleteOpen = true">
                  <q-item-section avatar><q-icon name="delete" color="negative" /></q-item-section>
                  <q-item-section class="text-negative">Delete student</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
      </div>

      <div class="row items-center no-wrap">
        <q-btn flat round icon="chevron_left" aria-label="Previous day" @click="shift(-1)" />
        <div class="col text-center">
          <div class="text-subtitle1">{{ dateLabel }}</div>
          <div v-if="isToday" class="text-caption text-grey-7">Today</div>
        </div>
        <q-btn flat round icon="event" aria-label="Pick a date">
          <q-popup-proxy cover transition-show="scale" transition-hide="scale">
            <q-date
              v-model="selected"
              :events="eventDates"
              event-color="primary"
              :options="notFuture"
            >
              <div class="row items-center justify-end">
                <q-btn v-close-popup label="Close" color="primary" flat />
              </div>
            </q-date>
          </q-popup-proxy>
        </q-btn>
        <q-btn
          flat
          round
          icon="chevron_right"
          aria-label="Next day"
          :disable="isToday"
          @click="shift(1)"
        />
      </div>

      <q-banner v-if="!hasAny" class="bg-grey-2 text-grey-8">
        No attendance recorded on this day.
      </q-banner>

      <q-card v-for="s in sessions" :key="s.title" flat bordered>
        <q-card-section class="text-subtitle1">{{ s.title }}</q-card-section>
        <q-separator />
        <q-list>
          <q-item v-for="row in s.rows" :key="row.key">
            <q-item-section avatar>
              <q-icon
                :name="row.done ? 'check_circle' : 'radio_button_unchecked'"
                :color="row.done ? 'positive' : 'grey-5'"
              />
            </q-item-section>
            <q-item-section :class="row.done ? '' : 'text-grey-7'">{{ row.text }}</q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <div>
        <div class="text-subtitle1 q-mb-sm">All recorded days</div>
        <q-list bordered separator>
          <q-item
            v-for="d in historyDays"
            :key="d.date"
            clickable
            v-ripple
            :active="d.date === selectedIso"
            @click="openDay(d.date)"
          >
            <q-item-section>
              <q-item-label>{{ d.label }}</q-item-label>
              <q-item-label caption>Morning: {{ d.morning }}</q-item-label>
              <q-item-label caption>Afternoon: {{ d.afternoon }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="!historyDays.length">
            <q-item-section class="text-grey-7">No attendance recorded yet.</q-item-section>
          </q-item>
        </q-list>
      </div>
    </div>

    <div v-else class="text-grey-7">Student not found.</div>

    <q-dialog v-model="qrOpen">
      <q-card style="min-width: 300px" class="text-center">
        <q-card-section class="text-h6">{{ student?.fullName }}</q-card-section>
        <q-card-section>
          <img v-if="qrImage" :src="qrImage" alt="Student QR code" width="240" height="240" />
        </q-card-section>
        <q-card-actions align="center">
          <q-btn flat color="primary" icon="download" label="Download" no-caps @click="downloadQr" />
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="editOpen">
      <q-card style="min-width: 300px">
        <q-card-section class="text-h6">Edit student</q-card-section>
        <q-card-section class="column q-gutter-y-md">
          <q-input v-model="editName" label="Full name" autofocus />
          <q-select
            v-model="editClassId"
            :options="classOptions"
            emit-value
            map-options
            label="Class"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save" :disable="!editName.trim()" @click="saveEdit" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="regenOpen">
      <q-card style="min-width: 300px">
        <q-card-section class="text-h6">Regenerate QR code?</q-card-section>
        <q-card-section>
          The current QR code for {{ student?.fullName }} will stop working, and any printed or
          shared copy must be replaced. Attendance records are kept.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Regenerate" @click="regenerate" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="deleteOpen">
      <q-card style="min-width: 300px">
        <q-card-section class="text-h6">Delete student?</q-card-section>
        <q-card-section>
          {{ student?.fullName }} and all of their attendance records will be deleted. This cannot
          be undone.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="negative" label="Delete" @click="confirmDelete" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toDataURL } from 'qrcode';
import { downloadStudentQr } from '../utils/qr-download';
import {
  localDate,
  useAttendanceStore,
  type ScanType,
  type Session,
} from '../stores/attendance-store';

const route = useRoute();
const router = useRouter();
const store = useAttendanceStore();

const student = computed(() => {
  const raw = route.params.studentId;
  const id = typeof raw === 'string' ? raw : '';
  return store.students.find((s) => s.id === id);
});
const className = computed(() =>
  student.value ? (store.classById(student.value.classId)?.className ?? 'Back') : 'Back',
);

const qrOpen = ref(false);
const qrImage = ref('');
async function showQr() {
  if (!student.value) return;
  qrImage.value = await toDataURL(student.value.qrToken, { width: 240, margin: 2 });
  qrOpen.value = true;
}

async function downloadQr() {
  if (!student.value) return;
  await downloadStudentQr(
    student.value.fullName,
    store.classById(student.value.classId)?.className ?? '',
    student.value.qrToken,
  );
}

const editOpen = ref(false);
const editName = ref('');
const editClassId = ref('');
const classOptions = computed(() =>
  store.classes.map((c) => ({ label: c.className, value: c.id })),
);
function openEdit() {
  if (!student.value) return;
  editName.value = student.value.fullName;
  editClassId.value = student.value.classId;
  editOpen.value = true;
}
function saveEdit() {
  if (!student.value || !editName.value.trim()) return;
  store.updateStudent(student.value.id, { fullName: editName.value, classId: editClassId.value });
  editOpen.value = false;
}

const regenOpen = ref(false);
async function regenerate() {
  if (!student.value) return;
  store.regenerateToken(student.value.id);
  regenOpen.value = false;
  await showQr();
}

const deleteOpen = ref(false);
function confirmDelete() {
  const s = student.value;
  if (!s) return;
  const classId = s.classId;
  deleteOpen.value = false;
  store.deleteStudent(s.id);
  void router.replace({ name: 'manage', params: { classId } });
}

// The date picker uses YYYY/MM/DD. The store uses YYYY-MM-DD.
const toPicker = (iso: string) => iso.replace(/-/g, '/');
const fromPicker = (value: string) => value.replace(/\//g, '-');
function parseIso(iso: string) {
  const p = iso.split('-').map(Number);
  return new Date(p[0] ?? 1970, (p[1] ?? 1) - 1, p[2] ?? 1);
}

const selected = ref(toPicker(localDate()));
const selectedIso = computed(() => fromPicker(selected.value));
const isToday = computed(() => selectedIso.value >= localDate());
const formatDay = (iso: string) =>
  parseIso(iso).toLocaleDateString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
const dateLabel = computed(() => formatDay(selectedIso.value));

const notFuture = (date: string) => date <= toPicker(localDate());

// Days on which this student has at least one record (dots in the calendar).
const eventDates = computed(() => {
  const id = student.value?.id;
  const days = store.records.filter((r) => r.studentId === id).map((r) => toPicker(r.eventDate));
  return [...new Set(days)];
});

function shift(delta: number) {
  const d = parseIso(selectedIso.value);
  d.setDate(d.getDate() + delta);
  if (localDate(d) > localDate()) return;
  selected.value = toPicker(localDate(d));
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const sessions = computed(() =>
  (['morning', 'afternoon'] as Session[]).map((session) => ({
    title: session === 'morning' ? 'Morning' : 'Afternoon',
    rows: (['check_in', 'check_out'] as ScanType[]).map((scan) => {
      const rec = student.value
        ? store.recordFor(student.value.id, session, scan, selectedIso.value)
        : undefined;
      const word = scan === 'check_in' ? 'Checked in' : 'Checked out';
      const none = scan === 'check_in' ? 'No check-in recorded' : 'No check-out recorded';
      return {
        key: `${session}-${scan}`,
        done: !!rec,
        text: rec ? `${word} at ${formatTime(rec.scannedAt)}` : none,
      };
    }),
  })),
);
// Every day on which this student has records, newest first.
const historyDays = computed(() => {
  const id = student.value?.id;
  if (id === undefined) return [];
  const dates = [...new Set(store.records.filter((r) => r.studentId === id).map((r) => r.eventDate))]
    .sort()
    .reverse();
  const time = (date: string, session: Session, scan: ScanType) => {
    const rec = store.recordFor(id, session, scan, date);
    return rec ? formatTime(rec.scannedAt) : '-';
  };
  return dates.map((date) => ({
    date,
    label: formatDay(date),
    morning: `In ${time(date, 'morning', 'check_in')} / Out ${time(date, 'morning', 'check_out')}`,
    afternoon: `In ${time(date, 'afternoon', 'check_in')} / Out ${time(date, 'afternoon', 'check_out')}`,
  }));
});

function openDay(date: string) {
  selected.value = toPicker(date);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const hasAny = computed(() => sessions.value.some((s) => s.rows.some((r) => r.done)));
</script>
