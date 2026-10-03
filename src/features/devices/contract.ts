import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { DeviceInfoSchema } from '../../shared/models';

export const devicesContract = defineContract('devices', {
  /** Every USB device present, hubs included. */
  list: channel(noInput, z.array(DeviceInfoSchema)),
});
