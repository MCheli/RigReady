<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import ManualLink from '../../../renderer/components/ManualLink.vue';
import type { SavedScript } from '../core/assistantModel';
import { useAssistantStore } from './assistantStore';
import {
  budgetLine,
  dollars,
  flow,
  PANEL_WIDTH,
  panelWidth,
  sizeLine,
  spendLine,
  usageLine,
  workingLine,
  type FlowItem,
} from './assistantText';
import { monthWarning, NOT_A_BILL } from './estimateText';
import { MarkdownText } from './markdownView';

/**
 * The built-in assistant, on every screen: a chat column at the side, opened from the app bar
 * or the command palette.
 *
 * One region scrolls: the conversation, which fills the height. What the assistant proposes
 * (a setup, a script, the line that says it was saved) is shown in the conversation where it
 * was made. The foot is pinned: what the assistant is doing right now with Stop, or the
 * request that waits for Send with what it carries, then the box. Nothing of a reply is ever
 * put on the page as HTML: `MarkdownText` builds it from text.
 *
 * Room left on purpose, nothing built: files given as context would be a row of chips right
 * above the box (see the comment in the form), and further kinds of work ("reading a file",
 * "looking this up") are further phases of the one working line.
 */
const store = useAssistantStore();
const router = useRouter();

const PHASES: Record<string, string> = {
  preLaunch: 'Before launch',
  postLaunch: 'After launch',
  standDown: 'At Stand down',
};
const TIERS: Record<string, string> = {
  read: 'read',
  change: 'change',
  launch: 'launch',
  off: 'not offered',
};

// ---- what is shown, in order ------------------------------------------------------------

/** One thing in the column: the conversation's own, then what waits from elsewhere. */
type Row =
  | FlowItem
  | { kind: 'pending'; key: string; text: string }
  | { kind: 'heading'; key: string }
  | { kind: 'changed'; key: string; script: SavedScript };

const rows = computed<Row[]>(() => {
  const shown = flow(store.conversation?.entries ?? [], store.drafts, store.saved);
  const out: Row[] = [...shown.conversation];
  // The message on its way, until the conversation holds it.
  if (store.pendingText !== undefined) {
    out.push({ kind: 'pending', key: 'pending', text: store.pendingText });
  }
  // Not from this conversation: drafted by another AI client or earlier, and scripts that
  // changed since they were approved.
  const drafts = shown.waiting.filter((item) => item.kind !== 'saved');
  if (drafts.length > 0 || store.waitingScripts.length > 0) {
    out.push({ kind: 'heading', key: 'heading' });
  }
  out.push(...drafts);
  for (const script of store.waitingScripts) {
    out.push({ kind: 'changed', key: `changed:${script.file}`, script });
  }
  out.push(...shown.waiting.filter((item) => item.kind === 'saved'));
  return out;
});
const nothingYet = computed(() => !store.conversation && store.pendingText === undefined);
const budget = computed(() => (store.preview ? budgetLine(store.preview) : ''));
const spend = computed(() => spendLine(store.progress));
const usage = computed(() => (store.conversation ? usageLine(store.conversation.usage) : ''));
/** Said only when the month is close to its budget; the stop itself arrives as a refusal. */
const monthNote = computed(() => monthWarning(store.preview?.month ?? null));
/** A dollar figure is on show somewhere in the foot: it is said once that it is no bill. */
const figures = computed(() =>
  [
    store.preview ? sizeLine(store.preview) : '',
    budget.value,
    monthNote.value,
    spend.value,
    usage.value,
  ].some((line) => line.includes('$'))
);
/** The request on screen is for the very message in the box: its Send is the button to press. */
const boxReady = computed(
  () => store.preview?.text !== undefined && store.preview.text === store.draft.trim()
);

const exactOpen = ref(false);
const shownExact = ref<Record<string, boolean>>({});
const openTools = ref<Record<string, boolean>>({});

watch(
  () => store.preview?.requestId,
  () => (exactOpen.value = false)
);
watch(
  () => store.conversation?.conversationId,
  () => (openTools.value = {})
);

// ---- keeping the newest in view -----------------------------------------------------------

const list = ref<HTMLElement>();
/** True while the newest is in view: only then does the column move by itself. */
const following = ref(true);

function onScroll(): void {
  const el = list.value;
  if (!el) return;
  following.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

async function follow(force = false): Promise<void> {
  if (force) following.value = true;
  if (!following.value) return;
  await nextTick();
  const el = list.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/** Something was opened or closed by hand: where the reader is now decides. */
async function reflowed(): Promise<void> {
  await nextTick();
  onScroll();
}

watch(
  () => rows.value.map((row) => row.key).join('|'),
  () => void follow()
);
// A message was just sent, or the panel was just opened: the newest is what is looked for.
watch(
  () => store.sending,
  (sending) => {
    if (sending) void follow(true);
  }
);
watch(
  () => store.open,
  (open) => {
    if (!open) return;
    void store.refreshStatus();
    void store.refreshDrafts();
    void follow(true);
  }
);
// The foot grew or shrank (a request is shown, the box got taller): the column's end stays
// in view when it was.
watch(
  list,
  (el, _before, onCleanup) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (following.value) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  },
  { immediate: true, flush: 'post' }
);

// ---- the panel's width --------------------------------------------------------------------

const WIDTH_KEY = 'rigready.assistant.width';

function readWidth(): number {
  try {
    return Number.parseInt(window.localStorage.getItem(WIDTH_KEY) ?? '', 10);
  } catch {
    // Storage is switched off for this window: the usual width.
    return Number.NaN;
  }
}

/** The width asked for; not a number means the usual width. */
const wanted = ref(readWidth());
const windowWidth = ref(window.innerWidth);
const width = computed(() => panelWidth(wanted.value, windowWidth.value));
const widest = computed(() => panelWidth(PANEL_WIDTH.max, windowWidth.value));
const resizing = ref(false);

function keepWidth(): void {
  wanted.value = width.value;
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width.value));
  } catch {
    // Storage is full or switched off: the width holds for as long as the window is open.
  }
}

function gripDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  resizing.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}

function gripMove(event: PointerEvent): void {
  if (resizing.value) wanted.value = window.innerWidth - event.clientX;
}

function gripUp(event: PointerEvent): void {
  if (!resizing.value) return;
  resizing.value = false;
  const grip = event.currentTarget as HTMLElement;
  if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
  keepWidth();
}

function gripKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') wanted.value = width.value + PANEL_WIDTH.step;
  else if (event.key === 'ArrowRight') wanted.value = width.value - PANEL_WIDTH.step;
  else if (event.key === 'Home') wanted.value = PANEL_WIDTH.max;
  else if (event.key === 'End') wanted.value = PANEL_WIDTH.min;
  else return;
  event.preventDefault();
  keepWidth();
}

function usualWidth(): void {
  wanted.value = Number.NaN;
  try {
    window.localStorage.removeItem(WIDTH_KEY);
  } catch {
    // Nothing was stored.
  }
}

const onWindowResize = (): void => {
  windowWidth.value = window.innerWidth;
};
onMounted(() => window.addEventListener('resize', onWindowResize));
onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize));

// ---- what the buttons do ------------------------------------------------------------------

function submit(): void {
  void store.prepare();
}

function onEnter(event: KeyboardEvent): void {
  // Enter that only confirms a composed character (an input method) is not a Send.
  if (event.isComposing) return;
  event.preventDefault();
  submit();
}

function toggleTool(key: string): void {
  openTools.value = { ...openTools.value, [key]: !openTools.value[key] };
  void reflowed();
}

function toggleExact(id: string): void {
  shownExact.value = { ...shownExact.value, [id]: !shownExact.value[id] };
  void reflowed();
}

async function openSetup(id: string): Promise<void> {
  store.open = false;
  await router.push(`/configure/profiles/${id}`);
}

async function openSettings(): Promise<void> {
  store.open = false;
  await router.push('/configure/settings');
}

/** From the budget's stop: the panel gets out of the way and Settings shows the monthly budget. */
async function openBudget(): Promise<void> {
  store.showBudget = true;
  store.open = false;
  await router.push('/configure/settings');
}
</script>

<template>
  <v-navigation-drawer
    v-model="store.open"
    location="right"
    temporary
    touchless
    :width="width"
    class="asp"
    :class="{ 'asp-resizing': resizing }"
    data-testid="assistant-panel"
  >
    <div class="asp-wrap">
      <div
        class="asp-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Width of the assistant panel"
        :aria-valuenow="width"
        :aria-valuemin="PANEL_WIDTH.min"
        :aria-valuemax="widest"
        tabindex="0"
        title="Drag to change the width. Double-click for the usual width."
        data-testid="assistant-resize"
        @pointerdown="gripDown"
        @pointermove="gripMove"
        @pointerup="gripUp"
        @pointercancel="gripUp"
        @keydown="gripKey"
        @dblclick="usualWidth"
      />

      <header class="asp-head">
        <h2 class="asp-title">Assistant</h2>
        <v-btn
          v-if="store.conversation || store.preview"
          variant="text"
          size="small"
          prepend-icon="mdi-plus"
          data-testid="assistant-new"
          @click="store.newConversation()"
          >New conversation</v-btn
        >
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          aria-label="Close the assistant"
          data-testid="assistant-close"
          @click="store.open = false"
        />
      </header>

      <div class="asp-body">
        <!-- The one region that scrolls. -->
        <div
          ref="list"
          class="asp-list"
          role="log"
          aria-label="Conversation with the assistant"
          tabindex="0"
          data-testid="assistant-conversation"
          @scroll.passive="onScroll"
        >
          <div v-if="!store.keyPresent" class="asp-empty" data-testid="assistant-no-key">
            <p>
              To talk to the assistant, choose an AI provider in Settings, under AI: your own key,
              or a model on this PC. What assistants drafted is below either way.
            </p>
            <v-btn
              variant="tonal"
              size="small"
              data-testid="assistant-settings"
              @click="openSettings"
              >Open Settings</v-btn
            >
          </div>
          <div v-else class="asp-intro">
            <p data-testid="assistant-promise">
              Every request is shown before it is sent. A change is asked in RigReady first, unless
              Settings says not to ask. What it drafts is saved only when you press Save.
              <ManualLink page="ai/built-in-assistant">How it works</ManualLink>
            </p>
            <p v-if="nothingYet" data-testid="assistant-examples">
              Ask for help with your rig: "Make my setup start Stream Deck and TrackIR", "Why is my
              rig not ready?", "Write a check that SimHub answers on its port".
            </p>
          </div>

          <template v-for="row in rows" :key="row.key">
            <template v-if="row.kind === 'entry'">
              <div
                v-if="row.entry.kind === 'user'"
                class="asp-msg asp-user"
                data-testid="assistant-user"
              >
                {{ row.entry.text }}
              </div>
              <div
                v-else-if="row.entry.kind === 'assistant'"
                class="asp-msg asp-bot"
                data-testid="assistant-reply"
              >
                <MarkdownText :source="row.entry.text" />
              </div>
              <div
                v-else-if="row.entry.kind === 'tool'"
                class="asp-tool"
                :class="{ 'asp-tool-open': openTools[row.key] }"
                :data-ok="row.entry.ok"
                data-testid="assistant-tool"
              >
                <button
                  type="button"
                  class="asp-tool-row"
                  :disabled="!row.entry.answer"
                  :aria-expanded="row.entry.answer ? !!openTools[row.key] : undefined"
                  :title="row.entry.answer ? 'Show what it answered' : undefined"
                  @click="toggleTool(row.key)"
                >
                  <v-icon
                    :icon="row.entry.ok ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'"
                    :class="row.entry.ok ? 'rr-ok' : 'rr-warn'"
                    size="15"
                  />
                  <span class="asp-tool-name">{{ row.entry.title }}</span>
                  <span
                    class="asp-tool-tier"
                    :data-tier="row.entry.tier"
                    data-testid="assistant-tool-tier"
                    >{{ TIERS[row.entry.tier] }}</span
                  >
                  <span class="asp-tool-line">{{
                    row.entry.ok ? row.entry.line : `Did not run: ${row.entry.line}`
                  }}</span>
                  <v-icon
                    v-if="row.entry.answer"
                    :icon="openTools[row.key] ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                    size="16"
                    class="asp-tool-chevron"
                  />
                </button>
                <div v-if="openTools[row.key] && row.entry.answer" class="asp-tool-more">
                  <div class="asp-muted">
                    What it answered, as it is sent with the next request{{
                      row.entry.channel ? ` (${row.entry.channel})` : ''
                    }}:
                  </div>
                  <pre class="asp-pre rr-mono" data-testid="assistant-tool-answer">{{
                    row.entry.answer
                  }}</pre>
                </div>
              </div>
              <div v-else class="asp-note" data-testid="assistant-note">
                <v-icon icon="mdi-information-outline" size="15" />
                <span>{{ row.entry.text }}</span>
              </div>
            </template>

            <div
              v-else-if="row.kind === 'pending'"
              class="asp-msg asp-user asp-user-pending"
              data-testid="assistant-user-pending"
            >
              {{ row.text }}
            </div>

            <div v-else-if="row.kind === 'heading'" class="asp-section">Waiting for you</div>

            <!-- What an assistant drafted: nothing of it is saved until Save is pressed here. -->
            <section
              v-else-if="row.kind === 'setup'"
              class="asp-card"
              data-testid="assistant-setup-draft"
            >
              <div class="asp-card-title">
                <v-icon icon="mdi-clipboard-check-outline" size="17" />
                {{
                  row.draft.target.kind === 'new'
                    ? `New setup: ${row.draft.target.name}`
                    : `Changes to ${row.draft.target.name}`
                }}
              </div>
              <p class="asp-card-sub">
                {{ row.draft.summary }} <span class="asp-by">From {{ row.draft.by }}.</span>
              </p>
              <ul class="asp-items">
                <li
                  v-for="(c, i) in row.draft.checks"
                  :key="`c${i}`"
                  data-testid="assistant-draft-check"
                >
                  <strong>{{ c.title }}</strong> <span class="asp-muted">{{ c.type }}</span>
                  <div class="asp-detail rr-mono">{{ c.detail }}</div>
                  <div v-if="c.fix" class="asp-detail rr-mono">Fix: {{ c.fix }}</div>
                </li>
                <li
                  v-for="(s, i) in row.draft.steps"
                  :key="`s${i}`"
                  data-testid="assistant-draft-step"
                >
                  <strong>{{ s.title }}</strong>
                  <span class="asp-muted"> {{ PHASES[s.phase] }} · {{ s.type }}</span>
                  <div class="asp-detail rr-mono">{{ s.detail }}</div>
                </li>
              </ul>
              <pre v-if="shownExact[row.draft.id]" class="asp-pre rr-mono">{{
                row.draft.exact
              }}</pre>
              <p v-if="store.draftErrors[row.draft.id]" class="asp-error rr-bad" role="alert">
                <v-icon icon="mdi-alert-circle-outline" size="15" />
                <span>{{ store.draftErrors[row.draft.id] }}</span>
              </p>
              <div class="asp-actions">
                <v-btn
                  color="primary"
                  variant="flat"
                  size="small"
                  data-testid="assistant-setup-save"
                  @click="store.saveSetup(row.draft.id)"
                  >Save</v-btn
                >
                <v-btn variant="text" size="small" @click="store.discard(row.draft.id)"
                  >Discard</v-btn
                >
                <v-spacer />
                <v-btn
                  size="small"
                  variant="text"
                  :prepend-icon="shownExact[row.draft.id] ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                  :aria-expanded="!!shownExact[row.draft.id]"
                  @click="toggleExact(row.draft.id)"
                  >{{
                    shownExact[row.draft.id]
                      ? 'Hide the setup as it would be saved'
                      : 'Show the setup as it would be saved'
                  }}</v-btn
                >
              </div>
            </section>

            <section
              v-else-if="row.kind === 'script'"
              class="asp-card"
              data-testid="assistant-script-draft"
            >
              <div class="asp-card-title">
                <v-icon icon="mdi-script-text-outline" size="17" /> Script:
                {{ row.draft.fileName }}
              </div>
              <p class="asp-card-sub" data-testid="assistant-script-explanation">
                {{ row.draft.explanation }} <span class="asp-by">From {{ row.draft.by }}.</span>
              </p>
              <p v-if="row.draft.use" class="asp-muted">
                Goes into {{ row.draft.use.setup }} as
                {{
                  row.draft.use.as === 'check'
                    ? 'a check'
                    : row.draft.use.as === 'fix'
                      ? `the fix of ${row.draft.use.forCheck}`
                      : PHASES[row.draft.use.as]?.toLowerCase()
                }}: "{{ row.draft.use.title }}". It asks before every run.
              </p>
              <ul
                v-if="row.draft.warnings.length > 0 || row.draft.replaces"
                class="asp-warn rr-warn"
              >
                <li v-for="w in row.draft.warnings" :key="w">{{ w }}</li>
                <li v-if="row.draft.replaces">Replaces the script of the same name.</li>
              </ul>
              <div class="asp-muted">
                The whole file, as it would be saved at {{ row.draft.stored }}:
              </div>
              <pre class="asp-pre rr-mono" data-testid="assistant-script-text">{{
                row.draft.text
              }}</pre>
              <p v-if="store.draftErrors[row.draft.id]" class="asp-error rr-bad" role="alert">
                <v-icon icon="mdi-alert-circle-outline" size="15" />
                <span>{{ store.draftErrors[row.draft.id] }}</span>
              </p>
              <div class="asp-actions">
                <v-btn
                  color="primary"
                  variant="flat"
                  size="small"
                  data-testid="assistant-script-save"
                  @click="store.saveScript(row.draft.id)"
                  >Save</v-btn
                >
                <v-btn variant="text" size="small" @click="store.discard(row.draft.id)"
                  >Discard</v-btn
                >
              </div>
            </section>

            <section
              v-else-if="row.kind === 'changed'"
              class="asp-card asp-card-warn"
              data-testid="assistant-script-changed"
            >
              <div class="asp-card-title">
                <v-icon icon="mdi-alert-outline" size="17" />
                {{
                  row.script.state === 'changed'
                    ? `${row.script.file} changed since you approved it`
                    : `${row.script.file} is not approved`
                }}
              </div>
              <p class="asp-card-sub">
                RigReady does not run it until you have read it as it is now and approved it.
              </p>
              <pre class="asp-pre rr-mono" data-testid="assistant-script-current">{{
                row.script.text
              }}</pre>
              <p v-if="store.draftErrors[row.script.file]" class="asp-error rr-bad" role="alert">
                <v-icon icon="mdi-alert-circle-outline" size="15" />
                <span>{{ store.draftErrors[row.script.file] }}</span>
              </p>
              <div class="asp-actions">
                <v-btn
                  color="primary"
                  variant="flat"
                  size="small"
                  data-testid="assistant-script-approve"
                  @click="store.approve(row.script)"
                  >Approve it as shown</v-btn
                >
              </div>
            </section>

            <div v-else class="asp-saved" role="status" data-testid="assistant-saved">
              <v-icon icon="mdi-check-circle-outline" size="15" class="rr-ok" />
              <span>{{ row.done.message }}</span>
              <v-btn
                v-if="row.done.setupId"
                size="small"
                variant="text"
                data-testid="assistant-open-setup"
                @click="openSetup(row.done.setupId)"
                >Open in the setup editor</v-btn
              >
            </div>
          </template>
        </div>

        <v-btn
          v-if="!following"
          class="asp-newest"
          size="small"
          variant="elevated"
          prepend-icon="mdi-arrow-down"
          data-testid="assistant-newest"
          @click="follow(true)"
          >Newest</v-btn
        >
      </div>

      <footer v-if="store.footShown" class="asp-foot">
        <!-- What it is doing right now. Other kinds of work (reading a file, looking something
             up) would be further phases of this one line. -->
        <div v-if="store.sending" class="asp-working" role="status" data-testid="assistant-working">
          <v-progress-circular indeterminate size="16" width="2" />
          <div class="asp-working-text">
            <div>{{ store.stopped ? 'Stopping' : workingLine(store.progress) }}</div>
            <div v-if="spend" class="asp-muted" data-testid="assistant-spend">{{ spend }}</div>
          </div>
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-stop"
            :disabled="store.stopped"
            data-testid="assistant-stop"
            @click="store.stop()"
            >Stop</v-btn
          >
        </div>

        <!-- The request that waits: what it carries, and the exact text a click away. -->
        <section
          v-else-if="store.preview"
          class="asp-preview"
          :class="{ 'asp-preview-over': store.preview.overCeiling }"
          data-testid="assistant-preview"
        >
          <div class="asp-preview-head">
            <v-icon icon="mdi-send-outline" size="16" />
            <span>Ready to send to {{ store.preview.to }}</span>
            <span class="asp-muted">{{ store.preview.model }}</span>
          </div>
          <div class="asp-muted" data-testid="assistant-preview-size">
            {{ sizeLine(store.preview) }}
          </div>
          <div
            v-if="budget"
            :class="store.preview.overCeiling ? 'asp-over rr-warn' : 'asp-muted'"
            data-testid="assistant-budget"
          >
            {{ budget }}
          </div>
          <div v-if="monthNote" class="asp-over rr-warn" data-testid="assistant-month">
            {{ monthNote }}
          </div>
          <ul class="asp-contents" data-testid="assistant-preview-contents">
            <li v-for="(c, i) in store.preview.contents" :key="i">{{ c }}</li>
          </ul>
          <template v-if="exactOpen">
            <p class="asp-muted">
              Nothing else: no files and no keys. Paths in what the tools answered name your user
              folder as {USER}.
            </p>
            <pre
              class="asp-pre asp-pre-capped rr-mono"
              tabindex="0"
              data-testid="assistant-preview-body"
              >{{ store.preview.body }}</pre>
          </template>
          <div class="asp-actions">
            <v-btn
              v-if="store.preview.overCeiling"
              color="primary"
              variant="flat"
              size="small"
              data-testid="assistant-continue-past"
              @click="store.send(true)"
              >Continue past {{ dollars(store.preview.ceiling ?? 0) }}</v-btn
            >
            <v-btn
              v-else
              color="primary"
              variant="flat"
              size="small"
              data-testid="assistant-send"
              @click="store.send()"
              >{{ store.failed ? 'Try again' : 'Send' }}</v-btn
            >
            <v-btn variant="text" size="small" data-testid="assistant-discard" @click="store.drop()"
              >Don't send</v-btn
            >
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              :prepend-icon="exactOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'"
              :aria-expanded="exactOpen"
              data-testid="assistant-preview-toggle"
              @click="exactOpen = !exactOpen"
              >{{ exactOpen ? 'Hide the exact request' : 'Show the exact request' }}</v-btn
            >
          </div>
          <v-checkbox
            v-model="store.skipPreview"
            density="compact"
            hide-details
            label="Don't show this again for this conversation"
            data-testid="assistant-skip-preview"
          />
        </section>

        <p v-if="store.notice" class="asp-notice" role="status" data-testid="assistant-notice">
          <v-icon icon="mdi-information-outline" size="15" />
          <span>{{ store.notice }}</span>
        </p>
        <p v-if="store.error" class="asp-error rr-bad" role="alert" data-testid="assistant-error">
          <v-icon icon="mdi-alert-circle-outline" size="15" />
          <span>{{ store.error }}</span>
        </p>
        <div v-if="store.budgetStopped" class="asp-actions">
          <v-btn
            variant="tonal"
            size="small"
            data-testid="assistant-budget-settings"
            @click="openBudget"
            >Open the budget in Settings</v-btn
          >
        </div>

        <form class="asp-composer" @submit.prevent="submit">
          <!-- Files given as context would be listed here, right above the box, one chip each
               with its size and a way to take it out again. Not built. -->
          <v-textarea
            :model-value="store.draft"
            rows="2"
            auto-grow
            max-rows="8"
            hide-details
            variant="outlined"
            density="compact"
            placeholder="Ask the assistant"
            aria-label="Message to the assistant"
            data-testid="assistant-input"
            @update:model-value="store.edit"
            @keydown.enter.exact="onEnter"
          />
          <div class="asp-actions">
            <v-btn
              v-if="!boxReady"
              type="submit"
              variant="tonal"
              size="small"
              :loading="store.preparing"
              :disabled="store.sending || store.draft.trim() === ''"
              data-testid="assistant-prepare"
              >{{ store.skipPreview ? 'Send' : 'Prepare' }}</v-btn
            >
            <v-btn
              v-if="store.canResume"
              variant="tonal"
              size="small"
              data-testid="assistant-resume"
              @click="store.resume()"
              >Continue</v-btn
            >
          </div>
        </form>
        <div v-if="usage || figures" class="asp-usage asp-muted">
          <div v-if="usage" data-testid="assistant-usage">{{ usage }}</div>
          <div v-if="figures" data-testid="assistant-estimate-note">{{ NOT_A_BILL }}</div>
        </div>
      </footer>
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
/* The drawer itself never scrolls: the conversation inside it does. */
.asp :deep(.v-navigation-drawer__content) {
  overflow: hidden;
}
.asp.asp-resizing {
  transition: none !important;
  user-select: none;
}
.asp-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  font-size: var(--rr-text-md);
}

/* The left edge: drag it, or use the arrow keys on it, to change the width. */
.asp-grip {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  left: 0;
  width: 6px;
  cursor: ew-resize;
  touch-action: none;
}
.asp-grip:hover,
.asp-resizing .asp-grip {
  background: var(--rr-border-strong);
}
.asp-grip:focus-visible {
  outline: 2px solid var(--rr-focus);
  outline-offset: -2px;
}

.asp-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px 6px 18px;
  border-bottom: 1px solid var(--rr-border);
}
.asp-title {
  flex: 1 1 auto;
  margin: 0;
  font-size: var(--rr-text-lg);
  font-weight: 600;
}

.asp-body {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}
.asp-list {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 14px 16px 18px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.asp-list:focus-visible {
  outline: 2px solid var(--rr-focus);
  outline-offset: -2px;
}
/* Nothing in the column is squeezed to fit: it scrolls. */
.asp-list > * {
  flex: 0 0 auto;
}
.asp-newest {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
}

.asp-intro,
.asp-empty {
  color: var(--rr-text-2);
  font-size: var(--rr-text-sm);
  line-height: 1.5;
}
.asp-intro p,
.asp-empty p {
  margin: 0 0 8px;
}
.asp-muted {
  color: var(--rr-muted);
  font-size: var(--rr-text-xs);
}
.asp-section {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--rr-border);
  color: var(--rr-muted);
  font-size: var(--rr-text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Messages */
.asp-msg {
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.asp-user {
  align-self: flex-end;
  max-width: 88%;
  padding: 8px 12px;
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius);
  background: var(--rr-surface-2);
  white-space: pre-wrap;
}
.asp-user-pending {
  opacity: 0.65;
}
.asp-bot {
  align-self: stretch;
}
.asp-note,
.asp-notice,
.asp-error,
.asp-saved {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: var(--rr-text-sm);
  line-height: 1.45;
}
.asp-note > .v-icon,
.asp-notice > .v-icon,
.asp-error > .v-icon,
.asp-saved > .v-icon {
  flex: 0 0 auto;
  margin-top: 2px;
}
.asp-note,
.asp-notice {
  color: var(--rr-text-2);
}
.asp-saved {
  align-items: center;
  flex-wrap: wrap;
}

/* A tool the assistant used: one line, the answer on demand. */
.asp-tool {
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius);
  background: var(--rr-surface);
  font-size: var(--rr-text-sm);
}
.asp-tool-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 5px 8px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.asp-tool-row:disabled {
  cursor: default;
}
.asp-tool-row:focus-visible {
  outline: 2px solid var(--rr-focus);
  outline-offset: -2px;
}
.asp-tool-name {
  flex: 0 1 auto;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asp-tool-tier {
  flex: 0 0 auto;
  padding: 0 6px;
  border: 1px solid var(--rr-border-strong);
  border-radius: 999px;
  color: var(--rr-muted);
  font-size: var(--rr-text-xs);
  line-height: 1.5;
}
/* The tier is said in its word. What changes or launches is only set off from what reads,
   without a status colour: nothing went wrong. */
.asp-tool-tier[data-tier='change'],
.asp-tool-tier[data-tier='launch'] {
  border-color: var(--rr-text-2);
  color: var(--rr-text);
  font-weight: 600;
}
.asp-tool-line {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  color: var(--rr-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Why a tool did not run, and the line of an opened row, are read in full. */
.asp-tool[data-ok='false'] .asp-tool-line,
.asp-tool-open .asp-tool-line {
  white-space: normal;
}
.asp-tool-chevron {
  flex: 0 0 auto;
  color: var(--rr-muted);
}
.asp-tool-more {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px 8px;
}

/* A proposal: a setup, a script, or a script that changed. */
.asp-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--rr-border-strong);
  border-radius: var(--rr-radius);
  background: var(--rr-surface);
}
.asp-card-warn {
  border-color: var(--rr-warn);
}
.asp-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.asp-card-sub {
  margin: 0;
  color: var(--rr-text-2);
  font-size: var(--rr-text-sm);
}
.asp-by {
  color: var(--rr-muted);
}
.asp-items,
.asp-warn,
.asp-contents {
  margin: 0;
  padding-left: 18px;
  font-size: var(--rr-text-sm);
}
.asp-items li + li {
  margin-top: 4px;
}
.asp-detail {
  color: var(--rr-text-2);
  font-size: var(--rr-text-xs);
  overflow-wrap: anywhere;
}
.asp-pre {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius);
  background: var(--rr-bg);
  font-size: var(--rr-text-xs);
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
/* Only the exact request has a height of its own: it sits in the foot, which does not scroll. */
.asp-pre-capped {
  max-height: min(40vh, 320px);
  overflow: auto;
}
.asp-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

/* The foot: pinned under the conversation. */
.asp-foot {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 72%;
  padding: 10px 14px 10px 18px;
  border-top: 1px solid var(--rr-border);
  overflow-y: auto;
}
.asp-working {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--rr-text-sm);
}
.asp-working-text {
  flex: 1 1 auto;
  min-width: 0;
}
.asp-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--rr-border-strong);
  border-radius: var(--rr-radius);
  background: var(--rr-surface);
}
.asp-preview-over {
  border-color: var(--rr-warn);
}
.asp-preview-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-size: var(--rr-text-sm);
  font-weight: 600;
}
.asp-preview-head .asp-muted {
  font-weight: 400;
}
.asp-over {
  font-size: var(--rr-text-sm);
}
.asp-contents {
  color: var(--rr-text-2);
  font-size: var(--rr-text-xs);
}
.asp-preview :deep(.v-checkbox .v-label) {
  font-size: var(--rr-text-xs);
}
.asp-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.asp-usage {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.4;
}

/* A reply, formatted (markdownView.ts makes the elements). */
.asp-bot :deep(.md > :first-child) {
  margin-top: 0;
}
.asp-bot :deep(.md > :last-child) {
  margin-bottom: 0;
}
.asp-bot :deep(.md p) {
  margin: 0 0 8px;
}
.asp-bot :deep(.md-heading) {
  margin: 12px 0 6px;
  font-weight: 600;
}
.asp-bot :deep(.md-heading-1) {
  font-size: var(--rr-text-lg);
}
.asp-bot :deep(.md ul),
.asp-bot :deep(.md ol) {
  margin: 0 0 8px;
  padding-left: 22px;
}
.asp-bot :deep(.md li > p) {
  margin: 0;
}
.asp-bot :deep(.md li + li) {
  margin-top: 2px;
}
.asp-bot :deep(.md-code),
.asp-bot :deep(.md-pre) {
  border: 1px solid var(--rr-border);
  border-radius: 4px;
  background: var(--rr-bg);
  font-family: var(--rr-font-mono);
  font-size: var(--rr-text-xs);
}
.asp-bot :deep(.md-code) {
  padding: 1px 4px;
  overflow-wrap: anywhere;
}
.asp-bot :deep(.md-pre) {
  margin: 0 0 8px;
  padding: 8px 10px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.asp-bot :deep(.md-pre code) {
  font: inherit;
}
.asp-bot :deep(.md-link) {
  color: var(--rr-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.asp-bot :deep(.md blockquote) {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 3px solid var(--rr-border-strong);
  color: var(--rr-text-2);
}
.asp-bot :deep(.md hr) {
  margin: 10px 0;
  border: 0;
  border-top: 1px solid var(--rr-border);
}
</style>
