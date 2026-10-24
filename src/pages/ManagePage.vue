<template>
  <q-page padding>
    <div v-if="!cls">
      <div class="text-h6 q-mb-md">Manage student data</div>
      <div class="text-grey-7 q-mb-md">Choose a class to view or add students.</div>
      <q-list bordered separator>
        <q-item
          v-for="c in store.classes"
          :key="c.id"
          clickable
          v-ripple
          :to="{ name: 'manage', params: { classId: c.id } }"
        >
          <q-item-section>{{ c.className }}</q-item-section>
          <q-item-section side>{{ store.studentsOfClass(c.id).length }} students</q-item-section>
        </q-item>
      </q-list>
    </div>

    <div v-else>
      <div class="row items-center q-mb-md">
        <div class="text-h6">{{ cls.className }}</div>
        <q-space />
        <q-btn color="primary" icon="add" label="Add student" no-caps @click="addOpen = true" />
      </div>
      <q-list bordered separator>
        <q-item
          v-for="s in list"
          :key="s.id"
          clickable
          v-ripple
          :to="{ name: 'student', params: { studentId: s.id } }"
        >
          <q-item-section>
            <q-item-label>{{ s.fullName }}</q-item-label>
            <q-item-label caption>Today: {{ todayCount(s.id) }} of 4 records</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn
              flat
              round
              icon="qr_code_2"
              aria-label="Show QR code"
              @click.stop.prevent="showQr(s)"
            />
          </q-item-section>
        </q-item>
        <q-item v-if="!list.length">
          <q-item-section class="text-grey-7">No students yet.</q-item-section>
        </q-item>
      </q-list>
    </div>

    <q-dialog v-model="addOpen">
      <q-card style="min-width: 300px">
        <q-card-section class="text-h6">Add student</q-card-section>
        <q-card-section>
          <q-input v-model="newName" label="Full name" autofocus @keyup.enter="saveStudent" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Add" :disable="!newName.trim()" @click="saveStudent" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="qrOpen">
      <q-card style="min-width: 300px" class="text-center">
        <q-card-section class="text-h6">{{ qrStudent?.fullName }}</q-card-section>
        <q-card-section>
          <img v-if="qrImage" :src="qrImage" alt="Student QR code" width="240" height="240" />
        </q-card-section>
        <q-card-actions align="center">
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { toDataURL } from 'qrcode';
import { useAttendanceStore, type Student } from '../stores/attendance-store';

const route = useRoute();
const store = useAttendanceStore();

const classId = computed(() => {
  const raw = route.params.classId;
  return typeof raw === 'string' && raw ? Number(raw) : null;
});
const cls = computed(() => (classId.value === null ? undefined : store.classById(classId.value)));
const list = computed(() => (cls.value ? store.studentsOfClass(cls.value.id) : []));

const addOpen = ref(false);
const newName = ref('');
function saveStudent() {
  const name = newName.value.trim();
  if (!name || !cls.value) return;
  store.addStudent(cls.value.id, name);
  newName.value = '';
  addOpen.value = false;
}

function todayCount(studentId: number) {
  let count = 0;
  for (const session of ['morning', 'afternoon'] as const) {
    for (const scan of ['check_in', 'check_out'] as const) {
      if (store.recordFor(studentId, session, scan)) count++;
    }
  }
  return count;
}

const qrOpen = ref(false);
const qrStudent = ref<Student | null>(null);
const qrImage = ref('');
async function showQr(s: Student) {
  qrStudent.value = s;
  qrImage.value = await toDataURL(s.qrToken, { width: 240, margin: 2 });
  qrOpen.value = true;
}
</script>