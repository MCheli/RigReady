<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CopyResult, ProfilesInUse } from '../contract';
import CopyDialog from './CopyDialog.vue';

/**
 * Every control profile iRacing keeps, the one it uses for all cars, and the cars that
 * have one of their own (app.ini [ControlProfiles]); and copying bindings between them.
 */
const props = defineProps<{ profiles: ProfilesInUse }>();
const emit = defineEmits<{ copied: [] }>();

const copying = ref(false);
/** What the last copy did, as main reported it after reading the file back. */
const done = ref<CopyResult>();

/** Profiles bindings can be copied from and into: the ones with a controls.cfg. */
const withBindings = computed(() => props.profiles.profiles.filter((p) => p.hasControls));

const usedBy = (p: ProfilesInUse['profiles'][number]): string => {
  const cars = p.cars.length
    ? `${p.cars.length === 1 ? 'Car' : 'Cars'} with this profile: ${p.cars.join(', ')}`
    : '';
  if (p.forAllCars) return cars ? `Used for all cars. ${cars}.` : 'Used for all cars.';
  return cars ? `${cars}.` : 'No car uses it now.';
};

function onCopied(result: CopyResult): void {
  done.value = result;
  copying.value = false;
  emit('copied');
}
</script>

<template>
  <section class="ip-section" data-testid="iracing-profiles">
    <div class="ip-head">
      <h2 class="rr-section-title">Control profiles</h2>
      <span class="ip-hint">Chosen in iRacing: Options, then Controls</span>
      <v-spacer />
      <v-btn
        v-if="withBindings.length >= 2"
        variant="tonal"
        size="small"
        prepend-icon="mdi-content-copy"
        data-testid="iracing-profiles-copy"
        @click="
          done = undefined;
          copying = true;
        "
        >Copy bindings between profiles</v-btn
      >
    </div>
    <div class="rr-panel">
      <div
        v-for="p in profiles.profiles"
        :key="p.name"
        class="rr-row"
        data-testid="iracing-profile"
        :data-profile="p.name"
        :data-all-cars="p.forAllCars ? 'yes' : 'no'"
      >
        <v-icon :icon="p.forAllCars ? 'mdi-car-multiple' : 'mdi-car'" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title" data-testid="iracing-profile-name">
            {{ p.name }}
            <span v-if="p.forAllCars" class="ip-badge" data-testid="iracing-profile-all-cars"
              >All cars</span
            >
          </div>
          <div class="rr-row-sub" data-testid="iracing-profile-used">
            {{ usedBy(p) }}
            <template v-if="!p.hasControls"> It has no controls.cfg yet.</template>
          </div>
        </div>
      </div>
      <div
        v-for="m in profiles.missing"
        :key="`${m.car ?? ''}|${m.profile}`"
        class="rr-row"
        data-testid="iracing-profile-missing"
      >
        <v-icon icon="mdi-alert" class="rr-warn" />
        <div class="rr-row-main">
          <div class="rr-row-title">Not on this PC: “{{ m.profile }}”</div>
          <div class="rr-row-sub">
            {{
              m.car
                ? `app.ini gives ${m.car} this profile, but there is no folder for it, so iRacing cannot load it.`
                : 'app.ini names this profile for all cars, but there is no folder for it.'
            }}
          </div>
        </div>
      </div>
      <div v-if="profiles.unread" class="rr-row rr-muted" data-testid="iracing-profiles-unread">
        RigReady could not read app.ini, so it cannot tell which profile each car uses.
      </div>
    </div>
    <div
      v-if="done"
      class="ip-done"
      :class="done.copied ? 'rr-ok' : 'rr-muted'"
      role="status"
      data-testid="iracing-profiles-copied"
    >
      <v-icon :icon="done.copied ? 'mdi-check' : 'mdi-information-outline'" size="16" />
      <span>{{ done.message }}</span>
    </div>
    <p class="ip-foot">
      A setup can switch iRacing to one of these profiles at Make ready and back at Stand down: add
      “iRacing control profile” to the setup.
    </p>

    <CopyDialog
      :open="copying"
      :profiles="withBindings"
      @close="copying = false"
      @copied="onCopied"
    />
  </section>
</template>

<style scoped>
.ip-section {
  margin-bottom: 26px;
}
.ip-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}
.ip-head .rr-section-title {
  margin: 0;
}
.ip-hint {
  font-size: 12.5px;
  color: var(--rr-muted);
}
.ip-badge {
  margin-left: 8px;
  padding: 0 8px;
  border: 1px solid var(--rr-border-strong);
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--rr-text-2);
}
.ip-done {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  margin-top: 8px;
}
.ip-foot {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
</style>
