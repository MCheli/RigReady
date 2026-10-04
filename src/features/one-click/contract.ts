import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';

/** The hotkey that brings RigReady forward and runs Make ready, as the Settings page shows it. */
export const HotkeyStateSchema = z.object({
  /** The combination chosen, as it is written: "Ctrl+Alt+R". Absent: the hotkey is off. */
  hotkey: z.string().optional(),
  /** Windows has that combination registered for RigReady right now. */
  active: z.boolean(),
  /** Why a chosen hotkey is not active. */
  problem: z.string().optional(),
});
export type HotkeyState = z.infer<typeof HotkeyStateSchema>;

export const oneClickContract = defineContract('one-click', {
  hotkey: channel(noInput, HotkeyStateSchema),
  /**
   * Chooses the hotkey ("Ctrl+Alt+R") or, with null, turns it off. Answers only after
   * Windows was asked what it has registered.
   */
  setHotkey: channel(z.object({ hotkey: z.string().max(60).nullable() }), HotkeyStateSchema),
});
