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
        <q-item-label caption class="q-px-md text-grey-7">
          {{ auth.signedIn ? `Signed in as ${auth.displayName}` : 'Guest' }}
        </q-item-label>
        <q-item-label caption class="q-px-md q-pb-sm text-grey-7">
          Data is saved on this device.
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
      <q-banner v-if="store.saveFailed" dense class="bg-orange-2 text-grey-9">
        Your data could not be saved on this device. Export a spreadsheet to keep your work.
      </q-banner>
      <router-view />
    </q-page-container>

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
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAttendanceStore } from '../stores/attendance-store';
import { useAuthStore } from '../stores/auth-store';

const router = useRouter();
const store = useAttendanceStore();
const auth = useAuthStore();
const drawer = ref(false);

function onAccountClick() {
  if (auth.signedIn) void auth.signOut();
  else void auth.signIn();
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
