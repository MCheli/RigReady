<script setup lang="ts">
import { computed } from 'vue';
import type { History, SessionRecord } from '../contract';
import {
  clockText,
  durationText,
  fixTotalText,
  totalText,
  waitText,
  whenText,
} from '../core/sessionText';

/**
 * History: every session launched from RigReady, newest first, and what they add up to.
 * Read only: it changes nothing.
 */
const props = defineProps<{
  open: boolean;
  history?: History | undefined;
  /** Why the history could not be asked for at all. */
  error?: string | undefined;
}>();
const emit = defineEmits<{ close: [] }>();

const now = new Date();

const rows = computed(() =>
  (props.history?.sessions ?? []).map((session: SessionRecord) => {
    const started = new Date(session.startedAt);
    return {
      id: session.id,
      when: `${whenText(started, now)} ${clockText(started)}`,
      setup: session.profileName,
      game: session.gameName,
      length:
        session.durationSeconds === undefined ? 'not known' : durationText(session.durationSeconds),
      ready: session.readySeconds !== undefined ? waitText(session.readySeconds) : undefined,
      notReady: session.notReady === true,
      fixed: session.fixed.map((fix) => fix.title).join(', '),
      first: session.failedFirst,
    };
  })
);

const facts = computed(() => {
  const totals = props.history?.totals;
  if (!totals || totals.sessions === 0) return [];
  return [
    {
      id: 'sessions',
      label: totals.sessions === 1 ? 'Session' : 'Sessions',
      value: String(totals.sessions),
    },
    { id: 'time', label: 'In the game', value: totalText(totals.seconds) },
    ...(totals.readySeconds !== undefined
      ? [{ id: 'ready', label: 'Usually ready in', value: waitText(totals.readySeconds) }]
      : []),
    ...(totals.notReady > 0
      ? [{ id: 'not-ready', label: 'Launched not ready', value: String(totals.notReady) }]
      : []),
  ];
});

const fixes = computed(() => (props.history?.totals.fixes ?? []).slice(0, 4).map(fixTotalText));
const listed = computed(() => props.history?.sessions.length ?? 0);
</script>

<template>
  <v-dialog :model-value="open" max-width="860" scrollable @update:model-value="emit('close')">
    <v-card data-testid="history-dialog">
      <v-card-title>History</v-card-title>
      <v-card-text class="history">
        <v-alert v-if="error" type="error" variant="tonal" class="mb-3" data-testid="history-error">
          {{ error }}
        </v-alert>
        <v-alert
          v-if="history?.notice"
          type="warning"
          variant="tonal"
          class="mb-3"
          data-testid="history-notice"
        >
          {{ history.notice }}
        </v-alert>

        <div v-if="!history && !error" class="rr-muted">Reading the history…</div>

        <div v-else-if="history && rows.length === 0" class="rr-empty" data-testid="history-empty">
          <v-icon icon="mdi-history" size="34" class="mb-2" />
          <div>No sessions yet.</div>
          <div class="history-hint">
            Launch a game from the Play screen and its session is listed here once the game has
            closed: how long it was, how long the rig took to be ready, and what had to be fixed.
          </div>
        </div>

        <template v-else-if="history">
          <p class="history-line" data-testid="history-line">{{ history.line }}</p>
          <dl class="history-facts">
            <div v-for="fact in facts" :key="fact.id" :data-testid="`history-fact-${fact.id}`">
              <dt>{{ fact.label }}</dt>
              <dd>{{ fact.value }}</dd>
            </div>
          </dl>
          <div v-if="fixes.length" class="history-fixes">
            <div class="rr-section-title">Needed most often before launching</div>
            <ul data-testid="history-fixes">
              <li v-for="fix in fixes" :key="fix">{{ fix }}</li>
            </ul>
          </div>

          <div class="rr-section-title history-list-title">
            {{
              listed === history.totals.sessions ? 'Every session' : `The last ${listed} sessions`
            }}
          </div>
          <div class="rr-panel history-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Setup</th>
                  <th scope="col" class="history-num">Length</th>
                  <th scope="col" class="history-num">Ready in</th>
                  <th scope="col">Had to be fixed</th>
                  <th scope="col">First thing not met</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.id" data-testid="history-row">
                  <td class="history-when">{{ row.when }}</td>
                  <td class="history-setup">
                    {{ row.setup }}
                    <div v-if="row.game" class="history-sub">{{ row.game }}</div>
                  </td>
                  <td class="history-num">{{ row.length }}</td>
                  <td class="history-num">
                    <span v-if="row.notReady" class="rr-warn">not ready</span>
                    <template v-else>{{ row.ready ?? '–' }}</template>
                  </td>
                  <td>{{ row.fixed || 'nothing' }}</td>
                  <td>
                    <template v-if="row.first">
                      {{ row.first.title }}
                      <div class="history-sub">{{ row.first.summary }}</div>
                    </template>
                    <template v-else>–</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="history-close" @click="emit('close')">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.history {
  padding-top: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--rr-border) transparent;
}
.history-setup {
  white-space: nowrap;
}
.history-line {
  margin: 0 0 14px;
  font-size: 17px;
  font-weight: 500;
}
.history-hint {
  max-width: 460px;
  margin: 6px auto 0;
  font-size: 13px;
}
.history-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 36px;
  margin: 0 0 18px;
}
.history-facts dt {
  font-size: 12px;
  color: var(--rr-muted);
}
.history-facts dd {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}
.history-fixes {
  margin-bottom: 18px;
}
.history-fixes ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13.5px;
}
.history-list-title {
  margin-bottom: 6px;
}
.history-table {
  overflow-x: auto;
}
.history-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.history-table th {
  padding: 8px 12px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--rr-muted);
  white-space: nowrap;
}
.history-table td {
  padding: 8px 12px;
  border-top: 1px solid var(--rr-border);
  vertical-align: top;
}
.history-table .history-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.history-when {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.history-sub {
  font-size: 12px;
  color: var(--rr-muted);
}
</style>
