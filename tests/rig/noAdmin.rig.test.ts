/**
 * The rig smoke runs without administrator rights (PLAT-007): everything the other rig
 * tests read from the real machine, they read as an ordinary, not elevated process.
 * This file records that, and that the readers a feature depends on answer in that state.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nullLogger } from '../../src/core/logger';
import { createWindowsPorts } from '../../src/platform/windows';
import { isElevated } from '../winHelpers';

const projectRoot = path.resolve(__dirname, '../..');

describe('no administrator rights', () => {
  it('the rig smoke itself runs without elevation', async () => {
    const elevated = await isElevated();
    console.log(`  rig smoke runs ${elevated ? 'WITH' : 'without'} administrator rights`);
    expect(elevated, 'run "npm run rig:smoke" from a normal (not elevated) terminal').toBe(false);
  });

  it('every reader answers without elevation: devices, monitors, processes, services, audio, registry, input', async () => {
    const ports = createWindowsPorts({ log: nullLogger, projectRoot });
    const results = {
      devices: await ports.devices.list(),
      displays: await ports.displays.read(),
      processes: await ports.processes.list(),
      services: await ports.services.list(),
      audio: await ports.audio.read(),
      registry: await ports.registry.listKeys('HKLM', 'SOFTWARE\\Microsoft\\Windows NT'),
      input: await ports.input.start(),
    };
    await ports.input.stop();
    for (const [name, result] of Object.entries(results)) {
      expect(result.ok, `${name}: ${JSON.stringify(result).slice(0, 300)}`).toBe(true);
    }
  });
});
