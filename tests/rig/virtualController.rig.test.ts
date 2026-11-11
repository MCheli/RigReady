/**
 * The virtual controller on the real ViGEmBus driver. Not part of `npm run rig:smoke`: it
 * plugs a virtual Xbox 360 controller in for a few seconds, which every running game and
 * Steam would see. Run it by hand, with nothing else open:
 *
 *   cross-env RIGREADY_RIG_PAD=1 npx vitest run --config vitest.rig.config.ts tests/rig/virtualController.rig.test.ts
 *
 * Needs the driver installed by the owner and `npm run setup:python` (the helper and
 * ViGEmClient.dll). It changes nothing else: no HidHide, no files outside the repository.
 */
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nullLogger } from '../../src/core/logger';
import { createWindowsPorts } from '../../src/platform/windows';

const projectRoot = path.resolve(__dirname, '../..');
const wanted = process.env['RIGREADY_RIG_PAD'] === '1';
const ports = createWindowsPorts({ log: nullLogger, projectRoot });
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterAll(async () => {
  await ports.pads.unplug();
  await ports.input.stop();
});

describe.skipIf(!wanted)('virtual controller on the real driver (manual)', () => {
  it('the driver is installed and running', async () => {
    const bus = await ports.services.get('ViGEmBus');
    expect(bus.ok && bus.value?.state).toBe('running');
  });

  it('plugs an Xbox 360 controller in, which DirectInput then lists, takes reports, and goes away', async () => {
    const before = await ports.input.start();
    expect(before.ok).toBe(true);
    const plugged = await ports.pads.plug('xbox360', 'rig smoke');
    expect(plugged).toEqual({ ok: true, value: undefined });
    for (let i = 0; i <= 20; i++) {
      const x = Math.sin(i / 3);
      expect(
        ports.pads.send({
          lx: x,
          ly: -x,
          rx: 0,
          ry: 0,
          lt: i / 20,
          rt: 0,
          buttons: i % 2 ? 0x1000 : 0,
        }).ok
      ).toBe(true);
      await wait(20);
    }
    const status = await ports.pads.status();
    expect(status.ok && status.value).toMatchObject({ plugged: true, kind: 'xbox360' });
    expect(status.ok && status.value.reports).toBeGreaterThanOrEqual(20);
    // The input reader looks for new controllers every 2 s.
    await wait(3000);
    const seen = ports.input.devices().some((d) => /xbox 360/i.test(d.name));
    console.log(`  DirectInput lists the virtual controller: ${seen ? 'yes' : 'no'}`);
    expect(seen).toBe(true);
    expect(await ports.pads.unplug()).toEqual({ ok: true, value: undefined });
    expect(await ports.pads.status()).toEqual({ ok: true, value: { plugged: false, reports: 0 } });
  });
});
