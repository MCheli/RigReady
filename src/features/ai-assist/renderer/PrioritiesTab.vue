<script setup lang="ts">
import { computed } from 'vue';
import type { ItemView } from '../core/model';
import { useAiStore } from './store';

/** The whole guide at a glance: tiers with status, and the plan per kind of device. */
const store = useAiStore();
const guide = computed(() => store.guide!);
const titles = computed(() => new Map(store.items.map((i) => [i.id, i.title])));

const counts = (items: ItemView[]) => ({
  bound: items.filter((i) => i.status === 'bound').length,
  total: items.filter((i) => i.status !== 'missing').length,
});
const dot = (i: ItemView): string =>
  i.status === 'bound'
    ? 'rr-ok'
    : i.status === 'partial'
      ? 'rr-warn'
      : i.status === 'unbound' && i.tier === 'must'
        ? 'rr-bad'
        : 'rr-muted';
</script>

<template>
  <div v-if="!guide.guide" class="rr-panel rr-empty" data-testid="ai-no-guide">
    There is no guide for the {{ guide.aircraftName }} yet.
  </div>
  <div v-else class="prio" data-testid="ai-priorities">
    <p class="prio-summary">{{ guide.guide.summary }}</p>

    <div
      v-for="tier in guide.tiers"
      :key="tier.tier"
      class="prio-tier"
      :data-testid="`ai-tier-${tier.tier}`"
    >
      <div v-if="tier.items.length > 0" class="rr-section-title prio-tier-title">
        {{ tier.title }}
        <span class="rr-muted">
          · {{ counts(tier.items).bound }} of {{ counts(tier.items).total }} bound
        </span>
      </div>
      <div v-if="tier.items.length > 0" class="rr-panel">
        <div
          v-for="i in tier.items"
          :key="i.id"
          class="rr-row prio-row"
          data-testid="ai-priority-item"
          :data-item="i.id"
          :data-status="i.status"
        >
          <v-icon icon="mdi-circle" size="10" :class="dot(i)" />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ i.title }}</div>
            <div class="rr-row-sub">{{ i.what }}</div>
            <div class="prio-labels">
              <span
                v-for="a in i.actions.slice(0, 6)"
                :key="a.actionId"
                class="prio-label"
                :title="a.dcsName"
              >
                {{ a.label }} <span class="rr-mono rr-muted">{{ a.dcsName }}</span>
              </span>
              <span v-if="i.actions.length > 6" class="rr-muted"
                >and {{ i.actions.length - 6 }} more</span
              >
            </div>
          </div>
          <div class="prio-place">
            {{ i.place === 'keyboard' ? 'Keyboard is fine' : i.roleTitle }}
          </div>
        </div>
      </div>
    </div>

    <div class="rr-section-title">Plan per device</div>
    <div class="prio-roles">
      <div
        v-for="role in guide.guide.roles"
        :key="role.role"
        class="rr-panel prio-role"
        data-testid="ai-role-plan"
        :data-role="role.role"
      >
        <div class="rr-row-title">{{ role.title }}</div>
        <p class="rr-row-sub">{{ role.summary }}</p>
        <ol class="prio-role-items">
          <li v-for="id in role.items" :key="id">{{ titles.get(id) ?? id }}</li>
        </ol>
      </div>
    </div>

    <div class="prio-sources rr-muted" data-testid="ai-sources">
      <div class="prio-sources-title">Where this guide comes from</div>
      <p v-for="(s, n) in guide.guide.sources" :key="n">{{ s }}</p>
    </div>
  </div>
</template>

<style scoped>
.prio-summary {
  font-size: 14.5px;
  line-height: 1.5;
  margin: 0 0 8px;
}
.prio-tier-title {
  margin-top: 18px;
}
.prio-row {
  align-items: flex-start;
}
.prio-row > .v-icon {
  margin-top: 6px;
}
.prio-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 4px;
  font-size: 12.5px;
}
.prio-label .rr-mono {
  font-size: 11px;
  margin-left: 4px;
}
.prio-place {
  font-size: 12.5px;
  color: var(--rr-muted);
  white-space: nowrap;
}
.prio-roles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.prio-role {
  padding: 14px 16px;
}
.prio-role p {
  margin: 4px 0 8px;
}
.prio-role-items {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
}
.prio-sources {
  margin-top: 24px;
  font-size: 12.5px;
}
.prio-sources-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.prio-sources p {
  margin: 0 0 4px;
}
</style>
