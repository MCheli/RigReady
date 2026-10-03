import path from 'node:path';
import { z } from 'zod';
import type { Clock, DisplayProvider, FileStore } from '../ports';
import { slugify } from '../profile/schema';
import { err, ok, type Result } from '../result';
import { DisplayTargetSchema, type DisplayLayout, type DisplayTarget } from '../../shared/models';

/** A monitor arrangement saved under a name ("Flying", "Desk"), reusable by profiles and Stand down. */
export const NamedLayoutSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1).max(60),
  createdAt: z.string(),
  updatedAt: z.string(),
  displays: z.array(DisplayTargetSchema).min(1),
});
export type NamedLayout = z.infer<typeof NamedLayoutSchema>;

const FileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  layouts: z.array(NamedLayoutSchema).default([]),
});

/** What a layout read from the machine looks like as apply() targets: every monitor, on or off. */
export function layoutToTargets(layout: DisplayLayout): DisplayTarget[] {
  return layout.displays.map((d) => {
    // What finds the monitor again when its id changed (another connector or USB port).
    const identity = {
      ...(d.serial ? { serial: d.serial } : {}),
      ...(d.usbSerial ? { usbSerial: d.usbSerial } : {}),
    };
    return d.enabled
      ? {
          id: d.id,
          name: d.name,
          enabled: true,
          primary: d.primary,
          x: d.x,
          y: d.y,
          width: d.width,
          height: d.height,
          rotation: d.rotation,
          ...identity,
        }
      : {
          id: d.id,
          name: d.name,
          enabled: false,
          primary: false,
          x: 0,
          y: 0,
          rotation: 0,
          ...identity,
        };
  });
}

/** Named display layouts at <data root>/displays/layouts.json. */
export class DisplayLayoutStore {
  constructor(
    private readonly files: FileStore,
    private readonly dataRoot: string,
    private readonly clock: Clock
  ) {}

  get file(): string {
    return path.join(this.dataRoot, 'displays', 'layouts.json');
  }

  async list(): Promise<Result<NamedLayout[]>> {
    if (!(await this.files.exists(this.file))) return ok([]);
    const text = await this.files.readText(this.file);
    if (!text.ok) return text;
    try {
      const parsed = FileSchema.safeParse(JSON.parse(text.value));
      if (!parsed.success) {
        return err(
          'layouts.invalid',
          `The saved monitor layouts in ${this.file} are not valid.`,
          z.prettifyError(parsed.error)
        );
      }
      return ok(parsed.data.layouts);
    } catch (e) {
      return err(
        'layouts.invalid',
        `The saved monitor layouts in ${this.file} are not valid.`,
        String(e)
      );
    }
  }

  async get(id: string): Promise<Result<NamedLayout>> {
    const all = await this.list();
    if (!all.ok) return all;
    const layout = all.value.find((l) => l.id === id);
    return layout
      ? ok(layout)
      : err('layouts.missing', `There is no saved monitor layout "${id}".`);
  }

  private async saveAll(layouts: NamedLayout[]): Promise<Result<void>> {
    const written = await this.files.write(
      this.file,
      JSON.stringify({ schemaVersion: 1, layouts }, null, 2) + '\n',
      { reason: 'Monitor layouts' }
    );
    return written.ok ? ok(undefined) : written;
  }

  private checkName(name: string, layouts: NamedLayout[], exceptId?: string): Result<string> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 60) {
      return err('layouts.name', 'A layout name must be 1 to 60 characters.');
    }
    if (layouts.some((l) => l.id !== exceptId && l.name.toLowerCase() === trimmed.toLowerCase())) {
      return err('layouts.duplicate', `There is already a layout named "${trimmed}".`);
    }
    return ok(trimmed);
  }

  /** Saves the given arrangement under a new name. */
  async create(name: string, displays: DisplayTarget[]): Promise<Result<NamedLayout>> {
    const all = await this.list();
    if (!all.ok) return all;
    const checked = this.checkName(name, all.value);
    if (!checked.ok) return checked;
    if (displays.length === 0) return err('layouts.empty', 'A layout needs at least one monitor.');
    const base = slugify(checked.value);
    let id = base;
    for (let n = 2; all.value.some((l) => l.id === id); n++) id = `${base.slice(0, 60)}-${n}`;
    const now = this.clock.now().toISOString();
    const layout: NamedLayout = {
      id,
      name: checked.value,
      createdAt: now,
      updatedAt: now,
      displays,
    };
    const saved = await this.saveAll([...all.value, layout]);
    return saved.ok ? ok(layout) : saved;
  }

  /** Saves the monitors exactly as they are right now under a new name. */
  async createFromCurrent(name: string, provider: DisplayProvider): Promise<Result<NamedLayout>> {
    const current = await provider.read();
    if (!current.ok) return current;
    return this.create(name, layoutToTargets(current.value));
  }

  async rename(id: string, name: string): Promise<Result<NamedLayout>> {
    const all = await this.list();
    if (!all.ok) return all;
    const layout = all.value.find((l) => l.id === id);
    if (!layout) return err('layouts.missing', `There is no saved monitor layout "${id}".`);
    const checked = this.checkName(name, all.value, id);
    if (!checked.ok) return checked;
    layout.name = checked.value;
    layout.updatedAt = this.clock.now().toISOString();
    const saved = await this.saveAll(all.value);
    return saved.ok ? ok(layout) : saved;
  }

  /** Replaces the monitors of an existing layout, keeping its id and name. */
  async replace(id: string, displays: DisplayTarget[]): Promise<Result<NamedLayout>> {
    const all = await this.list();
    if (!all.ok) return all;
    const layout = all.value.find((l) => l.id === id);
    if (!layout) return err('layouts.missing', `There is no saved monitor layout "${id}".`);
    if (displays.length === 0) return err('layouts.empty', 'A layout needs at least one monitor.');
    layout.displays = displays;
    layout.updatedAt = this.clock.now().toISOString();
    const saved = await this.saveAll(all.value);
    return saved.ok ? ok(layout) : saved;
  }

  async remove(id: string): Promise<Result<void>> {
    const all = await this.list();
    if (!all.ok) return all;
    if (!all.value.some((l) => l.id === id)) {
      return err('layouts.missing', `There is no saved monitor layout "${id}".`);
    }
    return this.saveAll(all.value.filter((l) => l.id !== id));
  }
}
