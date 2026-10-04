import { afterEach, describe, expect, it } from 'vitest';
import { layoutToTargets } from '../../../core/displays/layouts';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import type { DisplayTarget } from '../../../shared/models';
import { RecoveryStore } from './stores';

let rig: TestRig;
afterEach(() => rig?.cleanup());

/** A store as one start of RigReady has it; a second one over the same folder is the next start. */
async function setUp(): Promise<{ start: () => RecoveryStore; now: DisplayTarget[] }> {
  rig = await scenarioRig('flying-all-good', { files: [] });
  const read = await rig.ports.displays.read();
  if (!read.ok) throw new Error(read.error.message);
  return {
    start: () => new RecoveryStore(rig.ports.files, rig.ports.folders.dataRoot(), rig.clock),
    now: layoutToTargets(read.value),
  };
}

describe('the layout from before a change, kept for after a crash', () => {
  it('is offered by the next start, never by the start that wrote it', async () => {
    const { start, now } = await setUp();
    const first = start();
    expect(first.ownedByThisRun).toBe(false);
    expect(await first.leftOver()).toBeUndefined();

    expect((await first.save(now)).ok).toBe(true);
    // Its own change: the countdown asks about that one.
    expect(first.ownedByThisRun).toBe(true);
    expect(await first.leftOver()).toBeUndefined();
    expect((await first.read())?.displays).toEqual(now);

    // RigReady was closed before the answer: the next start finds it.
    const second = start();
    expect((await second.leftOver())?.displays).toEqual(now);
    // And once that start has changed the layout itself, the file is that change's.
    expect((await second.save(now)).ok).toBe(true);
    expect(await second.leftOver()).toBeUndefined();
  });

  it('a change that begins while the file is being read is not taken for one left behind', async () => {
    const { start, now } = await setUp();
    expect((await start().save(now)).ok).toBe(true);
    const next = start();
    const asked = next.leftOver();
    const saved = next.save(now);
    expect(await asked).toBeUndefined();
    expect((await saved).ok).toBe(true);
  });

  it('removing what was left behind never takes a point written by this start', async () => {
    const { start, now } = await setUp();
    expect((await start().save(now)).ok).toBe(true);

    // Left behind and not wanted: removed.
    const dismissing = start();
    await dismissing.clearLeftOver();
    expect(await dismissing.read()).toBeUndefined();

    // Asked to remove what was left, and a change begins before that is done: the removal
    // and the writing take turns, and what is on disk afterwards is the new point.
    expect((await start().save(now)).ok).toBe(true);
    const busy = start();
    const removed = busy.clearLeftOver();
    const written = busy.save(now);
    await Promise.all([removed, written]);
    expect((await busy.read())?.displays).toEqual(now);
    // From then on there is nothing left over to remove, only its own point.
    await busy.clearLeftOver();
    expect((await busy.read())?.displays).toEqual(now);
    // Settled (kept or reverted): gone.
    await busy.clear();
    expect(await busy.read()).toBeUndefined();
  });
});
