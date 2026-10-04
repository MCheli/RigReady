/** What the tray shows. Pure, so it is unit-tested without Electron. */

export interface TraySetup {
  id: string;
  name: string;
  canLaunch: boolean;
  /** When it was last used (ISO), for offering the most recent ones first. */
  lastUsed?: string;
}

export interface TrayStatus {
  /** The setup shown on the Play screen. Undefined when there are no setups yet. */
  profileId?: string;
  profileName?: string;
  /** Every setup, for the quick switch. */
  profiles?: TraySetup[];
  /** From the last checklist run. Undefined until checks have run. */
  ready?: boolean;
  failed?: number;
  warnings?: number;
  fixable?: number;
  /** The required items that are not met, by title, in checklist order. */
  problems?: string[];
  /** The optional items that are not met, by title. */
  warningNames?: string[];
}

export type TrayAction = 'open' | 'makeReady' | 'launch' | 'standDown' | 'quit';

export interface TrayMenuItem {
  id: TrayAction | 'status' | 'separator' | 'setups' | `profile:${string}`;
  label: string;
  enabled: boolean;
  /** For a setup in the quick switch: the one in use. */
  checked?: boolean;
  submenu?: TrayMenuItem[];
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function trayStatusLine(status: TrayStatus): string {
  if (!status.profileName) return 'No setup yet';
  if (status.ready === undefined) return `${status.profileName}: not checked yet`;
  if (!status.ready)
    return `${status.profileName}: Not ready (${plural(status.failed ?? 0, 'problem')})`;
  if ((status.warnings ?? 0) > 0) {
    return `${status.profileName}: Ready (${plural(status.warnings ?? 0, 'warning')})`;
  }
  return `${status.profileName}: Ready`;
}

/** Windows cuts a tray tooltip off after this many characters. */
export const TOOLTIP_MAX = 127;

/** Names for a tooltip: as many as fit, then "and N more". */
function someOf(names: string[], room: number): string {
  let text = '';
  for (const [index, name] of names.entries()) {
    const left = names.length - index - 1;
    const next = text ? `${text}, ${name}` : name;
    const tail = left > 0 ? ` and ${left} more` : '';
    if (`${next}${tail}`.length > room) {
      const more = names.length - index;
      return text ? `${text} and ${more} more` : '';
    }
    text = next;
  }
  return text;
}

/**
 * What the pointer resting on the tray icon (and on the taskbar thumbnail) says: the setup,
 * its state, and what is wrong by name, so the window need not be opened to know. While
 * something runs it says so.
 */
export function trayTooltip(status: TrayStatus, busy = false): string {
  const line = `RigReady - ${trayStatusLine(status)}`;
  if (busy && status.profileName) return `RigReady - ${status.profileName}: working...`;
  const names =
    status.ready === false
      ? (status.problems ?? [])
      : status.ready === true
        ? (status.warningNames ?? [])
        : [];
  if (names.length === 0) return line.slice(0, TOOLTIP_MAX);
  const listed = someOf(names, TOOLTIP_MAX - line.length - 2);
  return listed ? `${line}: ${listed}` : line.slice(0, TOOLTIP_MAX);
}

export interface TrayWindowState {
  /** On screen: not hidden to the tray. */
  visible: boolean;
  minimized: boolean;
  /** It was the window in front when the click began. */
  inFront: boolean;
}

/**
 * What a click on the tray icon does with the window. A double-click always opens it. One
 * click does the sensible thing: it brings the window out when it is away, minimized or
 * behind something, and puts it away when it is what the user is looking at.
 */
export function trayClick(
  kind: 'click' | 'double-click',
  window: TrayWindowState
): 'show' | 'hide' {
  if (kind === 'double-click') return 'show';
  return window.visible && !window.minimized && window.inFront ? 'hide' : 'show';
}

/** The colour of the tray icon's badge: none until checks have run. */
export function trayTone(status: TrayStatus): 'ok' | 'warn' | 'bad' | undefined {
  if (!status.profileId || status.ready === undefined) return undefined;
  if (!status.ready) return 'bad';
  return (status.warnings ?? 0) > 0 ? 'warn' : 'ok';
}

/** Same colours as the app's status tokens (styles.css). */
export const TONE_RGB = {
  ok: [0x3f, 0xb9, 0x7f],
  warn: [0xe2, 0xb2, 0x3c],
  bad: [0xee, 0x63, 0x5b],
} as const;

/**
 * The badge's shape: status is never colour alone (NFR-011). Ready is a dot, a warning a
 * triangle, not ready a square, so the three read on a taskbar without telling green from
 * red. The words are in the tooltip and at the top of the tray menu (trayStatusLine).
 */
export const TONE_SHAPE = { ok: 'dot', warn: 'triangle', bad: 'square' } as const;
export type BadgeShape = (typeof TONE_SHAPE)[keyof typeof TONE_SHAPE];

function shapeOf(rgb: readonly [number, number, number]): BadgeShape {
  const tone = (Object.keys(TONE_RGB) as (keyof typeof TONE_RGB)[]).find((key) =>
    TONE_RGB[key].every((value, index) => value === rgb[index])
  );
  return tone ? TONE_SHAPE[tone] : 'dot';
}

/** Whether a point (relative to the badge's centre) is inside the shape of this half-size. */
function inside(shape: BadgeShape, dx: number, dy: number, half: number): boolean {
  if (shape === 'dot') return Math.hypot(dx, dy) <= half;
  if (shape === 'square') return Math.max(Math.abs(dx), Math.abs(dy)) <= half * 0.9;
  // A triangle pointing up: as wide as the dot at its base, narrowing to the top.
  if (dy < -half || dy > half * 0.9) return false;
  const widthHere = ((dy + half) / (half * 1.9)) * half;
  return Math.abs(dx) <= widthHere;
}

/**
 * Paints a status badge onto the bottom-right corner of a square BGRA bitmap (what
 * nativeImage.toBitmap() gives on Windows), with a dark ring so it reads on any taskbar. The
 * shape follows the tone (TONE_SHAPE) unless one is given.
 */
export function paintBadge(
  bitmap: Uint8Array,
  size: number,
  rgb: readonly [number, number, number],
  shape: BadgeShape = shapeOf(rgb)
): Uint8Array {
  const out = new Uint8Array(bitmap);
  const radius = size * 0.24;
  const ring = Math.max(1, size / 16);
  const cx = size - radius - ring;
  const cy = size - radius - ring;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (!inside(shape, dx, dy, radius + ring)) continue;
      const i = (y * size + x) * 4;
      const [r, g, b] = inside(shape, dx, dy, radius) ? rgb : ([0x0f, 0x13, 0x17] as const);
      out[i] = b;
      out[i + 1] = g;
      out[i + 2] = r;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * The status badge alone, filling a square picture (BGRA, clear around it): what the taskbar
 * button carries. The same shapes and colours as the badge on the tray icon.
 */
export function statusIcon(size: number, tone: keyof typeof TONE_RGB): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const shape = TONE_SHAPE[tone];
  const ring = Math.max(1, size / 16);
  const radius = size / 2 - ring - 0.5;
  const centre = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      if (!inside(shape, dx, dy, radius + ring)) continue;
      const i = (y * size + x) * 4;
      const [r, g, b] = inside(shape, dx, dy, radius)
        ? TONE_RGB[tone]
        : ([0x0f, 0x13, 0x17] as const);
      out[i] = b;
      out[i + 1] = g;
      out[i + 2] = r;
      out[i + 3] = 255;
    }
  }
  return out;
}

export function trayMenu(status: TrayStatus, busy = false): TrayMenuItem[] {
  const hasSetup = status.profileId !== undefined;
  const canLaunch = status.profiles?.find((p) => p.id === status.profileId)?.canLaunch ?? hasSetup;
  const setups = status.profiles ?? [];
  return [
    { id: 'open', label: 'Open RigReady', enabled: true },
    { id: 'separator', label: '', enabled: false },
    { id: 'status', label: trayStatusLine(status), enabled: false },
    ...(setups.length > 1
      ? [
          {
            id: 'setups' as const,
            label: 'Setup',
            enabled: !busy,
            submenu: setups.map((p) => ({
              id: `profile:${p.id}` as const,
              label: p.name,
              enabled: !busy,
              checked: p.id === status.profileId,
            })),
          },
        ]
      : []),
    {
      id: 'makeReady',
      label: busy ? 'Working...' : 'Make ready',
      enabled: !busy && hasSetup,
    },
    { id: 'launch', label: 'Launch', enabled: !busy && hasSetup && canLaunch },
    { id: 'standDown', label: 'Stand down', enabled: !busy && hasSetup },
    { id: 'separator', label: '', enabled: false },
    { id: 'quit', label: 'Quit', enabled: true },
  ];
}

/** Picks tray status out of an IPC answer from the fly feature, when it is one. */
export function statusFromFlyResponse(
  channel: string,
  value: unknown,
  current: TrayStatus
): TrayStatus | undefined {
  const record = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  if (channel === 'fly:state') {
    const state = record(value);
    const list = Array.isArray(state?.['profiles']) ? (state['profiles'] as unknown[]) : [];
    const profiles: TraySetup[] = list
      .map(record)
      .filter((p): p is Record<string, unknown> => typeof p?.['id'] === 'string')
      .map((p) => ({
        id: p['id'] as string,
        name: typeof p['name'] === 'string' ? p['name'] : (p['id'] as string),
        canLaunch: p['canLaunch'] === true,
        ...(typeof p['lastUsed'] === 'string' ? { lastUsed: p['lastUsed'] } : {}),
      }));
    const activeId =
      typeof state?.['activeProfileId'] === 'string' ? state['activeProfileId'] : undefined;
    const active = profiles.find((p) => p.id === activeId);
    if (!active) return { profiles };
    // Keep the last result while the same setup stays selected.
    return current.profileId === activeId
      ? { ...current, profileName: active.name, profiles }
      : { profileId: active.id, profileName: active.name, profiles };
  }
  if (channel === 'fly:check' || channel === 'fly:makeReady' || channel === 'fly:standDown') {
    const report = channel === 'fly:check' ? record(value) : record(record(value)?.['report']);
    if (!report || typeof report['ready'] !== 'boolean') return undefined;
    const profileId = typeof report['profileId'] === 'string' ? report['profileId'] : undefined;
    const number = (key: string): number => (typeof report[key] === 'number' ? report[key] : 0);
    const known = current.profiles?.find((p) => p.id === profileId);
    // What is not met, by title: required items are problems, optional ones warnings.
    const notMet = (required: boolean): string[] =>
      (Array.isArray(report['results']) ? (report['results'] as unknown[]) : [])
        .map(record)
        .filter(
          (r): r is Record<string, unknown> =>
            r !== undefined &&
            typeof r['title'] === 'string' &&
            r['required'] === required &&
            r['status'] !== 'pass' &&
            r['disabled'] !== true
        )
        .map((r) => r['title'] as string);
    return {
      ...(profileId === current.profileId ? current : {}),
      ...(current.profiles ? { profiles: current.profiles } : {}),
      ...(profileId ? { profileId } : {}),
      ...(known
        ? { profileName: known.name }
        : profileId === current.profileId && current.profileName
          ? { profileName: current.profileName }
          : profileId
            ? { profileName: profileId }
            : {}),
      ready: report['ready'],
      failed: number('failed'),
      warnings: number('warnings'),
      fixable: number('fixable'),
      problems: notMet(true),
      warningNames: notMet(false),
    };
  }
  return undefined;
}
