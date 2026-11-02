<template>
  <q-page class="home column items-center justify-center q-pa-md">
    <img :src="logo" alt="QR Attendance logo" class="home-logo" />
    <h1 class="home-title">QR Attendance</h1>
    <p class="home-subtitle">Scan a student's QR code to record attendance in seconds.</p>

    <div class="home-actions column q-gutter-y-md">
      <button
        type="button"
        class="action-card action-card--main"
        @click="router.push({ name: 'scan' })"
      >
        <span class="action-icon"><q-icon name="qr_code_scanner" size="30px" /></span>
        <span class="action-text">
          <span class="action-title">Scan QR code</span>
          <span class="action-caption">Use the camera, or search a name</span>
        </span>
        <q-icon name="chevron_right" size="24px" />
      </button>
      <button type="button" class="action-card" @click="router.push({ name: 'manage' })">
        <span class="action-icon"><q-icon name="groups" size="28px" /></span>
        <span class="action-text">
          <span class="action-title">Manage student data</span>
          <span class="action-caption">{{ summary }}</span>
        </span>
        <q-icon name="chevron_right" size="24px" />
      </button>
    </div>

    <div class="home-mode">
      <q-icon :name="store.mode === 'cloud' ? 'cloud_done' : 'phone_iphone'" size="16px" />
      {{ store.mode === 'cloud' ? 'Saved in your account' : 'Guest: saved on this device' }}
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import logo from '../assets/logo.svg';
import { useAttendanceStore } from '../stores/attendance-store';

const router = useRouter();
const store = useAttendanceStore();

const summary = computed(() => {
  const c = store.classes.length;
  const s = store.students.length;
  if (!c) return 'Add a class to get started';
  return `${c} ${c === 1 ? 'class' : 'classes'} · ${s} ${s === 1 ? 'student' : 'students'}`;
});
</script>

<style scoped>
.home {
  background:
    radial-gradient(circle at 15% 0%, rgba(63, 128, 234, 0.14), transparent 45%),
    radial-gradient(circle at 90% 100%, rgba(95, 169, 90, 0.16), transparent 45%);
  text-align: center;
}
.home-logo {
  width: 132px;
  height: 132px;
  margin-bottom: 8px;
  filter: drop-shadow(0 10px 22px rgba(47, 111, 222, 0.25));
}
.home-title {
  margin: 8px 0 4px;
  font-size: 1.7rem;
  line-height: 1.2;
  font-weight: 700;
  background: linear-gradient(100deg, #2f6fde, #3f9e63);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.home-subtitle {
  max-width: 300px;
  margin: 0 0 28px;
  color: var(--qa-muted);
}
.home-actions {
  width: 100%;
  max-width: 360px;
}
.action-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px;
  border: 1px solid var(--qa-line);
  border-radius: 20px;
  background: var(--qa-surface);
  color: var(--qa-ink);
  text-align: left;
  font: inherit;
  cursor: pointer;
  box-shadow: var(--qa-shadow);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}
.action-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(31, 42, 61, 0.12);
}
.action-card:active {
  transform: scale(0.985);
}
.action-card:focus-visible {
  outline: 3px solid rgba(63, 128, 234, 0.45);
  outline-offset: 2px;
}
.action-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: var(--qa-gradient-soft);
  color: var(--q-primary);
}
.action-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.action-title {
  font-size: 1.05rem;
  font-weight: 600;
}
.action-caption {
  font-size: 0.82rem;
  color: var(--qa-muted);
}
.action-card--main {
  border: none;
  background: var(--qa-gradient);
  color: #fff;
  box-shadow: 0 10px 28px rgba(47, 111, 222, 0.32);
}
.action-card--main .action-icon {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.action-card--main .action-caption {
  color: rgba(255, 255, 255, 0.88);
}
.home-mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 28px;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--qa-surface);
  border: 1px solid var(--qa-line);
  font-size: 0.8rem;
  color: var(--qa-muted);
}
</style>
