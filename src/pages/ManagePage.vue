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
        <q-btn flat round dense icon="more_vert" aria-label="Class options">
          <q-menu>
            <q-list style="min-width: 160px">
              <q-item clickable v-close-popup @click="openRename">
                <q-item-section avatar><q-icon name="edit" /></q-item-section>
                <q-item-section>Rename class</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="deleteClassOpen = true">
                <q-item-section avatar><q-icon name="delete" color="negative" /></q-item-section>
                <q-item-section class="text-negative">Delete class</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <q-space />
        <q-btn color="primary" icon="add" label="Add student" no-caps @click="addOpen = true" />
      </div>
      <q-input
        v-model="search"
        dense
        outlined
        clearable
        placeholder="Search students by name"
        class="q-mb-md"
      >
        <template #prepend><q-icon name="search" /></template>
      </q-input>
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
          <q-item-section class="text-grey-7">
            {{ search?.trim() ? 'No students match your search.' : 'No students yet.' }}
          </q-item-section>
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

    <q-dialog v-model="renameOpen">
      <q-card style="min-width: 300px">
        <q-card-section class="text-h6">Rename class</q-card-section>
        <q-card-section>
          <q-input
            v-model="renameValue"
            label="Class name"
            autofocus
            :error="renameTaken"
            error-message="A class with this name already exists."
            @keyup.enter="saveRename"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Save"
            :disable="!renameValue.trim() || renameTaken"
            @click="saveRename"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="deleteClassOpen">
      <q-card style="min-width: 300px">
        <q-card-section class="text-h6">Delete class</q-card-section>
        <q-card-section v-if="cls && studentCount > 0">
          {{ cls.className }} still has {{ studentCount }}
          {{ studentCount === 1 ? 'student' : 'students' }}. Move or delete them first.
        </q-card-section>
        <q-card-section v-else-if="cls">
          Delete {{ cls.className }}? This cannot be undone.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="studentCount > 0 ? 'OK' : 'Cancel'" v-close-popup />
          <q-btn v-if="studentCount === 0" color="negative" label="Delete" @click="confirmDeleteClass" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toDataURL } from 'qrcode';
import { useAttendanceStore, type Student } from '../stores/attendance-store';

const route = useRoute();
const router = useRouter();
const store = useAttendanceStore();

const classId = computed(() => {
  const raw = route.params.classId;
  return typeof raw === 'string' && raw ? Number(raw) : null;
});
const cls = computed(() => (classId.value === null ? undefined : store.classById(classId.value)));
const search = ref('');
// Clear the search when another class is opened.
watch(classId, () => {
  search.value = '';
});

// Students of this class matching the search, sorted A to Z by full name.
const list = computed(() => {
  if (!cls.value) return [];
  const term = (search.value ?? '').trim().toLowerCase();
  return store
    .studentsOfClass(cls.value.id)
    .filter((s) => s.fullName.toLowerCase().includes(term))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }));
});

const addOpen = ref(false);
const newName = ref('');
function saveStudent() {
  const name = newName.value.trim();
  if (!name || !cls.value) return;
  store.addStudent(cls.value.id, name);
  newName.value = '';
  addOpen.value = false;
}

const renameOpen = ref(false);
const renameValue = ref('');
const renameTaken = computed(
  () => !!cls.value && store.classNameTaken(renameValue.value, cls.value.id),
);
function openRename() {
  renameValue.value = cls.value?.className ?? '';
  renameOpen.value = true;
}
function saveRename() {
  if (!cls.value || !renameValue.value.trim() || renameTaken.value) return;
  store.renameClass(cls.value.id, renameValue.value);
  renameOpen.value = false;
}

const deleteClassOpen = ref(false);
const studentCount = computed(() => (cls.value ? store.studentsOfClass(cls.value.id).length : 0));
function confirmDeleteClass() {
  if (!cls.value) return;
  if (store.deleteClass(cls.value.id) === 'ok') {
    deleteClassOpen.value = false;
    void router.push({ name: 'manage' });
  }
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
