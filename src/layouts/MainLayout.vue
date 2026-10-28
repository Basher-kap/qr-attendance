<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-btn flat dense round icon="menu" aria-label="Menu" @click="drawer = !drawer" />
        <q-toolbar-title class="cursor-pointer" @click="router.push({ name: 'home' })">
          QR Attendance
        </q-toolbar-title>
        <q-btn
          v-if="auth.enabled && auth.status !== 'loading'"
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
        <q-item-label caption class="q-px-md text-grey-7">{{ dbStatus }}</q-item-label>
        <q-item-label v-if="auth.signedIn" caption class="q-px-md q-pb-sm text-grey-7">
          Signed in as {{ auth.displayName }}
        </q-item-label>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view v-if="auth.canUse" />
      <q-page v-else class="column items-center justify-center q-pa-md text-center q-gutter-y-md">
        <q-spinner v-if="auth.status === 'loading'" size="40px" color="primary" />

        <template v-else-if="auth.status === 'not-authorized'">
          <q-icon name="block" size="56px" color="negative" />
          <div class="text-h6">Account not authorized</div>
          <div class="text-grey-7" style="max-width: 320px">
            {{ auth.email }} is not on the list of allowed users. Ask an administrator to add it,
            or use another account.
          </div>
          <q-btn color="primary" no-caps icon="swap_horiz" label="Use another account" @click="auth.signIn" />
          <q-btn flat no-caps label="Log out" @click="auth.signOut" />
        </template>

        <template v-else-if="auth.status === 'error'">
          <q-icon name="error_outline" size="56px" color="negative" />
          <div class="text-h6">Something went wrong</div>
          <div class="text-grey-7" style="max-width: 320px">{{ auth.errorMessage }}</div>
          <q-btn color="primary" no-caps icon="refresh" label="Try again" @click="auth.refreshRole" />
          <q-btn v-if="auth.signedIn" flat no-caps label="Log out" @click="auth.signOut" />
        </template>

        <template v-else>
          <q-icon name="account_circle" size="64px" color="grey-6" />
          <div class="text-h6">Sign in to continue</div>
          <div class="text-grey-7" style="max-width: 320px">
            Use your Google account to open QR Attendance.
          </div>
          <q-btn color="primary" no-caps icon="login" label="Sign in with Google" @click="auth.signIn" />
        </template>
      </q-page>
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
import { checkConnection } from '../lib/supabase';
import { useAttendanceStore } from '../stores/attendance-store';
import { useAuthStore } from '../stores/auth-store';

const router = useRouter();
const store = useAttendanceStore();
const auth = useAuthStore();
const drawer = ref(false);
const dbStatus = ref('Checking database...');

function onAccountClick() {
  if (auth.signedIn) void auth.signOut();
  else void auth.signIn();
}

onMounted(() => {
  void auth.init();
  void checkConnection().then((result) => {
    if (result.status === 'connected') dbStatus.value = 'Database: connected';
    else if (result.status === 'not-configured') dbStatus.value = 'Database: not set up (sample data)';
    else dbStatus.value = `Database error: ${result.message ?? 'unknown'}`;
  });
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
