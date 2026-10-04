import { z } from 'zod';
import { channel, defineContract, noInput } from '../../../../src/shared/ipc';

/** A feature that exists only for tests/unit/selfRegistration.test.ts. */
export const exampleContract = defineContract(
  'zz-example',
  {
    ping: channel(z.object({ text: z.string().max(40) }), z.object({ echo: z.string() })),
    count: channel(noInput, z.object({ pings: z.number().int() })),
  },
  { pinged: z.object({ text: z.string() }) }
);
