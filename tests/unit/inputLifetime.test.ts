import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nullLogger } from '../../src/core/logger';
import { ok } from '../../src/core/result';
import { SidecarInputProvider } from '../../src/platform/windows/input';
import { scenarioRig } from '../helpers';

/**
 * The lifetime rule of InputProvider (src/core/ports/index.ts): any feature calls start()
 * whenever it needs controllers, start() is idempotent, and only the app shell stops the
 * reader. The real provider is exercised with a stand-in sidecar: a Node script that
 * speaks the sidecar's protocol and writes down every time it is started.
 */

const SIDECAR = `
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
fs.appendFileSync(path.join(dir, 'starts.log'), 'start\\n');
if (fs.existsSync(path.join(dir, 'fail-once'))) {
  fs.rmSync(path.join(dir, 'fail-once'));
  process.stderr.write('no DirectInput today');
  process.exit(3);
}
const device = {
  index: 0,
  name: 'Stick',
  guid: 'AAAAAAAA-0000-0000-0000-000000000001',
  numAxes: 2,
  numButtons: 4,
  numHats: 0,
};
setTimeout(() => {
  process.stdout.write(JSON.stringify({ type: 'ready', version: 'stand-in', devices: [device] }) + '\\n');
}, 50);
require('node:readline')
  .createInterface({ input: process.stdin })
  .on('line', (line) => {
    if (JSON.parse(line).command === 'stop') process.exit(0);
  });
`;

describe('input reader lifetime', () => {
  let dir: string;
  let provider: SidecarInputProvider;
  const starts = async (): Promise<number> => {
    const text = await fs.readFile(path.join(dir, 'starts.log'), 'utf8').catch(() => '');
    return text.split('\n').filter(Boolean).length;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rigready-test-input-'));
    await fs.writeFile(path.join(dir, 'sidecar.js'), SIDECAR);
    provider = new SidecarInputProvider(
      () => ok({ python: process.execPath, script: path.join(dir, 'sidecar.js') }),
      nullLogger
    );
  });
  afterEach(async () => {
    await provider.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('concurrent start() calls from several features share one start of the sidecar', async () => {
    const results = await Promise.all([provider.start(), provider.start(), provider.start()]);
    expect(results.every((r) => r.ok && r.value.length === 1)).toBe(true);
    expect(await starts()).toBe(1);
    // Asking again while it runs is answered from the running reader.
    const again = await provider.start();
    expect(again.ok && again.value[0]?.name).toBe('Stick');
    expect(await starts()).toBe(1);
  });

  it('a failed start is reported and the next start() tries again', async () => {
    await fs.writeFile(path.join(dir, 'fail-once'), '');
    const [first, second] = await Promise.all([provider.start(), provider.start()]);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(!first.ok && first.error.code).toBe('input.exit');
    expect(await starts()).toBe(1);
    const retry = await provider.start();
    expect(retry.ok && retry.value.length).toBe(1);
    expect(await starts()).toBe(2);
  });

  it('stop() ends the reader, also one that is still starting, and start() starts a new one', async () => {
    const starting = provider.start();
    await provider.stop();
    expect((await starting).ok).toBe(true);
    expect(provider.devices()).toEqual([]);
    const next = await provider.start();
    expect(next.ok && next.value.length).toBe(1);
    expect(await starts()).toBe(2);
  });

  it('the fake reader answers every start() with the controllers attached now', async () => {
    const rig = await scenarioRig('flying-all-good', { files: [] });
    try {
      const [a, b] = await Promise.all([rig.ports.input.start(), rig.ports.input.start()]);
      expect(a.ok && b.ok && a.value.length === b.value.length && a.value.length > 0).toBe(true);
      await rig.ports.input.stop();
      const after = await rig.ports.input.start();
      expect(after.ok && after.value.length).toBe(a.ok ? a.value.length : -1);
    } finally {
      await rig.cleanup();
    }
  });
});
