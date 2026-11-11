import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { Logger } from '../../../core/logger';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { InputDevice, InputState, PadReport } from '../../../shared/models';
import { hideControllers, HidingRecordSchema, restoreHiding, type HidingRecord } from './hiding';
import {
  computeReport,
  isVirtualPadLike,
  planMapping,
  resolveController,
  sameReport,
} from './mapping';
import { profileSources, type PadProfile } from './profile';
import type { Running } from './running';

/**
 * Runs one virtual controller: plugs it in, feeds it from the real controllers on every
 * change the input reader sees, sends the same report again at a steady beat, and takes
 * it away again with whatever was hidden for it.
 */

/** A report is sent again at least this often while nothing moves. */
export const HEARTBEAT_MS = 250;

/** What survives a crash: the HidHide changes to undo at the next start. */
const LeftoverSchema = z.object({ hiding: HidingRecordSchema.optional() });

export interface StartOptions {
  hide: boolean;
  by: 'setup' | 'hand';
  setup?: string;
}

export class Emulator {
  private running: Running | undefined;
  private profile: PadProfile | undefined;
  private hiding: HidingRecord | undefined;
  private unsubscribe: (() => void) | undefined;
  private unwatch: (() => void) | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private latest = new Map<number, InputState>();
  private last: PadReport | undefined;
  private busy: Promise<unknown> = Promise.resolve();
  private readonly leftover: JsonStore<typeof LeftoverSchema>;

  constructor(
    private readonly ports: Ports,
    private readonly log: Logger,
    /** Told whenever it starts or stops, or the controller went away by itself. */
    private readonly changed: (running: Running | undefined, note?: string) => void
  ) {
    this.leftover = new JsonStore(
      ports.files,
      path.join(ports.folders.dataRoot(), 'virtual-controller', 'hidden.json'),
      LeftoverSchema
    );
  }

  current(): Running | undefined {
    return this.running ? structuredClone(this.running) : undefined;
  }

  /** The last report handed to the controller, for the live view. */
  lastReport(): PadReport | undefined {
    return this.last ? { ...this.last } : undefined;
  }

  /** One start or stop at a time: a second waits for the first. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.busy.then(work, work);
    this.busy = next.catch(() => {
      // The caller gets this start or stop's own result; the queue only waits for it to end.
    });
    return next;
  }

  start(profile: PadProfile, options: StartOptions): Promise<Result<Running>> {
    return this.serial(() => this.startNow(profile, options));
  }

  private async startNow(profile: PadProfile, options: StartOptions): Promise<Result<Running>> {
    if (this.running) {
      const stopped = await this.stopNow();
      if (!stopped.ok) return stopped;
    }
    const bus = await this.ports.services.get('ViGEmBus');
    if (!bus.ok) return bus;
    if (!bus.value) {
      return err(
        'vc.driver',
        'The ViGEmBus driver is not installed, so no virtual controller can be plugged in.',
        'Install it from its official page (Configure > Virtual controller has the link), then try again.'
      );
    }
    if (bus.value.state !== 'running') {
      return err(
        'vc.driver',
        `The ViGEmBus driver is installed but ${bus.value.state}. Restart Windows, then try again.`
      );
    }
    const started = await this.ports.input.start();
    if (!started.ok) return started;
    const devices = started.value.filter((d) => !isVirtualPadLike(d));
    const plan = planMapping(profile, devices);
    if (plan.mapped.length === 0) {
      return err(
        'vc.nothing',
        plan.missing.length > 0
          ? `None of the controllers "${profile.name}" uses is connected.`
          : `Nothing is mapped in "${profile.name}" yet. Edit it and press or move a control for each part.`
      );
    }
    const used = uniqueDevices(profile, devices);

    let hiding: HidingRecord | undefined;
    let notHidden: string[] = [];
    if (options.hide) {
      const hidden = await hideControllers(this.ports, used);
      if (!hidden.ok) return hidden;
      hiding = hidden.value.record;
      notHidden = hidden.value.notFound;
      // Written before anything else can go wrong: a crash from here on is undone at the next start.
      const saved = await this.leftover.write({ hiding });
      if (!saved.ok) {
        await restoreHiding(this.ports, hiding);
        return saved;
      }
    }

    const label = profile.name;
    const plugged = await this.ports.pads.plug(profile.kind, label);
    const status = plugged.ok ? await this.ports.pads.status() : undefined;
    if (!plugged.ok || !status?.ok || !status.value.plugged) {
      if (hiding) await this.undoHiding(hiding);
      if (!plugged.ok) return plugged;
      if (status && !status.ok) return status;
      return err('vc.notPlugged', 'The driver did not plug the virtual controller in.');
    }

    this.profile = profile;
    this.hiding = hiding;
    this.latest.clear();
    this.last = undefined;
    this.running = {
      profileId: profile.id,
      profileName: profile.name,
      kind: profile.kind,
      by: options.by,
      ...(options.setup ? { setup: options.setup } : {}),
      startedAt: this.ports.clock.now().toISOString(),
      controllers: used.map((d) => d.name),
      missing: plan.missing,
      hidden: hiding?.names ?? [],
      notHidden,
    };
    let currentPlan = plan;
    this.unsubscribe = this.ports.input.subscribe((states) => {
      for (const state of states) this.latest.set(state.index, state);
      // A controller plugged in or out renumbers the list: plan again on what is there now.
      const now = this.ports.input.devices().filter((d) => !isVirtualPadLike(d));
      if (states.some((s) => !now.some((d) => d.index === s.index && d.name === s.name))) {
        currentPlan = planMapping(profile, now);
      }
      this.feed(computeReport(profile, currentPlan, this.latest));
    });
    this.feed(computeReport(profile, currentPlan, this.latest), true);
    this.heartbeat = setInterval(() => {
      if (this.last) this.feed(this.last, true);
    }, HEARTBEAT_MS);
    this.unwatch = this.ports.pads.subscribe((lost) => {
      void this.serial(async () => {
        if (!this.running) return;
        const note = lost.lost ?? 'The virtual controller went away.';
        this.log.warn(`virtual controller lost: ${note}`);
        await this.tearDown();
        this.changed(undefined, note);
      });
    });
    this.log.info(`virtual controller on: ${profile.name} (${profile.kind})`, {
      controllers: this.running.controllers,
      hidden: this.running.hidden,
    });
    this.changed(this.current());
    return ok(this.current()!);
  }

  private feed(report: PadReport, force = false): void {
    if (!force && sameReport(this.last, report)) return;
    this.last = report;
    const sent = this.ports.pads.send(report);
    if (!sent.ok) this.log.debug('virtual controller report not sent', sent.error);
  }

  /** Stops it. ok with what was done, or ok(null) when none was running. */
  stop(): Promise<Result<string | null>> {
    return this.serial(() => this.stopNow());
  }

  private async stopNow(): Promise<Result<string | null>> {
    if (!this.running) return ok(null);
    const name = this.running.profileName;
    const done = await this.tearDown();
    if (!done.ok) {
      this.changed(undefined);
      return done;
    }
    this.changed(undefined);
    return ok(
      done.value
        ? `Virtual controller off (${name}). ${done.value}`
        : `Virtual controller off (${name})`
    );
  }

  /** Unplugs, stops feeding and puts HidHide back. Resolves with what HidHide said. */
  private async tearDown(): Promise<Result<string | undefined>> {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.unwatch?.();
    this.unwatch = undefined;
    this.running = undefined;
    this.profile = undefined;
    this.last = undefined;
    const unplugged = await this.ports.pads.unplug();
    const status = await this.ports.pads.status();
    const hiding = this.hiding;
    this.hiding = undefined;
    const restored = hiding ? await this.undoHiding(hiding) : ok(undefined);
    if (!unplugged.ok) return unplugged;
    if (!status.ok) return status;
    if (status.value.plugged) {
      return err('vc.stillPlugged', 'The virtual controller is still plugged in.');
    }
    if (!restored.ok) return restored;
    return ok(restored.value);
  }

  private async undoHiding(record: HidingRecord): Promise<Result<string>> {
    const restored = await restoreHiding(this.ports, record);
    if (restored.ok) {
      const cleared = await this.leftover.write({});
      if (!cleared.ok) this.log.warn('could not clear the hiding record', cleared.error);
    } else {
      this.log.warn('HidHide was not put back', restored.error);
    }
    return restored;
  }

  /**
   * After a crash: puts back what HidHide was told to hide by a run that never stopped.
   * Resolves with what was done, or null when nothing was left.
   */
  async recover(): Promise<Result<string | null>> {
    const left = await this.leftover.read();
    if (!left.ok) return left;
    if (!left.value.hiding) return ok(null);
    const restored = await this.undoHiding(left.value.hiding);
    return restored.ok ? ok(restored.value) : restored;
  }

  /** For quitting: stops whatever runs, within the time the shell gives. */
  async dispose(): Promise<void> {
    const stopped = await this.stop();
    if (!stopped.ok) this.log.warn('virtual controller did not stop cleanly', stopped.error);
  }

  /** For the live view: the latest state of the profile's controllers. */
  profileInUse(): PadProfile | undefined {
    return this.profile;
  }
}

/** The connected controllers a profile uses, each once. */
export function uniqueDevices(profile: PadProfile, devices: InputDevice[]): InputDevice[] {
  const out: InputDevice[] = [];
  for (const { source } of profileSources(profile)) {
    const device = resolveController(source.device, devices);
    if (device && !out.some((d) => d.index === device.index)) out.push(device);
  }
  return out;
}
