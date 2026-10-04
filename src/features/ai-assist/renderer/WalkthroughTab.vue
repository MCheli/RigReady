<script setup lang="ts">
import { computed } from 'vue';
import type { ItemView } from '../core/model';
import { useAiStore } from './store';

/**
 * "Bind this aircraft": tier by tier, one item at a time. Shows what the item does, when
 * you use it and where it belongs, what it is bound to now, and lets the user press the
 * control they want. Presses are staged; nothing is written until the review.
 */
const store = useAiStore();
const emit = defineEmits<{ open: [tab: string] }>();

const guide = computed(() => store.guide!);
const settled = computed(
  () => new Set([...guide.value.progress.done, ...guide.value.progress.skipped])
);
const doneCount = computed(
  () => store.items.filter((i) => guide.value.progress.done.includes(i.id)).length
);
const item = computed(() => store.item);
const stagedFor = (actionId: string) => guide.value.staged.find((s) => s.actionId === actionId);

const STATUS: Record<ItemView['status'], string> = {
  bound: 'Bound',
  partial: 'Partly bound',
  unbound: 'Not bound on a controller',
  missing: 'Not in this version of DCS',
};
const statusClass = (i: ItemView): string =>
  i.status === 'bound'
    ? 'rr-ok'
    : i.status === 'partial'
      ? 'rr-warn'
      : i.status === 'unbound' && i.tier === 'must'
        ? 'rr-bad'
        : 'rr-muted';

function mark(i: ItemView): string {
  if (guide.value.progress.done.includes(i.id)) return 'mdi-check-circle';
  if (guide.value.progress.skipped.includes(i.id)) return 'mdi-debug-step-over';
  return i.status === 'bound' ? 'mdi-circle' : 'mdi-circle-outline';
}

const position = computed(() => {
  const at = store.items.findIndex((i) => i.id === item.value?.id);
  return { at, total: store.items.length };
});
</script>

<template>
  <div v-if="!guide.guide" class="rr-panel rr-empty" data-testid="ai-no-guide">
    <v-icon icon="mdi-book-open-blank-variant" size="36" class="mb-3" />
    <div class="rr-row-title">There is no guide for the {{ guide.aircraftName }} yet</div>
    <div class="rr-row-sub">
      RigReady ships guides for the F/A-18C and the UH-1H. Guides are plain data files anyone can
      write (see the packs folder in RigReady's source).
      <template v-if="store.keyPresent">
        With your API key, AI help can draft one from this aircraft's own list of actions.
      </template>
    </div>
    <v-btn
      v-if="store.keyPresent"
      class="mt-4"
      color="primary"
      variant="tonal"
      prepend-icon="mdi-creation-outline"
      data-testid="ai-open-draft"
      @click="emit('open', 'ai')"
    >
      Draft a guide with AI
    </v-btn>
  </div>

  <div v-else class="walk" data-testid="ai-walkthrough">
    <div class="walk-progress">
      <div class="walk-progress-text" data-testid="ai-progress">
        {{ doneCount }} of {{ store.items.length }} done
        <span class="rr-muted">· saved as you go</span>
      </div>
      <v-progress-linear
        :model-value="store.items.length ? (100 * doneCount) / store.items.length : 0"
        color="primary"
        height="6"
        rounded
      />
      <v-alert
        v-if="guide.guide.drafted"
        type="info"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="ai-drafted-note"
      >
        This guide was drafted by AI ({{ guide.guide.drafted.by }}) and has not been checked by a
        person. Use it as a starting point.
      </v-alert>
    </div>

    <div class="walk-grid">
      <nav class="walk-list rr-panel" aria-label="Items">
        <template v-for="tier in guide.tiers" :key="tier.tier">
          <div v-if="tier.items.length > 0" class="walk-tier">{{ tier.title }}</div>
          <button
            v-for="i in tier.items"
            :key="i.id"
            type="button"
            class="walk-list-item"
            :class="{ active: i.id === item?.id, settled: settled.has(i.id) }"
            :data-testid="`ai-item-${i.id}`"
            @click="store.goTo(i.id)"
          >
            <v-icon :icon="mark(i)" size="14" :class="statusClass(i)" />
            <span>{{ i.title }}</span>
          </button>
        </template>
      </nav>

      <section
        v-if="item"
        class="walk-card rr-panel"
        data-testid="ai-current-item"
        :data-item="item.id"
      >
        <div class="walk-card-head">
          <div>
            <div class="walk-kicker">
              {{ guide.tiers.find((t) => t.tier === item!.tier)?.title }} · {{ position.at + 1 }} of
              {{ position.total }}
            </div>
            <h2 class="walk-title">{{ item.title }}</h2>
          </div>
          <span class="walk-status" :class="statusClass(item)" data-testid="ai-item-status">
            {{ STATUS[item.status] }}
          </span>
        </div>

        <p class="walk-what">{{ item.what }}</p>
        <div class="walk-facts">
          <div><span class="rr-muted">When</span> {{ item.when }}</div>
          <div>
            <span class="rr-muted">Where</span> {{ item.placeTitle }}
            <template v-if="item.place !== 'keyboard'">({{ item.roleTitle }})</template>
          </div>
          <div v-if="item.need === 'any' && item.actions.length > 1">
            <span class="rr-muted">Bind</span> any one of these is enough
          </div>
        </div>
        <p v-if="item.note" class="walk-note">
          <v-icon icon="mdi-lightbulb-on-outline" size="15" /> {{ item.note }}
        </p>

        <div class="walk-actions">
          <div
            v-for="a in item.actions"
            :key="a.actionId"
            class="walk-action"
            data-testid="ai-action"
            :data-action="a.dcsName"
          >
            <div class="walk-action-main">
              <div class="rr-row-title">{{ a.label }}</div>
              <div class="rr-mono rr-muted walk-dcs" title="DCS's own name">{{ a.dcsName }}</div>
              <div class="walk-bound">
                <span v-if="a.bound.length === 0" class="rr-muted">Not bound</span>
                <span
                  v-for="(b, n) in a.bound"
                  :key="n"
                  class="walk-chip"
                  :class="{ ignored: b.ignored }"
                  :title="
                    b.ignored
                      ? 'On a device marked as not used in DCS'
                      : b.source === 'default'
                        ? 'DCS default'
                        : 'Your binding'
                  "
                >
                  {{ b.text }}
                </span>
                <span
                  v-if="stagedFor(a.actionId)"
                  class="walk-chip staged"
                  data-testid="ai-action-staged"
                >
                  Adding {{ stagedFor(a.actionId)!.deviceName }} ·
                  {{ stagedFor(a.actionId)!.inputLabel }}
                  (staged)
                </span>
              </div>
              <p
                v-if="store.explanations[a.actionId]"
                class="walk-explained"
                data-testid="ai-explanation"
              >
                {{ store.explanations[a.actionId]!.text }}
              </p>
            </div>
            <v-btn
              v-if="store.keyPresent && !store.explanations[a.actionId]"
              size="small"
              variant="text"
              prepend-icon="mdi-creation-outline"
              data-testid="ai-explain"
              @click="store.prepare('explain', { actionId: a.actionId })"
            >
              Explain
            </v-btn>
            <template v-if="a.editable">
              <v-btn
                v-if="store.listeningFor !== a.actionId"
                size="small"
                variant="tonal"
                prepend-icon="mdi-gesture-tap-button"
                :disabled="store.listeningFor !== undefined"
                data-testid="ai-bind"
                @click="store.listen(a.actionId)"
              >
                Bind
              </v-btn>
              <div v-else class="walk-listening" data-testid="ai-listening">
                <v-progress-circular indeterminate size="16" width="2" color="primary" />
                Press the control
                <v-btn
                  size="x-small"
                  variant="text"
                  data-testid="ai-bind-cancel"
                  @click="store.stopListening()"
                >
                  Cancel
                </v-btn>
              </div>
            </template>
            <span v-else class="rr-muted walk-cannot" data-testid="ai-not-writable">
              Bind in DCS: RigReady cannot write this one yet
            </span>
          </div>
        </div>
        <p v-if="store.pressNote" class="rr-warn walk-press-note" data-testid="ai-press-note">
          {{ store.pressNote }}
        </p>

        <div class="walk-nav">
          <v-btn
            variant="text"
            :disabled="position.at <= 0"
            prepend-icon="mdi-chevron-left"
            data-testid="ai-prev"
            @click="store.goTo(store.items[position.at - 1]!.id)"
          >
            Back
          </v-btn>
          <v-spacer />
          <v-btn
            v-if="settled.has(item.id)"
            variant="text"
            data-testid="ai-reopen"
            @click="store.reopen(item.id)"
          >
            Mark not done
          </v-btn>
          <v-btn v-else variant="text" data-testid="ai-skip" @click="store.finish('skipped')">
            Skip
          </v-btn>
          <v-btn
            color="primary"
            append-icon="mdi-chevron-right"
            data-testid="ai-done"
            @click="store.finish('done')"
          >
            Done, next
          </v-btn>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.walk-progress {
  margin-bottom: 16px;
}
.walk-progress-text {
  font-size: 13px;
  margin-bottom: 6px;
}
.walk-grid {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  align-items: start;
}
.walk-list {
  padding: 8px 0;
  max-height: calc(100vh - 300px);
  overflow-y: auto;
  position: sticky;
  top: 12px;
}
.walk-tier {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--rr-muted);
  padding: 10px 14px 4px;
}
.walk-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 5px 14px;
  font-size: 13px;
  color: var(--rr-text);
  background: none;
  border: none;
  cursor: pointer;
}
.walk-list-item:hover {
  background: var(--rr-surface-2);
}
.walk-list-item.active {
  background: var(--rr-surface-2);
  box-shadow: inset 3px 0 0 var(--rr-accent);
}
.walk-list-item.settled span {
  color: var(--rr-muted);
}
.walk-card {
  padding: 18px 20px;
}
.walk-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.walk-kicker {
  font-size: 12px;
  color: var(--rr-muted);
}
.walk-title {
  font-size: 22px;
  font-weight: 600;
  margin: 2px 0 8px;
}
.walk-status {
  font-size: 12.5px;
  white-space: nowrap;
}
.walk-what {
  font-size: 15px;
  line-height: 1.5;
  margin: 0 0 10px;
}
.walk-facts {
  display: grid;
  gap: 4px;
  font-size: 13.5px;
  margin-bottom: 10px;
}
.walk-facts .rr-muted {
  display: inline-block;
  width: 52px;
}
.walk-note {
  font-size: 13px;
  color: var(--rr-muted);
  margin: 0 0 10px;
}
.walk-actions {
  border-top: 1px solid var(--rr-border);
  margin-top: 8px;
}
.walk-action {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--rr-border);
}
.walk-action-main {
  flex: 1;
  min-width: 0;
}
.walk-dcs {
  font-size: 11.5px;
}
.walk-bound {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  font-size: 12.5px;
}
.walk-chip {
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  padding: 0 6px;
  background: var(--rr-surface-2);
}
.walk-chip.ignored {
  opacity: 0.55;
  text-decoration: line-through;
}
.walk-chip.staged {
  border-color: var(--rr-accent);
  color: var(--rr-accent);
}
.walk-listening {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--rr-accent);
}
.walk-cannot {
  font-size: 12px;
  max-width: 170px;
  text-align: right;
}
.walk-explained {
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  margin: 6px 0 0;
  padding: 8px 10px;
  border-left: 2px solid var(--rr-accent);
  background: var(--rr-surface-2);
}
.walk-press-note {
  font-size: 13px;
  margin: 10px 0 0;
}
.walk-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
</style>
