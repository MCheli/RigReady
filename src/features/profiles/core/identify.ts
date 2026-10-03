import type { Ports } from '../../../core/ports';
import { ok, type Result } from '../../../core/result';
import type { InputState } from '../../../shared/models';

export interface PressedDevice {
  /** DirectInput product name, trimmed. */
  name: string;
  /** Four upper-case hex digits; empty when DirectInput does not say. */
  vendorId: string;
  productId: string;
}

/**
 * Waits for a button to be pressed on any game controller and says which one it was:
 * "press a button on it" instead of typing VID/PID. Buttons already held when it starts
 * do not count. Resolves with no device when nothing is pressed in time.
 */
export async function waitForPress(
  ports: Pick<Ports, 'input'>,
  timeoutMs: number
): Promise<Result<{ device?: PressedDevice }>> {
  const started = await ports.input.start();
  if (!started.ok) return started;
  const devices = started.value;
  return new Promise((resolve) => {
    const held = new Map<number, boolean[]>();
    let replaying = true;
    let done = false;
    // Set once subscribed; a press seen during the subscription itself unsubscribes after it.
    let off: (() => void) | undefined = undefined;
    const finish = (device?: PressedDevice): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off?.();
      resolve(ok(device ? { device } : {}));
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    const look = (states: InputState[]): void => {
      for (const state of states) {
        const before = held.get(state.index) ?? [];
        held.set(state.index, state.buttons);
        // The replay of what was already held is where we start from, not a press.
        if (replaying) continue;
        if (!state.buttons.some((down, i) => down && !before[i])) continue;
        const device = devices.find((d) => d.index === state.index);
        finish({
          name: (device?.name ?? state.name).trim(),
          vendorId: device?.vendorId ?? '',
          productId: device?.productId ?? '',
        });
        return;
      }
    };
    off = ports.input.subscribe(look);
    replaying = false;
    if (done) off();
  });
}
