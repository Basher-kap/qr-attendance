<template>
  <q-page class="column items-center justify-center q-pa-md q-gutter-y-lg">
    <q-btn
      color="primary"
      icon="qr_code_scanner"
      label="Scan QR Code"
      size="xl"
      no-caps
      style="min-width: 260px; min-height: 120px"
      @click="router.push({ name: 'scan' })"
    />
    <q-btn
      outline
      color="primary"
      icon="groups"
      label="Manage student data"
      no-caps
      @click="router.push({ name: 'manage' })"
    />
  </q-page>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>