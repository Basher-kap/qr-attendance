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
        <div class="text-h6 q-mt-sm">{{ student.fullName }}</div>
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
    </div>

    <div v-else class="text-grey-7">Student not found.</div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  const id = Number(route.params.studentId);
  return store.students.find((s) => s.id === id);
});
const className = computed(() =>
  student.value ? (store.classById(student.value.classId)?.className ?? 'Back') : 'Back',
);

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
const dateLabel = computed(() =>
  parseIso(selectedIso.value).toLocaleDateString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }),
);

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
const hasAny = computed(() => sessions.value.some((s) => s.rows.some((r) => r.done)));
</script>