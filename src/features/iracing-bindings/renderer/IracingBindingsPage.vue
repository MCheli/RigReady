<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import EmptyState from '../../../renderer/components/EmptyState.vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import {
  ALL_CARS,
  iracingBindingsContract,
  type Action,
  type ChangeResult,
  type Device,
  type Overview,
  type SetView,
} from '../contract';
import DeviceState from './DeviceState.vue';
import EditDialog from './EditDialog.vue';
import GoneDevices from './GoneDevices.vue';
import { listed } from '../core/names';
import ProfilesSection from './ProfilesSection.vue';
import { shownActions } from './rows';

/**
 * Every action of one iRacing binding set and what it is bound to, and Change on each
 * action that takes a button or a key (EditDialog.vue: press, review, then Save).
 */
const api = useClient(iracingBindingsContract);
const route = useRoute();
const router = useRouter();

const overview = ref<Overview>();
const view = ref<SetView>();
const error = ref<string>();
const setError = ref<string>();
const selected = ref<string>(ALL_CARS);

const text = ref<string | null>('');
const onlyUnbound = ref(false);
const onlyDiffers = ref(false);
/** Device key to show the bindings of, or '' for all. */
const device = ref('');
const showCamera = ref(false);

/** The action whose binding is being changed, while the dialog is open. */
const changing = ref<Action>();
/** What the last change did, as main reported it after reading the file back. */
const saved = ref<ChangeResult & { action: string }>();

async function loadSet(): Promise<void> {
  const id = selected.value;
  const result = await api.set({ id });
  if (selected.value !== id) return;
  if (!result.ok) {
    setError.value = errorText(result.error);
    view.value = undefined;
    return;
  }
  setError.value = undefined;
  view.value = result.value;
  // A filter for something this set does not have would hide everything without saying why.
  if (!result.value.devices.some((d) => d.key === device.value)) device.value = '';
  if (result.value.set.general) onlyDiffers.value = false;
}

async function load(): Promise<void> {
  const result = await api.overview();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  error.value = undefined;
  overview.value = result.value;
  const sets = result.value.sets;
  // When RigReady cannot tell which profile iRacing uses for all cars, it shows no list at
  // all, not even a car's own profile: the page says why instead.
  if (sets.length === 0 || result.value.source.problem) {
    view.value = undefined;
    setError.value = undefined;
    return;
  }
  if (!sets.some((s) => s.id === selected.value)) selected.value = sets[0]!.id;
  await loadSet();
}

async function pick(id: string): Promise<void> {
  saved.value = undefined;
  selected.value = id;
  void router.replace({ query: id === ALL_CARS ? {} : { set: id } });
  await loadSet();
}

let off: (() => void) | undefined;
onMounted(() => {
  const wanted = route.query['set'];
  if (typeof wanted === 'string' && wanted) selected.value = wanted;
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());

const setItems = computed(() =>
  (overview.value?.sets ?? []).map((s) => ({
    value: s.id,
    // A car with a profile of its own is named by the car path iRacing writes in app.ini.
    title: s.general
      ? s.name
      : s.profile
        ? s.sharedWith?.length
          ? `${s.name} (profile “${s.profile}”, also ${listed(s.sharedWith)})`
          : `${s.name} (profile “${s.profile}”)`
        : `${s.name} (custom controls)`,
  }))
);

/** "2 cars have a folder in iRacing. 1 has custom controls; the others use the bindings for all cars." */
const carsLine = computed(() => {
  const o = overview.value;
  if (!o) return '';
  const custom = o.sets.filter((s) => !s.general).length;
  // With control profiles a car's own bindings come from app.ini, folder or not.
  if (o.source.kind === 'profiles') {
    if (custom === 0)
      return 'No car has a control profile of its own, so the profile for all cars applies.';
    return custom === 1
      ? '1 car has a control profile of its own; the others use the profile for all cars.'
      : `${custom} cars have control profiles of their own; the others use the profile for all cars.`;
  }
  if (o.carFolders === 0) return '';
  const folders =
    o.carFolders === 1
      ? '1 car has a folder in iRacing.'
      : `${o.carFolders} cars have a folder in iRacing.`;
  if (custom === 0)
    return `${folders} None has custom controls, so the bindings for all cars apply.`;
  if (custom === o.carFolders) {
    return `${folders} ${custom === 1 ? 'It has' : 'All have'} custom controls.`;
  }
  return `${folders} ${custom} ${custom === 1 ? 'has' : 'have'} custom controls; the others use the bindings for all cars.`;
});

/** Which control profile iRacing uses, and that the older file beside it is not read. */
const sourceLine = computed(() => {
  const s = overview.value?.source;
  if (!s || s.kind !== 'profiles' || !s.profile) return '';
  const older = s.oldFiles.length
    ? ' The older controls.cfg from before control profiles is not read by iRacing any more, so this page does not show it.'
    : '';
  return `iRacing keeps bindings in control profiles. It uses the profile “${s.profile}” for all cars.${older}`;
});

const GROUPS = ['Driving', 'In-car adjustments', 'Cameras and replay', 'Interface and chat'];

/**
 * The action just saved stays listed, with its new binding, until the search or a filter
 * changes: with "Not bound" on it would otherwise vanish the moment it is bound.
 */
const keep = ref<string>();
watch([text, onlyUnbound, onlyDiffers, device, selected], () => (keep.value = undefined));

const rows = computed(() =>
  shownActions(
    view.value?.actions ?? [],
    {
      text: text.value ?? '',
      onlyUnbound: onlyUnbound.value,
      onlyDiffers: onlyDiffers.value,
      device: device.value,
    },
    keep.value
  )
);
const groups = computed(() =>
  GROUPS.map((g) => ({ name: g, rows: rows.value.filter((a) => a.group === g) })).filter(
    (g) => g.rows.length
  )
);

const sharedDriving = computed(() => (view.value?.shared ?? []).filter((s) => !s.cameraEditor));
const sharedCamera = computed(() => (view.value?.shared ?? []).filter((s) => s.cameraEditor));

function toggleUnbound(): void {
  onlyUnbound.value = !onlyUnbound.value;
  // Nothing is both not bound and bound to a device.
  if (onlyUnbound.value) device.value = '';
}
function showDevice(key: string): void {
  device.value = device.value === key ? '' : key;
  if (device.value) onlyUnbound.value = false;
}

const shortId = (guid: string): string => `${guid.slice(0, 8)}…${guid.slice(19, 23)}`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const deviceLine = (d: Device): string =>
  [
    plural(d.bound, 'action bound', 'actions bound'),
    d.vendorId && d.productId ? `USB ${d.vendorId}:${d.productId}` : '',
    d.kind === 'controller' ? `id ${shortId(d.key)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** RigReady changes a button or a key. An axis, and a binding it cannot read, stay with iRacing. */
const canChange = (a: Action): boolean =>
  (a.accepts.includes('button') || a.accepts.includes('key')) &&
  a.binding?.kind !== 'axis' &&
  a.binding?.kind !== 'unknown';

async function onSaved(result: ChangeResult): Promise<void> {
  saved.value = { ...result, action: changing.value?.id ?? '' };
  keep.value = changing.value?.id;
  changing.value = undefined;
  // Other pages read the same file; this one reloads with them.
  notifyMachineChanged();
  await loadSet();
}

/** Bindings were copied into a profile: the set shown may be that profile. */
async function onCopied(): Promise<void> {
  saved.value = undefined;
  notifyMachineChanged();
  await load();
}

/** Columns of the table: action, bound to, on, the car's "All cars has", and Change. */
const columns = computed(() => 4 + (view.value?.set.general ? 0 : 1));

const cheatSheet = computed(() => ({
  path: '/configure/cheat-sheets',
  query: { game: 'iracing', aircraft: selected.value },
}));
</script>

<template>
  <div class="rr-page" data-testid="iracing-bindings-page">
    <div class="ib-head">
      <div>
        <h1 class="rr-page-title">iRacing bindings</h1>
        <p class="rr-page-sub">
          Every action in iRacing and what it is bound to, for all cars and for each car with custom
          controls.
        </p>
      </div>
      <v-spacer />
      <v-btn
        v-if="view"
        variant="text"
        prepend-icon="mdi-card-text-outline"
        :to="cheatSheet"
        data-testid="iracing-bindings-cheat-sheet"
        >Cheat sheet</v-btn
      >
      <v-btn
        variant="text"
        prepend-icon="mdi-information-outline"
        to="/configure/games/iracing"
        data-testid="iracing-bindings-game-link"
        >Install and files</v-btn
      >
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="iracing-bindings-error"
      >{{ error }}</v-alert
    >
    <PageSkeleton v-if="!overview && !error" label="Reading iRacing’s bindings…" />

    <template v-if="overview">
      <NotOnThisPc
        v-if="!overview.installed && !overview.folder"
        name="iRacing"
        :looked="['every Steam library', 'the usual install folders', 'Documents\\iRacing']"
        game-page="/configure/games/iracing"
      />
      <template v-else-if="overview.source.problem">
        <v-alert
          type="warning"
          variant="tonal"
          class="mb-4"
          data-testid="iracing-bindings-source-problem"
          >{{ overview.source.problem }} iRacing shows its bindings in Options, then
          Controls.</v-alert
        >
        <!-- Which profiles there are helps to see what app.ini names that is not there. -->
        <ProfilesSection
          v-if="overview.profiles"
          :profiles="overview.profiles"
          @copied="onCopied"
        />
      </template>
      <EmptyState
        v-else-if="overview.sets.length === 0"
        art="file"
        title="iRacing has no bindings file yet"
        data-testid="iracing-bindings-empty"
      >
        iRacing writes controls.cfg the first time you set up your controls. Do that in iRacing;
        this page then fills in.
      </EmptyState>

      <template v-else>
        <div class="ib-notice" data-testid="iracing-bindings-editing">
          <v-icon icon="mdi-pencil-outline" class="rr-muted" />
          <div class="ib-notice-main">
            <div class="ib-notice-title">You can change bindings here.</div>
            <div data-testid="iracing-bindings-proven">
              A button and a key bound here were used by iRacing in a test drive on 13 November 2026
              (iRacing 2026.11.02.01).
            </div>
            <div>
              Press Change, then the button or the key. RigReady shows what will change and writes
              nothing until you press Save. It makes a backup of the file first; Undo is on the
              <router-link to="/configure/safety" data-testid="iracing-bindings-safety-link"
                >Safety page</router-link
              >. An axis or a hat switch is bound in iRacing itself: Options, then Controls.
            </div>
          </div>
        </div>

        <div v-if="overview.simRunning" class="ib-notice" data-testid="iracing-bindings-running">
          <v-icon icon="mdi-alert" class="rr-warn" />
          <div class="ib-notice-main">
            The iRacing simulator is running. It writes its files when it closes, so a binding
            changed in this session may not show here yet.
            <span data-testid="iracing-bindings-running-edit">
              Close iRacing before you change a binding here: when it closes it would write its own
              bindings over the change.
            </span>
          </div>
        </div>

        <section class="ib-section">
          <div class="ib-pick">
            <v-select
              :model-value="selected"
              :items="setItems"
              label="Bindings for"
              density="compact"
              hide-details
              class="ib-select"
              data-testid="iracing-bindings-set"
              @update:model-value="pick"
            />
            <div class="ib-pick-text">
              <div v-if="carsLine" data-testid="iracing-bindings-cars-line">{{ carsLine }}</div>
              <div v-if="sourceLine" data-testid="iracing-bindings-source">{{ sourceLine }}</div>
              <div v-if="overview.source.kind === 'profiles'" class="ib-hint">
                In iRacing’s Options a car can have a control profile of its own.
              </div>
              <div v-else class="ib-hint">
                A car gets its own set when you tick “Use custom controls for this car” in iRacing’s
                Options.
              </div>
            </div>
          </div>
        </section>

        <ProfilesSection
          v-if="overview.profiles"
          :profiles="overview.profiles"
          @copied="onCopied"
        />

        <v-alert
          v-if="setError"
          type="error"
          variant="tonal"
          class="mb-4"
          data-testid="iracing-bindings-set-error"
          >{{ setError }}</v-alert
        >

        <template v-if="view">
          <div
            v-for="note in view.notes"
            :key="note"
            class="ib-notice"
            data-testid="iracing-bindings-note"
          >
            <v-icon icon="mdi-information-outline" class="rr-muted" />
            <div class="ib-notice-main">{{ note }}</div>
          </div>

          <section class="ib-section">
            <div class="ib-section-head">
              <h2 class="rr-section-title">Controllers and keyboard in this set</h2>
              <span class="ib-hint">Matched to what is plugged in now</span>
            </div>
            <div class="rr-panel">
              <div
                v-for="d in view.devices"
                :key="d.key"
                class="ib-device"
                data-testid="iracing-bindings-device"
                :data-state="d.state"
              >
                <div class="rr-row">
                  <v-icon
                    :icon="d.kind === 'keyboard' ? 'mdi-keyboard-outline' : 'mdi-steering'"
                    class="rr-muted"
                  />
                  <div class="rr-row-main">
                    <div class="rr-row-title" data-testid="iracing-bindings-device-name">
                      {{ d.givenName ?? d.name }}
                      <span v-if="d.givenName" class="rr-muted ib-hardware"> {{ d.name }}</span>
                    </div>
                    <div class="rr-row-sub">{{ deviceLine(d) }}</div>
                  </div>
                  <DeviceState v-if="d.kind === 'controller'" :state="d.state" />
                </div>
                <div v-if="d.state === 'moved'" class="ib-device-more">
                  Windows now gives this controller a different id, so iRacing will treat it as a
                  new one.
                  <router-link
                    v-if="overview.repairRoute"
                    :to="overview.repairRoute"
                    data-testid="iracing-bindings-repair-link"
                    >Point iRacing at the new id</router-link
                  >
                </div>
                <div v-else-if="d.state === 'missing'" class="ib-device-more">
                  Not plugged in. Its {{ plural(d.bound, 'binding does', 'bindings do') }} nothing
                  until it is.
                </div>
                <div v-else-if="d.state === 'unknown'" class="ib-device-more">
                  Windows did not list the controllers, so RigReady cannot tell whether this one is
                  plugged in.
                </div>
              </div>
              <div
                v-if="view.devices.length === 0"
                class="rr-row rr-muted"
                data-testid="iracing-bindings-no-devices"
              >
                Nothing is bound in this set yet.
              </div>
            </div>
          </section>

          <GoneDevices :set="view.set.id" :repair-route="overview.repairRoute" />

          <section class="ib-section" data-testid="iracing-bindings-shared">
            <div class="ib-section-head">
              <h2 class="rr-section-title">Inputs that do more than one thing</h2>
              <span class="ib-hint">One press does every action listed</span>
            </div>
            <div class="rr-panel">
              <div
                v-for="s in sharedDriving"
                :key="`${s.device}|${s.input}`"
                class="rr-row"
                data-testid="iracing-bindings-shared-row"
              >
                <v-icon icon="mdi-call-split" class="rr-muted" />
                <div class="rr-row-main">
                  <div class="rr-row-title">
                    <span class="ib-input">{{ s.input }}</span>
                    <span class="rr-muted ib-hardware"> on {{ s.deviceName }}</span>
                  </div>
                  <div class="rr-row-sub">{{ s.actions.map((a) => a.name).join(' and ') }}</div>
                </div>
              </div>
              <div
                v-if="sharedDriving.length === 0"
                class="rr-row rr-muted"
                data-testid="iracing-bindings-shared-none"
              >
                No input does two things while you drive.
              </div>
              <div v-if="sharedCamera.length" class="ib-camera">
                <div class="rr-row">
                  <v-icon icon="mdi-video-outline" class="rr-muted" />
                  <div class="rr-row-main">
                    <div class="rr-row-title" data-testid="iracing-bindings-camera-line">
                      {{ plural(sharedCamera.length, 'more input is', 'more inputs are') }} shared
                      with iRacing’s camera editor
                    </div>
                    <div class="rr-row-sub">
                      iRacing’s own default keys are like this: one key for driving, and the same
                      key in the camera editor.
                    </div>
                  </div>
                  <v-btn
                    variant="text"
                    size="small"
                    :aria-expanded="showCamera"
                    data-testid="iracing-bindings-camera-toggle"
                    @click="showCamera = !showCamera"
                    >{{ showCamera ? 'Hide them' : 'Show them' }}</v-btn
                  >
                </div>
                <template v-if="showCamera">
                  <div
                    v-for="s in sharedCamera"
                    :key="`${s.device}|${s.input}`"
                    class="rr-row ib-camera-row"
                    data-testid="iracing-bindings-camera-row"
                  >
                    <div class="rr-row-main">
                      <div class="rr-row-title">
                        <span class="ib-input">{{ s.input }}</span>
                        <span class="rr-muted ib-hardware"> on {{ s.deviceName }}</span>
                      </div>
                      <div class="rr-row-sub">
                        {{ s.actions.map((a) => a.name).join(' and ') }}
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </section>

          <section class="ib-section">
            <div class="ib-section-head">
              <h2 class="rr-section-title">Actions</h2>
              <span class="ib-hint" data-testid="iracing-bindings-counts">
                {{ view.counts.actions }} actions · {{ view.counts.bound }} bound ·
                {{ view.counts.unbound }} not bound<template v-if="!view.set.general">
                  · {{ view.counts.differs }}
                  {{ view.counts.differs === 1 ? 'differs' : 'differ' }} from All cars</template
                >
              </span>
              <span
                v-if="view.counts.unread"
                class="rr-warn ib-hint-warn"
                data-testid="iracing-bindings-unread"
              >
                {{ plural(view.counts.unread, 'binding', 'bindings') }} RigReady cannot read
              </span>
            </div>
            <div class="ib-filters">
              <v-text-field
                v-model="text"
                density="compact"
                hide-details
                clearable
                prepend-inner-icon="mdi-magnify"
                placeholder="Find an action, a button or a key"
                aria-label="Find an action, a button or a key"
                class="ib-filter"
                data-testid="iracing-bindings-filter"
              />
              <v-btn
                size="small"
                rounded="pill"
                :variant="onlyUnbound ? 'flat' : 'outlined'"
                :color="onlyUnbound ? 'primary' : undefined"
                :aria-pressed="onlyUnbound"
                data-testid="iracing-bindings-only-unbound"
                @click="toggleUnbound"
                >Not bound</v-btn
              >
              <v-btn
                v-if="!view.set.general"
                size="small"
                rounded="pill"
                :variant="onlyDiffers ? 'flat' : 'outlined'"
                :color="onlyDiffers ? 'primary' : undefined"
                :aria-pressed="onlyDiffers"
                data-testid="iracing-bindings-only-differs"
                @click="onlyDiffers = !onlyDiffers"
                >Differs from All cars</v-btn
              >
              <v-btn
                v-for="d in view.devices"
                :key="d.key"
                size="small"
                rounded="pill"
                :variant="device === d.key ? 'flat' : 'outlined'"
                :color="device === d.key ? 'primary' : undefined"
                :aria-pressed="device === d.key"
                data-testid="iracing-bindings-device-filter"
                :data-device="d.key"
                @click="showDevice(d.key)"
                >{{ d.givenName ?? d.name }}</v-btn
              >
            </div>
            <div class="ib-shown" data-testid="iracing-bindings-shown">
              Showing {{ rows.length }} of {{ view.counts.actions }}
            </div>
            <div
              v-if="saved"
              class="ib-saved"
              :class="saved.changed ? 'rr-ok' : 'rr-muted'"
              role="status"
              data-testid="iracing-bindings-saved"
              :data-changed="saved.changed ? 'yes' : 'no'"
            >
              <v-icon :icon="saved.changed ? 'mdi-check' : 'mdi-information-outline'" size="16" />
              <span>{{ saved.message }}</span>
            </div>
            <div class="rr-panel">
              <table class="ib-table" data-testid="iracing-bindings-table">
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Bound to</th>
                    <th scope="col">On</th>
                    <th v-if="!view.set.general" scope="col">All cars has</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody v-for="g in groups" :key="g.name">
                  <tr class="ib-group">
                    <th :colspan="columns" scope="colgroup">
                      {{ g.name }} <span class="ib-group-count">{{ g.rows.length }}</span>
                    </th>
                  </tr>
                  <tr
                    v-for="a in g.rows"
                    :key="a.id"
                    data-testid="iracing-bindings-row"
                    :data-action="a.id"
                    :data-bound="a.binding ? 'yes' : 'no'"
                    :data-differs="a.differs ? 'yes' : 'no'"
                  >
                    <td>
                      {{ a.name }}
                      <span class="ib-id">{{ a.id }}</span>
                    </td>
                    <td v-if="!a.binding" class="rr-muted">Not bound</td>
                    <td v-else-if="a.binding.kind === 'unknown'">
                      <span class="rr-warn">{{ a.binding.input }}</span>
                    </td>
                    <td v-else class="ib-input">{{ a.binding.input }}</td>
                    <td class="rr-muted">{{ a.binding?.deviceName }}</td>
                    <td v-if="!view.set.general" class="ib-general">
                      <template v-if="a.differs">
                        <v-icon icon="mdi-swap-horizontal" size="15" class="rr-muted" />
                        {{ a.general }}
                      </template>
                    </td>
                    <td class="ib-change">
                      <button
                        v-if="canChange(a)"
                        type="button"
                        class="ib-change-btn"
                        data-testid="iracing-bindings-change"
                        :aria-label="`Change ${a.name}`"
                        @click="changing = a"
                      >
                        Change
                      </button>
                      <span v-else class="rr-muted" data-testid="iracing-bindings-in-iracing"
                        >In iRacing</span
                      >
                      <span
                        v-if="saved?.changed && saved.action === a.id"
                        class="rr-ok ib-row-saved"
                        data-testid="iracing-bindings-row-saved"
                      >
                        <v-icon icon="mdi-check" size="14" /> Saved
                      </span>
                    </td>
                  </tr>
                </tbody>
                <tbody v-if="groups.length === 0">
                  <tr>
                    <td :colspan="columns" class="rr-muted" data-testid="iracing-bindings-nothing">
                      Nothing matches.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="ib-foot">
              Read from
              <span class="rr-mono" data-testid="iracing-bindings-file">{{ view.set.file }}</span
              >.
              <template v-if="overview.repairRoute">
                Backups of these files and the repair of a controller id are on the
                <router-link :to="overview.repairRoute" data-testid="iracing-bindings-racing-link"
                  >iRacing page</router-link
                >.
              </template>
            </p>
          </section>

          <EditDialog
            :action="changing"
            :set="view.set"
            @close="changing = undefined"
            @saved="onSaved"
          />
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.ib-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}
.ib-head .rr-page-sub {
  margin-bottom: 0;
}
.ib-section {
  margin-bottom: 26px;
}
.ib-section-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}
.ib-section-head .rr-section-title {
  margin: 0;
}
.ib-hint {
  font-size: 12.5px;
  color: var(--rr-muted);
}
.ib-hint-warn {
  font-size: 12.5px;
}
.ib-notice {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-radius: var(--rr-radius);
  border: 1px solid var(--rr-border);
  background: var(--rr-surface-2);
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 16px;
}
.ib-notice-main {
  flex: 1;
  min-width: 0;
}
.ib-notice-title {
  font-weight: 600;
}
.ib-pick {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}
.ib-select {
  flex: 0 0 340px;
  max-width: 100%;
}
.ib-pick-text {
  flex: 1;
  min-width: 260px;
  font-size: 13px;
}
.ib-device + .ib-device,
.ib-camera {
  border-top: 1px solid var(--rr-border);
}
.ib-device-more {
  padding: 0 16px 12px 52px;
  font-size: 13px;
  color: var(--rr-muted);
}
.ib-hardware {
  font-weight: 400;
  font-size: 12.5px;
}
.ib-camera-row {
  padding-left: 52px;
}
.ib-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.ib-filter {
  flex: 0 0 320px;
  max-width: 100%;
}
.ib-shown {
  font-size: 12.5px;
  color: var(--rr-muted);
  margin-bottom: 8px;
}
.ib-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ib-table th {
  text-align: left;
  font-weight: 600;
  font-size: 11.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--rr-muted);
  padding: 10px 16px 6px;
}
.ib-table .ib-group th {
  border-top: 1px solid var(--rr-border);
  color: var(--rr-text);
  background: var(--rr-surface-2);
  padding: 8px 16px;
}
.ib-group-count {
  margin-left: 6px;
  font-weight: 400;
  color: var(--rr-muted);
}
.ib-table td {
  padding: 7px 16px;
  border-top: 1px solid var(--rr-border);
  vertical-align: top;
}
.ib-input {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
}
.ib-id {
  margin-left: 8px;
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--rr-muted);
}
.ib-general {
  color: var(--rr-muted);
}
.ib-saved {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 8px;
}
.ib-change {
  white-space: nowrap;
}
.ib-change-btn {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--rr-text);
  background: transparent;
  border: 1px solid var(--rr-border-strong);
  border-radius: 999px;
  padding: 1px 12px;
  cursor: pointer;
}
.ib-change-btn:hover {
  border-color: var(--rr-accent);
}
.ib-row-saved {
  margin-left: 10px;
  font-size: 12.5px;
}
.ib-foot {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
</style>
