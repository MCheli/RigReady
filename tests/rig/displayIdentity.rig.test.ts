/**
 * Real monitor changes beyond the basic apply test, each restored afterwards. Only with
 * RIGREADY_RIG_APPLY=1 (npm run rig:smoke:apply). Every test captures the layout first
 * and puts it back in a finally block, and fails loudly if the machine does not end
 * exactly as it began.
 */
import { describe, expect, it } from 'vitest';
import { gdiOrientation, WindowsDisplayProvider } from '../../src/platform/windows/displays';
import type { DisplayInfo, DisplayLayout, DisplayTarget } from '../../src/shared/models';

const enabled = process.env['RIGREADY_RIG_APPLY'] === '1';
const settle = (ms = 2500): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const comparable = (layout: DisplayLayout) =>
  layout.displays
    .map(({ id, enabled: on, primary, x, y, width, height, rotation, refreshHz }) => ({
      id,
      on,
      primary,
      x,
      y,
      width,
      height,
      rotation,
      refreshHz: on ? Math.round(refreshHz ?? 0) : 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

const asTarget = (d: DisplayInfo): DisplayTarget =>
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
        ...(d.refreshHz !== undefined ? { refreshHz: Math.round(d.refreshHz) } : {}),
      }
    : { id: d.id, name: d.name, enabled: false, primary: false, x: 0, y: 0, rotation: 0 };

const describeLayout = (layout: DisplayLayout): string =>
  layout.displays
    .map(
      (d) =>
        `${d.name} ${d.enabled ? `${d.width}x${d.height}@${d.x},${d.y} r${d.rotation} ${d.refreshHz ?? '?'}Hz` : 'off'}`
    )
    .join(' | ');

/** Runs `change` on the real monitors, then restores the original layout whatever happened. */
async function withRestore(
  change: (provider: WindowsDisplayProvider, original: DisplayLayout) => Promise<void>
): Promise<void> {
  const provider = new WindowsDisplayProvider();
  const before = await provider.read();
  expect(before.ok).toBe(true);
  if (!before.ok) return;
  const original = before.value;
  try {
    await change(provider, original);
  } finally {
    while (provider.canRevert()) await provider.revert();
    await settle();
    let after = await provider.read();
    if (
      !after.ok ||
      JSON.stringify(comparable(after.value)) !== JSON.stringify(comparable(original))
    ) {
      // Second line of defence: apply the original layout by value.
      await provider.apply(original.displays.map(asTarget));
      await settle();
      after = await provider.read();
    }
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(comparable(after.value)).toEqual(comparable(original));
      console.log('  restored:', describeLayout(after.value));
    }
  }
}

describe.runIf(enabled)('real display changes (capture and restore)', () => {
  it('turns a monitor that is not the main display off, then on again where it was, in one call', async () => {
    await withRestore(async (provider, original) => {
      const on = original.displays.filter((d) => d.enabled);
      expect(on.length, 'needs at least two enabled monitors').toBeGreaterThanOrEqual(2);
      const victim = [...on].reverse().find((d) => !d.primary)!;
      const off = await provider.apply([
        {
          id: victim.id,
          name: victim.name,
          enabled: false,
          primary: false,
          x: 0,
          y: 0,
          rotation: 0,
        },
      ]);
      expect(off.ok, off.ok ? '' : `${off.error.message} ${off.error.detail ?? ''}`).toBe(true);
      await settle();
      const during = await provider.read();
      expect(during.ok && during.value.displays.find((d) => d.id === victim.id)?.enabled).toBe(
        false
      );
      console.log('  off:', during.ok ? describeLayout(during.value) : '');

      // Back on, at its place and size, with everything else as it was: one SetDisplayConfig.
      const back = await provider.apply(original.displays.map(asTarget));
      expect(back.ok, back.ok ? '' : `${back.error.message} ${back.error.detail ?? ''}`).toBe(true);
      await settle();
      const after = await provider.read();
      expect(after.ok).toBe(true);
      if (after.ok) expect(comparable(after.value)).toEqual(comparable(original));
      console.log(
        `  on again with ${provider.lastApplyCalls} SetDisplayConfig call(s)${provider.lastAtomicFailure ? `: ${provider.lastAtomicFailure}` : ''}`
      );
      expect(provider.lastApplyCalls).toBe(1);
    });
  });

  it('applies another refresh rate the monitor lists, and refuses nothing it was not asked', async () => {
    await withRestore(async (provider, original) => {
      // A monitor that offers its current size at a lower refresh rate too.
      const candidate = original.displays
        .filter((d) => d.enabled && d.refreshHz !== undefined && d.modes)
        .map((d) => {
          const sideways = d.rotation === 90 || d.rotation === 270;
          const width = sideways ? d.height : d.width;
          const height = sideways ? d.width : d.height;
          const other = d
            .modes!.filter(
              (m) =>
                m.width === width &&
                m.height === height &&
                Math.abs(m.refreshHz - d.refreshHz!) >= 1 &&
                m.refreshHz >= 50
            )
            .sort((a, b) => a.refreshHz - b.refreshHz)[0];
          return { d, other };
        })
        .find((c) => c.other !== undefined);
      if (!candidate) {
        console.log('  no monitor offers a second refresh rate at its current size; skipped');
        return;
      }
      const { d, other } = candidate;
      console.log(`  ${d.name}: ${d.refreshHz} Hz -> ${other!.refreshHz} Hz`);
      const applied = await provider.apply([{ ...asTarget(d), refreshHz: other!.refreshHz }]);
      expect(
        applied.ok,
        applied.ok ? '' : `${applied.error.message} ${applied.error.detail ?? ''}`
      ).toBe(true);
      await settle();
      const during = await provider.read();
      expect(during.ok).toBe(true);
      if (!during.ok) return;
      const now = during.value.displays.find((m) => m.id === d.id)!;
      expect(Math.round(now.refreshHz ?? 0)).toBe(Math.round(other!.refreshHz));
      expect({ width: now.width, height: now.height, x: now.x, y: now.y }).toEqual({
        width: d.width,
        height: d.height,
        x: d.x,
        y: d.y,
      });
    });
  });

  it('MFD portrait orientation: applies the flying layout with 90 and with 270 and reports what Windows calls each', async () => {
    const findings: string[] = [];
    for (const rotation of [90, 270] as const) {
      await withRestore(async (provider, original) => {
        const usb = original.displays.filter((d) => d.usbSerial !== undefined);
        const main = original.displays
          .filter((d) => d.usbSerial === undefined)
          .sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (usb.length === 0 || !main) {
          console.log('  no USB screens on this PC; skipped');
          return;
        }
        // The flying layout: the largest monitor is main at 0,0, the USB screens in
        // portrait to its right, every other monitor off.
        const mainSideways = main.rotation === 90 || main.rotation === 270;
        const mainWidth = main.enabled ? (mainSideways ? main.height : main.width) : 0;
        let x = main.enabled ? main.width : 0;
        const targets: DisplayTarget[] = original.displays.map((d) => {
          if (d.id === main.id) {
            return { ...asTarget(d), enabled: true, primary: true, x: 0, y: 0 };
          }
          if (d.usbSerial !== undefined) {
            const sideways = d.rotation === 90 || d.rotation === 270;
            const nativeWidth = sideways ? d.height : d.width;
            const nativeHeight = sideways ? d.width : d.height;
            const target: DisplayTarget = {
              id: d.id,
              name: d.name,
              enabled: true,
              primary: false,
              x,
              y: 0,
              width: nativeHeight,
              height: nativeWidth,
              rotation,
            };
            x += nativeHeight;
            return target;
          }
          return {
            id: d.id,
            name: d.name,
            enabled: false,
            primary: false,
            x: 0,
            y: 0,
            rotation: 0,
          };
        });
        expect(mainWidth).toBeGreaterThan(0);
        const applied = await provider.apply(targets);
        expect(
          applied.ok,
          applied.ok ? '' : `${applied.error.message} ${applied.error.detail ?? ''}`
        ).toBe(true);
        await settle();
        const during = await provider.read();
        expect(during.ok).toBe(true);
        if (!during.ok) return;
        console.log(`  flying layout with ${rotation}:`, describeLayout(during.value));
        for (const d of during.value.displays.filter((m) => m.usbSerial !== undefined)) {
          expect(d.rotation, `${d.name} rotation`).toBe(rotation);
          const want = targets.find((t) => t.id === d.id)!;
          expect([d.width, d.height]).toEqual([want.width, want.height]);
          const gdi = d.gdiName ? gdiOrientation(d.gdiName) : undefined;
          findings.push(
            `rotation ${rotation}: DISPLAYCONFIG_ROTATION raw ${d.rawRotation}, GDI dmDisplayOrientation ${gdi} on ${d.usbSerial}`
          );
        }
      });
    }
    // dmDisplayOrientation: 0 landscape, 1 "Portrait" (DMDO_90), 2 landscape flipped,
    // 3 "Portrait (flipped)" (DMDO_270): the order of Windows' own orientation list.
    console.log('  MFD orientation findings:\n    ' + findings.join('\n    '));
    expect(findings.length).toBeGreaterThan(0);
  }, 120_000);
});

describe.runIf(!enabled)('real display changes', () => {
  it.skip('skipped: set RIGREADY_RIG_APPLY=1 (npm run rig:smoke:apply) to change and restore the real layout', () => {});
});
