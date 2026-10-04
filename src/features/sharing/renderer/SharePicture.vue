<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { sharingContract, type PicturePreviewView } from '../contract';
import type { PictureShape } from '../core/schema';

/**
 * "Save a picture of this setup": the rig as one image to show people. What is on screen is
 * the very PNG that Save writes, so there is nothing to imagine; and nothing personal is in
 * it, because the picture is built from names only and scanned like a shared setup.
 */
const api = useClient(sharingContract);
const profiles = ref<{ id: string; name: string }[]>();
const profileId = ref<string>();
const shape = ref<PictureShape>('wide');
const preview = ref<PicturePreviewView>();
const error = ref<string>();
const drawing = ref(false);
const saving = ref(false);
const saved = ref<{ path: string; size: number; width: number; height: number }>();

onMounted(async () => {
  const result = await api.profiles();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  profiles.value = result.value;
  profileId.value = result.value[0]?.id;
});

let sequence = 0;
async function draw(): Promise<void> {
  if (!profileId.value) return;
  const mine = ++sequence;
  drawing.value = true;
  error.value = undefined;
  saved.value = undefined;
  const result = await api.picturePreview({ profileId: profileId.value, shape: shape.value });
  if (mine !== sequence) return;
  drawing.value = false;
  if (result.ok) preview.value = result.value;
  else {
    preview.value = undefined;
    error.value = errorText(result.error);
  }
}
watch([profileId, shape], () => void draw());

async function save(): Promise<void> {
  if (!profileId.value) return;
  saving.value = true;
  error.value = undefined;
  const result = await api.savePicture({ profileId: profileId.value, shape: shape.value });
  saving.value = false;
  if (!result.ok) error.value = errorText(result.error);
  // Null: the Save dialog was cancelled, and nothing was written.
  else if (result.value) saved.value = result.value;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const name = computed(() => profiles.value?.find((p) => p.id === profileId.value)?.name ?? '');
const contents = computed(() => {
  const p = preview.value;
  if (!p) return '';
  return [
    plural(p.monitors, 'monitor', 'monitors'),
    plural(p.controllers, 'controller', 'controllers'),
    ...(p.apps ? [plural(p.apps, 'helper app', 'helper apps')] : []),
  ].join(' · ');
});
const size = (bytes: number): string =>
  bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
</script>

<template>
  <div data-testid="share-picture">
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="share-picture-error"
    >
      {{ error }}
    </v-alert>

    <div
      v-if="profiles && profiles.length === 0"
      class="rr-panel rr-empty"
      data-testid="share-picture-no-setups"
    >
      <div>There is no setup to draw yet.</div>
      <div class="rr-row-sub mb-3">
        A picture shows a setup: its monitors, controllers and apps.
      </div>
      <v-btn variant="tonal" color="primary" to="/configure/profiles">Go to Setups</v-btn>
    </div>

    <template v-else-if="profiles">
      <div class="rr-panel picture-bar">
        <v-select
          v-model="profileId"
          :items="profiles"
          item-title="name"
          item-value="id"
          label="Setup"
          density="compact"
          variant="outlined"
          hide-details
          class="picture-setup"
          data-testid="share-picture-setup"
        />
        <v-btn-toggle
          v-model="shape"
          mandatory
          density="compact"
          variant="outlined"
          divided
          aria-label="Shape of the picture"
        >
          <v-btn value="wide" size="small" data-testid="share-picture-wide">16:9</v-btn>
          <v-btn value="square" size="small" data-testid="share-picture-square">Square</v-btn>
        </v-btn-toggle>
        <v-spacer />
        <v-btn
          color="primary"
          prepend-icon="mdi-content-save-outline"
          :disabled="!preview || drawing"
          :loading="saving"
          data-testid="share-picture-save"
          @click="save"
        >
          Save picture…
        </v-btn>
      </div>

      <div class="picture-stage" :class="shape" data-testid="share-picture-stage">
        <img
          v-if="preview"
          class="picture-image"
          :class="{ stale: drawing }"
          :src="preview.image"
          :width="preview.width"
          :height="preview.height"
          :alt="`A picture of ${name}: ${contents}`"
          data-testid="share-picture-image"
          :data-shape="preview.width === preview.height ? 'square' : 'wide'"
        />
        <div v-else-if="!error" class="rr-muted picture-wait">Drawing the picture…</div>
      </div>

      <div v-if="preview" class="rr-panel picture-foot" data-testid="share-picture-foot">
        <div class="rr-row-main">
          <div class="rr-row-title" data-testid="share-picture-contents">
            {{ contents }} · {{ preview.width }} × {{ preview.height }} PNG
          </div>
          <div class="rr-row-sub">
            Names only. No serial number, user name, PC name or folder path is in the picture, and
            what you see here is the file that is saved.
            <template v-if="preview.monitorsFrom === 'now'">
              This setup does not check the monitor layout, so the monitors are drawn as they are
              now.
            </template>
          </div>
        </div>
        <div v-if="saved" class="picture-saved rr-ok" data-testid="share-picture-saved">
          <v-icon icon="mdi-check" size="16" /> Saved {{ saved.path }} ({{ size(saved.size) }})
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.picture-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.picture-setup {
  flex: 0 1 320px;
}
.picture-stage {
  display: flex;
  justify-content: center;
  min-height: 220px;
}
.picture-image {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
  transition: opacity 0.15s ease-out;
}
/* A square picture is shown no taller than a wide one would be. */
.picture-stage.square .picture-image {
  max-width: 560px;
}
.picture-image.stale {
  opacity: 0.55;
}
.picture-wait {
  align-self: center;
}
.picture-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-top: 16px;
}
.picture-saved {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 46%;
  font-size: 13px;
  overflow-wrap: anywhere;
}
@media (prefers-reduced-motion: reduce) {
  .picture-image {
    transition: none;
  }
}
</style>
