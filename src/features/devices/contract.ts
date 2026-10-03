import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { DeviceInfoSchema, InputDeviceSchema, InputStateSchema } from '../../shared/models';
import { HealthReportSchema } from './core/health';
import { NotificationModeSchema, OverviewSchema, UsbMapSchema } from './core/model';

export const devicesContract = defineContract(
  'devices',
  {
    /** Every USB device present, hubs included. */
    list: channel(noInput, z.array(DeviceInfoSchema)),
    /** Devices with names, controllers, location, HidHide state and what setups need. */
    overview: channel(noInput, OverviewSchema),
    /** Gives a device a name (an empty name removes it). `key` is RigDevice.key. */
    rename: channel(
      z.object({ key: z.string().min(1), name: z.string().max(80) }),
      z.object({ name: z.string().nullable() })
    ),
    /** The DirectInput controllers a game would list; starts the reader when needed. */
    inputDevices: channel(noInput, z.array(InputDeviceSchema)),
    /** Starts or stops sending live input to this window (`input` events). */
    watchInput: channel(
      z.object({ client: z.string().min(1).max(64), on: z.boolean() }),
      z.object({ watching: z.boolean() })
    ),
    /** Listens for `seconds` while nobody touches anything and reports what moved. */
    healthScan: channel(z.object({ seconds: z.number().min(0.1).max(30) }), HealthReportSchema),
    /** Marks a held button as a switch that is normally on (or not). */
    markSwitch: channel(
      z.object({
        inputKey: z.string().min(1),
        button: z.number().int().min(0),
        expected: z.boolean(),
      }),
      z.object({ switches: z.number().int() })
    ),
    usbMap: channel(noInput, UsbMapSchema),
    setNotifications: channel(
      z.object({ mode: NotificationModeSchema }),
      z.object({ mode: NotificationModeSchema })
    ),
    /** The window reports whether it is on screen; notifications are only shown while it is not. */
    windowVisible: channel(z.object({ visible: z.boolean() }), z.object({ visible: z.boolean() })),
  },
  {
    /** Latest state of each controller that changed, at most about 60 times a second. */
    input: z.object({ states: z.array(InputStateSchema) }),
  }
);
