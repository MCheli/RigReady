import path from 'node:path';
import { z } from 'zod';
import type { MainContext } from '../../../core/feature';
import {
  MAKE_READY_HOTKEY,
  hotkeyAccelerator,
  hotkeyShown,
  hotkeyText,
  parseHotkey,
} from '../../../core/hotkeys';
import { JsonStore } from '../../../core/jsonStore';
import { err, ok, type Result } from '../../../core/result';
import type { HotkeyState } from '../contract';

/**
 * The optional system-wide hotkey: a key combination that works whatever program is in
 * front, brings RigReady forward and runs Make ready for the setup in use. Off until the
 * user chooses one. This is the choosing and the keeping; what the hotkey does when it is
 * pressed is the shell's (it listens on the Hotkeys port for MAKE_READY_HOTKEY).
 */

type Ctx = Pick<MainContext, 'ports' | 'log'>;

const StoreSchema = z.object({
  /** As it is written: "Ctrl+Alt+R". Absent: off. */
  hotkey: z.string().optional(),
});

const TAKEN =
  'Windows did not give it to RigReady: another program is probably using it. Choose another combination.';

export class MakeReadyHotkey {
  private readonly store: JsonStore<typeof StoreSchema>;

  constructor(private readonly ctx: Ctx) {
    this.store = new JsonStore(
      ctx.ports.files,
      path.join(ctx.ports.folders.dataRoot(), 'one-click.json'),
      StoreSchema
    );
  }

  /** At startup: the hotkey chosen earlier is registered again. Nothing is written. */
  async start(): Promise<void> {
    const stored = await this.store.read();
    if (!stored.ok) {
      this.ctx.log.warn('the hotkey setting could not be read', stored.error);
      return;
    }
    if (!stored.value.hotkey) return;
    const parsed = parseHotkey(stored.value.hotkey);
    if (!parsed.ok) {
      this.ctx.log.warn(`the stored hotkey "${stored.value.hotkey}" is not one`, parsed.error);
      return;
    }
    const registered = await this.ctx.ports.hotkeys.register(
      MAKE_READY_HOTKEY,
      hotkeyAccelerator(parsed.value)
    );
    if (!registered.ok) {
      this.ctx.log.warn(`the hotkey ${stored.value.hotkey} was not registered`, registered.error);
    }
  }

  /** On quit: the combination goes back to Windows. */
  async stop(): Promise<void> {
    await this.ctx.ports.hotkeys.unregister(MAKE_READY_HOTKEY);
  }

  /** What is chosen, and whether Windows really has it registered for RigReady now. */
  async state(): Promise<Result<HotkeyState>> {
    const stored = await this.store.read();
    if (!stored.ok) return stored;
    const chosen = stored.value.hotkey;
    if (!chosen) return ok({ active: false });
    const parsed = parseHotkey(chosen);
    if (!parsed.ok) return ok({ hotkey: chosen, active: false, problem: parsed.error.message });
    const now = await this.ctx.ports.hotkeys.registered(MAKE_READY_HOTKEY);
    if (!now.ok) return ok({ hotkey: chosen, active: false, problem: now.error.message });
    const active = now.value === hotkeyAccelerator(parsed.value);
    return ok({ hotkey: chosen, active, ...(active ? {} : { problem: TAKEN }) });
  }

  /**
   * Chooses the hotkey, or turns it off with null. The answer is what Windows has registered
   * afterwards: a combination Windows did not take is an error, and the one before stays.
   */
  async set(text: string | null): Promise<Result<HotkeyState>> {
    const { hotkeys } = this.ctx.ports;
    // First: a settings file that cannot be read is reported and left alone, before
    // Windows is asked for anything.
    const before = await this.store.read();
    if (!before.ok) return before;
    if (text === null) {
      const released = await hotkeys.unregister(MAKE_READY_HOTKEY);
      if (!released.ok) return released;
      const still = await hotkeys.registered(MAKE_READY_HOTKEY);
      if (!still.ok) return still;
      if (still.value !== undefined) {
        return err('hotkey.stillOn', 'The hotkey is still registered with Windows.', still.value);
      }
      const saved = await this.store.write({});
      return saved.ok ? ok({ active: false }) : saved;
    }
    const parsed = parseHotkey(text);
    if (!parsed.ok) return parsed;
    const chosen = hotkeyText(parsed.value);
    const accelerator = hotkeyAccelerator(parsed.value);
    const registered = await hotkeys.register(MAKE_READY_HOTKEY, accelerator);
    if (!registered.ok) {
      return err('hotkey.taken', `${hotkeyShown(chosen)} cannot be the hotkey.`, TAKEN);
    }
    // Windows is asked: saying "registered" is not believed.
    const now = await hotkeys.registered(MAKE_READY_HOTKEY);
    if (!now.ok) return now;
    if (now.value !== accelerator) {
      return err('hotkey.notRegistered', `${hotkeyShown(chosen)} was not registered.`, TAKEN);
    }
    const saved = await this.store.write({ hotkey: chosen });
    if (!saved.ok) return saved;
    return ok({ hotkey: chosen, active: true });
  }
}
