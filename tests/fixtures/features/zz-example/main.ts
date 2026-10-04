import { z } from 'zod';
import { bind, defineFeatureMain } from '../../../../src/core/feature';
import { err, ok } from '../../../../src/core/result';
import { exampleContract } from './contract';

/**
 * The main side of the test feature: two IPC channels, a check type with its fix, a
 * capture and a stand-down step, all registered from setup() like any real feature.
 */
let disposed = 0;
export const disposedTimes = (): number => disposed;

export default defineFeatureMain({
  id: 'zz-example',
  setup(ctx) {
    let pings = 0;
    let lamp = false;
    ctx.checks.registerCheck({
      type: 'zz-example.lamp',
      group: 'other',
      label: 'Example lamp is on',
      params: z.object({ colour: z.string().default('green') }),
      fixes: ['zz-example.switchOn'],
      async run(params) {
        return lamp
          ? { pass: true, summary: `On (${params.colour})` }
          : { pass: false, summary: 'Off' };
      },
      async standDown() {
        if (!lamp) return ok(null);
        lamp = false;
        return ok('Switched the example lamp off');
      },
    });
    ctx.checks.registerRemediation({
      type: 'zz-example.switchOn',
      label: 'Switch the example lamp on',
      order: 400,
      params: z.object({ broken: z.boolean().default(false) }),
      describe: () => 'Switch the lamp on',
      async run(params) {
        if (!params.broken) lamp = true;
        // Read back before saying so.
        return lamp ? ok('Switched the lamp on') : err('zz-example.lamp', 'The lamp stayed off.');
      },
    });
    ctx.checks.registerCapture({
      id: 'zz-example',
      label: 'Example',
      async capture() {
        return ok([
          {
            key: 'zz-example.lamp',
            group: 'other' as const,
            title: 'Example lamp',
            selectedByDefault: false,
            check: {
              type: 'zz-example.lamp',
              title: 'Example lamp',
              required: true,
              params: { colour: 'green' },
              remediation: { type: 'zz-example.switchOn', params: {} },
            },
          },
        ]);
      },
    });
    ctx.checks.registerStandDownStep({
      id: 'zz-example.goodbye',
      label: 'Example',
      order: 900,
      run: async () => ok(null),
    });
    return [
      bind(exampleContract, {
        ping: async ({ text }) => {
          pings++;
          ctx.emit(exampleContract, 'pinged', { text });
          return ok({ echo: text });
        },
        count: async () => ok({ pings }),
      }),
    ];
  },
  dispose() {
    disposed++;
  },
});
