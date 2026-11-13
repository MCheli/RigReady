<script setup lang="ts">
/**
 * The overlay's switch in the setup editor: whether the overlay shows while this setup is the
 * one in use. Kept with the setup (extensions.overlay), saved by the editor's Save. A setup
 * that says nothing has it on where RigReady can read the bindings of its game and off where
 * it cannot, and then the reason is shown beside the switch. Look and place are the same for
 * every setup, on the Overlay page.
 */
import { computed, ref, watch } from 'vue';
import type { Profile } from '../../../core/profile/schema';
import { errorText, useClient } from '../../../renderer/ipc';
import { overlayContract, type SetupDefault } from '../contract';
import { overlayChoice, withOverlayChoice } from '../core/setupChoice';

const props = defineProps<{ profile: Profile }>();
const emit = defineEmits<{ 'update:profile': [profile: Profile] }>();

const api = useClient(overlayContract);
const facts = ref<SetupDefault>();
const error = ref<string>();

/** Asked again when the setup's game changes: the default goes with the game. */
let asked = 0;
async function load(): Promise<void> {
  const mine = ++asked;
  const { game, gameName } = props.profile;
  const answer = await api.setupDefault({
    ...(game ? { game } : {}),
    ...(game === 'other' && gameName ? { gameName } : {}),
  });
  if (mine !== asked) return;
  if (answer.ok) {
    facts.value = answer.value;
    error.value = undefined;
  } else {
    error.value = errorText(answer.error);
  }
}
watch(() => [props.profile.game, props.profile.gameName], load, { immediate: true });

const chosen = computed(() => overlayChoice(props.profile));
const on = computed(() => chosen.value ?? facts.value?.startsOn ?? false);

/** What the switch means as it stands; the reason, when there is one, follows it. */
const lead = computed(() => {
  if (error.value) return error.value;
  if (on.value) {
    return 'While this setup is the one in use, the overlay lists what you press over the game.';
  }
  if (chosen.value === false) {
    return 'Nothing is put over the game while this setup is the one in use.';
  }
  return facts.value ? 'Off to begin with.' : '';
});

function set(value: boolean | null): void {
  emit('update:profile', withOverlayChoice(props.profile, value === true));
}
</script>

<template>
  <div
    class="rr-panel op-setup"
    data-testid="edit-overlay"
    :data-on="on"
    :data-chosen="chosen !== undefined"
  >
    <div class="op-setup-row">
      <div class="op-setup-main">
        <v-switch
          :model-value="on"
          :loading="!facts && chosen === undefined && !error"
          label="Show the overlay in this setup"
          color="primary"
          density="compact"
          hide-details
          data-testid="edit-overlay-switch"
          @update:model-value="set"
        />
        <div class="rr-row-sub op-setup-sub" data-testid="edit-overlay-sub">
          {{ lead }}
          <span v-if="facts?.why" data-testid="edit-overlay-why">{{ facts.why }}</span>
        </div>
        <div
          v-if="facts && !facts.overlayOn"
          class="rr-row-sub op-setup-sub"
          data-testid="edit-overlay-master"
        >
          The overlay itself is turned off on the Overlay page, so it shows in no setup until you
          turn it on there.
        </div>
      </div>
      <v-btn
        variant="text"
        size="small"
        to="/configure/overlay"
        append-icon="mdi-arrow-right"
        data-testid="edit-overlay-page"
      >
        Open Overlay
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.op-setup {
  margin-bottom: 24px;
  padding: 10px 16px 14px;
}
.op-setup-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.op-setup-main {
  flex: 1;
  min-width: 260px;
}
.op-setup-sub {
  margin-top: 2px;
  max-width: 62ch;
}
.op-setup-row > .v-btn {
  margin-top: 6px;
}
</style>
