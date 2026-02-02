<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  isInstalled: boolean;
  profilesPath: string | null;
}>();

const emit = defineEmits<{
  openDownload: [];
  openSoftware: [];
  restoreBackup: [];
}>();

const expanded = ref(!true);
</script>

<template>
  <v-card class="mb-6">
    <v-card-title class="d-flex align-center cursor-pointer" @click="expanded = !expanded">
      <v-icon class="mr-2">mdi-help-circle-outline</v-icon>
      Setup Guide
      <v-spacer />
      <v-icon>{{ expanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
    </v-card-title>

    <v-expand-transition>
      <div v-show="expanded">
        <v-divider />
        <v-card-text>
          <v-stepper :model-value="isInstalled ? 2 : 1" alt-labels flat>
            <v-stepper-header>
              <v-stepper-item
                :complete="isInstalled"
                :value="1"
                title="Install Stream Deck"
                :subtitle="isInstalled ? 'Installed' : 'Required'"
              />
              <v-divider />
              <v-stepper-item :value="2" title="Configure Profiles" subtitle="Optional" />
              <v-divider />
              <v-stepper-item :value="3" title="Restore Backup" subtitle="If available" />
            </v-stepper-header>
          </v-stepper>

          <v-divider class="my-4" />

          <!-- Step 1: Install Stream Deck Software -->
          <div class="mb-6">
            <div class="d-flex align-center mb-2">
              <v-avatar size="32" :color="isInstalled ? 'success' : 'grey'" class="mr-3">
                <v-icon size="small" color="white">
                  {{ isInstalled ? 'mdi-check' : 'mdi-numeric-1' }}
                </v-icon>
              </v-avatar>
              <div>
                <div class="text-subtitle-1 font-weight-medium">
                  Download & Install Stream Deck Software
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{
                    isInstalled
                      ? 'Stream Deck software is installed'
                      : 'Required to use your Stream Deck'
                  }}
                </div>
              </div>
            </div>
            <div class="ml-11">
              <v-btn
                v-if="!isInstalled"
                variant="tonal"
                color="primary"
                prepend-icon="mdi-download"
                @click="emit('openDownload')"
              >
                Download from Elgato
              </v-btn>
              <v-btn
                v-else
                variant="outlined"
                prepend-icon="mdi-open-in-new"
                @click="emit('openSoftware')"
              >
                Open Stream Deck
              </v-btn>
            </div>
          </div>

          <!-- Step 2: Configure Profiles -->
          <div class="mb-6">
            <div class="d-flex align-center mb-2">
              <v-avatar size="32" color="grey" class="mr-3">
                <v-icon size="small" color="white">mdi-numeric-2</v-icon>
              </v-avatar>
              <div>
                <div class="text-subtitle-1 font-weight-medium">Configure Your Profiles</div>
                <div class="text-caption text-medium-emphasis">
                  Create profiles for your games and applications
                </div>
              </div>
            </div>
            <div class="ml-11">
              <v-alert type="info" variant="tonal" density="compact" class="mb-2">
                <template #text>
                  <div class="text-body-2">
                    For DCS World users, consider installing the
                    <a
                      href="https://github.com/asherao/DCS-Interface-for-Stream-Deck"
                      target="_blank"
                      class="text-decoration-none font-weight-medium"
                    >
                      DCS Interface Plugin
                    </a>
                    for direct integration.
                  </div>
                </template>
              </v-alert>
            </div>
          </div>

          <!-- Step 3: Restore Backup -->
          <div>
            <div class="d-flex align-center mb-2">
              <v-avatar size="32" color="grey" class="mr-3">
                <v-icon size="small" color="white">mdi-numeric-3</v-icon>
              </v-avatar>
              <div>
                <div class="text-subtitle-1 font-weight-medium">
                  Restore Your Profiles (Optional)
                </div>
                <div class="text-caption text-medium-emphasis">
                  Restore profiles from a previous backup
                </div>
              </div>
            </div>
            <div class="ml-11">
              <v-btn
                variant="outlined"
                prepend-icon="mdi-backup-restore"
                :disabled="!isInstalled"
                @click="emit('restoreBackup')"
              >
                Restore from Backup
              </v-btn>
            </div>
          </div>
        </v-card-text>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
