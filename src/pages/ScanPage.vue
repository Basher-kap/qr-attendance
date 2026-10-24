<template>
  <q-page padding class="column items-center q-gutter-y-md">
    <q-card
      flat
      bordered
      class="column items-center justify-center bg-grey-3"
      style="width: 280px; height: 280px"
    >
      <q-icon name="qr_code_scanner" size="80px" color="grey-6" />
      <div class="text-grey-7 q-mt-sm">Camera preview goes here</div>
    </q-card>

    <div class="text-caption text-grey-7 text-center">
      Camera scanning is added later. For now, simulate a scan:
    </div>

    <div class="column q-gutter-y-sm" style="min-width: 260px">
      <q-btn
        v-for="s in store.students"
        :key="s.id"
        outline
        color="primary"
        no-caps
        :label="`Scan ${s.fullName}`"
        @click="handleScan(s.qrToken)"
      />
      <q-btn flat color="negative" no-caps label="Scan an invalid QR code" @click="handleScan('not-a-student')" />
    </div>

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
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAttendanceStore } from 'stores/attendance-store';

const router = useRouter();
const store = useAttendanceStore();
const errorOpen = ref(false);

// The real camera scanner will call this same function with the decoded text.
function handleScan(token: string) {
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
</script>