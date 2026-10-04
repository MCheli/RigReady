<script setup lang="ts">
import { computed, ref } from 'vue';
import UsageLine from './UsageLine.vue';
import { useAiStore } from './store';

/**
 * AI help (only with a key): a suggested setup for this aircraft on the user's devices,
 * reviewed line by line; questions about the setup; a drafted guide for aircraft that
 * have none. Every request is shown exactly before it is sent.
 */
const store = useAiStore();
const question = ref('');
const guide = computed(() => store.guide!);
const round = computed(() => store.round);

const EXAMPLES = [
  'What am I missing for carrier landings?',
  'Why is the pitch axis bound on more than one device?',
  'Which of my panels should take the start-up switches?',
];

const PRIORITY: Record<string, string> = {
  must: 'Must have',
  should: 'Should have',
  nice: 'Nice to have',
};

function ask(): void {
  void store.prepare('ask', { question: question.value });
}

const selectedCount = computed(() => store.selected.size);
</script>

<template>
  <div class="ai" data-testid="ai-help">
    <v-alert
      v-if="store.aiError"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="ai-request-error"
    >
      {{ store.aiError }}
    </v-alert>

    <div class="rr-panel ai-block">
      <div class="ai-block-head">
        <div>
          <div class="rr-row-title">
            Suggest a setup for the {{ guide.aircraftName }} on my devices
          </div>
          <div class="rr-row-sub">
            The model sees your controllers (names, what each is used as, buttons, hats and axes),
            this aircraft's actions with what is bound now, and the guide. You see exactly what is
            sent before it goes, and nothing is changed until you review and write it.
          </div>
        </div>
        <v-btn
          color="primary"
          prepend-icon="mdi-creation-outline"
          :disabled="store.sending"
          data-testid="ai-suggest"
          @click="store.prepare('suggest')"
        >
          Suggest a setup
        </v-btn>
      </div>
      <div v-if="store.sending" class="ai-sending" data-testid="ai-sending">
        <v-progress-circular indeterminate size="16" width="2" color="primary" /> Waiting for the
        answer. This can take a minute.
      </div>
    </div>

    <template v-if="round">
      <div class="rr-section-title">Suggestions</div>
      <div class="rr-panel ai-round" data-testid="ai-round">
        <p class="ai-summary" data-testid="ai-round-summary">{{ round.summary }}</p>
        <ul v-if="round.notes.length > 0" class="ai-notes">
          <li v-for="(n, i) in round.notes" :key="i">{{ n }}</li>
        </ul>
        <div
          v-for="s in round.suggestions"
          :key="s.id"
          class="rr-row ai-suggestion"
          data-testid="ai-suggestion"
          :data-action="s.dcsName"
        >
          <v-checkbox-btn
            :model-value="store.selected.has(s.id)"
            :aria-label="`Use: ${s.label}`"
            data-testid="ai-suggestion-tick"
            @update:model-value="store.toggle(s.id, $event === true)"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">
              {{ s.label }} → {{ s.deviceName }} · {{ s.inputLabel }}
              <span class="ai-priority">{{ PRIORITY[s.priority] }}</span>
            </div>
            <div class="rr-mono rr-muted ai-dcs">{{ s.dcsName }}</div>
            <div class="rr-row-sub">{{ s.reason }}</div>
            <div v-if="s.already" class="rr-muted ai-flag" data-testid="ai-flag-already">
              Already bound exactly like this.
            </div>
            <div
              v-if="s.replaces.length > 0"
              class="rr-warn ai-flag"
              data-testid="ai-flag-replaces"
            >
              Conflict: this control does {{ s.replaces.join(', ') }} now, which would stop.
            </div>
            <div v-if="s.clashesWith.length > 0" class="rr-bad ai-flag" data-testid="ai-flag-clash">
              Conflict: another suggestion uses the same control. Tick only one.
            </div>
          </div>
        </div>
        <div v-if="round.suggestions.length === 0" class="rr-empty">
          No usable suggestions in the answer.
        </div>
        <details v-if="round.dropped.length > 0" class="ai-dropped" data-testid="ai-dropped">
          <summary>
            {{ round.dropped.length }}
            {{ round.dropped.length === 1 ? 'line of the answer was' : 'lines of the answer were' }}
            left out because they did not check out
          </summary>
          <div v-for="(d, i) in round.dropped" :key="i" class="ai-dropped-line">
            <span class="rr-mono">{{ d.text }}</span> — {{ d.why }}
          </div>
        </details>
        <div class="ai-round-actions">
          <UsageLine :usage="round.usage" />
          <v-spacer />
          <v-btn
            color="primary"
            :disabled="selectedCount === 0"
            data-testid="ai-review-suggestions"
            @click="store.reviewSuggestions()"
          >
            Review {{ selectedCount }} {{ selectedCount === 1 ? 'change' : 'changes' }}
          </v-btn>
        </div>
      </div>
    </template>

    <div class="rr-section-title">Ask about this setup</div>
    <div class="rr-panel ai-block">
      <div class="ai-ask">
        <v-text-field
          v-model="question"
          density="compact"
          placeholder="Why is X bound here? What am I missing?"
          maxlength="600"
          aria-label="Question"
          data-testid="ai-question"
          @keyup.enter="ask"
        />
        <v-btn :disabled="!question.trim() || store.sending" data-testid="ai-ask" @click="ask"
          >Ask</v-btn
        >
      </div>
      <div class="ai-examples">
        <button
          v-for="e in EXAMPLES"
          :key="e"
          type="button"
          class="ai-example"
          @click="question = e"
        >
          {{ e }}
        </button>
      </div>
      <div v-for="(a, i) in store.answers" :key="i" class="ai-answer" data-testid="ai-answer">
        <div class="rr-row-title">{{ a.question }}</div>
        <p class="ai-answer-text">{{ a.text }}</p>
        <UsageLine :usage="a.usage" />
      </div>
    </div>

    <template v-if="!guide.guide || guide.guide.drafted">
      <div class="rr-section-title">A guide for this aircraft</div>
      <div class="rr-panel ai-block">
        <div class="ai-block-head">
          <div>
            <div class="rr-row-title">
              {{ guide.guide ? 'Draft the guide again' : 'Draft a guide' }} for the
              {{ guide.aircraftName }}
            </div>
            <div class="rr-row-sub">
              RigReady has no checked guide for this aircraft. The model can draft one in the same
              format, from this aircraft's own action list: priority tiers, what each control does
              and where it belongs. It is marked as drafted by AI wherever it is shown.
            </div>
          </div>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-creation-outline"
            data-testid="ai-draft"
            @click="store.prepare('draft')"
          >
            Draft a guide
          </v-btn>
        </div>
        <p v-if="store.drafted" class="rr-ok ai-drafted" data-testid="ai-drafted">
          {{ store.drafted }}
        </p>
        <v-btn
          v-if="guide.guide?.drafted"
          size="small"
          variant="text"
          data-testid="ai-delete-draft"
          @click="store.deleteDraft()"
        >
          Delete the drafted guide
        </v-btn>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ai-block {
  padding: 14px 16px;
  margin-bottom: 8px;
}
.ai-block-head {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}
.ai-sending {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
  font-size: 13px;
  color: var(--rr-accent);
}
.ai-round {
  padding: 4px 0 12px;
}
.ai-summary {
  padding: 12px 16px 0;
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}
.ai-notes {
  margin: 6px 16px 6px 34px;
  font-size: 13px;
  color: var(--rr-muted);
}
.ai-suggestion {
  align-items: flex-start;
}
.ai-suggestion > :deep(.v-selection-control) {
  flex: 0 0 auto;
}
.ai-priority {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--rr-accent);
  margin-left: 8px;
}
.ai-dcs {
  font-size: 11.5px;
}
.ai-flag {
  font-size: 12.5px;
  margin-top: 2px;
}
.ai-dropped {
  margin: 8px 16px 0;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.ai-dropped-line {
  margin: 2px 0 0 14px;
}
.ai-round-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 0;
}
.ai-ask {
  display: flex;
  gap: 10px;
  align-items: center;
}
.ai-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.ai-example {
  font-size: 12px;
  border: 1px solid var(--rr-border);
  border-radius: 12px;
  padding: 2px 10px;
  color: var(--rr-muted);
  background: none;
  cursor: pointer;
}
.ai-answer {
  border-top: 1px solid var(--rr-border);
  margin-top: 12px;
  padding-top: 10px;
}
.ai-answer-text {
  white-space: pre-wrap;
  font-size: 13.5px;
  line-height: 1.55;
  margin: 4px 0 6px;
}
.ai-drafted {
  font-size: 13px;
  margin: 10px 0 0;
}
</style>
