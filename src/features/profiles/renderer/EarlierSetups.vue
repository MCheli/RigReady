<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { profilesContract, type EarlierPlan, type ProfileOverview } from '../contract';

/**
 * Setups page, "From RigReady 1": the setup files version 1 left in the folder. Each says
 * what it is and what RigReady can make of it: "Bring it over" when every part it brings
 * has an exact match here (the rest named, with why), or plainly that it cannot, with the
 * folder one click away. The old file is never changed; deleting it is the user's choice.
 */
const props = defineProps<{ earlier: ProfileOverview['earlier'] }>();
const emit = defineEmits<{
  delete: [target: { id: string; name: string }];
  done: [message: string];
  failed: [message: string];
}>();

const api = useClient(profilesContract);
const plans = reactive<Record<string, EarlierPlan>>({});
const planErrors = reactive<Record<string, string>>({});
const asking = ref<EarlierPlan>();
const bringing = ref(false);
const bringError = ref<string>();

const fileName = (file: string): string => file.split(/[\\/]/).pop() ?? file;
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

async function plan(id: string): Promise<void> {
  const result = await api.earlierPlan({ id });
  if (result.ok) {
    plans[id] = result.value;
    delete planErrors[id];
  } else planErrors[id] = errorText(result.error);
}
// Asked again whenever the page reads the folder again: a device plugged in since, or a
// setup brought over, changes what RigReady can do with the file.
watch(
  () => props.earlier,
  () => {
    for (const old of props.earlier) void plan(old.id);
  },
  { immediate: true }
);

/** One line under the file: what RigReady can make of it. */
function summary(id: string): string | undefined {
  const p = plans[id];
  if (!p || p.broughtOver) return undefined;
  if (p.canBringOver) {
    const brings = count(p.checks.length, 'check', 'checks');
    return p.left.length > 0
      ? `RigReady can bring it over: ${brings}. ${count(p.left.length, 'part has', 'parts have')} no match in this version.`
      : `RigReady can bring it over: ${brings}.`;
  }
  return undefined;
}
/** Why it cannot be brought over, in the words of each part. */
const reasons = (p: EarlierPlan): { title: string; why: string }[] =>
  p.blocked.length > 0 ? p.blocked : p.left;

async function open(id: string): Promise<void> {
  const result = await api.showFile({ id });
  if (!result.ok) emit('failed', errorText(result.error));
  else emit('done', 'Opened the folder in Explorer, with the file selected.');
}

async function bringOver(): Promise<void> {
  const target = asking.value;
  if (!target) return;
  bringing.value = true;
  bringError.value = undefined;
  const result = await api.bringOver({ id: target.id });
  bringing.value = false;
  if (!result.ok) {
    bringError.value = errorText(result.error);
    return;
  }
  asking.value = undefined;
  emit(
    'done',
    `Brought "${target.name}" over as the setup "${result.value.name}". The old file is still in the folder; delete it when you no longer need it.`
  );
}

function ask(target: EarlierPlan | undefined): void {
  bringError.value = undefined;
  asking.value = target;
}
</script>

<template>
  <section
    v-if="earlier.length > 0"
    class="earlier"
    data-testid="profiles-earlier"
    aria-labelledby="profiles-earlier-title"
  >
    <h2 id="profiles-earlier-title" class="rr-section-title">From RigReady 1</h2>
    <p class="earlier-note" data-testid="profiles-earlier-note">
      This version does not read setups made by RigReady 1 as they are. RigReady can bring one over:
      it makes a new setup from the parts it can match exactly, and says which it cannot. The old
      files stay where they are until you delete them.
    </p>
    <div class="rr-panel">
      <div
        v-for="old in earlier"
        :key="old.id"
        class="rr-row earlier-row"
        data-testid="profile-earlier"
        :data-id="old.id"
      >
        <v-icon icon="mdi-history" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ old.name ?? fileName(old.file) }}</div>
          <div class="rr-row-sub">{{ fileName(old.file) }} · made by RigReady 1</div>
          <div v-if="old.broughtOver" class="rr-row-sub" data-testid="profile-earlier-brought">
            Brought over as the setup "{{ old.broughtOver.name }}".
            <router-link :to="`/configure/profiles/${old.broughtOver.id}`">Open it</router-link>
          </div>
          <div v-else-if="summary(old.id)" class="rr-row-sub" data-testid="profile-earlier-summary">
            {{ summary(old.id) }}
          </div>
          <div
            v-else-if="plans[old.id] && !plans[old.id]!.canBringOver"
            class="earlier-cannot"
            data-testid="profile-earlier-cannot"
          >
            <div class="rr-row-sub rr-warn">RigReady cannot bring this setup over.</div>
            <ul class="earlier-list">
              <li v-for="part in reasons(plans[old.id]!)" :key="part.title">
                <strong>{{ part.title }}</strong
                >: {{ part.why }}
              </li>
            </ul>
            <div class="rr-row-sub">
              {{ plans[old.id]!.blocked.length > 0 ? 'Or create' : 'Create' }} it again with New
              setup from this rig. The file is in the folder RigReady keeps setups in.
            </div>
          </div>
          <div
            v-else-if="planErrors[old.id]"
            class="rr-row-sub rr-bad"
            data-testid="profile-earlier-error"
          >
            {{ planErrors[old.id] }}
          </div>
          <div v-else class="rr-row-sub rr-muted">Looking at the file…</div>
        </div>
        <v-btn
          v-if="plans[old.id]?.canBringOver"
          variant="text"
          color="primary"
          prepend-icon="mdi-import"
          data-testid="profile-earlier-bring"
          @click="ask(plans[old.id])"
          >Bring it over…</v-btn
        >
        <v-btn variant="text" data-testid="profile-earlier-folder" @click="open(old.id)"
          >Open the folder</v-btn
        >
        <v-btn
          variant="text"
          color="error"
          data-testid="profile-earlier-delete"
          @click="emit('delete', { id: old.id, name: old.name ?? old.id })"
          >Delete</v-btn
        >
      </div>
    </div>

    <v-dialog
      :model-value="asking !== undefined"
      max-width="560"
      @update:model-value="asking = undefined"
    >
      <v-card v-if="asking" data-testid="profile-bring-dialog">
        <v-card-title>Bring "{{ asking.name }}" over?</v-card-title>
        <v-card-text class="earlier-dialog">
          <p>
            RigReady makes a new setup, "{{ asking.setupName }}"<template v-if="asking.gameName">
              for {{ asking.gameName }}</template
            >, from {{ fileName(asking.file) }}. The old file stays where it is.
          </p>
          <p v-if="asking.checks.length > 0" class="earlier-head">It checks:</p>
          <ul class="earlier-list" data-testid="profile-bring-checks">
            <li v-for="check in asking.checks" :key="check.title">
              <strong>{{ check.title }}</strong
              >: {{ check.what }}{{ check.required ? '' : ' (optional)' }}
            </li>
          </ul>
          <p v-if="asking.launch" data-testid="profile-bring-launch">
            Launch starts {{ asking.launch }}.
          </p>
          <template v-if="asking.left.length > 0">
            <p class="earlier-head">Not brought over:</p>
            <ul class="earlier-list" data-testid="profile-bring-left">
              <li v-for="part in asking.left" :key="part.title">
                <strong>{{ part.title }}</strong
                >: {{ part.why }}
              </li>
            </ul>
          </template>
          <p v-for="note in asking.notes" :key="note" class="rr-muted">{{ note }}</p>
          <v-alert
            v-if="bringError"
            type="error"
            variant="tonal"
            density="compact"
            data-testid="profile-bring-error"
            >{{ bringError }}</v-alert
          >
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="profile-bring-cancel" @click="asking = undefined"
            >Cancel</v-btn
          >
          <v-btn
            color="primary"
            :loading="bringing"
            data-testid="profile-bring-go"
            @click="bringOver"
            >Bring it over</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.earlier {
  margin-top: 28px;
}
.earlier-note {
  max-width: 72ch;
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--rr-muted);
}
.earlier-row {
  align-items: flex-start;
}
.earlier-cannot {
  margin-top: 4px;
}
.earlier-list {
  margin: 4px 0 6px 18px;
  font-size: 13px;
}
.earlier-list li {
  margin: 2px 0;
}
.earlier-dialog p {
  margin: 0 0 8px;
}
.earlier-head {
  font-weight: 600;
}
</style>
