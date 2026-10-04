<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useClient } from '../../../renderer/ipc';
import { flyContract, type Welcome } from '../contract';

/**
 * First run: no setup exists yet. Says what RigReady does in three lines, shows what it
 * found on this PC, and leads straight into capturing the first setup.
 */
const api = useClient(flyContract);
const found = ref<Welcome>();

onMounted(async () => {
  const result = await api.welcome();
  if (result.ok) found.value = result.value;
});

const list = (names: string[], max: number): string =>
  names.length <= max
    ? names.join(', ')
    : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

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
    <div class="welcome-head">
      <v-icon icon="mdi-check-decagram" size="34" class="welcome-mark" />
      <div>
        <h1 class="welcome-title">Welcome to RigReady</h1>
        <p class="welcome-sub">No setups yet. The first one takes a minute.</p>
      </div>
    </div>

    <ol class="welcome-what" data-testid="welcome-what">
      <li>
        <v-icon icon="mdi-clipboard-check-outline" size="20" />
        <span
          ><b>Checks the rig before you fly or race</b>: devices plugged in, helper apps running,
          monitors arranged, audio and game files right.</span
        >
      </li>
      <li>
        <v-icon icon="mdi-auto-fix" size="20" />
        <span
          ><b>Fixes what is off and launches the game</b>: Make ready starts the apps and puts the
          monitors in place; Stand down puts the desk back afterwards.</span
        >
      </li>
      <li>
        <v-icon icon="mdi-shield-check-outline" size="20" />
        <span
          ><b>Protects your bindings and settings</b>: backups you can restore after a reinstall,
          and a copy kept before anything is changed.</span
        >
      </li>
    </ol>

    <div v-if="facts.length > 0" class="welcome-found" data-testid="welcome-found">
      <div class="rr-section-title">Found on this PC</div>
      <div class="welcome-facts">
        <div
          v-for="fact in facts"
          :key="fact.id"
          class="welcome-fact"
          :data-testid="`welcome-${fact.id}`"
        >
          <v-icon :icon="fact.icon" size="20" />
          <div>
            <div class="welcome-fact-title">
              <b>{{ fact.count }}</b> {{ fact.title }}
            </div>
            <div v-if="fact.detail" class="welcome-fact-detail">{{ fact.detail }}</div>
          </div>
        </div>
      </div>
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
  </div>
</template>

<style scoped>
.welcome {
  max-width: 820px;
  margin: 0 auto;
  padding: 32px 36px 28px;
}
.welcome-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.welcome-mark {
  color: var(--rr-accent);
}
.welcome-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}
.welcome-sub {
  margin: 2px 0 0;
  color: var(--rr-muted);
  font-size: 14px;
}
.welcome-what {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  display: grid;
  gap: 10px;
}
.welcome-what li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  font-size: 14px;
  line-height: 1.45;
  color: #c3cad3;
}
.welcome-what li b {
  color: var(--rr-text);
  font-weight: 600;
}
.welcome-what .v-icon {
  color: var(--rr-accent);
  margin-top: 1px;
  flex: none;
}
.welcome-found {
  border-top: 1px solid var(--rr-border);
  padding-top: 18px;
  margin-bottom: 22px;
}
.welcome-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.welcome-fact {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  background: var(--rr-surface-2);
}
.welcome-fact .v-icon {
  color: var(--rr-muted);
  margin-top: 2px;
  flex: none;
}
.welcome-fact-title {
  font-size: 14px;
}
.welcome-fact-detail {
  font-size: 12.5px;
  color: #a3adba;
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
</style>
