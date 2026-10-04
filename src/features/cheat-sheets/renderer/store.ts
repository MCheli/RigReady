import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { cheatSheetsContract, type Overview } from '../contract';
import { controlName } from '../core/layout';
import { sheetTitle, type Sheet, type SheetDevice } from '../core/sheet';

/**
 * The sheet being looked at, shared by the full page, the quick look and the editor, and
 * the live state of the controllers (what is held right now).
 */

let clientCounter = 0;

export interface LastPress {
  deviceKey: string;
  device: string;
  control: string;
  name: string;
  actions: string[];
  note?: string;
  at: number;
}

export const useCheatSheets = defineStore('cheat-sheets', () => {
  const api = useClient(cheatSheetsContract);
  const overview = ref<Overview>();
  const loaded = ref(false);
  const loading = ref(false);
  const error = ref('');
  /** "<game>/<aircraft id>" */
  const choice = ref('');
  const sheet = shallowRef<Sheet>();
  const deviceKey = ref('');
  /** Switch to the device whose control was just pressed. */
  const follow = ref(true);

  const game = computed(() => choice.value.split('/')[0] ?? '');
  const aircraftId = computed(() => choice.value.slice(game.value.length + 1));
  const device = computed<SheetDevice | undefined>(
    () => sheet.value?.devices.find((d) => d.key === deviceKey.value) ?? sheet.value?.devices[0]
  );
  const aircraftItems = computed(() =>
    (overview.value?.games ?? []).flatMap((g) =>
      g.aircraft.map((a) => ({
        title: `${g.gameName.replace(/ World$/, '')} · ${a.name}`,
        value: `${g.game}/${a.id}`,
        props: { subtitle: a.hasUserBindings ? 'Your bindings' : 'Game defaults only' },
      }))
    )
  );
  /** "F/A-18C", or "iRacing" for a game with one set of bindings for every car. */
  const title = computed(() => (sheet.value ? sheetTitle(sheet.value) : ''));
  const kneeboard = computed(
    () => overview.value?.games.find((g) => g.game === game.value)?.kneeboard ?? false
  );

  async function load(preferred?: string): Promise<void> {
    loading.value = true;
    const result = await api.overview();
    loading.value = false;
    loaded.value = true;
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    error.value = '';
    overview.value = result.value;
    const all = aircraftItems.value.map((i) => i.value);
    const wanted = preferred && all.includes(preferred) ? preferred : choice.value;
    if (wanted && all.includes(wanted)) {
      if (wanted !== choice.value || !sheet.value) await choose(wanted);
      else await refresh();
      return;
    }
    // Nothing chosen yet: what main suggests (the game of the setup in use, else the one
    // most of the connected controllers are bound in), else the first there is.
    const suggested = await api.suggest();
    // Someone picked an aircraft while the suggestion was on its way: theirs stands.
    if (choice.value && all.includes(choice.value)) return;
    const start = suggested.ok && suggested.value ? suggested.value : undefined;
    const first = start ? `${start.game}/${start.aircraftId}` : undefined;
    if (first && all.includes(first)) await choose(first);
    else if (all[0]) await choose(all[0]);
  }

  async function choose(value: string): Promise<void> {
    if (value !== choice.value) {
      // What the last press did was said of the sheet before.
      lastPress.value = undefined;
    }
    choice.value = value;
    sheet.value = undefined;
    await refresh();
  }

  async function refresh(): Promise<void> {
    if (!choice.value) return;
    const asked = choice.value;
    loading.value = true;
    const result = await api.sheet({ game: game.value, aircraftId: aircraftId.value });
    if (asked !== choice.value) return;
    loading.value = false;
    if (!result.ok) {
      error.value = errorText(result.error);
      sheet.value = undefined;
      return;
    }
    error.value = '';
    sheet.value = result.value;
    if (!result.value.devices.some((d) => d.key === deviceKey.value)) {
      deviceKey.value = result.value.devices[0]?.key ?? '';
    }
  }

  async function setNote(key: string, control: string, note: string): Promise<string | undefined> {
    const result = await api.setNote({
      game: game.value,
      aircraftId: aircraftId.value,
      deviceKey: key,
      control,
      note,
    });
    if (!result.ok) return errorText(result.error);
    await refresh();
    return undefined;
  }

  // ---- live input ----
  const client = `cheat-sheets-${Date.now()}-${++clientCounter}`;
  /** Controls held right now, by controller GUID. */
  const pressed = ref(new Map<string, string[]>());
  const axes = shallowRef(new Map<string, Record<string, number>>());
  const lastPress = ref<LastPress>();
  const watching = ref(false);
  /** While true, live input does not switch devices (the layout editor is open). */
  const holdDevice = ref(false);
  let users = 0;
  let off: (() => void) | undefined;
  let offChanged: (() => void) | undefined;
  /** How many times the sheet was redrawn because its bindings changed elsewhere. */
  const followed = ref(0);

  function describe(target: SheetDevice, control: string): LastPress {
    const entry = target.controls.find((c) => c.id === control);
    return {
      deviceKey: target.key,
      device: target.title,
      control,
      name: controlName(control),
      actions: (entry?.bindings ?? []).map(
        (b) => (b.modifiers.length ? `${b.modifiers.join('+')}: ` : '') + (b.plain ?? b.action)
      ),
      ...(entry?.note ? { note: entry.note } : {}),
      at: Date.now(),
    };
  }

  async function acquire(): Promise<void> {
    users++;
    if (users > 1) return;
    off = api.on('input', ({ devices }) => {
      const nextPressed = new Map(pressed.value);
      const nextAxes = new Map(axes.value);
      for (const live of devices) {
        const before = nextPressed.get(live.guid) ?? [];
        nextPressed.set(live.guid, live.pressed);
        nextAxes.set(live.guid, live.axes);
        const target = sheet.value?.devices.find((d) => d.guid === live.guid);
        if (!target) continue;
        const fresh = live.pressed.find((id) => !before.includes(id)) ?? live.moved[0];
        if (!fresh) continue;
        lastPress.value = describe(target, fresh);
        // A newly pressed button (not a wobbling axis) brings its device forward.
        const isPress = !fresh.startsWith('axis:');
        if (follow.value && !holdDevice.value && isPress && target.key !== deviceKey.value) {
          deviceKey.value = target.key;
        }
      }
      pressed.value = nextPressed;
      axes.value = nextAxes;
    });
    // The bindings page (in this window or the main one, when this is the pop-out) changed
    // the bindings of the game on show: draw the sheet again. Not while a layout is being
    // edited: the editor works on the sheet it opened.
    offChanged = api.on('changed', (change) => {
      if (change.game !== game.value || holdDevice.value) return;
      if (change.aircraftId && change.aircraftId !== aircraftId.value) return;
      void refresh().then(() => followed.value++);
    });
    const result = await api.watch({ client, on: true });
    watching.value = result.ok && result.value.watching;
  }

  async function release(): Promise<void> {
    users = Math.max(0, users - 1);
    if (users > 0) return;
    off?.();
    off = undefined;
    offChanged?.();
    offChanged = undefined;
    watching.value = false;
    pressed.value = new Map();
    await api.watch({ client, on: false });
  }

  return {
    api,
    overview,
    loaded,
    loading,
    error,
    choice,
    game,
    aircraftId,
    sheet,
    deviceKey,
    device,
    follow,
    aircraftItems,
    title,
    followed,
    kneeboard,
    load,
    choose,
    refresh,
    setNote,
    pressed,
    axes,
    lastPress,
    watching,
    holdDevice,
    acquire,
    release,
  };
});
