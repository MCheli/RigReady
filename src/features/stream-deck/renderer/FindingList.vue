<script setup lang="ts">
import { useRouter } from 'vue-router';
import type { Finding } from '../core/model';
import ExternalLink from './ExternalLink.vue';

defineProps<{ findings: Finding[] }>();
const emit = defineEmits<{ backup: [] }>();

/** A screen of another feature is linked only when that feature is part of this build. */
const router = useRouter();
const routeExists = (to: string): boolean =>
  router.resolve(to).matched.some((r) => r.path !== '/:rest(.*)*');

const ICON = { bad: 'mdi-alert-circle', warn: 'mdi-alert', info: 'mdi-information-outline' };
const CLASS = { bad: 'rr-bad', warn: 'rr-warn', info: 'rr-muted' };
</script>

<template>
  <div v-if="findings.length === 0" class="rr-panel finding-none" data-testid="sd-findings-none">
    <v-icon icon="mdi-check-circle" class="rr-ok" />
    <div>
      <div class="rr-row-title">No problems found</div>
      <div class="rr-row-sub">
        Every action's plugin is installed and every plugin has what it needs.
      </div>
    </div>
  </div>
  <div v-else class="rr-panel">
    <div
      v-for="finding in findings"
      :key="finding.id"
      class="finding"
      data-testid="sd-finding"
      :data-id="finding.id"
      :data-severity="finding.severity"
    >
      <v-icon
        :icon="ICON[finding.severity]"
        :class="CLASS[finding.severity]"
        class="finding-icon"
      />
      <div class="rr-row-main">
        <div class="rr-row-title">{{ finding.title }}</div>
        <div class="finding-detail">{{ finding.detail }}</div>
        <div v-if="finding.fix" class="finding-fix">
          <span class="finding-fix-label">What to do</span> {{ finding.fix }}
        </div>
        <div
          v-if="
            (finding.route && routeExists(finding.route.to)) ||
            finding.link ||
            finding.id === 'no-backup' ||
            finding.id === 'old-backup'
          "
          class="finding-actions"
        >
          <v-btn
            v-if="finding.route && routeExists(finding.route.to)"
            size="small"
            color="primary"
            :to="finding.route.to"
            data-testid="sd-finding-route"
          >
            {{ finding.route.label }}
          </v-btn>
          <v-btn
            v-if="finding.id === 'no-backup' || finding.id === 'old-backup'"
            size="small"
            color="primary"
            prepend-icon="mdi-content-save-outline"
            data-testid="sd-finding-backup"
            @click="emit('backup')"
          >
            Back up now
          </v-btn>
          <ExternalLink
            v-if="finding.link"
            :url="finding.link.url"
            :label="finding.link.label"
            testid="sd-finding-link"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.finding-none {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
}
.finding {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-top: 1px solid var(--rr-border);
}
.finding:first-child {
  border-top: none;
}
.finding-icon {
  margin-top: 1px;
}
.finding-detail {
  font-size: 13px;
  color: var(--rr-muted);
  margin-top: 2px;
  line-height: 1.5;
}
.finding-fix {
  font-size: 13px;
  margin-top: 6px;
  line-height: 1.5;
}
.finding-fix-label {
  font-weight: 600;
  margin-right: 4px;
}
.finding-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
</style>
