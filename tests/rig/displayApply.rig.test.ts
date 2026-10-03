/**
 * Changes the real monitor layout, then puts it back. Only runs with RIGREADY_RIG_APPLY=1
 * (npm run rig:smoke:apply). The original layout is captured first and restored in a
 * finally block; the test fails loudly if the machine does not end exactly as it began.
 */
import { describe, expect, it } from 'vitest';
import { WindowsDisplayProvider } from '../../src/platform/windows/displays';
import type { DisplayLayout, DisplayTarget } from '../../src/shared/models';

const enabled = process.env['RIGREADY_RIG_APPLY'] === '1';
const settle = (ms = 2500): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Layout without the fields that legitimately change across a mode switch (GDI names). */
const comparable = (layout: DisplayLayout) =>
  layout.displays
    .map(({ id, enabled: on, primary, x, y, width, height, rotation }) => ({
      id,
      on,
      primary,
      x,
      y,
      width,
      height,
      rotation,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

const asTargets = (layout: DisplayLayout): DisplayTarget[] =>
  layout.displays.map((d) =>
    d.enabled
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
        }
      : { id: d.id, name: d.name, enabled: false, primary: false, x: 0, y: 0, rotation: 0 }
  );

describe.runIf(enabled)('real display apply (capture and restore)', () => {
  it('rotates, moves and disables monitors, then restores the original layout exactly', async () => {
    const provider = new WindowsDisplayProvider();
    const before = await provider.read();
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const original = before.value;
    const on = original.displays.filter((d) => d.enabled);
    expect(on.length, 'this test needs at least two enabled monitors').toBeGreaterThanOrEqual(2);

    // Change something of every kind: turn the primary off (another becomes primary at 0,0),
    // rotate the last monitor a quarter turn, and repack the rest left to right.
    const primary = on.find((d) => d.primary)!;
    const others = on.filter((d) => d !== primary).sort((a, b) => a.x - b.x);
    const rotated = others[others.length - 1]!;
    let x = 0;
    const targets: DisplayTarget[] = [
      {
        id: primary.id,
        name: primary.name,
        enabled: false,
        primary: false,
        x: 0,
        y: 0,
        rotation: 0,
      },
    ];
    others.forEach((d, index) => {
      const turn = d === rotated && others.length > 1;
      const width = turn ? d.height : d.width;
      const height = turn ? d.width : d.height;
      targets.push({
        id: d.id,
        name: d.name,
        enabled: true,
        primary: index === 0,
        x,
        y: 0,
        width,
        height,
        rotation: turn ? (((d.rotation + 90) % 360) as DisplayTarget['rotation']) : d.rotation,
      });
      x += width;
    });

    let applied = false;
    try {
      const outcome = await provider.apply(targets);
      expect(
        outcome.ok,
        outcome.ok ? '' : `${outcome.error.message} ${outcome.error.detail ?? ''}`
      ).toBe(true);
      if (!outcome.ok) return;
      applied = true;
      await settle();
      const during = await provider.read();
      expect(during.ok).toBe(true);
      if (!during.ok) return;
      const now = new Map(during.value.displays.map((d) => [d.id, d]));
      for (const target of targets) {
        const actual = now.get(target.id)!;
        expect(actual.enabled, `${target.name} enabled`).toBe(target.enabled);
        if (!target.enabled) continue;
        expect({
          x: actual.x,
          y: actual.y,
          width: actual.width,
          height: actual.height,
          rotation: actual.rotation,
          primary: actual.primary,
        }).toEqual({
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
          rotation: target.rotation,
          primary: target.primary,
        });
      }
      console.log(
        '  applied:',
        during.value.displays
          .map(
            (d) =>
              `${d.name} ${d.enabled ? `${d.width}x${d.height}@${d.x},${d.y} r${d.rotation}` : 'off'}`
          )
          .join(' | ')
      );
    } finally {
      if (applied && provider.canRevert()) await provider.revert();
      await settle();
      let after = await provider.read();
      if (
        !after.ok ||
        JSON.stringify(comparable(after.value)) !== JSON.stringify(comparable(original))
      ) {
        // Second line of defence: apply the original layout by value.
        await provider.apply(asTargets(original));
        await settle();
        after = await provider.read();
      }
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(comparable(after.value)).toEqual(comparable(original));
        expect(after.value.displays.filter((d) => d.enabled).length).toBe(on.length);
        console.log(
          '  restored:',
          after.value.displays
            .map(
              (d) =>
                `${d.name} ${d.enabled ? `${d.width}x${d.height}@${d.x},${d.y} r${d.rotation}` : 'off'}`
            )
            .join(' | ')
        );
      }
    }
  });
});

describe.runIf(!enabled)('real display apply', () => {
  it.skip('skipped: set RIGREADY_RIG_APPLY=1 (npm run rig:smoke:apply) to change and restore the real layout', () => {});
});
