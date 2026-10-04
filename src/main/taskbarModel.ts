import { commandArgs } from '../core/commandLine';
import type { JumpTask, TaskbarImage, TaskbarProgress, ThumbButton } from '../core/ports';
import {
  statusIcon,
  trayMenu,
  trayStatusLine,
  trayTone,
  trayTooltip,
  type TraySetup,
  type TrayStatus,
} from './trayModel';

/**
 * What RigReady's taskbar button shows and offers. Pure, like the tray's model next to it:
 * the shell hands the results to the Taskbar port.
 *
 *   Jump List   "Fly <setup>" for the setups used most recently (right-click the button)
 *   overlay     the status badge of the setup in use, with its words
 *   tooltip     the same line the tray shows
 *   progress    while a check, Make ready, Launch or Stand down runs
 *   buttons     Make ready, Launch and Stand down under the window's thumbnail
 */

/** More setups than this do not fit a Jump List anybody reads. */
export const JUMP_LIST_SETUPS = 6;

/** Used most recently first; setups never used come last, by name. */
function byLastUsed(a: TraySetup, b: TraySetup): number {
  if (a.lastUsed && b.lastUsed) return b.lastUsed.localeCompare(a.lastUsed) || byName(a, b);
  if (a.lastUsed) return -1;
  if (b.lastUsed) return 1;
  return byName(a, b);
}
const byName = (a: TraySetup, b: TraySetup): number =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** The Jump List: one task per setup, the most recently used first. */
export function jumpTasks(status: TrayStatus): JumpTask[] {
  return [...(status.profiles ?? [])]
    .sort(byLastUsed)
    .slice(0, JUMP_LIST_SETUPS)
    .map((setup) =>
      setup.canLaunch
        ? {
            title: `Fly ${setup.name}`,
            description: `Make the rig ready for ${setup.name} and launch it`,
            args: commandArgs({ action: 'fly', setup: setup.id }),
          }
        : {
            // Nothing to launch: the most this setup can be asked for is to be made ready.
            title: `Make ready: ${setup.name}`,
            description: `Make the rig ready for ${setup.name}`,
            args: commandArgs({ action: 'makeReady', setup: setup.id }),
          }
    );
}

/** Pixels per side of the icons handed to Windows, which scales them to the taskbar. */
export const TASKBAR_ICON_SIZE = 32;

/**
 * The badge on the taskbar button: the tray's shapes (a dot, a triangle, a square), so it is
 * never colour alone, with the status in words for a screen reader. None until checks ran.
 */
export function taskbarOverlay(
  status: TrayStatus
): { icon: TaskbarImage; description: string } | null {
  const tone = trayTone(status);
  if (!tone) return null;
  return {
    icon: {
      width: TASKBAR_ICON_SIZE,
      height: TASKBAR_ICON_SIZE,
      pixels: statusIcon(TASKBAR_ICON_SIZE, tone),
    },
    description: trayStatusLine(status),
  };
}

export const taskbarTooltip = trayTooltip;

export type TaskbarGlyph = 'makeReady' | 'launch' | 'standDown';

/** The distance from a point to a line segment. */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const along = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + along * dx), py - (ay + along * dy));
}

/** Whether a point of the unit square (0..1 both ways, y down) is inside the glyph. */
function inGlyph(glyph: TaskbarGlyph, x: number, y: number): boolean {
  if (glyph === 'makeReady') {
    // A check mark: two strokes.
    const stroke = 0.075;
    return (
      toSegment(x, y, 0.2, 0.54, 0.42, 0.76) <= stroke ||
      toSegment(x, y, 0.42, 0.76, 0.82, 0.26) <= stroke
    );
  }
  if (glyph === 'launch') {
    // A triangle pointing right: as tall as wide at its left edge, a point at its right.
    if (x < 0.28 || x > 0.8) return false;
    return Math.abs(y - 0.5) <= ((0.8 - x) / 0.52) * 0.32;
  }
  // Stand down: a square.
  return x >= 0.25 && x <= 0.75 && y >= 0.25 && y <= 0.75;
}

/** How far the dark edge reaches beyond the glyph, in the unit square. */
const EDGE = 0.05;
const AROUND = [0, 1, 2, 3, 4, 5, 6, 7].map((step) => {
  const angle = (step * Math.PI) / 4;
  return [Math.cos(angle) * EDGE, Math.sin(angle) * EDGE] as const;
});

/** The glyph, or within the edge's reach of it. */
function nearGlyph(glyph: TaskbarGlyph, x: number, y: number): boolean {
  return AROUND.some(([dx, dy]) => inGlyph(glyph, x + dx, y + dy));
}

/** The app's text colour and its background, as blue, green, red. */
const LIGHT = [0xed, 0xe9, 0xe6] as const;
const DARK = [0x17, 0x13, 0x0f] as const;

/**
 * A button's picture: a light glyph with a dark edge on nothing, so it reads on a dark
 * taskbar and on a light one. BGRA with the colour already multiplied by how much of the
 * pixel is covered (what Windows bitmaps hold), top row first; smoothed by sampling every
 * pixel sixteen times. Three shapes, so the buttons are told apart without their tooltips.
 */
export function paintGlyph(glyph: TaskbarGlyph, size = TASKBAR_ICON_SIZE): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const SAMPLES = 4;
  const all = SAMPLES * SAMPLES;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let filled = 0;
      let edged = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (inGlyph(glyph, x, y)) filled++;
          else if (nearGlyph(glyph, x, y)) edged++;
        }
      }
      if (filled + edged === 0) continue;
      const i = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel++) {
        pixels[i + channel] = Math.round((LIGHT[channel]! * filled + DARK[channel]! * edged) / all);
      }
      pixels[i + 3] = Math.round(((filled + edged) / all) * 255);
    }
  }
  return pixels;
}

const GLYPHS: Record<TaskbarGlyph, TaskbarImage> = {
  makeReady: image('makeReady'),
  launch: image('launch'),
  standDown: image('standDown'),
};
function image(glyph: TaskbarGlyph): TaskbarImage {
  return { width: TASKBAR_ICON_SIZE, height: TASKBAR_ICON_SIZE, pixels: paintGlyph(glyph) };
}

/**
 * The buttons under the window's thumbnail: what the tray's menu offers, enabled when the
 * tray's are. Always all three: Windows cannot take a button away again.
 */
export function thumbButtons(status: TrayStatus, busy = false): ThumbButton[] {
  const menu = trayMenu(status, busy);
  const enabled = (id: TaskbarGlyph): boolean =>
    menu.find((item) => item.id === id)?.enabled ?? false;
  const name = status.profileName;
  const of = (words: string): string => (name ? `${words}: ${name}` : words);
  return [
    {
      id: 'makeReady',
      tooltip: busy ? 'Working' : of('Make ready'),
      icon: GLYPHS.makeReady,
      enabled: enabled('makeReady'),
    },
    { id: 'launch', tooltip: of('Launch'), icon: GLYPHS.launch, enabled: enabled('launch') },
    {
      id: 'standDown',
      tooltip: of('Stand down'),
      icon: GLYPHS.standDown,
      enabled: enabled('standDown'),
    },
  ];
}

/**
 * Windows is told a thing about the taskbar button only when it is a different thing than
 * the last time: the Jump List is a file on disk, and nothing here should be rewritten on
 * every check.
 */
export class TaskbarTold {
  private readonly last = new Map<string, string>();
  /** True when `key` is news for `what`; it is remembered as told. */
  news(what: string, key: string): boolean {
    if (this.last.get(what) === key) return false;
    this.last.set(what, key);
    return true;
  }
}

const ACTIONS: Record<string, 'makeReady' | 'launch' | 'standDown' | 'fix'> = {
  'fly:makeReady': 'makeReady',
  'fly:launch': 'launch',
  'fly:standDown': 'standDown',
  'fly:fix': 'fix',
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

/**
 * What is running right now, as the shell sees it go by (every IPC call and every event the
 * features send), and the progress bar that says so on the taskbar button.
 */
export class TaskbarActivity {
  private checks = 0;
  private actions = 0;
  /** Steps of the Make ready or Launch in progress, by id: true once it has ended. */
  private steps = new Map<string, boolean>();

  /** An IPC call started. True when it is one the taskbar shows. */
  began(channel: string, input: unknown): boolean {
    // The Fly screen re-checks quietly every few seconds; only a check somebody asked for counts.
    if (channel === 'fly:check' && record(input)?.['remember'] !== false) {
      this.checks++;
      return true;
    }
    if (!(channel in ACTIONS)) return false;
    if (this.actions === 0) this.steps = new Map();
    this.actions++;
    return true;
  }

  /** The same call ended. */
  ended(channel: string, input: unknown): boolean {
    if (channel === 'fly:check' && record(input)?.['remember'] !== false) {
      this.checks = Math.max(0, this.checks - 1);
      return true;
    }
    if (!(channel in ACTIONS)) return false;
    this.actions = Math.max(0, this.actions - 1);
    if (this.actions === 0) this.steps = new Map();
    return true;
  }

  /** An event a feature sent to the window: Make ready and Launch report their steps. */
  event(channel: string, payload: unknown): boolean {
    if (this.actions === 0) return false;
    const event = record(payload);
    const state = event?.['state'];
    if (!event || typeof state !== 'string') return false;
    let id: string | undefined;
    if (channel === 'fly:event:progress' && typeof event['itemId'] === 'string')
      id = event['itemId'];
    // Steps after the launch run in the background and are not waited for.
    if (channel === 'fly:event:launchProgress' && event['phase'] !== 'postLaunch') {
      id = `${String(event['phase'])}:${String(event['id'])}`;
    }
    if (id === undefined) return false;
    this.steps.set(id, state !== 'pending' && state !== 'running');
    return true;
  }

  /** True while Make ready, Launch, Stand down or a single fix runs, whoever started it. */
  busy(): boolean {
    return this.actions > 0;
  }

  progress(): TaskbarProgress {
    if (this.actions > 0) {
      if (this.steps.size === 0) return { mode: 'indeterminate' };
      const done = [...this.steps.values()].filter(Boolean).length;
      // Never an empty bar while something runs.
      return { mode: 'normal', value: Math.max(0.05, done / this.steps.size) };
    }
    return this.checks > 0 ? { mode: 'indeterminate' } : { mode: 'none' };
  }
}
