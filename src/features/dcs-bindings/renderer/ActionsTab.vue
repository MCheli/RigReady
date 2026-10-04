<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BindingView, CommandView, DeviceView } from '../core/model';
import { useBindingsStore } from './store';

/** Every action of the aircraft, by category, with what is bound to it on every device. */
const store = useBindingsStore();
const view = computed(() => store.view!);
const search = ref('');
const filter = ref<'all' | 'bound' | 'unbound'>('all');
const category = ref('All categories');
const limit = ref(80);

interface Occurrence {
  device: DeviceView;
  binding: BindingView;
}

const byCommand = computed(() => {
  const map = new Map<string, Occurrence[]>();
  for (const device of view.value.devices) {
    for (const binding of device.bindings) {
      if (binding.inert) continue;
      map.set(binding.commandId, [...(map.get(binding.commandId) ?? []), { device, binding }]);
    }
  }
  return map;
});

const categoryOf = (command: CommandView): string =>
  command.unmatched ? 'Not in the current DCS defaults' : (command.category[0] ?? 'Other');

const categories = computed(() => [
  'All categories',
  ...[...new Set(view.value.commands.map(categoryOf))].sort((a, b) => a.localeCompare(b)),
]);

const matching = computed(() => {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  return view.value.commands.filter((command) => {
    const bound = (byCommand.value.get(command.id)?.length ?? 0) > 0;
    if (filter.value === 'bound' && !bound) return false;
    if (filter.value === 'unbound' && bound) return false;
    if (category.value !== 'All categories' && categoryOf(command) !== category.value) return false;
    const text =
      `${command.plain ?? ''} ${command.name} ${command.category.join(' ')}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
});

watch([search, filter, category], () => (limit.value = 80));

/** The visible actions, grouped by category in DCS's own order. */
const groups = computed(() => {
  const out: { title: string; commands: CommandView[] }[] = [];
  for (const command of matching.value.slice(0, limit.value)) {
    const title = categoryOf(command);
    const group = out.find((g) => g.title === title);
    if (group) group.commands.push(command);
    else out.push({ title, commands: [command] });
  }
  return out;
});

const summary = computed(() => {
  const p = view.value.problems;
  const bound = view.value.commands.filter((c) => (byCommand.value.get(c.id)?.length ?? 0) > 0);
  return {
    total: view.value.commands.length,
    bound: bound.length,
    conflicts: p.inputConflicts.length,
    duplicates: p.actionDuplicates.filter((d) => !d.expected).length,
  };
});

const shortName = (device: DeviceView): string =>
  device.type === 'keyboard'
    ? 'Keyboard'
    : (device.givenName ?? device.name.replace(/^WINWING /, ''));

function clear(command: CommandView, occurrence: Occurrence): void {
  if (!store.aircraftId) return;
  store.stage(
    {
      op: 'unbind',
      aircraft: store.aircraftId,
      deviceId: occurrence.device.id,
      commandId: command.id,
      combo: { key: occurrence.binding.combo.key, reformers: occurrence.binding.combo.reformers },
    },
    `${occurrence.device.name}: clear ${occurrence.binding.label} (${command.name})`
  );
}
</script>

<template>
  <div data-testid="bind-actions">
    <div class="act-bar">
      <v-text-field
        v-model="search"
        class="act-search"
        placeholder="Search actions, e.g. trim, flaps, TDC"
        prepend-inner-icon="mdi-magnify"
        clearable
        aria-label="Search actions"
        data-testid="act-search"
        @click:clear="search = ''"
      />
      <v-autocomplete
        v-model="category"
        variant="outlined"
        density="comfortable"
        hide-details="auto"
        auto-select-first
        class="act-category"
        :items="categories"
        aria-label="Category"
        data-testid="act-category"
      />
      <v-btn-toggle v-model="filter" mandatory density="comfortable" variant="outlined" divided>
        <v-btn value="all" size="small" data-testid="act-filter-all">All</v-btn>
        <v-btn value="bound" size="small" data-testid="act-filter-bound">Bound</v-btn>
        <v-btn value="unbound" size="small" data-testid="act-filter-unbound">Unbound</v-btn>
      </v-btn-toggle>
    </div>
    <div class="rr-row-sub act-summary" data-testid="act-summary">
      {{ matching.length }} of {{ summary.total }} actions shown · {{ summary.bound }} have
      something bound · {{ summary.conflicts }}
      {{ summary.conflicts === 1 ? 'input does' : 'inputs do' }} several things ·
      {{ summary.duplicates }} {{ summary.duplicates === 1 ? 'action is' : 'actions are' }} bound
      more than once
    </div>

    <div v-if="matching.length === 0" class="rr-panel rr-empty" data-testid="act-empty">
      No action matches. Try fewer words, another category, or "All".
    </div>

    <template v-for="group in groups" :key="group.title">
      <div class="rr-section-title act-group">{{ group.title }}</div>
      <div class="rr-panel">
        <div
          v-for="command in group.commands"
          :key="command.id"
          class="act-row"
          data-testid="act-row"
          :data-action="command.name"
        >
          <div class="act-name">
            <div class="rr-row-title" data-testid="act-title">
              {{ command.plain ?? command.name }}
            </div>
            <div v-if="command.plain" class="rr-row-sub" data-testid="act-dcs-name">
              DCS calls it: {{ command.name }}
            </div>
            <div class="rr-row-sub">
              {{ command.kind === 'axis' ? 'Axis' : 'Button' }}
              <template v-if="command.category.length > 1">
                · {{ command.category.slice(1).join(' · ') }}
              </template>
              <span v-if="!command.editable" class="rr-muted" data-testid="act-uneditable">
                · can only be bound in DCS for now
              </span>
            </div>
          </div>
          <div class="act-bindings">
            <span v-if="!byCommand.get(command.id)" class="rr-muted act-none">Not bound</span>
            <span
              v-for="occurrence in byCommand.get(command.id) ?? []"
              :key="occurrence.device.id + occurrence.binding.label"
              class="act-chip"
              :class="{ 'act-chip-default': occurrence.binding.source === 'default' }"
              data-testid="act-binding"
              :title="
                occurrence.binding.source === 'default'
                  ? `DCS default on ${occurrence.device.name}`
                  : occurrence.device.name
              "
            >
              <span class="act-chip-device">{{ shortName(occurrence.device) }}</span>
              {{ occurrence.binding.label }}
              <button
                v-if="occurrence.device.type === 'joystick' && command.editable"
                class="act-chip-x"
                :aria-label="`Clear ${occurrence.binding.label}`"
                data-testid="act-clear"
                @click="clear(command, occurrence)"
              >
                ×
              </button>
            </span>
          </div>
          <v-btn
            size="small"
            variant="tonal"
            :disabled="!command.editable"
            data-testid="act-bind"
            @click="store.bindRequest = { mode: 'bind', commandId: command.id }"
          >
            Bind
          </v-btn>
        </div>
      </div>
    </template>
    <div v-if="matching.length > limit" class="act-more">
      <v-btn variant="text" data-testid="act-more" @click="limit += 200">
        Show more ({{ matching.length - limit }} left)
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.act-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.act-search {
  flex: 1;
}
.act-category {
  flex: 0 0 240px;
}
.act-summary {
  margin-bottom: 8px;
}
.act-group {
  margin-top: 18px;
}
.act-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid var(--rr-border);
}
.act-row:first-child {
  border-top: none;
}
.act-name {
  flex: 0 0 38%;
  min-width: 0;
}
.act-bindings {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.act-none {
  font-size: 13px;
}
.act-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--rr-surface-2);
  border: 1px solid var(--rr-border);
}
.act-chip-default {
  border-style: dashed;
}
.act-chip-device {
  color: var(--rr-muted);
}
.act-chip-x {
  background: none;
  border: none;
  color: var(--rr-muted);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 0 0 1px;
}
.act-chip-x:hover {
  color: var(--rr-text);
}
.act-more {
  text-align: center;
  margin-top: 12px;
}
</style>
