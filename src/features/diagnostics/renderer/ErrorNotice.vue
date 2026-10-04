<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useClient } from '../../../renderer/ipc';
import { diagnosticsContract, type ErrorReportView } from '../contract';

/**
 * The notice for errors nobody expected, on every screen. It never blocks: the app
 * stays usable behind it. Errors from main arrive as events; errors in this window
 * (an uncaught exception, a rejected promise, a component that failed) are sent to
 * main first, so they are logged, and come back the same way.
 */

const api = useClient(diagnosticsContract);
const router = useRouter();
const reports = ref<ErrorReportView[]>([]);
const copied = ref(false);
const copyProblem = ref<string>();

const latest = computed(() => reports.value[reports.value.length - 1]);
const total = computed(() => reports.value.reduce((sum, r) => sum + r.count, 0));

function show(report: ErrorReportView): void {
  copied.value = false;
  copyProblem.value = undefined;
  reports.value = [...reports.value.filter((r) => r.id !== report.id), report];
}

// An error that repeats on every frame must not flood main or the log.
let sentInWindow = 0;
let windowStart = 0;
let local = 0;

function describe(thrown: unknown): { message: string; detail?: string } {
  if (thrown instanceof Error) {
    return {
      message: thrown.message || thrown.name,
      ...(thrown.stack ? { detail: thrown.stack } : {}),
    };
  }
  return {
    message: typeof thrown === 'string' ? thrown : (JSON.stringify(thrown) ?? String(thrown)),
  };
}

async function report(thrown: unknown, context?: string): Promise<void> {
  const now = Date.now();
  if (now - windowStart > 10_000) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (++sentInWindow > 10) return;
  let described: { message: string; detail?: string };
  try {
    described = describe(thrown);
  } catch {
    // Something that cannot even be described (an object with a throwing getter).
    described = { message: 'An error that could not be described.' };
  }
  const detail = [described.detail, context].filter(Boolean).join('\n').slice(0, 20_000);
  const message = (described.message || 'Error').slice(0, 2000);
  const sent = await api.report({ message, ...(detail ? { detail } : {}) });
  // Main shows it through the event; when main cannot be reached it is shown from here.
  if (!sent.ok) {
    show({
      id: `local-${++local}`,
      time: new Date().toISOString(),
      source: 'window',
      message,
      ...(detail ? { detail } : {}),
      count: 1,
    });
  }
}

const onError = (event: ErrorEvent): void => {
  void report(event.error ?? event.message, `${event.filename}:${event.lineno}`);
};
const onRejection = (event: PromiseRejectionEvent): void => {
  void report(event.reason, 'unhandled promise rejection');
};

const off = api.on('error', show);
const appConfig = getCurrentInstance()?.appContext.config;
if (appConfig) {
  appConfig.errorHandler = (thrown, _instance, info) => {
    console.error(thrown);
    void report(thrown, `in ${info}`);
  };
}

onMounted(async () => {
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  // What happened before this window existed (while starting, or before it was reloaded).
  const pending = await api.errors();
  if (pending.ok) for (const item of pending.value) show(item);
});
onBeforeUnmount(() => {
  off();
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
});

async function copyDetails(): Promise<void> {
  const item = latest.value;
  if (!item) return;
  const result = await api.copyError({ id: item.id });
  if (result.ok) copied.value = true;
  else copyProblem.value = result.error.message;
}

async function dismiss(): Promise<void> {
  reports.value = [];
  // Whether or not main hears it, the notice goes away; it only matters after a reload.
  await api.dismissErrors();
}

function openDiagnostics(): void {
  void router.push('/configure/diagnostics');
}
</script>

<template>
  <div v-if="latest" class="error-notice rr-panel" role="alert" data-testid="error-notice">
    <div class="error-notice-head">
      <v-icon icon="mdi-alert-circle-outline" size="20" class="rr-bad" />
      <span class="error-notice-title" data-testid="error-notice-title">
        {{ total === 1 ? 'Something went wrong' : `${total} unexpected errors` }}
      </span>
      <v-btn
        icon="mdi-close"
        variant="text"
        size="x-small"
        aria-label="Dismiss"
        data-testid="error-notice-dismiss"
        @click="dismiss"
      />
    </div>
    <div class="error-notice-message" data-testid="error-notice-message">{{ latest.message }}</div>
    <div class="rr-row-sub">
      RigReady keeps running. The details are in the log.
      <span v-if="copyProblem" class="rr-bad">{{ copyProblem }}</span>
    </div>
    <div class="error-notice-actions">
      <v-btn
        v-if="!latest.id.startsWith('local-')"
        size="small"
        variant="tonal"
        :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'"
        data-testid="error-notice-copy"
        @click="copyDetails"
      >
        {{ copied ? 'Copied' : 'Copy details' }}
      </v-btn>
      <v-btn size="small" variant="text" data-testid="error-notice-open" @click="openDiagnostics">
        Open diagnostics
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.error-notice {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 3000;
  width: 380px;
  max-width: calc(100vw - 40px);
  padding: 12px 14px 12px 16px;
  border-color: color-mix(in srgb, var(--rr-bad) 55%, var(--rr-border));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.error-notice-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.error-notice-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
}
.error-notice-message {
  margin: 6px 0 4px;
  font-size: 13px;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.error-notice-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
</style>
