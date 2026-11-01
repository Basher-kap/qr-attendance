<template>
  <q-dialog v-model="exportOpen">
    <q-card style="min-width: 320px; max-width: 420px">
      <q-card-section class="text-h6">Export to spreadsheet</q-card-section>
      <q-card-section class="column q-gutter-y-md">
        <q-option-group
          v-model="exportKind"
          type="radio"
          :options="[
            { label: 'All classes (one sheet per class)', value: 'all' },
            { label: 'Attendance for one date', value: 'daily' },
          ]"
        />
        <template v-if="exportKind === 'all'">
          <div class="text-grey-7">
            Every class becomes its own sheet (tab) in one file. The Morning and Afternoon in/out
            columns show the day each student was confirmed after scanning.
          </div>
          <q-banner dense class="bg-orange-1 text-grey-9">
            The QR Code column holds each student's QR value. Keep the file private.
          </q-banner>
        </template>
        <template v-else>
          <div class="text-grey-7">
            One sheet named "{{ exportDate }} Attendance" with all students. Each cell shows the
            time of the scan. Status is Present when all four scans are done, Incomplete when some
            are missing, and Absent when there are none.
          </div>
          <q-input v-model="exportDate" outlined dense label="Date" mask="####-##-##">
            <template #append>
              <q-icon name="event" class="cursor-pointer">
                <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                  <q-date
                    v-model="exportDate"
                    mask="YYYY-MM-DD"
                    :events="hasRecords"
                    :options="notFuture"
                  >
                    <div class="row justify-end">
                      <q-btn v-close-popup flat no-caps label="Close" color="primary" />
                    </div>
                  </q-date>
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>
        </template>
        <q-banner v-if="error" dense class="bg-red-1 text-negative">{{ error }}</q-banner>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Cancel" v-close-popup />
        <q-btn
          color="primary"
          no-caps
          label="Download"
          :loading="busy"
          :disable="exportKind === 'daily' && !dateValid"
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
            sheet name is the class name, and each row needs a Full Name. The attendance columns are
            not imported.
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
          <q-btn
            flat
            dense
            no-caps
            color="primary"
            icon="description"
            label="Download blank template"
            @click="getTemplate"
          />
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
                  {{ row.toAdd }} new {{ row.toAdd === 1 ? 'student' : 'students'
                  }}<span v-if="row.alreadyThere">, {{ row.alreadyThere }} already in the app</span>
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
import {
  buildDailyExport,
  buildExport,
  buildTemplate,
  parseStudents,
  saveFile,
} from '../utils/spreadsheet';

const store = useAttendanceStore();
const busy = ref(false);
const error = ref('');

// Export
const exportOpen = ref(false);
const exportKind = ref<'all' | 'daily'>('all');
const exportDate = ref(localDate());
const dateValid = computed(
  () => /^\d{4}-\d{2}-\d{2}$/.test(exportDate.value) && !Number.isNaN(Date.parse(exportDate.value)),
);
// The date picker hands over dates as YYYY/MM/DD, whatever the mask is.
const hasRecords = (d: string) => {
  const day = d.replace(/\//g, '-');
  return store.records.some((r) => r.eventDate === day);
};
const notFuture = (d: string) => d.replace(/\//g, '-') <= localDate();

function openExport() {
  error.value = '';
  exportOpen.value = true;
}

async function doExport() {
  busy.value = true;
  error.value = '';
  try {
    const data = { classes: store.classes, students: store.students, records: store.records };
    if (exportKind.value === 'daily') {
      saveFile(
        await buildDailyExport(data, exportDate.value),
        `${exportDate.value} Attendance.xlsx`,
      );
    } else {
      saveFile(await buildExport(data), `QR_Attendee_${localDate()}.xlsx`);
    }
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
