<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CheckResult } from '../../../core/checks/engine';
import type { SkeletonItem } from '../contract';
import SafeMarkdown from './SafeMarkdown.vue';

const props = defineProps<{
  item: SkeletonItem;
  result?: CheckResult;
  checking: boolean;
  fixing: boolean;
  fixMessage?: { ok: boolean; message: string };
  /** Make ready or Stand down is running: per-item actions wait. */
  locked: boolean;
  profileId: string;
}>();
const emit = defineEmits<{ recheck: []; fix: []; acknowledge: [] }>();

const showInstructions = ref(false);
const showOutput = ref(false);

const status = computed(() =>
  props.result?.disabled
    ? 'off'
    : props.checking || !props.result
      ? 'checking'
      : props.result.status
);
const required = computed(() => props.result?.required ?? props.item.required);

const look = computed(() => {
  switch (status.value) {
    case 'off':
      return { icon: 'mdi-minus-circle-outline', tone: 'rr-muted', label: 'Off' };
    case 'pass':
      return { icon: 'mdi-check-circle', tone: 'rr-ok', label: 'Passed' };
    case 'fail':
      return { icon: 'mdi-close-circle', tone: 'rr-bad', label: 'Failed' };
    case 'warn':
      return { icon: 'mdi-alert', tone: 'rr-warn', label: 'Warning' };
    case 'error':
      return {
        icon: 'mdi-alert-circle-outline',
        tone: required.value ? 'rr-bad' : 'rr-warn',
        label: 'Could not check',
      };
    default:
      return { icon: '', tone: 'rr-muted', label: 'Checking' };
  }
});

const checkedAt = computed(() => {
  const at = props.result?.checkedAt;
  if (!at) return '';
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
});

const failing = computed(() => props.result && props.result.status !== 'pass');
const canFix = computed(
  () =>
    failing.value &&
    props.result?.fix &&
    (props.result.fixKind === 'action' || props.result.fixKind === 'navigate')
);
const hasInstructions = computed(
  () => failing.value && props.result?.fixKind === 'instructions' && props.result.instructions
);
const diagnose = computed(() => failing.value && props.item.group === 'devices');
</script>

<template>
  <div
    class="rr-row check-row"
    :class="{ 'check-off': status === 'off' }"
    data-testid="check-row"
    :data-status="status"
    :data-title="item.title"
    :data-checked-at="result?.checkedAt ?? ''"
  >
    <div class="check-icon" :title="look.label" :aria-label="look.label" role="img">
      <v-progress-circular
        v-if="status === 'checking'"
        indeterminate
        size="18"
        width="2"
        class="rr-muted"
      />
      <v-icon v-else :icon="look.icon" :class="look.tone" size="22" />
    </div>
    <div class="rr-row-main">
      <div class="rr-row-title">
        {{ item.title }}
        <span v-if="status === 'off'" class="check-chip" data-testid="check-off">off</span>
        <span v-else-if="!required" class="check-chip">optional</span>
        <span v-if="status === 'error'" class="check-chip check-chip-error" :class="look.tone"
          >error</span
        >
      </div>
      <div
        class="rr-row-sub"
        :class="status === 'pass' || status === 'checking' ? '' : look.tone"
        data-testid="check-summary"
      >
        <template v-if="status === 'off'">
          Off: not checked and not counted. Turn it on in the
          <router-link :to="`/configure/profiles/${profileId}`" class="check-off-link"
            >setup editor</router-link
          >.
        </template>
        <template v-else>
          {{ status === 'checking' && !result ? 'Checking…' : result?.summary }}
        </template>
      </div>
      <ul v-if="result && result.details.length" class="check-details">
        <li v-for="line in result.details" :key="line">{{ line }}</li>
      </ul>
      <div v-if="result?.output" class="check-output">
        <button
          type="button"
          class="check-link"
          data-testid="check-output-toggle"
          @click="showOutput = !showOutput"
        >
          <v-icon :icon="showOutput ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="16" />
          Program output
        </button>
        <pre v-if="showOutput" class="rr-mono" data-testid="check-output">{{ result.output }}</pre>
      </div>
      <div
        v-if="fixMessage"
        class="check-fix-result"
        :class="fixMessage.ok ? 'rr-ok' : 'rr-bad'"
        data-testid="fix-result"
      >
        <v-icon :icon="fixMessage.ok ? 'mdi-check' : 'mdi-alert-circle'" size="15" />
        {{ fixMessage.message }}
      </div>
      <router-link
        v-if="fixMessage && !fixMessage.ok"
        :to="`/configure/profiles/${profileId}`"
        class="check-edit-link"
        data-testid="fix-edit-setup"
      >
        Change the fix in the setup editor
      </router-link>
      <div v-if="showInstructions && result?.instructions" class="check-instructions rr-panel">
        <SafeMarkdown :source="result.instructions" />
      </div>
    </div>
    <div class="check-side">
      <div class="check-buttons">
        <v-btn
          v-if="canFix"
          size="small"
          color="primary"
          variant="tonal"
          prepend-icon="mdi-wrench-outline"
          :loading="fixing"
          :disabled="locked || fixing"
          data-testid="check-fix"
          @click="emit('fix')"
        >
          {{ result!.fix }}
        </v-btn>
        <v-btn
          v-if="hasInstructions"
          size="small"
          variant="tonal"
          prepend-icon="mdi-text-box-outline"
          data-testid="check-instructions"
          @click="showInstructions = !showInstructions"
        >
          {{ showInstructions ? 'Hide instructions' : 'Show instructions' }}
        </v-btn>
        <v-btn
          v-if="failing && result?.acknowledge"
          size="small"
          variant="tonal"
          prepend-icon="mdi-check-decagram-outline"
          :loading="fixing"
          :disabled="locked"
          data-testid="check-acknowledge"
          @click="emit('acknowledge')"
        >
          {{ result.acknowledge }}
        </v-btn>
        <v-btn
          v-if="diagnose"
          size="small"
          variant="text"
          prepend-icon="mdi-stethoscope"
          :to="{ path: '/configure/devices', query: { profile: profileId, item: item.itemId } }"
          data-testid="check-diagnose"
        >
          Diagnose
        </v-btn>
        <span
          v-if="checkedAt"
          class="check-time"
          data-testid="checked-at"
          :title="`Checked at ${checkedAt}`"
        >
          {{ checkedAt }}
        </span>
        <v-btn
          icon="mdi-refresh"
          size="x-small"
          variant="text"
          :disabled="checking || locked"
          :aria-label="`Check ${item.title} again`"
          title="Check this again"
          data-testid="check-recheck"
          @click="emit('recheck')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.check-row {
  align-items: flex-start;
}
.check-icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  flex: none;
}
.check-chip {
  margin-left: 8px;
  font-size: 11px;
  color: var(--rr-muted);
  border: 1px solid var(--rr-border);
  border-radius: 4px;
  padding: 0 5px;
  font-weight: 400;
}
.check-chip-error {
  border-color: currentColor;
}
.check-details {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.check-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.check-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.check-time {
  font-size: 11px;
  color: var(--rr-muted);
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}
.check-fix-result {
  margin-top: 4px;
  font-size: 12.5px;
}
.check-edit-link {
  display: inline-block;
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--rr-accent);
}
.check-instructions {
  margin-top: 8px;
  padding: 10px 14px;
}
.check-link {
  display: inline-flex;
  align-items: center;
  font-size: 12.5px;
  color: var(--rr-accent);
  background: none;
  border: none;
  padding: 0;
  margin-top: 4px;
  cursor: pointer;
}
.check-output pre {
  margin-top: 6px;
  padding: 8px 10px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 6px;
}
.check-off .rr-row-title,
.check-off .rr-row-sub {
  color: var(--rr-muted);
}
.check-off-link {
  color: inherit;
}
</style>
