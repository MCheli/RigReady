import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { PadReportSchema, VirtualPadKindSchema } from '../../shared/models';
import { RunningSchema } from './core/running';
import { ControllerRefSchema, PadProfileSchema, PROFILE_ID } from './core/profile';

const ProfileIdSchema = z.string().regex(PROFILE_ID);

export const ProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  kind: VirtualPadKindSchema,
  /** A starting point: copied, never changed or started as it is. */
  builtin: z.boolean(),
  /** Parts with a control chosen. */
  mapped: z.number().int(),
  /** Parts whose controller is not connected now. */
  missing: z.array(z.string()),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export const ControllerSchema = z.object({
  name: z.string(),
  guid: z.string(),
  axisNames: z.array(z.string()),
  numButtons: z.number().int(),
  numHats: z.number().int(),
});

export const VcStateSchema = z.object({
  driver: z.object({
    installed: z.boolean(),
    running: z.boolean(),
    /** The service's state in words when it is installed. */
    state: z.string().optional(),
    downloadUrl: z.string(),
  }),
  hidHide: z.object({ installed: z.boolean(), downloadUrl: z.string() }),
  running: RunningSchema.optional(),
  profiles: z.object({
    builtin: z.array(ProfileSummarySchema),
    mine: z.array(ProfileSummarySchema),
  }),
  /** The controllers that can drive a virtual one (the virtual ones left out). */
  controllers: z.array(ControllerSchema),
  /** Set when the controllers could not be read. */
  inputError: z.string().optional(),
});
export type VcState = z.infer<typeof VcStateSchema>;

export const PressSchema = z.object({
  device: ControllerRefSchema,
  input: z.string(),
  kind: z.enum(['button', 'hat', 'axis']),
});

export const virtualControllerContract = defineContract(
  'virtual-controller',
  {
    state: channel(noInput, VcStateSchema, {
      describe:
        "Answers with whether the ViGEmBus driver and HidHide are installed, the virtual controller running now (if any), every virtual controller profile (starting points and the user's own) and the controllers that can drive one. Profile ids come from here. Changes nothing.",
      tier: 'read',
    }),
    running: channel(
      noInput,
      z.object({
        running: RunningSchema.nullable(),
        profiles: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
      {
        describe:
          "Answers with the virtual controller running now (or null) and the user's own profiles by name. Reads nothing but RigReady's own data.",
        tier: 'read',
      }
    ),
    profile: channel(z.object({ id: ProfileIdSchema }), PadProfileSchema, {
      describe:
        'Answers with one virtual controller profile: which real control drives each stick, trigger and button, with its deadzone, curve and range. id comes from virtual-controller:state. Changes nothing.',
      tier: 'read',
    }),
    save: channel(z.object({ profile: PadProfileSchema }), PadProfileSchema, {
      describe:
        "Saves one of the user's own virtual controller profiles in RigReady's data folder (a starting point cannot be saved over; copy it first). Writes nothing outside RigReady.",
      tier: 'change',
    }),
    copy: channel(
      z.object({ from: ProfileIdSchema, name: z.string().trim().min(1).max(80) }),
      PadProfileSchema,
      {
        describe:
          "Makes a copy of a virtual controller profile (a starting point or the user's own) under a new name, as the user's own. from comes from virtual-controller:state.",
        tier: 'change',
      }
    ),
    remove: channel(z.object({ id: ProfileIdSchema }), z.object({ removed: z.boolean() }), {
      describe:
        "Deletes one of the user's own virtual controller profiles. Ask the user first. id comes from virtual-controller:state.",
      tier: 'change',
    }),
    start: channel(
      z.object({ id: ProfileIdSchema, hide: z.boolean().default(false) }),
      RunningSchema,
      {
        describe:
          'Plugs in a virtual Xbox 360 controller or DualShock 4 fed from the real controllers as the profile says, for any game or emulator that reads a standard controller. hide also hides the real controllers from games with HidHide until it stops. Needs the ViGEmBus driver installed by the user. id comes from virtual-controller:state.',
        tier: 'change',
      }
    ),
    stop: channel(noInput, z.object({ message: z.string().nullable() }), {
      describe:
        'Takes the virtual controller away and shows the real controllers to games again if they were hidden. Says what was done, or null when none was running.',
      tier: 'change',
    }),
    detect: channel(
      z.object({ seconds: z.number().min(1).max(30) }),
      z.object({ press: PressSchema.nullable() }),
      {
        describe:
          'Waits for the user to press a button, a hat or move an axis on a real controller and says which. For the profile editor in the window.',
        tier: 'off',
      }
    ),
    live: channel(
      z.object({ on: z.boolean(), profile: PadProfileSchema.optional() }),
      z.object({ watching: z.boolean() }),
      {
        describe:
          'Starts or stops sending what the virtual controller reports (or would report for an edited profile) to a window of the app as `live` events.',
        tier: 'off',
      }
    ),
  },
  {
    /** Sent while a window watches: the report, about 30 times a second at most. */
    live: z.object({ report: PadReportSchema, plugged: z.boolean() }),
    /** It started or stopped, or went away by itself (note says why). */
    changed: z.object({
      running: RunningSchema.optional(),
      note: z.string().optional(),
      profiles: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  }
);
