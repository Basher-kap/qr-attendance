<template>
  <q-page padding>
    <div v-if="student" class="column q-gutter-y-md" style="max-width: 480px; margin: 0 auto">
      <q-card flat bordered>
        <q-card-section>
          <div class="text-h6">{{ student.fullName }}</div>
          <div class="text-caption text-grey-7">{{ className }}</div>
        </q-card-section>
        <q-separator />
        <q-list>
          <q-item v-for="s in slots" :key="s.label">
            <q-item-section avatar>
              <q-icon
                :name="s.time ? 'check_circle' : 'radio_button_unchecked'"
                :color="s.time ? 'positive' : 'grey-5'"
              />
            </q-item-section>
            <q-item-section>{{ s.label }}</q-item-section>
            <q-item-section side>{{ s.time ?? '-' }}</q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <q-banner v-if="allDone" class="bg-orange-2">
        All four records are already complete for today.
      </q-banner>

      <template v-else>
        <div class="text-subtitle2">Session</div>
        <q-btn-toggle
          v-model="session"
          spread
          no-caps
          toggle-color="primary"
          :options="[
            { label: 'Morning', value: 'morning' },
            { label: 'Afternoon', value: 'afternoon' },
          ]"
        />
        <div class="text-subtitle2">Type</div>
        <q-btn-toggle
          v-model="scan"
          spread
          no-caps
          toggle-color="primary"
          :options="[
            { label: 'Check-in', value: 'check_in' },
            { label: 'Check-out', value: 'check_out' },
          ]"
        />
        <q-banner v-if="duplicate" class="bg-orange-2">
          This record already exists for today. Choose a different session or type.
        </q-banner>
      </template>

      <div class="row q-gutter-sm justify-end">
        <q-btn flat no-caps label="Cancel" @click="cancel" />
        <q-btn
          color="primary"
          no-caps
          label="Confirm"
          :disable="allDone || duplicate"
          @click="confirm"
        />
      </div>
    </div>

    <q-dialog v-model="savedOpen" persistent>
      <q-card style="min-width: 300px">
        <q-card-section class="text-h6">Record saved</q-card-section>
        <q-card-section>
          {{ savedText }}
          <div class="q-mt-md">Scan another QR code?</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="No, go home" @click="go('home')" />
          <q-btn color="primary" no-caps label="Yes" @click="go('scan')" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAttendanceStore, type ScanType, type Session } from 'stores/attendance-store';

const router = useRouter();
const store = useAttendanceStore();

const student = computed(() =>
  store.pendingToken ? store.studentByToken(store.pendingToken) : undefined,
);
const className = computed(() =>
  student.value ? (store.classById(student.value.classId)?.className ?? '') : '',
);

const ORDER: { session: Session; scan: ScanType; label: string }[] = [
  { session: 'morning', scan: 'check_in', label: 'Morning check-in' },
  { session: 'morning', scan: 'check_out', label: 'Morning check-out' },
  { session: 'afternoon', scan: 'check_in', label: 'Afternoon check-in' },
  { session: 'afternoon', scan: 'check_out', label: 'Afternoon check-out' },
];

const slots = computed(() =>
  ORDER.map((o) => {
    const rec = student.value ? store.recordFor(student.value.id, o.session, o.scan) : undefined;
    return {
      ...o,
      time: rec
        ? new Date(rec.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null,
    };
  }),
);
const allDone = computed(() => slots.value.every((s) => s.time));

const session = ref<Session>('morning');
const scan = ref<ScanType>('check_in');
const duplicate = computed(() =>
  student.value ? !!store.recordFor(student.value.id, session.value, scan.value) : false,
);

const savedOpen = ref(false);
const savedText = ref('');

onMounted(() => {
  if (!student.value) {
    void router.replace({ name: 'home' });
    return;
  }
  // Suggest the first slot that is not recorded yet.
  const next = slots.value.find((s) => !s.time);
  if (next) {
    session.value = next.session;
    scan.value = next.scan;
  }
});

function confirm() {
  if (!student.value) return;
  const ok = store.addRecord(student.value.id, session.value, scan.value);
  if (!ok) return;
  const label = ORDER.find((o) => o.session === session.value && o.scan === scan.value)?.label;
  savedText.value = `${student.value.fullName}: ${label}`;
  savedOpen.value = true;
}

function cancel() {
  store.pendingToken = null;
  void router.push({ name: 'home' });
}

function go(name: 'home' | 'scan') {
  store.pendingToken = null;
  savedOpen.value = false;
  void router.push({ name });
}
</script>