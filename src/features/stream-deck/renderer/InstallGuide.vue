<script setup lang="ts">
import ExternalLink from './ExternalLink.vue';

defineProps<{ downloadUrl: string }>();
</script>

<template>
  <div class="rr-panel guide" data-testid="sd-install-guide">
    <div class="rr-row-title guide-title">Install the Stream Deck app</div>
    <ol class="guide-steps">
      <li>Download "Stream Deck" for Windows from Elgato's downloads page.</li>
      <li>Run the installer. It needs no settings changed; Windows may ask for permission.</li>
      <li>
        Plug in your Stream Deck and let the app start. It creates its profile folder on first run.
      </li>
      <li>
        Come back here: RigReady can then restore your profiles and tell you which plugins to add.
      </li>
    </ol>
    <p class="guide-dcs" data-testid="sd-install-dcs">
      <b>For DCS World:</b> keys that show cockpit lamps and displays also need a DCS plugin and its
      DCS-side export script: either DCS Interface (streamdeck-dcs-interface, which uses
      DCS-ExportScript) or a DCS-BIOS based plugin such as Streamdeck-DCS. Install the one your
      profiles were built with; the Profiles and plugins tab lists it once your profiles are back.
    </p>
    <ExternalLink
      :url="downloadUrl"
      label="Open Elgato's downloads page"
      testid="sd-download"
      variant="flat"
    />
  </div>
</template>

<style scoped>
.guide {
  padding: 16px 20px;
  margin-bottom: 24px;
}
.guide-title {
  font-size: 15px;
  margin-bottom: 8px;
}
.guide-steps {
  padding-left: 20px;
  font-size: 13.5px;
  line-height: 1.7;
  margin-bottom: 12px;
}
.guide-dcs {
  font-size: 13px;
  color: var(--rr-muted);
  line-height: 1.55;
  margin-bottom: 14px;
}
</style>
