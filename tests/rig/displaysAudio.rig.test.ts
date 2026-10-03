/**
 * Read-only: the monitor and audio checks against the real machine. Nothing is changed and
 * nothing is written (no layouts or names are stored; the checks get empty stores).
 */
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nullLogger } from '../../src/core/logger';
import { err } from '../../src/core/result';
import {
  audioCapture,
  audioDefaultCheck,
  AudioParamsSchema,
} from '../../src/features/audio/core/audio';
import { modelOf } from '../../src/features/displays/core/identity';
import {
  createDisplayCapture,
  createLayoutCheck,
  LayoutParamsSchema,
  type LayoutDeps,
} from '../../src/features/displays/core/layoutCheck';
import { monitorViews } from '../../src/features/displays/core/service';
import { createWindowsPorts } from '../../src/platform/windows';

const projectRoot = path.resolve(__dirname, '../..');
const ports = createWindowsPorts({ log: nullLogger, projectRoot });
const ctx = { ports, log: nullLogger };
const noStores: LayoutDeps = {
  names: async () => ({}),
  layouts: {
    get: async () => err('layouts.missing', 'none'),
    list: async () => err('layouts.missing', 'none'),
  },
};

afterAll(() => ports.input.stop());

describe('real monitors and audio (read-only)', () => {
  it('reads every monitor with its rotation and an EDID model, and the captured layout check passes', async () => {
    const layout = await ports.displays.read();
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    const views = monitorViews(layout.value.displays, {});
    for (const view of views) {
      expect(modelOf(view.id), view.id).toMatch(/^[A-Z]{3}[0-9A-F]{4}$/);
      expect([0, 90, 180, 270]).toContain(view.rotation);
      console.log(
        `  ${view.number ?? '-'} ${view.label} ${view.enabled ? `${view.width}x${view.height} @${view.x},${view.y} ${view.rotation}°` : 'off'}${view.primary ? ' main' : ''}${view.identical ? ' (identical model)' : ''}`
      );
    }
    const captured = await createDisplayCapture(noStores).capture(ctx);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const params = LayoutParamsSchema.parse(captured.value[0]!.check.params);
    expect(await createLayoutCheck(noStores).run(params, ctx)).toMatchObject({ pass: true });
  });

  it('reads the default playback and recording devices and the captured audio checks pass', async () => {
    const captured = await audioCapture.capture(ctx);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    for (const candidate of captured.value) {
      const params = AudioParamsSchema.parse(candidate.check.params);
      const outcome = await audioDefaultCheck.run(params, ctx);
      console.log(`  ${candidate.title}: ${outcome.summary}`);
      expect(outcome.pass).toBe(true);
    }
    const playback = captured.value.find((c) => c.key === 'audio:playback');
    if (playback) expect(playback.title).toMatch(/^Sound output: .+/);
  });
});
