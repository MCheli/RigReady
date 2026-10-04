<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { highlight } from '../shell/fuzzy';
import { moveActive, searchCommands } from '../shell/palette';
import type { ListedCommand } from '../shell/registry';
import { paletteOpen, usePaletteCommands } from '../shell/shell';

/**
 * The command palette (Ctrl+K): one field that finds every page and every command the
 * features offer. Arrow keys move, Enter runs, Escape closes and puts the focus back where
 * it was. A combobox with a listbox, so a screen reader hears each row as it is marked.
 */
const router = useRouter();
const palette = usePaletteCommands(router);

const query = ref('');
const active = ref(0);
const field = ref<HTMLInputElement>();
const list = ref<HTMLElement>();
/** What had the focus when the palette opened: it gets it back. */
let cameFrom: HTMLElement | null = null;
/** Set when a page was opened from here: the focus then goes to the new page, not back. */
let opened = false;

const sections = computed(() =>
  searchCommands(palette.commands.value, query.value, palette.recent.value)
);
/** The sections with every row numbered through, so the arrow keys cross headings. */
const numbered = computed(() => {
  let index = 0;
  return sections.value.map((section, at) => ({
    id: `rr-palette-group-${at}`,
    title: section.title,
    more: section.more ?? 0,
    rows: section.rows.map((row) => ({ ...row, index: index++ })),
  }));
});
const rows = computed(() => numbered.value.flatMap((section) => section.rows));
const typed = computed(() => query.value.trim() !== '');
const activeId = computed(() =>
  rows.value[active.value] ? `rr-palette-option-${active.value}` : undefined
);
const counted = computed(() => {
  const count = rows.value.length;
  if (!typed.value) return `${count} pages and commands`;
  return count === 1 ? '1 match' : `${count} matches`;
});

watch(query, () => {
  active.value = 0;
  if (list.value) list.value.scrollTop = 0;
});
// Commands that depend on the machine arrive a moment after the palette opens.
watch(rows, (now) => {
  if (active.value >= now.length) active.value = Math.max(0, now.length - 1);
});

watch(
  paletteOpen,
  (open) => {
    if (!open) {
      // Closed without opening a page: the focus goes back at once, not when the fade is over.
      if (!opened) back();
      return;
    }
    const focused = document.activeElement;
    cameFrom = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    opened = false;
    query.value = '';
    active.value = 0;
    void palette.refresh();
  },
  // Before anything is drawn: the element that has the focus now is the one to go back to.
  { flush: 'sync' }
);

function focusField(): void {
  field.value?.focus({ preventScroll: true });
}

/** Puts the focus back on what had it when the palette opened. */
function back(): void {
  const target = cameFrom;
  cameFrom = null;
  if (target?.isConnected) target.focus({ preventScroll: true });
  // Nothing to go back to: the field, still fading out, does not keep the keyboard.
  else field.value?.blur();
}

/** A page was opened: reading goes on at its heading, and Tab from there into the page. */
function intoPage(): void {
  cameFrom = null;
  const page =
    document.querySelector<HTMLElement>('.rr-page-title') ??
    document.querySelector<HTMLElement>('.rr-page');
  if (!page) return;
  if (!page.hasAttribute('tabindex')) page.setAttribute('tabindex', '-1');
  page.focus({ preventScroll: true });
}

function move(step: number): void {
  active.value = moveActive(active.value, step, rows.value.length);
  void nextTick(() =>
    list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  );
}

async function choose(command: ListedCommand | undefined): Promise<void> {
  if (!command || palette.isRunning(command.id)) return;
  opened = command.kind === 'page';
  paletteOpen.value = false;
  await palette.use(command);
  if (command.kind === 'page') await nextTick(intoPage);
}

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      move(1);
      break;
    case 'ArrowUp':
      move(-1);
      break;
    case 'PageDown':
      active.value = Math.min(rows.value.length - 1, active.value + 8);
      move(0);
      break;
    case 'PageUp':
      active.value = Math.max(0, active.value - 8);
      move(0);
      break;
    case 'Enter':
      void choose(rows.value[active.value]?.command);
      break;
    default:
      return;
  }
  event.preventDefault();
}
</script>

<template>
  <v-dialog
    v-model="paletteOpen"
    class="rr-palette-overlay rr-shell-dialog"
    content-class="rr-palette"
    max-width="640"
    transition="rr-dialog"
    aria-label="Command palette"
    data-testid="palette-dialog"
    @after-enter="focusField"
  >
    <div class="rr-palette-box" data-testid="palette">
      <div class="rr-palette-field">
        <v-icon icon="mdi-magnify" size="20" class="rr-palette-glass" />
        <input
          ref="field"
          v-model="query"
          class="rr-palette-input"
          type="text"
          role="combobox"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="Find a page or run a command"
          aria-label="Find a page or run a command"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          :aria-expanded="rows.length > 0"
          :aria-controls="rows.length > 0 ? 'rr-palette-list' : undefined"
          :aria-activedescendant="activeId"
          data-testid="palette-input"
          autofocus
          @keydown="onKeydown"
        />
        <kbd class="rr-kbd">Esc</kbd>
      </div>

      <div
        v-if="rows.length > 0"
        id="rr-palette-list"
        ref="list"
        class="rr-palette-list"
        role="listbox"
        aria-label="Pages and commands"
        data-testid="palette-list"
      >
        <div
          v-for="section in numbered"
          :key="section.id"
          role="group"
          :aria-labelledby="section.id"
          class="rr-palette-group"
        >
          <div
            :id="section.id"
            class="rr-palette-heading"
            :class="{ 'rr-sr-only': typed }"
            data-testid="palette-heading"
          >
            {{ section.title }}
          </div>
          <div
            v-for="row in section.rows"
            :id="`rr-palette-option-${row.index}`"
            :key="`${section.id}:${row.command.id}`"
            class="rr-palette-row"
            :class="{ active: row.index === active, running: palette.isRunning(row.command.id) }"
            role="option"
            :aria-selected="row.index === active"
            :aria-disabled="palette.isRunning(row.command.id) ? 'true' : undefined"
            :data-command="row.command.id"
            :data-kind="row.command.kind"
            :data-to="row.command.to"
            data-testid="palette-row"
            @mousemove="active = row.index"
            @click="choose(row.command)"
          >
            <v-icon
              :icon="row.command.icon ?? 'mdi-arrow-right'"
              size="18"
              class="rr-palette-icon"
            />
            <span class="rr-palette-title">
              <template v-for="(piece, at) in highlight(row.command.title, row.positions)" :key="at"
                ><mark v-if="piece.hit">{{ piece.text }}</mark
                ><template v-else>{{ piece.text }}</template></template
              >
            </span>
            <span v-if="palette.isRunning(row.command.id)" class="rr-palette-hint">
              Still running
            </span>
            <span v-else-if="row.command.hint" class="rr-palette-hint">{{ row.command.hint }}</span>
            <span v-if="typed && row.command.group !== row.command.hint" class="rr-palette-where">
              {{ row.command.kind === 'page' ? 'Page' : row.command.group }}
            </span>
          </div>
          <div v-if="section.more > 0" class="rr-palette-more" data-testid="palette-more">
            and {{ section.more }} more: type a name to find
            {{ section.more === 1 ? 'it' : 'them' }}
          </div>
        </div>
      </div>
      <div v-else class="rr-palette-none" role="status" data-testid="palette-none">
        Nothing matches “{{ query.trim() }}”. Try the name of a page, a setup or an aircraft.
      </div>

      <div
        v-for="problem in palette.problems.value"
        :key="problem"
        class="rr-palette-problem"
        data-testid="palette-problem"
      >
        <v-icon icon="mdi-alert-outline" size="15" /> Not listed: {{ problem }}
      </div>

      <div class="rr-palette-foot">
        <span><kbd class="rr-kbd">↑</kbd><kbd class="rr-kbd">↓</kbd> move</span>
        <span><kbd class="rr-kbd">Enter</kbd> open or run</span>
        <span><kbd class="rr-kbd">Esc</kbd> close</span>
        <span class="rr-palette-count" role="status" aria-live="polite" data-testid="palette-count">
          {{ counted }}
        </span>
      </div>
    </div>
  </v-dialog>
</template>

<style>
/* Near the top of the window, where the eye already is after Ctrl+K, not in the middle. */
.rr-palette-overlay.v-overlay {
  align-items: flex-start;
}
.rr-palette-overlay .rr-palette {
  margin-top: min(13vh, 120px);
}
.rr-palette-box {
  display: flex;
  flex-direction: column;
  max-height: min(70vh, 620px);
  background: var(--rr-surface);
  border-radius: 12px;
  box-shadow: var(--rr-elev-2);
  overflow: hidden;
}
.rr-palette-field {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 16px;
  border-bottom: 1px solid var(--rr-border);
}
.rr-palette-glass {
  color: var(--rr-muted);
  flex: none;
}
.rr-palette-input {
  flex: 1;
  min-width: 0;
  height: 52px;
  background: none;
  border: none;
  outline: none;
  color: var(--rr-text);
  font: inherit;
  font-size: 16px;
}
.rr-palette-input::placeholder {
  color: var(--rr-muted);
  opacity: 1;
}
.rr-palette-list {
  overflow-y: auto;
  padding: 6px 6px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--rr-border-strong) transparent;
}
.rr-palette-heading {
  padding: 10px 10px 4px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rr-muted);
}
.rr-palette-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 6px 10px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 14px;
}
.rr-palette-row.active {
  background: var(--rr-surface-2);
}
/* The marked row carries a line as well as a tint: it is found without telling shades apart. */
.rr-palette-row.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 2px;
  background: var(--rr-accent);
}
.rr-palette-row.running {
  cursor: default;
}
.rr-palette-icon {
  flex: none;
  color: var(--rr-muted);
}
.rr-palette-row[data-kind='action'] .rr-palette-icon {
  color: var(--rr-accent);
}
.rr-palette-title {
  flex: none;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rr-text);
}
.rr-palette-title mark {
  background: none;
  color: var(--rr-accent);
  font-weight: 600;
}
.rr-palette-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.rr-palette-where {
  flex: none;
  margin-left: auto;
  font-size: 11.5px;
  color: var(--rr-muted);
  border: 1px solid var(--rr-border);
  border-radius: 5px;
  padding: 0 6px;
  line-height: 18px;
}
.rr-palette-more {
  padding: 4px 10px 2px 38px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.rr-palette-none {
  padding: 28px 20px;
  text-align: center;
  font-size: 14px;
  color: var(--rr-muted);
}
.rr-palette-problem {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 12.5px;
  color: var(--rr-muted);
  border-top: 1px solid var(--rr-border);
}
.rr-palette-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--rr-border);
  background: var(--rr-bg);
  font-size: 12px;
  color: var(--rr-muted);
}
.rr-palette-foot .rr-kbd {
  margin-right: 4px;
}
.rr-palette-count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
</style>
