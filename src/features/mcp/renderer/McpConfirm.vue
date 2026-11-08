<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useClient } from '../../../renderer/ipc';
import { mcpContract } from '../contract';
import type { ActivityEntry } from '../core/activity';
import type { ConfirmRequest } from '../core/confirm';

/**
 * On every screen: the question an assistant's call raised ("Claude Code wants to make
 * DCS F/A-18C ready"), answered here and nowhere else, and a short line after an
 * assistant changed something or launched a game.
 */
const api = useClient(mcpContract);
const queue = ref<ConfirmRequest[]>([]);
const current = computed(() => queue.value[0]);
const left = ref(0);
const done = ref<ActivityEntry>();
const showDone = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  const q = current.value;
  if (!q) return;
  const ends = new Date(q.askedAt).getTime() + q.seconds * 1000;
  left.value = Math.max(0, Math.round((ends - Date.now()) / 1000));
}

async function answer(allow: boolean): Promise<void> {
  const q = current.value;
  if (!q) return;
  queue.value = queue.value.slice(1);
  await api.answer({ id: q.id, allow });
}

/**
 * Allows this change and stops asking about changes from now on (launches still ask):
 * an assistant setting a rig up makes many changes in a row, each backed up and undoable.
 * The same choice is "Ask before a launch only" in Settings, where it is changed back.
 */
async function allowAndStopAsking(): Promise<void> {
  await answer(true);
  await api.setOptions({ confirm: 'launchOnly' });
}

const offs: (() => void)[] = [];
onMounted(() => {
  void api.status().then((got) => {
    if (got.ok) queue.value = [...got.value.pending];
  });
  offs.push(
    api.on('confirm', (request) => {
      if (!queue.value.some((q) => q.id === request.id)) queue.value = [...queue.value, request];
    }),
    api.on('confirmSettled', ({ id }) => {
      queue.value = queue.value.filter((q) => q.id !== id);
    }),
    api.on('activity', (entry) => {
      if (entry.tier === 'read') return;
      done.value = entry;
      showDone.value = true;
    })
  );
  timer = setInterval(tick, 500);
});
onBeforeUnmount(() => {
  for (const off of offs) off();
  clearInterval(timer);
});
</script>

<template>
  <v-dialog :model-value="current !== undefined" max-width="480" persistent>
    <v-card v-if="current" data-testid="mcp-question">
      <v-card-title>{{ current.client }} asks</v-card-title>
      <v-card-text>
        <p class="mb-2" data-testid="mcp-question-summary">
          {{ current.tier === 'launch' ? 'Launch' : 'Change the rig' }}: {{ current.summary }}
        </p>
        <p class="rr-row-sub">
          Files RigReady changes are backed up first and can be undone on the Safety page. Without
          an answer this is a no in {{ left }} seconds.
        </p>
        <p v-if="current.tier === 'change'" class="rr-row-sub mt-2">
          <strong>Allow, and stop asking</strong> lets assistants make changes without asking from
          now on; a launch still asks. Settings &gt; AI assistants changes it back.
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="mcp-question-deny" @click="answer(false)">No</v-btn>
        <v-btn
          v-if="current.tier === 'change'"
          variant="text"
          data-testid="mcp-question-allow-always"
          @click="allowAndStopAsking()"
          >Allow, and stop asking</v-btn
        >
        <v-btn color="primary" variant="flat" data-testid="mcp-question-allow" @click="answer(true)"
          >Allow</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-snackbar v-model="showDone" timeout="6000" location="bottom right" data-testid="mcp-done">
    <template v-if="done">{{ done.client }}: {{ done.summary }}. {{ done.message }}</template>
  </v-snackbar>
</template>
