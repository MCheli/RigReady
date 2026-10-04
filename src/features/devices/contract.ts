import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { DeviceInfoSchema, InputDeviceSchema, InputStateSchema } from '../../shared/models';
import { BindingSourceSchema, BoundInputsSchema } from './core/bound';
import { HealthReportSchema } from './core/health';
import { DeviceIdentitySchema } from './core/identity';
import { NotificationModeSchema, OverviewSchema, UsbMapSchema } from './core/model';

export const devicesContract = defineContract(
  'devices',
  {
    /** Every USB device present, hubs included. */
    list: channel(noInput, z.array(DeviceInfoSchema)),
    /** Devices with names, controllers, location, HidHide state and what setups need. */
    overview: channel(noInput, OverviewSchema),
    /**
     * Which device a checklist item of a setup is about (the Play screen's "Diagnose" link):
     * its identity, and the connected devices that match it (RigDevice.key), if any.
     */
    forCheck: channel(
      z.object({ profileId: z.string().min(1).max(64), itemId: z.string().min(1).max(200) }),
      z.object({
        title: z.string(),
        profile: z.string(),
        identity: DeviceIdentitySchema,
        keys: z.array(z.string()),
      })
    ),
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
    /**
     * Puts the findings of a health check on the clipboard as plain text, to paste into a
     * forum post or a support request. Personal details are removed first.
     */
    copyHealth: channel(
      z.object({ report: HealthReportSchema }),
      z.object({ characters: z.number().int() })
    ),
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
    /** The games whose bindings can be read on this PC, with their aircraft (input tester). */
    bindingSources: channel(noInput, z.array(BindingSourceSchema)),
    /** What every control of every controller does in one aircraft of one game. */
    boundInputs: channel(
      z.object({ game: z.string().min(1).max(40), aircraftId: z.string().min(1).max(200) }),
      BoundInputsSchema
    ),
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
