import type { MainContext } from '../../../core/feature';
import { layoutToTargets, type NamedLayout } from '../../../core/displays/layouts';
import { err, ok, type Result } from '../../../core/result';
import type { DisplayInfo, DisplayTarget } from '../../../shared/models';
import type {
  ApplyPreview,
  DisplaysView,
  LayoutMonitor,
  LayoutView,
  MonitorView,
  RecoveryView,
} from '../contract';
import { matchMonitors } from '../../../core/displays/identity';
import type { LayoutApplier } from './applier';
import { describeTargets, targetFromDisplay } from './layoutCheck';
import { monitorLabels, monitorNumbers, type MonitorNames } from './labels';
import { analyzeLayout, joinNames } from './plan';
import { previewMaps } from './previewMap';
import type { MonitorNameStore, RecoveryStore, UprightStore } from './stores';

type Ctx = Pick<MainContext, 'ports' | 'settings' | 'layouts'>;

/** How long Identify keeps the numbers on the monitors. */
export const IDENTIFY_MS = 5000;

const sideways = (r: number): boolean => r === 90 || r === 270;

/** What the Monitors page does, on top of the ports and stores. */
export class DisplaysService {
  constructor(
    private readonly ctx: Ctx,
    private readonly names: MonitorNameStore,
    private readonly recoveryStore: RecoveryStore,
    private readonly applier: Pick<LayoutApplier, 'apply' | 'applyAndWait'>,
    private readonly upright?: UprightStore
  ) {}

  async view(): Promise<Result<DisplaysView>> {
    const current = await this.ctx.ports.displays.read();
    if (!current.ok) return current;
    const names = await this.names.readOrEmpty();
    const displays = current.value.displays;
    const confirmed = (await this.upright?.read()) ?? [];
    const view: DisplaysView = {
      monitors: monitorViews(displays, names).map((m) => ({
        ...m,
        uprightConfirmed: confirmed.includes(uprightKey(m)),
      })),
      layouts: [],
      canRevert: this.ctx.ports.displays.canRevert(),
    };
    const settings = await this.ctx.settings.get();
    const deskId = settings.ok ? settings.value.deskLayoutId : undefined;
    if (deskId) view.deskLayoutId = deskId;
    const layouts = await this.ctx.layouts.list();
    if (layouts.ok) {
      view.layouts = layouts.value.map((l) => layoutView(l, displays, names, deskId));
    } else {
      view.layoutsError = layouts.error.message;
    }
    return ok(view);
  }

  async identify(): Promise<Result<{ shown: number; off: number }>> {
    const current = await this.ctx.ports.displays.read();
    if (!current.ok) return current;
    const displays = current.value.displays;
    const names = await this.names.readOrEmpty();
    const labels = monitorLabels(displays, names);
    const numbers = monitorNumbers(displays);
    const on = displays
      .filter((d) => d.enabled)
      .sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!);
    if (on.length === 0) return err('displays.identify', 'No monitor is on.');
    const shown = await this.ctx.ports.overlays.showLabels(
      on.map((d) => ({
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        text: String(numbers.get(d.id)),
        caption: labels.get(d.id) ?? d.name,
        // "Which way is up?": the arrow must point up on every screen.
        up: true,
      })),
      IDENTIFY_MS
    );
    if (!shown.ok) return shown;
    return ok({ shown: on.length, off: displays.length - on.length });
  }

  /**
   * Turns one monitor upside down and waits for Keep or Go back. When it is kept, the
   * saved layouts that had this monitor the old way round are corrected too.
   */
  async flip(
    id: string
  ): Promise<Result<{ kept: boolean; layoutsUpdated: number; message: string }>> {
    const current = await this.ctx.ports.displays.read();
    if (!current.ok) return current;
    const monitor = current.value.displays.find((d) => d.id === id.toLowerCase());
    if (!monitor || !monitor.enabled) {
      return err('displays.flip', 'That monitor is off or not connected, so it cannot be turned.');
    }
    const names = await this.names.readOrEmpty();
    const label = monitorLabels(current.value.displays, names).get(monitor.id) ?? monitor.name;
    const from = monitor.rotation;
    const to = ((from + 180) % 360) as DisplayTarget['rotation'];
    const applied = await this.applier.applyAndWait([
      { ...targetFromDisplay(monitor), rotation: to },
    ]);
    if (!applied.ok) {
      if (applied.error.code !== 'display.reverted') return applied;
      return ok({
        kept: false,
        layoutsUpdated: 0,
        message: `${label} is back the way it was. Nothing was changed.`,
      });
    }
    // Read back: saved layouts are corrected only when the monitor really turned.
    const turned = await this.ctx.ports.displays.read();
    if (!turned.ok) return turned;
    if (turned.value.displays.find((d) => d.id === monitor.id)?.rotation !== to) {
      return err(
        'display.notApplied',
        `Windows accepted the change, but ${label} did not turn. Nothing was changed.`
      );
    }
    // The answer goes where it is used: every saved layout with this monitor the old way.
    let layoutsUpdated = 0;
    const layouts = await this.ctx.layouts.list();
    for (const layout of layouts.ok ? layouts.value : []) {
      const match = matchMonitors(layout.displays, [monitor]).find((m) => m.actual);
      if (!match || !match.expected.enabled || match.expected.rotation !== from) continue;
      const replaced = await this.ctx.layouts.replace(
        layout.id,
        layout.displays.map((d) => (d === match.expected ? { ...d, rotation: to } : d))
      );
      if (replaced.ok) layoutsUpdated++;
    }
    await this.upright?.confirm([uprightKey({ ...monitor, rotation: to })]);
    const also =
      layoutsUpdated > 0
        ? ` and corrected it in ${layoutsUpdated} saved ${layoutsUpdated === 1 ? 'layout' : 'layouts'}`
        : '';
    return ok({ kept: true, layoutsUpdated, message: `Turned ${label} the other way up${also}.` });
  }

  /** The user looked at the arrows: every monitor that is on is the right way up. */
  async confirmUpright(): Promise<Result<DisplaysView>> {
    const current = await this.ctx.ports.displays.read();
    if (!current.ok) return current;
    const saved = await this.upright?.confirm(
      current.value.displays.filter((d) => d.enabled).map(uprightKey)
    );
    if (saved && !saved.ok) return saved;
    return this.view();
  }

  async setName(id: string, name: string): Promise<Result<DisplaysView>> {
    const set = await this.names.set(id, name);
    return set.ok ? this.view() : set;
  }

  async saveLayout(name: string): Promise<Result<DisplaysView>> {
    const created = await this.ctx.layouts.createFromCurrent(name, this.ctx.ports.displays);
    return created.ok ? this.view() : created;
  }

  async updateLayout(id: string): Promise<Result<DisplaysView>> {
    const current = await this.ctx.ports.displays.read();
    if (!current.ok) return current;
    const existing = await this.ctx.layouts.get(id);
    if (!existing.ok) return existing;
    // Monitors of the layout that are not connected now (the TV) stay in it as they were.
    const now = layoutToTargets(current.value);
    const connected = new Set(now.map((t) => t.id));
    const kept = existing.value.displays.filter((d) => !connected.has(d.id.toLowerCase()));
    const replaced = await this.ctx.layouts.replace(id, [...now, ...kept]);
    return replaced.ok ? this.view() : replaced;
  }

  async editLayout(id: string, displays: DisplayTarget[]): Promise<Result<DisplaysView>> {
    const existing = await this.ctx.layouts.get(id);
    if (!existing.ok) return existing;
    const known = new Set(existing.value.displays.map((d) => d.id.toLowerCase()));
    if (displays.some((d) => !known.has(d.id.toLowerCase())) || displays.length !== known.size) {
      return err('displays.edit', 'The edited layout does not have the same monitors.');
    }
    const on = displays.filter((d) => d.enabled);
    if (on.length === 0) return err('displays.edit', 'At least one monitor must be on.');
    if (on.filter((d) => d.primary).length !== 1) {
      return err('displays.edit', 'Choose exactly one main display.');
    }
    const current = await this.ctx.ports.displays.read();
    if (!current.ok) return current;
    const analysis = analyzeLayout(
      displays,
      current.value.displays,
      await this.names.readOrEmpty()
    );
    if (analysis.problems.length > 0) {
      return err('displays.edit', analysis.problems.join(' '));
    }
    const cleaned = displays.map((d) =>
      d.enabled ? d : { ...d, primary: false, x: 0, y: 0, rotation: 0 as const }
    );
    const replaced = await this.ctx.layouts.replace(id, cleaned);
    return replaced.ok ? this.view() : replaced;
  }

  async renameLayout(id: string, name: string): Promise<Result<DisplaysView>> {
    const renamed = await this.ctx.layouts.rename(id, name);
    return renamed.ok ? this.view() : renamed;
  }

  async removeLayout(id: string): Promise<Result<DisplaysView>> {
    const removed = await this.ctx.layouts.remove(id);
    if (!removed.ok) return removed;
    const settings = await this.ctx.settings.get();
    if (settings.ok && settings.value.deskLayoutId === id) {
      const cleared = await this.ctx.settings.update({ deskLayoutId: null });
      if (!cleared.ok) return cleared;
    }
    return this.view();
  }

  async setDeskLayout(id: string | null): Promise<Result<DisplaysView>> {
    if (id !== null) {
      const layout = await this.ctx.layouts.get(id);
      if (!layout.ok) return layout;
    }
    const updated = await this.ctx.settings.update({ deskLayoutId: id });
    return updated.ok ? this.view() : updated;
  }

  async preview(id: string): Promise<Result<ApplyPreview>> {
    const layout = await this.ctx.layouts.get(id);
    if (!layout.ok) return layout;
    const current = await this.ctx.ports.displays.read();
    if (!current.ok) return current;
    const names = await this.names.readOrEmpty();
    const a = analyzeLayout(layout.value.displays, current.value.displays, names);
    const preview: ApplyPreview = {
      layoutId: id,
      name: layout.value.name,
      changes: a.changes,
      missing: a.missing,
      problems: a.problems,
      enabledCount: a.enabledCount,
      ...previewMaps(layout.value.displays, current.value.displays, a, names),
    };
    if (a.primaryMissing) preview.primaryMissing = a.primaryMissing;
    if (a.primaryLabel) preview.primaryLabel = a.primaryLabel;
    return ok(preview);
  }

  async applyLayout(id: string, withoutMissing: boolean): Promise<Result<{ message: string }>> {
    const layout = await this.ctx.layouts.get(id);
    if (!layout.ok) return layout;
    const current = await this.ctx.ports.displays.read();
    if (!current.ok) return current;
    const a = analyzeLayout(
      layout.value.displays,
      current.value.displays,
      await this.names.readOrEmpty()
    );
    const name = layout.value.name;
    if (a.missing.length > 0 && !withoutMissing) {
      return err(
        'display.missing',
        `${joinNames(a.missing)} ${a.missing.length === 1 ? 'is' : 'are'} not connected. Nothing was changed.`
      );
    }
    if (a.problems.length > 0) {
      return err(
        'display.invalid',
        `The "${name}" layout cannot be applied.`,
        a.problems.join(' ')
      );
    }
    if (a.changes.length === 0) {
      return ok({ message: `The monitors already match "${name}". Nothing was changed.` });
    }
    const applied = await this.applier.apply(a.targets);
    if (!applied.ok) return applied;
    // Read back: Windows may have adjusted what it was given.
    const left = analyzeLayout(
      layout.value.displays,
      applied.value.current.displays,
      await this.names.readOrEmpty()
    ).changes;
    if (left.length > 0) {
      return err(
        'display.partial',
        `Windows did not arrange the monitors exactly as "${name}". Keep or go back in the prompt.`,
        left.join('; ')
      );
    }
    const without = a.missing.length > 0 ? ` without ${joinNames(a.missing)}` : '';
    return ok({ message: `Applied "${name}"${without}` });
  }

  /**
   * The layout an earlier run changed without getting an answer. Never the one from before
   * a change this run made: that change has its own question, the countdown.
   */
  async recovery(): Promise<Result<RecoveryView | null>> {
    const point = await this.recoveryStore.leftOver();
    if (!point) return ok(null);
    // Nothing to offer when the monitors already are as they were.
    const current = await this.ctx.ports.displays.read();
    if (current.ok) {
      const saved = analyzeLayout(point.displays, current.value.displays);
      if (saved.changes.length === 0) {
        await this.recoveryStore.clearLeftOver();
        return ok(null);
      }
    }
    const names = await this.names.readOrEmpty();
    // A change that began while the monitors were being read took the file over.
    if (this.recoveryStore.ownedByThisRun) return ok(null);
    return ok({ savedAt: point.savedAt, lines: describeTargets(point.displays, names) });
  }

  async recover(restore: boolean): Promise<Result<{ message: string }>> {
    const point = await this.recoveryStore.leftOver();
    if (!point) return err('display.norecovery', 'There is no earlier layout to put back.');
    if (!restore) {
      await this.recoveryStore.clearLeftOver();
      return ok({ message: 'Kept the monitors as they are.' });
    }
    const current = await this.ctx.ports.displays.read();
    if (!current.ok) return current;
    const a = analyzeLayout(point.displays, current.value.displays);
    if (a.problems.length > 0) {
      return err('display.invalid', 'The earlier layout cannot be put back.', a.problems.join(' '));
    }
    const applied = await this.applier.apply(a.targets);
    if (!applied.ok) return applied;
    // Read back: only say it is back when it is.
    const left = analyzeLayout(point.displays, applied.value.current.displays).changes;
    if (left.length > 0) {
      return err(
        'display.recover',
        'Windows did not put every monitor back exactly as it was.',
        left.join('; ')
      );
    }
    return ok({
      message:
        a.missing.length > 0
          ? `Put back the earlier layout without ${joinNames(a.missing)}`
          : 'Put back the earlier layout',
    });
  }
}

/**
 * What a "this screen is the right way up" answer is kept under: the monitor (by the
 * identity that follows it) and the rotation it had when the user looked.
 */
export function uprightKey(
  monitor: Pick<DisplayInfo, 'id' | 'rotation'> & { usbSerial?: string | undefined }
): string {
  return `${monitor.usbSerial ?? monitor.id.toLowerCase()}@${monitor.rotation}`;
}

export function monitorViews(displays: DisplayInfo[], names: MonitorNames): MonitorView[] {
  const labels = monitorLabels(displays, names);
  const numbers = monitorNumbers(displays);
  const counts = new Map<string, number>();
  for (const d of displays) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  // In Identify order, then the monitors that are off.
  const order = (d: DisplayInfo): number => numbers.get(d.id.toLowerCase()) ?? Infinity;
  const sorted = displays
    .map((d, i) => ({ d, i }))
    .sort((a, b) => order(a.d) - order(b.d) || a.i - b.i)
    .map(({ d }) => d);
  return sorted.map((d) => {
    const view: MonitorView = {
      id: d.id,
      name: d.name,
      label: labels.get(d.id.toLowerCase()) ?? d.name,
      enabled: d.enabled,
      primary: d.primary,
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height,
      rotation: d.rotation,
      identical: (counts.get(d.name) ?? 0) > 1,
      uprightConfirmed: false,
    };
    if ((counts.get(d.name) ?? 0) > 1) {
      // A serial of its own (the USB device's) follows the screen to any port.
      const twins = displays.filter((o) => o.name === d.name);
      const own = d.usbSerial ?? d.serial;
      view.toldApartBy =
        own !== undefined && twins.filter((o) => (o.usbSerial ?? o.serial) === own).length === 1
          ? 'serial'
          : 'port';
    }
    if (d.connector) view.connector = d.connector;
    if (d.serial) view.serial = d.serial;
    if (d.usbSerial) view.usbSerial = d.usbSerial;
    const friendly = names[d.id.toLowerCase()];
    if (friendly) view.friendlyName = friendly;
    const number = numbers.get(d.id.toLowerCase());
    if (number !== undefined) view.number = number;
    if (d.edid) view.edid = d.edid;
    if (d.gdiName) view.gdiName = d.gdiName;
    if (d.refreshHz !== undefined) view.refreshHz = d.refreshHz;
    return view;
  });
}

/** A placeholder size for a monitor that is neither connected nor sized in the layout. */
const UNKNOWN_SIZE = { width: 1920, height: 1080 };

export function layoutView(
  layout: NamedLayout,
  displays: DisplayInfo[],
  names: MonitorNames,
  deskId: string | undefined
): LayoutView {
  const analysis = analyzeLayout(layout.displays, displays, names);
  const byId = new Map(displays.map((d) => [d.id.toLowerCase(), d]));
  const monitors: LayoutMonitor[] = layout.displays.map((t) => {
    const have = byId.get(t.id.toLowerCase());
    let width = t.width;
    let height = t.height;
    if (width === undefined || height === undefined) {
      if (have && have.width > 0) {
        const turn = sideways(t.rotation) !== sideways(have.rotation);
        width = turn ? have.height : have.width;
        height = turn ? have.width : have.height;
      } else {
        width = UNKNOWN_SIZE.width;
        height = UNKNOWN_SIZE.height;
      }
    }
    return {
      id: t.id,
      name: t.name,
      label: analysis.labels.get(t.id.toLowerCase()) ?? t.name,
      enabled: t.enabled,
      primary: t.enabled && t.primary,
      x: t.x,
      y: t.y,
      width,
      height,
      rotation: t.rotation,
      connected: have !== undefined,
    };
  });
  return {
    id: layout.id,
    name: layout.name,
    updatedAt: layout.updatedAt,
    isDesk: layout.id === deskId,
    monitors,
    status:
      analysis.differences.length === 0
        ? 'current'
        : analysis.missing.length > 0
          ? 'incomplete'
          : 'different',
    differences: analysis.differences,
    missing: analysis.missing,
  };
}
