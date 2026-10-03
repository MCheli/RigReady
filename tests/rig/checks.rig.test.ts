/**
 * The generic checks on the real PC, read-only: nothing is started, stopped or written.
 * They hold on any Windows PC, without admin rights.
 */
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GameRegistry } from '../../src/core/games';
import { nullLogger } from '../../src/core/logger';
import { serviceRunningCheck } from '../../src/features/checks-generic/core/serviceCheck';
import {
  createProcessRunningCheck,
  pathResolver,
  ProcessParamsSchema,
  SessionStarts,
} from '../../src/features/processes/core/processCheck';
import { createWindowsPorts } from '../../src/platform/windows';

const projectRoot = path.resolve(__dirname, '../..');
const ports = createWindowsPorts({ log: nullLogger, projectRoot });
const ctx = { ports, log: nullLogger };

afterAll(() => ports.input.stop());

describe('generic checks on this PC (read-only)', () => {
  it('the process check finds explorer.exe, by name and by its full path', async () => {
    const check = createProcessRunningCheck(new SessionStarts(), pathResolver(new GameRegistry()));
    expect(await check.run(ProcessParamsSchema.parse({ name: 'EXPLORER.EXE' }), ctx)).toEqual({
      pass: true,
      summary: 'Running',
    });
    const windows = process.env['SystemRoot'] ?? 'C:\\Windows';
    expect(
      (
        await check.run(
          ProcessParamsSchema.parse({
            name: 'explorer.exe',
            path: path.join(windows, 'explorer.exe'),
          }),
          ctx
        )
      ).pass
    ).toBe(true);
    expect(
      (await check.run(ProcessParamsSchema.parse({ name: 'no-such-program-rigready.exe' }), ctx))
        .summary
    ).toBe('Not running');
  });

  it('the service check reads Windows Audio (Audiosrv) without admin rights', async () => {
    const result = await serviceRunningCheck.run({ name: 'Audiosrv' }, ctx);
    console.log(`  Audiosrv: ${result.summary}`);
    expect(result.error).toBeUndefined();
    expect(['Running', 'Stopped', 'Start pending', 'Stop pending', 'Paused']).toContain(
      result.summary
    );
    expect(await serviceRunningCheck.run({ name: 'NoSuchServiceRigReady' }, ctx)).toEqual({
      pass: false,
      summary: 'Not installed',
    });
  });
});
