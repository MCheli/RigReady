<script setup lang="ts">
import { author, bugs, build, homepage, license, repository } from '../../../package.json';
import { aboutFacts } from '../shell/about';
import { aboutOpen, returnFocus, shortcutsOpen } from '../shell/shell';
import BrandMark from './BrandMark.vue';

/**
 * About RigReady: which version this is, what it is for, the licence, and where to find
 * it. Opened from the version in the header and from the command palette. What it says
 * about the licence, the author and the addresses is read from the package's own
 * description (package.json), so it cannot disagree with what was built.
 */
defineProps<{ version: string; dataRoot?: string | undefined; kind?: 'flight' | 'racing' }>();

const facts = aboutFacts({ author, bugs, build, homepage, license, repository });
returnFocus(aboutOpen);

const JOBS = [
  {
    icon: 'mdi-clipboard-check-outline',
    title: 'Ready, then launch',
    text: 'Checks the devices, helper apps, monitors, audio and game files a setup needs. Make ready fixes what it can, Launch starts the game, Stand down puts the desk back.',
  },
  {
    icon: 'mdi-shield-check-outline',
    title: 'Set up and protect',
    text: 'Setups captured from the rig as it is. Backups, bindings and cheat sheets, with a copy kept before any file is changed.',
  },
  {
    icon: 'mdi-stethoscope',
    title: 'Troubleshoot hardware',
    text: 'Find a device by pressing a button on it, test inputs the way a game sees them, and see which USB hub everything hangs off.',
  },
];

function showShortcuts(): void {
  aboutOpen.value = false;
  shortcutsOpen.value = true;
}
</script>

<template>
  <v-dialog
    v-model="aboutOpen"
    class="rr-shell-dialog"
    max-width="620"
    transition="rr-dialog"
    aria-label="About RigReady"
  >
    <v-card class="rr-about" data-testid="about">
      <div class="rr-about-head">
        <BrandMark :size="46" :kind="kind ?? 'flight'" />
        <div>
          <h2 class="rr-about-name">RigReady</h2>
          <div class="rr-about-version">
            Version <span class="rr-mono" data-testid="about-dialog-version">{{ version }}</span>
          </div>
        </div>
      </div>
      <v-card-text>
        <p class="rr-about-lead" data-testid="about-lead">
          Checks that a flight or racing sim rig is ready, fixes what is not, and launches the game.
        </p>
        <ul class="rr-about-jobs" data-testid="about-jobs">
          <li v-for="job in JOBS" :key="job.title">
            <v-icon :icon="job.icon" size="20" />
            <div>
              <div class="rr-about-job">{{ job.title }}</div>
              <div class="rr-about-text">{{ job.text }}</div>
            </div>
          </li>
        </ul>

        <dl class="rr-about-facts">
          <div v-if="facts.licence" data-testid="about-licence">
            <dt>Licence</dt>
            <dd>
              {{ facts.licence }}: open source, free to use, change and share<template
                v-if="facts.copyright"
              >
                <br /><span class="rr-about-quiet">{{ facts.copyright }}</span></template
              >
            </dd>
          </div>
          <div v-for="link in facts.links" :key="link.id" :data-testid="`about-${link.id}`">
            <dt>{{ link.label }}</dt>
            <dd>
              <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.shown }}</a>
            </dd>
          </div>
          <div v-if="dataRoot" data-testid="about-data">
            <dt>Data folder</dt>
            <dd class="rr-mono rr-about-quiet">{{ dataRoot }}</dd>
          </div>
        </dl>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" data-testid="about-shortcuts" @click="showShortcuts">
          Keyboard shortcuts
        </v-btn>
        <v-btn
          variant="text"
          to="/configure/diagnostics"
          data-testid="about-diagnostics"
          @click="aboutOpen = false"
        >
          Diagnostics
        </v-btn>
        <v-spacer />
        <v-btn color="primary" data-testid="about-close" @click="aboutOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style>
.rr-about-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 24px 20px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--rr-border);
}
/* The same heading tape as the window's header: the app's one instrument detail. */
.rr-about-head::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 5px;
  pointer-events: none;
  background:
    linear-gradient(90deg, var(--rr-border-strong) 1px, transparent 1px) center bottom / 40px 5px
      repeat-x,
    linear-gradient(90deg, var(--rr-border-strong) 1px, transparent 1px) center bottom / 8px 2px
      repeat-x;
  mask-image: linear-gradient(90deg, transparent 2%, #000 30%, #000 70%, transparent 98%);
}
.rr-about-name {
  margin: 0;
  font-family: var(--rr-font-display);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
}
.rr-about-version {
  font-size: 13px;
  color: var(--rr-muted);
}
.rr-about-lead {
  margin: 0 0 16px;
  font-size: 14.5px;
  color: var(--rr-text);
}
.rr-about-jobs {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: grid;
  gap: 12px;
}
.rr-about-jobs li {
  display: flex;
  gap: 12px;
}
.rr-about-jobs .v-icon {
  flex: none;
  margin-top: 1px;
  color: var(--rr-kind, var(--rr-accent));
}
.rr-about-job {
  font-size: 14px;
  font-weight: 600;
}
.rr-about-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--rr-text-2);
}
.rr-about-facts {
  margin: 0;
  padding-top: 14px;
  border-top: 1px solid var(--rr-border);
  display: grid;
  gap: 7px;
  font-size: 13px;
}
.rr-about-facts > div {
  display: flex;
  gap: 12px;
}
.rr-about-facts dt {
  flex: none;
  width: 128px;
  color: var(--rr-muted);
}
.rr-about-facts dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.rr-about-quiet {
  color: var(--rr-muted);
}
</style>
