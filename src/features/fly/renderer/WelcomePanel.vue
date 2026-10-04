<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BrandMark from '../../../renderer/components/BrandMark.vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { useClient } from '../../../renderer/ipc';
import { flyContract, type Welcome } from '../contract';

/**
 * First run: no setup exists yet. Says what RigReady does in three lines, shows what it
 * found on this PC, and leads straight into capturing the first setup.
 */
const api = useClient(flyContract);
const found = ref<Welcome>();
/** The read finished, with or without an answer: the outline goes either way. */
const looked = ref(false);

onMounted(async () => {
  const result = await api.welcome();
  if (result.ok) found.value = result.value;
  looked.value = true;
});

const list = (names: string[], max: number): string =>
  names.length <= max
    ? names.join(', ')
    : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

/** A PC with racing games only gets the wheel for a mark; any other gets the flight path marker. */
const kind = computed(() => {
  const games = found.value?.games ?? [];
  return games.length > 0 && games.every((g) => g.kind === 'racing') ? 'racing' : 'flight';
});

const WHAT = [
  {
    icon: 'mdi-clipboard-check-outline',
    title: 'Checks the rig before you fly or race',
    text: 'devices plugged in, helper apps running, monitors arranged, audio and game files right.',
  },
  {
    icon: 'mdi-auto-fix',
    title: 'Fixes what is off and launches the game',
    text: 'Make ready starts the apps and puts the monitors in place; Stand down puts the desk back afterwards.',
  },
  {
    icon: 'mdi-shield-check-outline',
    title: 'Protects your bindings and settings',
    text: 'backups you can restore after a reinstall, and a copy kept before anything is changed.',
  },
];

const facts = computed(() => {
  const f = found.value;
  if (!f) return [];
  const off = f.monitors.connected - f.monitors.on;
  return [
    {
      id: 'games',
      icon: 'mdi-gamepad-variant-outline',
      count: f.games.length,
      title: f.games.length === 1 ? 'game' : 'games',
      detail:
        f.games.length > 0
          ? list(
              f.games.map((g) => g.name),
              8
            )
          : 'None that RigReady knows. Any other game still works: you say what to launch.',
    },
    {
      id: 'controllers',
      icon: 'mdi-controller',
      count: f.controllers.length,
      title: f.controllers.length === 1 ? 'game controller' : 'game controllers',
      detail:
        f.controllers.length > 0
          ? list(f.controllers, 3)
          : 'Plug in your stick, wheel or panels and they show up here.',
    },
    {
      id: 'monitors',
      icon: 'mdi-monitor-multiple',
      count: f.monitors.connected,
      title: f.monitors.connected === 1 ? 'monitor' : 'monitors',
      detail: off > 0 ? `${f.monitors.on} on, ${off} off right now` : 'All on right now',
    },
  ];
});
</script>

<template>
  <div class="rr-panel welcome" data-testid="fly-empty">
    <!--
      A simplified head-up display: the horizon, two rungs of the pitch ladder, and the mark
      where the aircraft is going. Drawn, not content.
    -->
    <div class="welcome-hud" aria-hidden="true">
      <svg
        class="welcome-horizon"
        width="100%"
        height="100"
        viewBox="0 0 640 100"
        preserveAspectRatio="xMidYMid meet"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
        stroke-linecap="round"
        focusable="false"
      >
        <path d="M-2000 56H282M358 56H2640" />
        <!-- Above the horizon a solid rung, below it a dashed one, as a pitch ladder draws them. -->
        <template v-if="kind === 'flight'">
          <path d="M246 36v-4h32M394 36v-4h-32" />
          <path stroke-dasharray="5 4" d="M246 76v4h32M394 76v4h-32" />
        </template>
      </svg>
      <BrandMark :size="52" :kind="kind" class="welcome-mark" />
    </div>

    <div class="welcome-head">
      <h1 class="welcome-title">Welcome to RigReady</h1>
      <p class="welcome-sub">No setups yet. The first one takes a minute.</p>
    </div>

    <ol class="welcome-what" data-testid="welcome-what">
      <li v-for="item in WHAT" :key="item.title">
        <v-icon :icon="item.icon" size="20" />
        <span
          ><b>{{ item.title }}</b
          >: {{ item.text }}</span
        >
      </li>
    </ol>

    <div class="welcome-found" data-testid="welcome-found">
      <div class="rr-section-title">Found on this PC</div>
      <PageSkeleton v-if="!looked" label="Looking at this PC…" shape="cards" :rows="3" />
      <div v-else-if="facts.length > 0" class="welcome-facts">
        <div
          v-for="fact in facts"
          :key="fact.id"
          class="welcome-fact"
          :data-testid="`welcome-${fact.id}`"
        >
          <div class="welcome-fact-head">
            <v-icon :icon="fact.icon" size="18" />
            <span class="welcome-fact-title">
              <b class="welcome-count">{{ fact.count }}</b> {{ fact.title }}
            </span>
          </div>
          <div v-if="fact.detail" class="welcome-fact-detail">{{ fact.detail }}</div>
        </div>
      </div>
      <p v-else class="welcome-fact-detail" data-testid="welcome-unread">
        This PC could not be looked at just now. Capturing a setup looks again.
      </p>
    </div>

    <div class="welcome-actions">
      <v-btn
        color="primary"
        size="large"
        prepend-icon="mdi-camera-iris"
        to="/configure/profiles/capture"
        data-testid="fly-create"
      >
        Create a setup from this rig
      </v-btn>
      <v-btn
        variant="text"
        prepend-icon="mdi-backup-restore"
        to="/configure/backups"
        data-testid="welcome-restore"
      >
        Restore from a backup
      </v-btn>
      <v-btn
        variant="text"
        prepend-icon="mdi-tray-arrow-down"
        to="/configure/share"
        data-testid="welcome-import"
      >
        Import a shared setup
      </v-btn>
    </div>
    <p class="welcome-tip">
      Get the rig the way you fly or race first (gear plugged in, helper apps running, monitors
      arranged) and RigReady captures it as it is.
    </p>
    <p class="welcome-keys" data-testid="welcome-keys">
      <kbd class="rr-kbd">Ctrl</kbd><kbd class="rr-kbd">K</kbd> finds any page or command from
      anywhere; <kbd class="rr-kbd">?</kbd> lists the keyboard shortcuts.
    </p>
  </div>
</template>

<style scoped>
.welcome {
  max-width: 860px;
  margin: 0 auto;
  padding: 0 40px 28px;
  overflow: hidden;
}
.welcome-hud {
  position: relative;
  height: 100px;
  margin: 0 -40px;
  color: var(--rr-border-strong);
}
.welcome-horizon {
  display: block;
}
.welcome-mark {
  position: absolute;
  left: calc(50% - 26px);
  /* Its circle sits on the horizon. */
  top: 28px;
}
.welcome-head {
  text-align: center;
  margin: 6px 0 26px;
}
.welcome-title {
  font-family: var(--rr-font-display);
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}
.welcome-sub {
  margin: 4px 0 0;
  color: var(--rr-muted);
  font-size: 14px;
}
.welcome-what {
  list-style: none;
  padding: 0;
  margin: 0 0 24px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.welcome-what li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--rr-text-2);
}
.welcome-what li b {
  color: var(--rr-text);
  font-weight: 600;
}
.welcome-what .v-icon {
  color: var(--rr-kind, var(--rr-accent));
  margin-top: 1px;
  flex: none;
}
.welcome-found {
  border-top: 1px solid var(--rr-border);
  padding-top: 18px;
  margin-bottom: 24px;
}
.welcome-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.welcome-fact {
  padding: 12px 14px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  background: var(--rr-surface-2);
}
/* While the PC is being looked at: the outline of the three readings, where they will be. */
.welcome-found :deep(.rr-skeleton-grid) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.welcome-found :deep(.rr-skeleton-card) {
  gap: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--rr-surface-2);
  box-shadow: none;
}
.welcome-found :deep(.rr-skeleton-block) {
  height: 46px;
}
.welcome-fact-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.welcome-fact-head .v-icon {
  color: var(--rr-muted);
  flex: none;
}
.welcome-fact-title {
  font-size: 14px;
}
.welcome-count {
  font-family: var(--rr-font-display);
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  margin-right: 2px;
}
.welcome-fact-detail {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--rr-muted);
  overflow-wrap: anywhere;
}
.welcome-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.welcome-tip {
  margin: 14px 0 0;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.welcome-keys {
  margin: 18px -40px 0;
  padding: 14px 40px 0;
  border-top: 1px solid var(--rr-border);
  font-size: 12.5px;
  color: var(--rr-muted);
}
.welcome-keys .rr-kbd {
  margin-right: 3px;
}
.welcome-keys .rr-kbd + .rr-kbd {
  margin-right: 6px;
}
/* A narrow window, or large text: one thing under the other. */
@media (max-width: 760px) {
  .welcome {
    padding: 0 20px 22px;
  }
  .welcome-hud {
    margin: 0 -20px;
  }
  .welcome-what,
  .welcome-facts,
  .welcome-found :deep(.rr-skeleton-grid) {
    grid-template-columns: minmax(0, 1fr);
  }
  .welcome-what {
    gap: 12px;
  }
  .welcome-keys {
    margin: 18px -20px 0;
    padding: 14px 20px 0;
  }
}
</style>
