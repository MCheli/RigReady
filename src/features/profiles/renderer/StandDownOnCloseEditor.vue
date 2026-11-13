<script setup lang="ts">
import { computed } from 'vue';
import type { Profile } from '../../../core/profile/schema';
import {
  standDownOnClose,
  standDownWaitText,
  withStandDownOnClose,
  type StandDownOnClose,
} from '../../../core/profile/standDownOnClose';

/**
 * What this setup does when its game closes: the switch for Stand down by itself, and how
 * long the countdown before it is. Both are kept with the setup (extensions.fly), so every
 * setup has its own answer. A setup that says nothing has the switch on and one minute.
 */
const props = defineProps<{ profile: Profile }>();
const emit = defineEmits<{ 'update:profile': [profile: Profile] }>();

const value = computed(() => standDownOnClose(props.profile));

/** The lengths offered. Any other length written in the file by hand is offered as well. */
const LENGTHS = [10, 30, 60, 120, 300, 600];
const lengths = computed(() => {
  const seconds = value.value.seconds;
  const all = LENGTHS.includes(seconds) ? LENGTHS : [...LENGTHS, seconds].sort((a, b) => a - b);
  return all.map((s) => ({ title: standDownWaitText(s), value: s }));
});

function set(patch: Partial<StandDownOnClose>): void {
  emit('update:profile', withStandDownOnClose(props.profile, { ...value.value, ...patch }));
}
</script>

<template>
  <h2 class="rr-section-title">When the game closes</h2>
  <div class="rr-panel on-close" data-testid="edit-on-close" :data-enabled="value.enabled">
    <div class="on-close-row">
      <div class="on-close-main">
        <v-switch
          :model-value="value.enabled"
          label="Stand down when the game closes"
          color="primary"
          density="compact"
          hide-details
          data-testid="edit-on-close-switch"
          @update:model-value="set({ enabled: $event === true })"
        />
        <div class="rr-row-sub on-close-sub" data-testid="edit-on-close-sub">
          <template v-if="value.enabled">
            RigReady counts down on the screen, with a Cancel button, and then does what the Stand
            down button does. A game that closes within two minutes of starting does not start the
            countdown.
          </template>
          <template v-else>
            Nothing is closed by itself. The Play screen says Welcome back, and the Stand down
            button is there for when you are done.
          </template>
        </div>
      </div>
      <v-select
        :model-value="value.seconds"
        :items="lengths"
        label="Countdown"
        density="compact"
        hide-details
        :disabled="!value.enabled"
        class="on-close-length"
        data-testid="edit-on-close-seconds"
        @update:model-value="set({ seconds: Number($event) })"
      />
    </div>
  </div>
</template>

<style scoped>
.on-close {
  margin-bottom: 24px;
  padding: 10px 16px 14px;
}
.on-close-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.on-close-main {
  flex: 1;
  min-width: 260px;
}
.on-close-sub {
  margin-top: 2px;
  max-width: 62ch;
}
.on-close-length {
  flex: none;
  width: 200px;
  margin-top: 6px;
}
</style>
