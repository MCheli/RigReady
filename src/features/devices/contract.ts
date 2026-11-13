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
    list: channel(noInput, z.array(DeviceInfoSchema), {
      describe: 'Answers with every USB device present, hubs included. Changes nothing.',
      tier: 'read',
    }),
    /** Devices with names, controllers, location, HidHide state and what setups need. */
    overview: channel(noInput, OverviewSchema, {
      describe:
        'Answers with the connected devices with their names, game controllers, USB location, HidHide state, and which setups need them. Device keys come from here. Changes nothing.',
      tier: 'read',
    }),
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
      }),
      {
        describe:
          'Answers with the device a checklist item of a setup is about and the connected devices that match it. profileId comes from fly:state and itemId from fly:check. Changes nothing.',
        tier: 'read',
      }
    ),
    /** Gives a device a name (an empty name removes it). `key` is RigDevice.key. */
    rename: channel(
      z.object({ key: z.string().min(1), name: z.string().max(80) }),
      z.object({ name: z.string().nullable() }),
      {
        describe:
          'Gives a device a name in RigReady; an empty name removes it. key is a device key from devices:overview.',
        tier: 'change',
      }
    ),
    /** The DirectInput controllers a game would list; starts the reader when needed. */
    inputDevices: channel(noInput, z.array(InputDeviceSchema), {
      describe: 'Answers with the DirectInput game controllers a game would list. Changes nothing.',
      tier: 'read',
    }),
    /** Starts or stops sending live input to this window (`input` events). */
    watchInput: channel(
      z.object({ client: z.string().min(1).max(64), on: z.boolean() }),
      z.object({ watching: z.boolean() }),
      {
        describe: 'Starts or stops sending live controller input to a window of the app.',
        tier: 'off',
      }
    ),
    /** Listens for `seconds` while nobody touches anything and reports what moved. */
    healthScan: channel(z.object({ seconds: z.number().min(0.1).max(30) }), HealthReportSchema, {
      describe:
        'Listens to every game controller for the given seconds while nobody touches anything and reports what moved: stuck or held buttons, noisy axes and controls that move by themselves. Ask the user to let go of the controls first. Changes nothing.',
      tier: 'read',
    }),
    /**
     * Puts the findings of a health check on the clipboard as plain text, to paste into a
     * forum post or a support request. Personal details are removed first.
     */
    copyHealth: channel(
      z.object({ report: HealthReportSchema }),
      z.object({ characters: z.number().int() }),
      {
        describe:
          'Puts the findings of devices:healthScan on the clipboard as plain text with personal details removed, to paste into a forum post or support request. Replaces what is on the clipboard.',
        tier: 'off',
      }
    ),
    /** Marks a held button as a switch that is normally on (or not). */
    markSwitch: channel(
      z.object({
        inputKey: z.string().min(1),
        button: z.number().int().min(0),
        expected: z.boolean(),
      }),
      z.object({ switches: z.number().int() }),
      {
        describe:
          'Marks a held button as a switch that is normally on (expected true), or not, so health scans stop reporting it. inputKey and button come from devices:healthScan.',
        tier: 'change',
      }
    ),
    usbMap: channel(noInput, UsbMapSchema, {
      describe:
        'Answers with the USB tree of this PC: its USB controllers and the hubs and devices on them. Changes nothing.',
      tier: 'read',
    }),
    /** The games whose bindings can be read on this PC, with their aircraft (input tester). */
    bindingSources: channel(noInput, z.array(BindingSourceSchema), {
      describe:
        'Answers with the games whose bindings RigReady can read on this PC, with their aircraft. Changes nothing.',
      tier: 'read',
    }),
    /** What every control of every controller does in one aircraft of one game. */
    boundInputs: channel(
      z.object({ game: z.string().min(1).max(40), aircraftId: z.string().min(1).max(200) }),
      BoundInputsSchema,
      {
        describe:
          'Answers with what every control of every controller does in one aircraft of one game. game and aircraftId come from devices:bindingSources. Changes nothing.',
        tier: 'read',
      }
    ),
    setNotifications: channel(
      z.object({ mode: NotificationModeSchema }),
      z.object({ mode: NotificationModeSchema }),
      {
        describe:
          'Chooses which device connects and disconnects RigReady tells the user about: off, required (devices a setup needs), controllers, or all.',
        tier: 'change',
      }
    ),
    /** The window reports whether it is on screen; notifications are only shown while it is not. */
    windowVisible: channel(z.object({ visible: z.boolean() }), z.object({ visible: z.boolean() }), {
      describe: "The app's window says whether it is on screen.",
      tier: 'off',
    }),
  },
  {
    /** Latest state of each controller that changed, at most about 60 times a second. */
    input: z.object({ states: z.array(InputStateSchema) }),
    /**
     * The list of game controllers changed while a window watches input: one came, went or
     * got another number. Sent before any input of the new list.
     */
    controllers: z.object({ devices: z.array(InputDeviceSchema) }),
  }
);
