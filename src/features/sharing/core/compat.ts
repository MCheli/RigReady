import path from 'node:path';
import { z } from 'zod';
import type { MainContext } from '../../../core/feature';
import type { Profile } from '../../../core/profile/schema';

import { CompatibilitySchema, type Compatibility } from './schema';

export { CompatibilitySchema, type Compatibility };

type Ctx = Pick<MainContext, 'ports' | 'log' | 'games'>;

const hex4 = (v: unknown): string | undefined =>
  typeof v === 'string' && /^[0-9A-Fa-f]{4}$/.test(v) ? v.toUpperCase() : undefined;

const DisplaysParam = z.object({
  displays: z.array(
    z.object({
      enabled: z.boolean(),
      width: z.number().optional(),
      height: z.number().optional(),
      rotation: z.number().optional(),
      name: z.string().optional(),
    })
  ),
});

function displaySummary(
  displays: z.infer<typeof DisplaysParam>['displays']
): Compatibility['displays'] {
  const on = displays.filter((d) => d.enabled);
  const sizes = new Map<string, number>();
  for (const d of on) {
    const size =
      d.width && d.height
        ? `${d.width}×${d.height}${d.rotation ? ` rotated ${d.rotation}°` : ''}`
        : 'any size';
    sizes.set(size, (sizes.get(size) ?? 0) + 1);
  }
  const parts = [...sizes].map(([size, n]) => (n > 1 ? `${n} × ${size}` : size));
  return {
    count: on.length,
    summary: `${on.length} ${on.length === 1 ? 'monitor' : 'monitors'}${parts.length ? `: ${parts.join(', ')}` : ''}`,
  };
}

/** What the setup needs, read from its checks: devices, the game, helper apps, monitors. */
export async function requirementsOf(ctx: Ctx, profile: Profile): Promise<Compatibility> {
  const hardware: Compatibility['hardware'] = [];
  const software: Compatibility['software'] = [];
  let displays: Compatibility['displays'];
  for (const check of profile.checks) {
    const vendorId = hex4(check.params['vendorId']);
    const productId = hex4(check.params['productId']);
    if (vendorId && productId) {
      if (!hardware.some((h) => h.vendorId === vendorId && h.productId === productId)) {
        hardware.push({ name: check.title, vendorId, productId, required: check.required });
      }
      continue;
    }
    const process = check.params['name'];
    if (typeof process === 'string' && /\.exe$/i.test(process)) {
      software.push({ name: check.title, kind: 'app', required: check.required, process });
      continue;
    }
    const layout = DisplaysParam.safeParse(check.params);
    if (layout.success && !displays) displays = displaySummary(layout.data.displays);
  }
  if (profile.game) {
    const module = ctx.games.get(profile.game);
    let source: string | undefined;
    if (module) {
      const installs = await module.detect(ctx);
      if (installs.ok) source = installs.value[0]?.source;
    }
    software.unshift({
      name: module?.name ?? profile.game,
      kind: 'game',
      required: true,
      game: profile.game,
      ...(source ? { source } : {}),
    });
  }
  return { hardware, software, ...(displays ? { displays } : {}) };
}

/** The free-text notes a shared setup starts with. */
export function notesFor(name: string, compat: Compatibility): string {
  const lines = [`${name}, shared from RigReady.`];
  const required = compat.hardware.filter((h) => h.required);
  const optional = compat.hardware.filter((h) => !h.required);
  if (required.length) {
    lines.push('', 'Hardware it needs:');
    for (const h of required) lines.push(`- ${h.name} (${h.vendorId}:${h.productId})`);
  }
  if (optional.length) {
    lines.push('', 'Optional hardware:');
    for (const h of optional) lines.push(`- ${h.name} (${h.vendorId}:${h.productId})`);
  }
  if (compat.software.length) {
    lines.push('', 'Software:');
    for (const s of compat.software) {
      lines.push(`- ${s.name}${s.kind === 'app' && !s.required ? ' (optional)' : ''}`);
    }
  }
  if (compat.displays) lines.push('', `Monitors: ${compat.displays.summary}.`);
  return lines.join('\n');
}

export interface CompatibilityReport {
  devices: {
    name: string;
    vendorId: string;
    productId: string;
    required: boolean;
    present: boolean;
  }[];
  software: {
    name: string;
    kind: 'game' | 'app';
    required: boolean;
    found: boolean;
    detail: string;
  }[];
  displays?: { needed: number; here: number; summary: string };
}

const UNINSTALL = [
  ['HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKLM', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
] as const;

/** Programs Windows lists as installed: lower-case exe names from their icons and install folders. */
async function installedPrograms(ctx: Ctx): Promise<{ exes: Set<string>; folders: string[] }> {
  const exes = new Set<string>();
  const folders: string[] = [];
  for (const [hive, key] of UNINSTALL) {
    const keys = await ctx.ports.registry.listKeys(hive, key);
    if (!keys.ok) continue;
    for (const sub of keys.value) {
      const values = await ctx.ports.registry.listValues(hive, `${key}\\${sub}`);
      if (!values.ok) continue;
      const icon = values.value['DisplayIcon'];
      if (icon?.type === 'string') {
        exes.add(
          path.win32.basename(icon.value.replace(/"/g, '').replace(/,\s*-?\d+$/, '')).toLowerCase()
        );
      }
      const location = values.value['InstallLocation'];
      if (location?.type === 'string' && location.value.trim()) folders.push(location.value.trim());
    }
  }
  return { exes, folders };
}

/** True when the program is in a folder (or a folder's folder) of Program Files or the user's Programs. */
async function inProgramFolders(ctx: Ctx, exe: string): Promise<boolean> {
  const { folders, files } = ctx.ports;
  const roots = [
    folders.programFiles(),
    folders.programFilesX86(),
    path.join(folders.localAppData(), 'Programs'),
  ];
  for (const root of roots) {
    const first = await files.listEntries(root);
    if (!first.ok) continue;
    for (const dir of first.value.filter((e) => e.isDirectory)) {
      if (await files.exists(path.join(dir.path, exe))) return true;
      const second = await files.listEntries(dir.path);
      if (!second.ok) continue;
      for (const sub of second.value.filter((e) => e.isDirectory)) {
        if (await files.exists(path.join(sub.path, exe))) return true;
      }
    }
  }
  return false;
}

/** The setup's requirements against this PC. */
export async function compareWithMachine(
  ctx: Ctx,
  compat: Compatibility
): Promise<CompatibilityReport> {
  const devices = await ctx.ports.devices.list();
  const present = devices.ok ? devices.value : [];
  const processes = await ctx.ports.processes.list();
  const running = new Set((processes.ok ? processes.value : []).map((p) => p.name.toLowerCase()));
  const installed = await installedPrograms(ctx);
  const software: CompatibilityReport['software'] = [];
  for (const s of compat.software) {
    if (s.kind === 'game') {
      const module = s.game ? ctx.games.get(s.game) : undefined;
      if (!module) {
        software.push({
          name: s.name,
          kind: 'game',
          required: s.required,
          found: false,
          detail: 'RigReady does not know this game',
        });
        continue;
      }
      const installs = await module.detect(ctx);
      const first = installs.ok ? installs.value[0] : undefined;
      software.push({
        name: s.name,
        kind: 'game',
        required: s.required,
        found: first !== undefined,
        detail: !first
          ? 'Not installed on this PC'
          : s.source && s.source !== first.source
            ? `Installed (${first.source}; the setup was made with the ${s.source} version)`
            : `Installed (${first.source})`,
      });
      continue;
    }
    const exe = (s.process ?? '').toLowerCase();
    let found = running.has(exe) ? 'Running now' : undefined;
    if (!found && installed.exes.has(exe)) found = 'Installed';
    if (!found && s.process && (await inProgramFolders(ctx, s.process))) found = 'Installed';
    if (!found) {
      for (const folder of installed.folders) {
        if (await ctx.ports.files.exists(path.join(folder, s.process ?? ''))) {
          found = 'Installed';
          break;
        }
      }
    }
    software.push({
      name: s.name,
      kind: 'app',
      required: s.required,
      found: found !== undefined,
      detail: found ?? 'Not found on this PC',
    });
  }
  const report: CompatibilityReport = {
    devices: compat.hardware.map((h) => ({
      ...h,
      present: present.some((d) => d.vendorId === h.vendorId && d.productId === h.productId),
    })),
    software,
  };
  if (compat.displays) {
    const layout = await ctx.ports.displays.read();
    report.displays = {
      needed: compat.displays.count,
      here: layout.ok ? layout.value.displays.length : 0,
      summary: compat.displays.summary,
    };
  }
  return report;
}
