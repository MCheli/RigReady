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

const describeLayout = (layout: DisplayLayout): string =>
  layout.displays
    .map(
      (d) =>
        `${d.name} ${d.enabled ? `${d.width}x${d.height}@${d.x},${d.y} r${d.rotation}${d.refreshHz ? ` ${d.refreshHz}Hz` : ''}` : 'off'}`
    )
    .join(' | ');

describe.runIf(enabled)('real display apply: another resolution (capture and restore)', () => {
  it('changes the resolution of one monitor together with the layout in as few display changes as Windows allows, then restores the original exactly', async () => {
    const provider = new WindowsDisplayProvider();
    const before = await provider.read();
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const original = before.value;
    const on = original.displays.filter((d) => d.enabled);

    // The right-most monitor that offers a smaller size at the refresh rate it runs at
    // now: making it smaller leaves every other monitor where it is.
    const sideways = (r: number): boolean => r === 90 || r === 270;
    const pick = [...on]
      .sort((a, b) => b.x - a.x)
      .map((d) => {
        const nativeW = sideways(d.rotation) ? d.height : d.width;
        const nativeH = sideways(d.rotation) ? d.width : d.height;
        const smaller = (d.modes ?? [])
          .filter(
            (m) =>
              m.width * m.height < nativeW * nativeH &&
              m.width >= 800 &&
              m.height >= 600 &&
              (d.refreshHz === undefined || Math.abs(m.refreshHz - d.refreshHz) < 1)
          )
          .sort((a, b) => b.width * b.height - a.width * a.height)[0];
        return smaller ? { display: d, mode: smaller } : undefined;
      })
      .find((p) => p !== undefined);
    if (!pick) {
      console.log('  skipped: no enabled monitor offers a smaller mode at its refresh rate');
      return;
    }
    const { display, mode } = pick;
    const width = sideways(display.rotation) ? mode.height : mode.width;
    const height = sideways(display.rotation) ? mode.width : mode.height;
    const targets = asTargets(original).map((t) =>
      t.id === display.id ? { ...t, width, height } : t
    );
    console.log(
      `  ${display.name}: ${display.width}x${display.height} -> ${width}x${height}; before: ${describeLayout(original)}`
    );

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
      console.log(`  applied: ${describeLayout(during.value)}`);
      // WHAT TO LOOK FOR: 1 = the new size went in with the layout in one SetDisplayConfig
      // call. 2 = Windows did not take it that way (the reason is printed) and the size
      // was set by one GDI reset followed by one arrangement. It used to be 3 or more.
      console.log(
        `  display changes for this apply: ${provider.lastApplyCalls}${provider.lastAtomicFailure ? ` (not in one call: ${provider.lastAtomicFailure})` : ''}`
      );
      const now = during.value.displays.find((d) => d.id === display.id)!;
      expect({ width: now.width, height: now.height, rotation: now.rotation }).toEqual({
        width,
        height,
        rotation: display.rotation,
      });
      // Nothing else moved, turned or changed size.
      for (const other of on.filter((d) => d.id !== display.id)) {
        const actual = during.value.displays.find((d) => d.id === other.id)!;
        expect(
          {
            x: actual.x,
            y: actual.y,
            width: actual.width,
            height: actual.height,
            rotation: actual.rotation,
          },
          other.name
        ).toEqual({
          x: other.x,
          y: other.y,
          width: other.width,
          height: other.height,
          rotation: other.rotation,
        });
      }
      expect(provider.lastApplyCalls).toBeGreaterThanOrEqual(1);
      expect(provider.lastApplyCalls).toBeLessThanOrEqual(2);
    } finally {
      if (applied && provider.canRevert()) await provider.revert();
      await settle();
      let after = await provider.read();
      if (
        !after.ok ||
        JSON.stringify(comparable(after.value)) !== JSON.stringify(comparable(original))
      ) {
        // Second line of defence: apply the original layout by value, sizes included.
        await provider.apply(asTargets(original));
        await settle();
        after = await provider.read();
      }
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(comparable(after.value)).toEqual(comparable(original));
        const restored = after.value.displays.find((d) => d.id === display.id)!;
        if (display.refreshHz !== undefined && restored.refreshHz !== undefined) {
          expect(Math.abs(restored.refreshHz - display.refreshHz)).toBeLessThan(1);
        }
        console.log(`  restored: ${describeLayout(after.value)}`);
      }
    }
  });
});

describe.runIf(!enabled)('real display apply', () => {
  it.skip('skipped: set RIGREADY_RIG_APPLY=1 (npm run rig:smoke:apply) to change and restore the real layout', () => {});
});
