<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { sharingContract, type ExportReviewView, type FindingView } from '../contract';

const api = useClient(sharingContract);
const profiles = ref<{ id: string; name: string }[]>();
const profileId = ref<string>();
const include = ref<string[]>([]);
const review = ref<ExportReviewView>();
const decisions = ref<Record<string, 'keep' | 'remove'>>({});
const notes = ref('');
const notesTouched = ref(false);
const reviewed = ref(false);
const error = ref<string>();
const saved = ref<{ path: string; size: number }>();
const loading = ref(false);
const saving = ref(false);

onMounted(async () => {
  const result = await api.profiles();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  profiles.value = result.value;
  profileId.value = result.value[0]?.id;
});

let sequence = 0;
async function prepare(): Promise<void> {
  if (!profileId.value) return;
  const mine = ++sequence;
  loading.value = true;
  error.value = undefined;
  const result = await api.prepare({ profileId: profileId.value, includeItems: include.value });
  if (mine !== sequence) return;
  loading.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  review.value = result.value;
  for (const f of result.value.findings) decisions.value[f.id] ??= f.defaultAction;
  if (!notesTouched.value) notes.value = result.value.notes;
}

watch(profileId, () => {
  include.value = [];
  decisions.value = {};
  notesTouched.value = false;
  reviewed.value = false;
  saved.value = undefined;
  void prepare();
});
watch(include, () => {
  reviewed.value = false;
  saved.value = undefined;
  void prepare();
});

const KIND: Record<FindingView['kind'], string> = {
  userName: 'Windows user name',
  machineName: 'PC name',
  serial: 'Serial number',
  instancePath: 'Device instance path',
  path: 'Folder path',
  audioId: 'Audio device id',
  deviceId: 'Controller id in a file name',
  unchecked: 'File that cannot be checked',
};

const HELP: Record<FindingView['kind'], string> = {
  userName: 'Your Windows account name.',
  machineName: 'The name of this PC.',
  serial: 'Serial numbers identify your exact devices.',
  instancePath: 'Windows ids of your devices and monitors. They only mean something on this PC.',
  path: 'Folders under your user account. Replaced with variables that point at the same folders on the other PC.',
  audioId: 'Ids of audio devices on this PC.',
  deviceId:
    'DCS names binding files after each controller id. Keep them, or the bindings cannot be used.',
  unchecked: 'Not text files, so RigReady cannot look inside them.',
};

/** Groups longer than this start folded, with one choice for the whole group. */
const FOLD = 3;
const ORDER: FindingView['kind'][] = [
  'userName',
  'machineName',
  'serial',
  'instancePath',
  'path',
  'audioId',
  'deviceId',
  'unchecked',
];
const groups = computed(() =>
  ORDER.map((kind) => ({
    kind,
    findings: (review.value?.findings ?? []).filter((f) => f.kind === kind),
  })).filter((g) => g.findings.length > 0)
);
const openGroups = ref(new Set<string>());
function toggleGroup(kind: string): void {
  const next = new Set(openGroups.value);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  openGroups.value = next;
}
function groupDecision(g: { findings: FindingView[] }): 'keep' | 'remove' | undefined {
  const all = new Set(g.findings.map((f) => decisions.value[f.id]));
  return all.size === 1 ? [...all][0] : undefined;
}
function setGroup(g: { findings: FindingView[] }, value: 'keep' | 'remove' | undefined): void {
  if (!value) return;
  for (const f of g.findings) decisions.value[f.id] = value;
}

const removed = computed(
  () => review.value?.findings.filter((f) => decisions.value[f.id] === 'remove').length ?? 0
);
/** Config files that go along, without those left out by a "remove" on a file-level finding. */
const sharedFiles = computed(() => {
  const dropped = new Set(
    (review.value?.findings ?? [])
      .filter(
        (f) =>
          (f.kind === 'deviceId' || f.kind === 'unchecked') && decisions.value[f.id] === 'remove'
      )
      .flatMap((f) => f.where)
  );
  return (review.value?.files ?? []).filter((f) => !dropped.has(`${f.group} / ${f.path}`));
});
const totalBytes = computed(() => sharedFiles.value.reduce((s, f) => s + f.size, 0));

const size = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1048576
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;

function whereText(f: FindingView): string {
  const shown = f.where.slice(0, 2).join('; ');
  return f.where.length > 2 ? `${shown}; and ${f.where.length - 2} more` : shown;
}

async function save(): Promise<void> {
  if (!profileId.value || !reviewed.value) return;
  saving.value = true;
  error.value = undefined;
  const result = await api.export({
    profileId: profileId.value,
    includeItems: include.value,
    decisions: decisions.value,
    notes: notes.value,
    reviewed: true,
  });
  saving.value = false;
  if (!result.ok) error.value = errorText(result.error);
  else if (result.value) saved.value = result.value;
}
</script>

<template>
  <div data-testid="share-export">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="share-error">
      {{ error }}
    </v-alert>

    <div
      v-if="profiles && profiles.length === 0"
      class="rr-panel rr-empty"
      data-testid="share-no-setups"
    >
      There are no setups to share yet. Create one from the rig first.
    </div>

    <template v-else-if="profiles">
      <h2 class="rr-section-title">1. What to share</h2>
      <div class="rr-panel step">
        <v-select
          v-model="profileId"
          :items="profiles"
          item-title="name"
          item-value="id"
          label="Setup"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-3 setup-select"
          data-testid="share-setup"
        />
        <div class="rr-row-sub mb-1">
          The setup's checks and its monitor layout are always included. Its config files are
          optional:
        </div>
        <div
          v-if="review && review.items.length === 0"
          class="rr-row-sub"
          data-testid="share-no-items"
        >
          This setup tracks no config files. Add them on Backups → Tracked files to share bindings
          too.
        </div>
        <div
          v-for="item in review?.items ?? []"
          :key="item.id"
          class="item"
          data-testid="share-item"
        >
          <v-checkbox
            v-model="include"
            :value="item.id"
            :disabled="item.fileCount === 0"
            density="compact"
            hide-details
            :data-testid="`share-item-${item.id}`"
          >
            <template #label>
              <span>{{ item.label }}</span>
              <span class="rr-muted item-meta">
                {{ item.fileCount }} files · {{ size(item.totalBytes) }}
                <template v-if="item.problem"> · {{ item.problem }}</template>
              </span>
            </template>
          </v-checkbox>
        </div>
      </div>

      <template v-if="review">
        <h2 class="rr-section-title section-gap">2. Privacy review</h2>
        <div class="rr-panel" data-testid="share-findings">
          <div
            v-if="review.findings.length === 0"
            class="rr-row rr-muted"
            data-testid="share-no-findings"
          >
            No personal details were found.
          </div>
          <div
            v-for="g in groups"
            :key="g.kind"
            class="finding-group"
            data-testid="share-finding-group"
            :data-kind="g.kind"
            :data-decision="groupDecision(g) ?? 'mixed'"
          >
            <div class="rr-row group-head">
              <div class="rr-row-main">
                <div class="rr-row-title">{{ KIND[g.kind] }} ({{ g.findings.length }})</div>
                <div class="rr-row-sub">{{ HELP[g.kind] }}</div>
              </div>
              <template v-if="g.findings.length > FOLD">
                <v-btn
                  variant="text"
                  size="small"
                  :data-testid="`share-group-toggle-${g.kind}`"
                  @click="toggleGroup(g.kind)"
                >
                  {{ openGroups.has(g.kind) ? 'Hide' : 'Show each' }}
                </v-btn>
                <v-btn-toggle
                  :model-value="groupDecision(g)"
                  density="compact"
                  variant="outlined"
                  divided
                  @update:model-value="(v: 'keep' | 'remove' | undefined) => setGroup(g, v)"
                >
                  <v-btn value="remove" size="small">Remove all</v-btn>
                  <v-btn value="keep" size="small">Keep all</v-btn>
                </v-btn-toggle>
              </template>
            </div>
            <template v-if="g.findings.length <= FOLD || openGroups.has(g.kind)">
              <div
                v-for="f in g.findings"
                :key="f.id"
                class="rr-row finding"
                data-testid="share-finding"
                :data-kind="f.kind"
                :data-decision="decisions[f.id]"
              >
                <div class="rr-row-main">
                  <div class="rr-mono finding-value">{{ f.value }}</div>
                  <div class="rr-row-sub">Found in {{ whereText(f) }}</div>
                  <div class="rr-row-sub">
                    {{ decisions[f.id] === 'remove' ? f.removeText : 'Shared as it is' }}
                  </div>
                </div>
                <v-btn-toggle
                  v-model="decisions[f.id]"
                  mandatory
                  density="compact"
                  variant="outlined"
                  divided
                  data-testid="share-finding-decision"
                >
                  <v-btn value="remove" size="small" data-testid="share-finding-remove"
                    >Remove</v-btn
                  >
                  <v-btn value="keep" size="small" data-testid="share-finding-keep">Keep</v-btn>
                </v-btn-toggle>
              </div>
            </template>
          </div>
        </div>

        <h2 class="rr-section-title section-gap">Never shared</h2>
        <div class="rr-panel" data-testid="share-stripped">
          <div
            v-if="review.stripped.length === 0 && review.excluded.length === 0"
            class="rr-row rr-muted"
          >
            Nothing in this setup runs a program, and no file was left out.
          </div>
          <div
            v-for="s in review.stripped"
            :key="s.kind + s.name + s.description"
            class="rr-row"
            data-testid="share-stripped-item"
          >
            <v-icon icon="mdi-cancel" size="18" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ s.name }}</div>
              <div class="rr-row-sub">
                {{
                  s.kind === 'launch'
                    ? 'Launch command'
                    : s.kind === 'check'
                      ? 'Check that runs a script or command'
                      : s.kind === 'action'
                        ? 'Launch or Stand down step that runs a program'
                        : 'Fix that starts a program'
                }}
                · {{ s.description }}
              </div>
            </div>
          </div>
          <div
            v-for="x in review.excluded"
            :key="x.path"
            class="rr-row"
            data-testid="share-excluded-item"
          >
            <v-icon icon="mdi-file-cancel-outline" size="18" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-mono">{{ x.path }}</div>
              <div class="rr-row-sub">Left out: {{ x.reason }}</div>
            </div>
          </div>
        </div>

        <h2 class="rr-section-title section-gap">3. Notes for whoever gets it</h2>
        <div class="rr-panel step">
          <v-textarea
            v-model="notes"
            rows="6"
            auto-grow
            variant="outlined"
            hide-details
            data-testid="share-notes"
            @update:model-value="notesTouched = true"
          />
          <div class="rr-row-sub mt-2">
            Written from the setup's checks: the hardware, software and monitors it expects. Edit it
            as you like.
          </div>
        </div>

        <div class="rr-panel footer" data-testid="share-footer">
          <v-checkbox
            v-model="reviewed"
            density="compact"
            hide-details
            label="I reviewed this"
            data-testid="share-reviewed"
          />
          <div v-if="saved" class="rr-row-main saved rr-ok" data-testid="share-saved">
            <v-icon icon="mdi-check" size="16" /> Saved {{ saved.path }} ({{ size(saved.size) }})
          </div>
          <div v-else class="rr-row-main rr-row-sub" data-testid="share-summary">
            {{ sharedFiles.length }} config files ({{ size(totalBytes) }}) · {{ removed }} of
            {{ review.findings.length }} personal details removed ·
            {{ review.stripped.length }} runnable items left out
          </div>
          <v-btn
            color="primary"
            prepend-icon="mdi-content-save-outline"
            :disabled="!reviewed || loading"
            :loading="saving"
            data-testid="share-save"
            @click="save"
          >
            Save .rigready file
          </v-btn>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.step {
  padding: 14px 16px;
}
.setup-select {
  max-width: 360px;
}
.item-meta {
  margin-left: 10px;
  font-size: 12.5px;
}
.finding-group {
  border-top: 1px solid var(--rr-border);
}
.finding-group:first-child {
  border-top: none;
}
.group-head {
  border-top: none;
}
.finding {
  align-items: flex-start;
  padding-left: 32px;
  border-top: 1px dashed var(--rr-border);
}
.finding-value {
  overflow-wrap: anywhere;
  margin: 2px 0;
}
.footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  margin-top: 20px;
  position: sticky;
  bottom: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
}
.saved {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
</style>
