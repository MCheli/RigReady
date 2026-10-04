import path from 'node:path';
import {
  dcsGuidText,
  identityForGuid,
  readDirectInputIdentities,
  sameGuid,
} from '../../../core/directInput';
import { parseLuaData, writeLuaDocument } from '../../../core/lua/data';
import { err, ok, type Result } from '../../../core/result';
import type { InputDevice } from '../../../shared/models';
import type { DcsBindings } from './bindings';
import { PlanBuilder, executePlan, planView, type Applied, type ChangePlan } from './changes';
import { comboId, putCombo, readDiff, type DiffSection } from './diff';
import type { Candidate, Mapping, MigrationScan, Orphan } from './model';
import { DEVICE_TYPES, diffFileNameFor, fullIdFor, parseDiffFileName, splitFullId } from './names';

/**
 * Device id (GUID) migration (docs/research/dcs.md 2). Windows hands a controller a new
 * DirectInput instance GUID after a reinstall, a move to a new PC or a driver reset;
 * DCS then looks for "<name> {new GUID}.diff.lua" and the user's bindings, still under
 * the old GUID, appear lost. Migration renames those files in every aircraft folder and
 * rewrites the ids inside modifiers.lua, disabled.lua and wizard.lua, as one undoable
 * change. Identical devices are never guessed between: the user picks.
 */

export type { Candidate, Mapping, MigrationScan, Orphan };

const REFERENCE_FILES = ['modifiers.lua', 'disabled.lua', 'wizard.lua'];
const FULL_ID_IN_TEXT =
  /([^"'\n[\]]+?) \{([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}/g;

const identityKey = (name: string, guid: string): string => `${name} {${guid.toUpperCase()}}`;

interface Found {
  name: string;
  guid: string;
  files: { path: string; folder: string; type: string }[];
  references: Set<string>;
}

interface Scanned {
  scan: MigrationScan;
  connected: InputDevice[];
  /** Text of every reference file, by path. */
  referenceTexts: Map<string, string>;
}

async function scan(bindings: DcsBindings): Promise<Result<Scanned>> {
  const { ports } = bindings.ctx;
  const locations = await bindings.locations();
  const connected = await bindings.connectedDevices();
  const identities = await readDirectInputIdentities(ports.registry);
  const known = identities.ok ? identities.value : [];

  const found = new Map<string, Found>();
  /** Per attached device id: the folders (and device types) that already hold a file for it. */
  const liveFiles = new Map<string, Set<string>>();
  const referenceTexts = new Map<string, string>();
  const isLive = (name: string, guid: string): boolean =>
    connected.some((d) => d.name === name && sameGuid(d.guid, guid));
  const note = (name: string, guid: string): Found => {
    const key = identityKey(name, guid);
    const entry = found.get(key) ?? { name, guid, files: [], references: new Set<string>() };
    found.set(key, entry);
    return entry;
  };
  const readReferences = async (file: string): Promise<void> => {
    if (!(await ports.files.exists(file))) return;
    const text = await ports.files.readText(file);
    if (!text.ok) return;
    referenceTexts.set(file, text.value);
    for (const match of text.value.matchAll(FULL_ID_IN_TEXT)) {
      if (!isLive(match[1]!, match[2]!)) note(match[1]!, match[2]!).references.add(file);
    }
  };

  const folders = await ports.files.listEntries(locations.inputDir);
  if (!folders.ok) return folders;
  for (const name of REFERENCE_FILES) await readReferences(path.join(locations.inputDir, name));
  for (const folder of folders.value.filter((f) => f.isDirectory)) {
    await readReferences(path.join(folder.path, 'modifiers.lua'));
    for (const type of DEVICE_TYPES) {
      const names = await ports.files.list(path.join(folder.path, type));
      for (const fileName of names.ok ? names.value : []) {
        const parsed = parseDiffFileName(fileName);
        if (!parsed?.guid) continue;
        const file = { path: path.join(folder.path, type, fileName), folder: folder.name, type };
        if (isLive(parsed.deviceName, parsed.guid)) {
          const key = parsed.guid.toUpperCase();
          liveFiles.set(key, (liveFiles.get(key) ?? new Set()).add(`${folder.name}|${type}`));
        } else {
          note(parsed.deviceName, parsed.guid).files.push(file);
        }
      }
    }
  }

  // The owner's names: what tells three devices with one name apart at a glance.
  const names = await bindings.ctx.names?.();
  const givenNameOf = (device: InputDevice): string | undefined =>
    device.vendorId && device.productId
      ? names?.nameOf({
          vendorId: device.vendorId,
          productId: device.productId,
          guid: device.guid,
        })
      : undefined;
  const candidateFor = (device: InputDevice, entry: Found): Candidate => ({
    guid: dcsGuidText(device.guid),
    name: device.name,
    ...(givenNameOf(device) ? { givenName: givenNameOf(device)! } : {}),
    fullId: fullIdFor(device.name, device.guid),
    index: device.index,
    vendorId: device.vendorId,
    productId: device.productId,
    // Only files that would be in the way: in a folder the old id has a file in too.
    ownFiles: entry.files.filter((f) =>
      liveFiles.get(device.guid.toUpperCase())?.has(`${f.folder}|${f.type}`)
    ).length,
    nameChanged: device.name !== entry.name,
  });

  const orphans: Orphan[] = [];
  for (const entry of found.values()) {
    // The registry still knows some old GUIDs (a stale calibration slot): that pins the model.
    const model = identityForGuid(known, entry.guid);
    const candidates = connected
      .filter((d) =>
        model
          ? d.vendorId === model.vendorId && d.productId === model.productId
          : d.name === entry.name
      )
      .map((d) => candidateFor(d, entry));
    orphans.push({
      id: fullIdFor(entry.name, entry.guid),
      name: entry.name,
      oldGuid: dcsGuidText(entry.guid),
      files: entry.files,
      references: [...entry.references],
      candidates,
      status: 'unplugged',
    });
  }
  // Decide which can be proposed without guessing.
  for (const orphan of orphans) {
    if (orphan.candidates.length === 0) continue;
    const rivals = orphans.filter(
      (o) =>
        o !== orphan &&
        o.candidates.some((c) => orphan.candidates.some((mine) => sameGuid(mine.guid, c.guid)))
    );
    if (orphan.candidates.length > 1) {
      orphan.status = 'choose';
      orphan.reason = `${orphan.candidates.length} attached devices are called "${orphan.name}". Press a button on the one these bindings belong to.`;
    } else if (rivals.length > 0) {
      orphan.status = 'choose';
      orphan.reason = `${rivals.length + 1} old device IDs could belong to this device. Choose which bindings to move to it.`;
    } else if (orphan.candidates[0]!.nameChanged) {
      orphan.status = 'choose';
      orphan.reason = `The device is now called "${orphan.candidates[0]!.name}". If a grip or the firmware changed, some buttons may have moved; check the bindings after moving them.`;
    } else {
      orphan.status = 'ready';
      orphan.proposed = orphan.candidates[0]!.guid;
    }
  }
  orphans.sort(
    (a, b) =>
      Number(a.status === 'unplugged') - Number(b.status === 'unplugged') ||
      a.name.localeCompare(b.name) ||
      a.oldGuid.localeCompare(b.oldGuid)
  );
  return ok({
    scan: { inputDir: locations.inputDir, orphans, dcsRunning: await bindings.dcsRunning() },
    connected,
    referenceTexts,
  });
}

/** Binding files and id references that belong to device ids no longer attached. */
export async function scanMigration(bindings: DcsBindings): Promise<Result<MigrationScan>> {
  const scanned = await scan(bindings);
  return scanned.ok ? ok(scanned.value.scan) : scanned;
}

/** Adds to `target` every combo of `source` that the target does not mention at all. */
export function mergeDiffText(targetText: string, sourceText: string): Result<string> {
  const target = parseLuaData(targetText);
  if (!target.ok) return target;
  const source = parseLuaData(sourceText);
  if (!source.ok) return source;
  const mentioned = new Set<string>();
  for (const entry of readDiff(target.value).entries) {
    for (const combo of [...entry.added, ...entry.removed, ...entry.changed]) {
      mentioned.add(`${entry.kind}|${comboId(combo)}`);
    }
  }
  for (const entry of readDiff(source.value).entries) {
    for (const section of ['removed', 'added', 'changed'] as DiffSection[]) {
      for (const combo of entry[section]) {
        if (mentioned.has(`${entry.kind}|${comboId(combo)}`)) continue;
        putCombo(target.value, entry.kind, entry.hash, entry.name, section, combo);
      }
    }
  }
  return ok(writeLuaDocument(target.value));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Prepared {
  builder: PlanBuilder;
  summary: string;
  dcsRunning: boolean;
}

async function prepare(bindings: DcsBindings, mappings: Mapping[]): Promise<Result<Prepared>> {
  const scanned = await scan(bindings);
  if (!scanned.ok) return scanned;
  const { ports } = bindings.ctx;
  const builder = new PlanBuilder();
  const targets = new Set<string>();
  const rewrites: { pattern: RegExp; to: string; orphan: Orphan }[] = [];
  let moved = 0;

  for (const mapping of mappings) {
    const orphan = scanned.value.scan.orphans.find((o) => o.id === mapping.from);
    if (!orphan) {
      return err(
        'dcs.migration.unknown',
        `There are no bindings under "${mapping.from}" any more.`
      );
    }
    const device = scanned.value.connected.find((d) => sameGuid(d.guid, mapping.toGuid));
    if (!device || !orphan.candidates.some((c) => sameGuid(c.guid, mapping.toGuid))) {
      return err(
        'dcs.migration.target',
        `The device chosen for "${orphan.name}" is not attached or is a different kind of device.`
      );
    }
    const newFullId = fullIdFor(device.name, device.guid);
    if (device.name !== orphan.name) {
      builder.note(
        `"${orphan.name}" is now called "${device.name}". Buttons may have moved if a grip or the firmware changed.`
      );
    }
    for (const file of orphan.files) {
      const to = path.join(path.dirname(file.path), diffFileNameFor(device.name, device.guid));
      const before = await ports.files.readText(file.path);
      if (!before.ok) return before;
      const title = `${orphan.name} · ${file.folder}`;
      const taken = targets.has(to.toLowerCase()) || (await ports.files.exists(to));
      if (!taken) {
        builder.move(file.path, to, before.value, before.value, {
          title,
          lines: [`Rename to the attached device's id ${dcsGuidText(device.guid)}`],
        });
        targets.add(to.toLowerCase());
        moved++;
        continue;
      }
      if (targets.has(to.toLowerCase())) {
        builder.note(
          `${file.folder}: another old file is already being moved to ${device.name}; "${path.basename(file.path)}" stays where it is.`
        );
        continue;
      }
      const existing = await ports.files.readText(to);
      if (!existing.ok) return existing;
      if (mapping.onConflict === 'keep') {
        builder.note(
          `${file.folder}: ${device.name} already has a binding file under its current id. It is kept, and the old file stays where it is.`
        );
      } else if (mapping.onConflict === 'replace') {
        builder.write(to, existing.value, before.value, {
          title,
          lines: [
            `Replace the file under the current id ${dcsGuidText(device.guid)} with the old bindings`,
          ],
        });
        builder.remove(file.path, before.value, { title, lines: ['Remove the old file'] });
        targets.add(to.toLowerCase());
        moved++;
      } else {
        const merged = mergeDiffText(existing.value, before.value);
        if (!merged.ok) return merged;
        builder.write(to, existing.value, merged.value, {
          title,
          lines: [
            `Add the old bindings to the file under the current id ${dcsGuidText(device.guid)} where they do not conflict with what is there`,
          ],
        });
        builder.remove(file.path, before.value, { title, lines: ['Remove the old file'] });
        targets.add(to.toLowerCase());
        moved++;
      }
    }
    rewrites.push({
      pattern: new RegExp(
        `${escapeRegExp(orphan.name)} \\{${escapeRegExp(splitFullId(orphan.id).guid ?? orphan.oldGuid)}\\}`,
        'gi'
      ),
      to: newFullId,
      orphan,
    });
  }

  // References inside modifiers.lua, disabled.lua and wizard.lua.
  for (const [file, text] of scanned.value.referenceTexts) {
    let next = text;
    const lines: string[] = [];
    for (const rewrite of rewrites) {
      const replaced = next.replace(rewrite.pattern, rewrite.to);
      if (replaced !== next) lines.push(`Point "${rewrite.orphan.name}" at its current id`);
      next = replaced;
    }
    if (next !== text) {
      builder.write(file, text, next, {
        title: `${path.basename(file)} · ${path.basename(path.dirname(file))}`,
        lines,
      });
    }
  }

  const devices = mappings.length;
  return ok({
    builder,
    summary: `Move bindings of ${devices} ${devices === 1 ? 'device' : 'devices'} to ${devices === 1 ? 'its' : 'their'} current device ${devices === 1 ? 'ID' : 'IDs'} (${moved} ${moved === 1 ? 'file' : 'files'})`,
    dcsRunning: scanned.value.scan.dcsRunning,
  });
}

/** Every rename and rewrite a migration would make, without making it. */
export async function planMigration(
  bindings: DcsBindings,
  mappings: Mapping[]
): Promise<Result<ChangePlan>> {
  const prepared = await prepare(bindings, mappings);
  if (!prepared.ok) return prepared;
  return ok(planView(prepared.value.summary, prepared.value.builder, prepared.value.dcsRunning));
}

/** Migrates as one undoable group. Refuses while DCS is running. */
export async function applyMigration(
  bindings: DcsBindings,
  mappings: Mapping[]
): Promise<Result<Applied>> {
  const prepared = await prepare(bindings, mappings);
  if (!prepared.ok) return prepared;
  return executePlan(
    bindings.ctx.ports,
    prepared.value.summary,
    prepared.value.builder,
    prepared.value.dcsRunning
  );
}

/** The mappings RigReady can propose without guessing: every orphan with exactly one possible device. */
export function proposedMappings(scan: MigrationScan): Mapping[] {
  return scan.orphans
    .filter((o) => o.status === 'ready' && o.proposed !== undefined)
    .map((o) => ({ from: o.id, toGuid: o.proposed!, onConflict: 'keep' as const }));
}
