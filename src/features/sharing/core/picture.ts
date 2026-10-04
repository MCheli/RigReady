import path from 'node:path';
import { z } from 'zod';
import type { MainContext } from '../../../core/feature';
import { sha256 } from '../../../core/files/fileStore';
import type { Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import { privacyContext, Scanner } from './privacy';
import type { PictureShape } from './schema';

/**
 * A picture of a setup to show other people: its name and game, the monitors drawn to
 * scale, every controller with an icon and the name the owner gave it, and the helper apps.
 * It is a PNG made by the Render port from a page built here, with nothing in it that
 * identifies the PC or its owner: every text goes through the same privacy scan as a shared
 * setup, and ids, serials and paths are never asked for in the first place.
 */

export type PictureCtx = Pick<MainContext, 'ports' | 'log' | 'profiles' | 'games' | 'names'>;

/** 16:9 for a forum post or a video, square for a profile picture or a social post. */
export const PICTURE_SIZES: Record<PictureShape, { width: number; height: number }> = {
  wide: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
};

export type DeviceKind =
  'stick' | 'throttle' | 'pedals' | 'wheel' | 'panel' | 'screen' | 'tracker' | 'deck' | 'other';

export interface PictureMonitor {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

export interface PictureDevice {
  /** The owner's name for it, else what the setup calls it. */
  name: string;
  /** What the hardware calls itself, when the owner gave it another name. */
  model?: string;
  kind: DeviceKind;
  optional: boolean;
}

export interface PictureModel {
  name: string;
  game?: string;
  monitors: PictureMonitor[];
  /** Where the arrangement comes from: the setup's own layout check, or the monitors as they are now. */
  monitorsFrom: 'setup' | 'now' | 'none';
  devices: PictureDevice[];
  apps: { name: string; optional: boolean }[];
}

// The order matters: a throttle with "handle" in its name is not a stick, pedals with
// "rudder" are not a panel.
const KINDS: [DeviceKind, RegExp][] = [
  ['deck', /stream ?deck|loupedeck/i],
  ['tracker', /track ?ir|tobii|head ?track|smoothtrack|opentrack/i],
  ['wheel', /wheel|podium|fanatec|simucube|moza|\bdd ?\d|clubsport|\bcsl\b|simagic/i],
  ['pedals', /pedal|rudder|\btpr\b|crosswind|slaw/i],
  ['throttle', /throttle|collective|quadrant|\btqs\b/i],
  ['screen', /\bmfd|display|\bscreen|monitor/i],
  ['panel', /panel|\bufc|\bicp\b|\bhud\b|button ?box|\bbox\b|\bvpc\b|\bpto\b|switch|keypad/i],
  ['stick', /stick|gladiator|warthog|hotas|\bgrip\b|jgrip|cyclic|orion|alpha|constellation/i],
];

/** What kind of gear a device is, from what it is called. */
export function deviceKind(...names: (string | undefined)[]): DeviceKind {
  const text = names.filter(Boolean).join(' ');
  return KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}

const hex4 = (v: unknown): string | undefined =>
  typeof v === 'string' && /^[0-9A-Fa-f]{4}$/.test(v) ? v.toUpperCase() : undefined;
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const DisplaysParam = z.object({
  displays: z.array(
    z.object({
      id: z.string(),
      name: z.string().default(''),
      enabled: z.boolean(),
      primary: z.boolean().default(false),
      x: z.number().default(0),
      y: z.number().default(0),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      rotation: z.number().default(0),
    })
  ),
});

const sideways = (rotation: number): boolean => rotation === 90 || rotation === 270;

/** Everything the picture shows, read from the setup and the names the owner gave things. */
export async function pictureModel(ctx: PictureCtx, profile: Profile): Promise<PictureModel> {
  const checks = profile.checks.filter((c) => !c.disabled);
  const serials = checks.map((c) => text(c.params['serial'])).filter((s): s is string => !!s);
  const scanner = new Scanner(await privacyContext(ctx, ctx.games, serials));
  /** Nothing personal survives: a user name becomes "user", a PC name "my-pc", a serial is removed. */
  const clean = (value: string): string =>
    scanner
      .transform(value, 'Picture', 'profile', () => 'remove')
      .replace(/\s+/g, ' ')
      .trim();

  // ---- controllers ----
  const names = await ctx.names.devices();
  const found = checks.flatMap((check) => {
    const vendorId = hex4(check.params['vendorId']);
    const productId = hex4(check.params['productId']);
    if (!vendorId || !productId) return [];
    const serial = text(check.params['serial']);
    const instanceId = text(check.params['instanceId']);
    // The name of this very unit when the registry can tell, else the model's (the
    // registry says nothing when several identical devices have different names).
    const given =
      names.nameOf({
        vendorId,
        productId,
        ...(serial ? { serial } : {}),
        ...(instanceId ? { instanceId } : {}),
      }) ?? names.nameOf({ vendorId, productId });
    return [
      {
        model: `${vendorId}:${productId}`,
        unit: serial ?? instanceId,
        title: check.title,
        given,
        optional: !check.required,
      },
    ];
  });
  // One entry per device: a check that names a unit (by serial or port) stands for the
  // model's general check, and the same unit asked for twice is one device.
  const seen = new Set<string>();
  const devices: PictureDevice[] = [];
  for (const d of found) {
    const general = found.find((o) => o.model === d.model && o.unit === undefined);
    const specific = found.some((o) => o.model === d.model && o.unit !== undefined);
    if (d.unit === undefined && specific) continue;
    const key = `${d.model}/${d.unit ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // What the hardware is called: the general check carries the product's own name.
    const title = general?.title ?? d.title;
    const name = clean(d.given ?? title);
    const model = d.given && d.given.trim() !== title.trim() ? clean(title) : undefined;
    devices.push({
      name: name || 'Controller',
      ...(model ? { model } : {}),
      kind: deviceKind(d.given, title, d.title),
      optional: d.optional,
    });
  }

  // ---- helper apps ----
  const apps = checks.flatMap((check) => {
    const program = text(check.params['name']);
    if (!program || !/\.exe$/i.test(program)) return [];
    return [{ name: clean(check.title) || 'Helper app', optional: !check.required }];
  });

  // ---- monitors ----
  const monitorNames = await ctx.names.monitors();
  const current = await ctx.ports.displays.read();
  const connected = current.ok ? current.value.displays : [];
  const layout = checks
    .map((c) => DisplaysParam.safeParse(c.params))
    .find((parsed) => parsed.success && parsed.data.displays.some((d) => d.enabled));
  let monitors: PictureMonitor[] = [];
  let monitorsFrom: PictureModel['monitorsFrom'] = 'none';
  if (layout?.success) {
    monitorsFrom = 'setup';
    monitors = layout.data.displays
      .filter((d) => d.enabled)
      .map((d) => {
        const have = connected.find((c) => c.id.toLowerCase() === d.id.toLowerCase());
        let { width, height } = d;
        if ((width === undefined || height === undefined) && have && have.width > 0) {
          const turn = sideways(d.rotation) !== sideways(have.rotation);
          width = turn ? have.height : have.width;
          height = turn ? have.width : have.height;
        }
        const upright = sideways(d.rotation);
        return {
          label: clean(monitorNames[d.id.toLowerCase()] ?? d.name) || 'Monitor',
          x: d.x,
          y: d.y,
          width: width ?? (upright ? 1080 : 1920),
          height: height ?? (upright ? 1920 : 1080),
          primary: d.primary,
        };
      });
  } else if (connected.some((d) => d.enabled && d.width > 0)) {
    monitorsFrom = 'now';
    monitors = connected
      .filter((d) => d.enabled && d.width > 0)
      .map((d) => ({
        label: clean(monitorNames[d.id.toLowerCase()] ?? d.name) || 'Monitor',
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        primary: d.primary,
      }));
  }

  const game = profile.game ? (ctx.games.get(profile.game)?.name ?? profile.game) : undefined;
  return {
    name: clean(profile.name) || 'Setup',
    ...(game ? { game: clean(game) } : {}),
    monitors,
    monitorsFrom,
    devices,
    apps,
  };
}

// ---- the page ----

const C = {
  bg: '#0f1317',
  surface: '#171c22',
  raised: '#1e252d',
  border: '#2b333d',
  line: '#3a4350',
  text: '#e6e9ed',
  muted: '#8b95a3',
  accent: '#5aa9e6',
};

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** One line icon per kind of gear, on a 24 by 24 grid. */
const ICONS: Record<DeviceKind, string> = {
  stick:
    '<path d="M5 20h14M7 20v-2.2h10V20M12 17.8V9.4M9.4 9.4h5.2l-.7-4.3a1.9 1.9 0 0 0-3.8 0z"/>',
  throttle:
    '<path d="M4 20h16M6 20v-3h12v3M8.8 17l2.6-7.6M9.9 8.9l4 1.3 1.1-3.4-4-1.3z"/><path d="M14.5 17v-4"/>',
  pedals:
    '<path d="M4 19.5h16M6.4 19.5L7.6 6.5h3l.8 13M12.6 19.5l.8-13h3l1.2 13M7.2 10.5h3.6M13.2 10.5h3.6"/>',
  wheel:
    '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="2.1"/><path d="M12 14.1v6.3M10.1 11.2L3.9 9.6M13.9 11.2l6.2-1.6"/>',
  panel:
    '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M7 9.3v2.2M10.3 9.3v2.2M13.7 9.3v2.2M17 9.3v2.2M7 14.6h.01M10.3 14.6h.01M13.7 14.6h.01M17 14.6h.01"/>',
  screen:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><rect x="7.2" y="7.2" width="9.6" height="9.6" rx="0.6"/><path d="M9 5.4h.01M12 5.4h.01M15 5.4h.01M9 18.6h.01M12 18.6h.01M15 18.6h.01M5.4 9h.01M5.4 12h.01M5.4 15h.01M18.6 9h.01M18.6 12h.01M18.6 15h.01"/>',
  tracker:
    '<path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z"/><circle cx="12" cy="12" r="2.7"/>',
  deck: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M6.4 8.6h2.8v2.4H6.4zM10.6 8.6h2.8v2.4h-2.8zM14.8 8.6h2.8v2.4h-2.8zM6.4 13h2.8v2.4H6.4zM10.6 13h2.8v2.4h-2.8zM14.8 13h2.8v2.4h-2.8z"/>',
  other:
    '<path d="M7.4 8h9.2a4.4 4.4 0 0 1 4.4 4.4v1.2a3 3 0 0 1-5.7 1.3l-.5-1H9.2l-.5 1A3 3 0 0 1 3 13.6v-1.2A4.4 4.4 0 0 1 7.4 8z"/><path d="M7.6 10v2.8M6.2 11.4H9M15.8 10.6h.01M17.5 12.3h.01"/>',
};

const icon = (kind: DeviceKind, size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${C.accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`;

const px = (value: number): string => `${Math.round(value * 10) / 10}px`;

/** The monitors to scale inside a box of `width` by `height`, centred. */
function monitorsHtml(monitors: PictureMonitor[], width: number, height: number): string {
  if (monitors.length === 0) {
    return `<div class="none" style="width:${width}px;height:${height}px">This setup does not arrange the monitors.</div>`;
  }
  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const spanX = Math.max(...monitors.map((m) => m.x + m.width)) - minX;
  const spanY = Math.max(...monitors.map((m) => m.y + m.height)) - minY;
  const scale = Math.min(width / spanX, height / spanY);
  const left = (width - spanX * scale) / 2;
  const top = (height - spanY * scale) / 2;
  const boxes = monitors
    .map((m) => {
      const w = m.width * scale;
      const h = m.height * scale;
      // The name runs up a screen that is too narrow to write it across.
      const upright = w < 150 && h > w;
      const room = upright ? h : w;
      const size = Math.max(13, Math.min(30, room / Math.max(6, m.label.length * 0.62)));
      const small = Math.max(11, Math.min(18, size * 0.62));
      const showSize = (upright ? w : h) > size * 2.6 + small && room > 110;
      return (
        `<div class="mon${m.primary ? ' main' : ''}${upright ? ' up' : ''}" data-monitor="${escapeHtml(m.label)}" ` +
        `style="left:${px(left + (m.x - minX) * scale)};top:${px(top + (m.y - minY) * scale)};width:${px(w)};height:${px(h)}">` +
        `<div class="mon-text"><b style="font-size:${px(size)}">${escapeHtml(m.label)}</b>` +
        (showSize ? `<i style="font-size:${px(small)}">${m.width} × ${m.height}</i>` : '') +
        `</div>${m.primary ? '<span class="star">★</span>' : ''}</div>`
      );
    })
    .join('');
  return `<div class="map" style="width:${width}px;height:${height}px">${boxes}</div>`;
}

/** How the controllers are laid out for how many there are and how much room they have. */
export function deviceGrid(
  count: number,
  width: number,
  height: number
): { columns: number; shown: number; rowHeight: number; compact: boolean } {
  for (let columns = 1; columns <= 6; columns++) {
    const rows = Math.ceil(count / columns);
    const rowHeight = Math.floor(height / Math.max(1, rows));
    const cellWidth = width / columns;
    // Comfortable: a row tall enough for the icon and two lines, a cell wide enough for a name.
    if (rowHeight >= 74 && cellWidth >= 400) {
      return { columns, shown: count, rowHeight: Math.min(rowHeight, 104), compact: false };
    }
  }
  // A big rig, or little room: smaller rows, as many columns as the names can stand, and
  // the rest counted.
  const columns = Math.max(1, Math.floor(width / 300));
  const fit = Math.max(1, Math.floor(height / 58));
  const shown = Math.min(count, columns * fit);
  const rows = Math.ceil(shown / columns);
  const rowHeight = Math.max(58, Math.min(74, Math.floor(height / rows)));
  return { columns, shown, rowHeight, compact: true };
}

function devicesHtml(devices: PictureDevice[], width: number, height: number): string {
  if (devices.length === 0) {
    return `<div class="none" style="width:${width}px;height:${height}px">This setup checks no controllers.</div>`;
  }
  const grid = deviceGrid(devices.length, width, height);
  // The last place says how many more there are, when not all fit.
  const all = grid.shown >= devices.length;
  const shown = all ? devices : devices.slice(0, grid.shown - 1);
  const tile = grid.compact ? 40 : Math.min(64, grid.rowHeight - 22);
  const cells = shown.map(
    (d) =>
      `<div class="dev" data-kind="${d.kind}" style="height:${grid.rowHeight}px">` +
      `<div class="tile" style="width:${tile}px;height:${tile}px">${icon(d.kind, Math.round(tile * 0.66))}</div>` +
      `<div class="dev-text"><b>${escapeHtml(d.name)}</b>` +
      (d.model || d.optional
        ? `<i>${escapeHtml([d.model, d.optional ? 'optional' : ''].filter(Boolean).join(' · '))}</i>`
        : '') +
      `</div></div>`
  );
  if (!all) {
    cells.push(
      `<div class="dev more" style="height:${grid.rowHeight}px"><div class="dev-text"><b>and ${devices.length - shown.length} more</b></div></div>`
    );
  }
  return `<div class="devs${grid.compact ? ' compact' : ''}" style="width:${width}px;grid-template-columns:repeat(${grid.columns},1fr)">${cells.join('')}</div>`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The whole picture as a page of exactly the size of its shape. No script, no outside files. */
export function pictureHtml(model: PictureModel, shape: PictureShape): string {
  const { width, height } = PICTURE_SIZES[shape];
  const wide = shape === 'wide';
  const margin = wide ? 72 : 60;
  const inner = width - margin * 2;
  const headHeight = wide ? 158 : 150;
  const footHeight = 56;
  const label = 40;
  const gap = 26;
  // The helper apps take one line: beside their heading where there is room, under it otherwise.
  const appsHeight = model.apps.length === 0 ? 0 : wide ? 52 : label + 52;
  const bodyTop = margin + headHeight;
  const bodyHeight = height - bodyTop - margin - footHeight;

  // The monitors are the widest thing on a rig, so they go across the top, as tall as their
  // shape asks for within limits; the controllers get what is left.
  const span = (from: (m: PictureMonitor) => number, size: (m: PictureMonitor) => number) =>
    Math.max(...model.monitors.map((m) => from(m) + size(m))) -
    Math.min(...model.monitors.map(from));
  const mapHeight =
    model.monitors.length === 0
      ? 110
      : Math.round(
          Math.max(
            170,
            Math.min(
              wide ? 300 : 320,
              (inner *
                span(
                  (m) => m.y,
                  (m) => m.height
                )) /
                span(
                  (m) => m.x,
                  (m) => m.width
                )
            )
          )
        );
  const devicesHeight =
    bodyHeight - label * 2 - mapHeight - gap - (appsHeight ? appsHeight + gap : 0);

  const chips = model.apps
    .map(
      (a) =>
        `<span class="app" data-app="${escapeHtml(a.name)}">${escapeHtml(a.name)}${a.optional ? '<i>optional</i>' : ''}</span>`
    )
    .join('');
  const apps =
    model.apps.length === 0
      ? ''
      : `<div class="gap"></div><div class="apps-row"><div class="label">Helper apps · ${model.apps.length}</div><div class="apps">${chips}</div></div>`;

  const body =
    `<div class="col" style="left:${margin}px;top:${bodyTop}px;width:${inner}px">` +
    `<div class="label">Monitors · ${model.monitors.length}</div>` +
    monitorsHtml(model.monitors, inner, mapHeight) +
    `<div class="gap"></div><div class="label">Controllers · ${model.devices.length}</div>` +
    devicesHtml(model.devices, inner, devicesHeight) +
    apps +
    `</div>`;

  const counts = [
    plural(model.monitors.length, 'monitor', 'monitors'),
    plural(model.devices.length, 'controller', 'controllers'),
    ...(model.apps.length ? [plural(model.apps.length, 'helper app', 'helper apps')] : []),
  ].join(' · ');
  const titleSize = Math.max(
    44,
    Math.min(wide ? 84 : 72, (inner * 1.55) / Math.max(8, model.name.length))
  );

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(model.name)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:${C.bg};color:${C.text};font-family:"Segoe UI",Inter,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:${width}px;height:${height}px;background:${C.bg}}
.frame{position:absolute;inset:${margin / 2}px;border:1px solid ${C.border};border-radius:18px}
.head{position:absolute;left:${margin}px;top:${margin}px;width:${inner}px;height:${headHeight}px}
.head h1{font-size:${px(titleSize)};font-weight:650;letter-spacing:-0.01em;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head p{margin-top:10px;font-size:${wide ? 30 : 28}px;color:${C.muted}}
.col{position:absolute}
.label{height:${label}px;font-size:19px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${C.muted}}
.gap{height:${gap}px}
.map{position:relative}
.mon{position:absolute;border:2px solid ${C.line};background:${C.surface};border-radius:6px;overflow:hidden}
.mon.main{border-color:${C.accent}}
.mon-text{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px;text-align:center}
.mon.up .mon-text{writing-mode:vertical-rl;transform:rotate(180deg)}
.mon b{font-weight:600;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.mon.up b{max-width:none;max-height:100%}
.mon i{font-style:normal;color:${C.muted};font-variant-numeric:tabular-nums;white-space:nowrap}
.star{position:absolute;top:6px;right:9px;font-size:17px;color:${C.accent}}
.mon.up .star{top:4px;right:4px;font-size:13px}
.devs{display:grid;column-gap:28px}
.dev{display:flex;align-items:center;gap:18px;min-width:0}
.tile{flex:none;display:flex;align-items:center;justify-content:center;border:1px solid ${C.border};border-radius:14px;background:${C.surface}}
.dev-text{min-width:0}
.dev b{display:block;font-size:23px;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dev i{display:block;margin-top:3px;font-style:normal;font-size:16px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.devs.compact .dev{gap:12px}
.devs.compact .tile{border-radius:10px}
.devs.compact .dev b{font-size:20px}
.devs.compact .dev i{font-size:14px;margin-top:1px}
.dev.more b{color:${C.muted};font-weight:500}
.apps-row{display:flex;flex-direction:${wide ? 'row' : 'column'};${wide ? 'align-items:center;gap:28px;' : ''}height:${appsHeight}px}
.apps-row .label{flex:none;${wide ? 'height:auto;' : ''}}
.apps{display:flex;flex-wrap:wrap;gap:12px;height:52px;overflow:hidden;min-width:0}
.app{display:inline-flex;align-items:baseline;gap:10px;padding:8px 20px;border:1px solid ${C.border};border-radius:999px;background:${C.surface};font-size:22px;font-weight:500;white-space:nowrap}
.app i{font-style:normal;font-size:15px;color:${C.muted};font-weight:400}
.none{display:flex;align-items:center;justify-content:center;border:1px dashed ${C.border};border-radius:10px;color:${C.muted};font-size:22px}
.foot{position:absolute;left:${margin}px;bottom:${margin}px;width:${inner}px;height:${footHeight - 16}px;border-top:1px solid ${C.border};padding-top:14px;display:flex;justify-content:space-between;font-size:18px;color:${C.muted}}
.foot b{color:${C.text};font-weight:600;letter-spacing:.02em}
</style></head><body><div class="page" data-shape="${shape}">
<div class="frame"></div>
<div class="head"><h1>${escapeHtml(model.name)}</h1>${model.game ? `<p>${escapeHtml(model.game)}</p>` : ''}</div>
${body}
<div class="foot"><span>${escapeHtml(counts)}</span><span>Made with <b>RigReady</b></span></div>
</div></body></html>`;
}

// ---- rendering and saving ----

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height of a PNG, read from its header; undefined when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface RenderedPicture {
  png: Uint8Array;
  width: number;
  height: number;
  model: PictureModel;
}

/** The picture of one setup as PNG bytes of exactly the size of the shape. */
export async function renderPicture(
  ctx: PictureCtx,
  profileId: string,
  shape: PictureShape
): Promise<Result<RenderedPicture>> {
  const profile = await ctx.profiles.get(profileId);
  if (!profile.ok) return profile;
  const model = await pictureModel(ctx, profile.value);
  const size = PICTURE_SIZES[shape];
  const html = pictureHtml(model, shape);
  // The first capture of a new window can come before its first frame; the same request
  // then works a moment later.
  let png = await ctx.ports.render.png(html, size);
  for (let attempt = 1; !png.ok && png.error.code === 'render.png' && attempt < 4; attempt++) {
    png = await ctx.ports.render.png(html, size);
  }
  if (!png.ok) return png;
  const got = pngSize(png.value);
  if (!got || got.width !== size.width || got.height !== size.height) {
    return err('share.picture', 'The picture did not come out at the size it should have.');
  }
  return ok({ png: png.value, ...size, model });
}

export interface PicturePreview {
  /** The PNG as a data URL: exactly what Save writes. */
  image: string;
  width: number;
  height: number;
  monitors: number;
  controllers: number;
  apps: number;
  monitorsFrom: PictureModel['monitorsFrom'];
}

const previewOf = ({ png, width, height, model }: RenderedPicture): PicturePreview => ({
  image: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
  width,
  height,
  monitors: model.monitors.length,
  controllers: model.devices.length,
  apps: model.apps.length,
  monitorsFrom: model.monitorsFrom,
});

export async function picturePreview(
  ctx: PictureCtx,
  profileId: string,
  shape: PictureShape
): Promise<Result<PicturePreview>> {
  const rendered = await renderPicture(ctx, profileId, shape);
  return rendered.ok ? ok(previewOf(rendered.value)) : rendered;
}

/** What Save wrote: where, how large, and the picture itself, for the page to show. */
export interface SavedPicture extends PicturePreview {
  path: string;
  size: number;
}

/**
 * Renders the picture and writes it where the user says. Resolves with null when they
 * cancel. It answers with the path only after the file has been read back and is, byte
 * for byte, the picture; and it answers with that picture, so what the page shows next to
 * "Saved" is the file even if the rig changed since the preview was drawn.
 */
export async function savePicture(
  ctx: PictureCtx,
  profileId: string,
  shape: PictureShape
): Promise<Result<SavedPicture | null>> {
  const rendered = await renderPicture(ctx, profileId, shape);
  if (!rendered.ok) return rendered;
  const { png, model } = rendered.value;
  const safeName = model.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Setup';
  const target = await ctx.ports.dialogs.save({
    title: 'Save a picture of this setup',
    defaultPath: path.join(
      ctx.ports.folders.documents(),
      `${safeName}${shape === 'square' ? ' (square)' : ''}.png`
    ),
    filters: [{ name: 'PNG picture', extensions: ['png'] }],
  });
  if (!target.ok) return target;
  if (target.value === null) return ok(null);
  const file = /\.png$/i.test(target.value) ? target.value : `${target.value}.png`;
  const written = await ctx.ports.files.write(file, png, {
    reason: `Save a picture of ${model.name}`,
  });
  if (!written.ok) return written;
  const back = await ctx.ports.files.readBytes(file);
  if (!back.ok || sha256(back.value) !== sha256(png)) {
    return err('share.picture', `The file at ${file} is not the picture that was written.`);
  }
  ctx.log.info(`saved a picture of ${profileId}`, { file, bytes: png.length, shape });
  return ok({ path: file, size: png.length, ...previewOf(rendered.value) });
}
