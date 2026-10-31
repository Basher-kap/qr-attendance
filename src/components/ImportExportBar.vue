<template>
  <q-dialog v-model="exportOpen">
    <q-card style="min-width: 320px; max-width: 420px">
      <q-card-section class="text-h6">Export to spreadsheet</q-card-section>
      <q-card-section class="column q-gutter-y-md">
        <div class="text-grey-7">
          Every class becomes its own sheet (tab) in one file. The Morning and Afternoon in/out columns show the day each student
          was confirmed after scanning.
        </div>
        <q-banner dense class="bg-orange-1 text-grey-9">
          The QR Code column holds each student's QR value. Keep the file private.
        </q-banner>
        <q-banner v-if="error" dense class="bg-red-1 text-negative">{{ error }}</q-banner>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Cancel" v-close-popup />
        <q-btn
          color="primary"
          no-caps
          label="Download"
          :loading="busy"
          @click="doExport"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <q-dialog v-model="importOpen">
    <q-card style="min-width: 320px; max-width: 460px; width: 100%">
      <q-card-section class="text-h6">Import from spreadsheet</q-card-section>

      <template v-if="step === 'pick'">
        <q-card-section class="column q-gutter-y-md">
          <div class="text-grey-7">
            Use an .xlsx file with one sheet (tab) per class. All sheets are imported together. The
            sheet name is the class name, and each row needs a Full Name. The attendance columns are not imported.
          </div>
          <q-file
            v-model="file"
            outlined
            accept=".xlsx"
            label="Choose .xlsx file"
            :loading="busy"
            @update:model-value="onFile"
          >
            <template #prepend><q-icon name="attach_file" /></template>
          </q-file>
          <q-btn flat dense no-caps color="primary" icon="description" label="Download blank template" @click="getTemplate" />
          <q-banner v-if="error" dense class="bg-red-1 text-negative">{{ error }}</q-banner>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancel" v-close-popup />
        </q-card-actions>
      </template>

      <template v-else-if="step === 'preview'">
        <q-card-section class="column q-gutter-y-sm">
          <div class="text-grey-7">This is what the import will add. Nothing is saved yet.</div>
          <q-list bordered separator>
            <q-item v-for="row in preview" :key="row.name">
              <q-item-section>
                <q-item-label>
                  {{ row.name }}
                  <q-badge v-if="row.isNewClass" color="primary" class="q-ml-sm">New class</q-badge>
                </q-item-label>
                <q-item-label caption>
                  {{ row.toAdd }} new {{ row.toAdd === 1 ? 'student' : 'students' }}<span
                    v-if="row.alreadyThere"
                    >, {{ row.alreadyThere }} already in the app</span
                  >
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
          <q-banner v-if="plan && plan.warnings.length" dense class="bg-orange-1 text-grey-9">
            <div v-for="(w, i) in plan.warnings" :key="i">{{ w }}</div>
          </q-banner>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Back" @click="reset" />
          <q-btn color="primary" no-caps label="Import" :disable="!canImport" @click="doImport" />
        </q-card-actions>
      </template>

      <template v-else>
        <q-card-section v-if="summary" class="column q-gutter-y-xs">
          <div>
            Added {{ summary.studentsAdded }}
            {{ summary.studentsAdded === 1 ? 'student' : 'students' }} and
            {{ summary.classesAdded }} {{ summary.classesAdded === 1 ? 'class' : 'classes' }}.
          </div>
          <div v-if="summary.studentsSkipped" class="text-grey-7">
            Skipped {{ summary.studentsSkipped }} already in the app.
          </div>
          <div v-if="summary.tokensReplaced" class="text-grey-7">
            {{ summary.tokensReplaced }} QR
            {{ summary.tokensReplaced === 1 ? 'value was' : 'values were' }} already used, so new
            ones were created.
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn color="primary" no-caps label="Done" v-close-popup />
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  localDate,
  useAttendanceStore,
  type ImportPlan,
  type ImportPreviewRow,
  type ImportSummary,
} from '../stores/attendance-store';
import { buildExport, buildTemplate, parseStudents, saveFile } from '../utils/spreadsheet';

const store = useAttendanceStore();
const busy = ref(false);
const error = ref('');

// Export
const exportOpen = ref(false);

function openExport() {
  error.value = '';
  exportOpen.value = true;
}

async function doExport() {
  busy.value = true;
  error.value = '';
  try {
    const blob = await buildExport({
      classes: store.classes,
      students: store.students,
      records: store.records,
    });
    saveFile(blob, `QR_Attendee_${localDate()}.xlsx`);
    exportOpen.value = false;
  } catch {
    error.value = 'The spreadsheet could not be created.';
  } finally {
    busy.value = false;
  }
}

// Import
const importOpen = ref(false);
const step = ref<'pick' | 'preview' | 'done'>('pick');
const file = ref<File | null>(null);
const plan = ref<ImportPlan | null>(null);
const preview = ref<ImportPreviewRow[]>([]);
const summary = ref<ImportSummary | null>(null);

const canImport = computed(() => preview.value.some((r) => r.toAdd > 0 || r.isNewClass));

function reset() {
  step.value = 'pick';
  file.value = null;
  plan.value = null;
  preview.value = [];
  summary.value = null;
  error.value = '';
}

function openImport() {
  reset();
  importOpen.value = true;
}

async function onFile(picked: File | File[] | null) {
  error.value = '';
  const chosen = Array.isArray(picked) ? picked[0] : picked;
  if (!chosen) return;
  busy.value = true;
  try {
    const parsed = await parseStudents(await chosen.arrayBuffer());
    if (!parsed.classes.length) {
      error.value = 'No usable sheets were found. Each sheet needs a "Full Name" column.';
      return;
    }
    plan.value = parsed;
    preview.value = store.previewImport(parsed);
    step.value = 'preview';
  } catch {
    error.value = 'This file could not be read. Please use an .xlsx file made from the template.';
  } finally {
    busy.value = false;
  }
}

function doImport() {
  if (!plan.value) return;
  summary.value = store.applyImport(plan.value);
  step.value = 'done';
}

async function getTemplate() {
  saveFile(await buildTemplate(), 'QR_Attendee_Template.xlsx');
}
defineExpose({ openImport, openExport });
</script>
