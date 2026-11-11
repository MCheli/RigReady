import { z } from 'zod';
import { VirtualPadKindSchema } from '../../../shared/models';

/**
 * A virtual controller profile: which control of which real controller drives each part of
 * the virtual one, and how. Profiles belong to no game: a setup names one in a launch step,
 * or the user starts one by hand for any program that reads a standard controller.
 */

const AXES = 'X|Y|Z|RX|RY|RZ|SLIDER1|SLIDER2';
/** DirectInput's names, as the bindings pages use them: JOY_X, JOY_BTN5, JOY_BTN_POV1_U. */
export const INPUT_PATTERN = new RegExp(
  `^JOY_(?:${AXES}|BTN(?:[1-9]\\d?|1[01]\\d|12[0-8])|BTN_POV[1-4]_(?:U|UR|R|DR|D|DL|L|UL))$`
);

export const ControllerRefSchema = z.object({
  /** The name DirectInput gives the controller ("T-Pendular-Rudder"). */
  name: z.string().min(1).max(260),
  /** Its instance GUID on the PC where it was picked; the name is used where it differs. */
  guid: z
    .string()
    .regex(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/)
    .optional(),
});
export type ControllerRef = z.infer<typeof ControllerRefSchema>;

export const SourceSchema = z.object({
  device: ControllerRefSchema,
  input: z.string().regex(INPUT_PATTERN),
  /**
   * For an axis used as a button: pressed past half of its travel to this side. Absent
   * for an axis: the axis itself.
   */
  when: z.enum(['above', 'below']).optional(),
});
export type Source = z.infer<typeof SourceSchema>;

/** How a real axis becomes a part of the virtual controller. */
const ShapeFields = {
  /** Turns the axis round. */
  invert: z.boolean().default(false),
  /** Movement near the centre (sticks) or near the start (triggers) that counts as none. 0 to 0.9. */
  deadzone: z.number().min(0).max(0.9).default(0),
  /**
   * The response curve as a power: 1 is straight, above 1 is gentler near the centre and
   * steeper at the end, below 1 the other way round. 0.2 to 5.
   */
  curve: z.number().min(0.2).max(5).default(1),
  /**
   * How much of the real travel gives full output: 1 is all of it, 0.25 reaches full
   * output at a quarter (a wheel turned 225 of its 900 degrees). 0.05 to 1.
   */
  range: z.number().min(0.05).max(1).default(1),
  /** What this part is for, in a few words ("Pitch: pull back to climb"). */
  hint: z.string().max(200).optional(),
};

export const StickAxisSchema = z.object({ source: SourceSchema.optional(), ...ShapeFields });
export type StickAxis = z.infer<typeof StickAxisSchema>;

export const TriggerSchema = z.object({ source: SourceSchema.optional(), ...ShapeFields });
export type Trigger = z.infer<typeof TriggerSchema>;

/**
 * One throttle axis split over both triggers: forward of `split` it presses RT, behind it
 * LT, and at `split` (an idle detent, say) neither.
 */
export const SplitThrottleSchema = z.object({
  source: SourceSchema.optional(),
  invert: z.boolean().default(false),
  /** Where the throttle gives neither trigger, as a share of its travel from the back. */
  split: z.number().min(0.05).max(0.95).default(0.5),
  /** Movement either side of the split that counts as none, as a share of that side. */
  deadzone: z.number().min(0).max(0.9).default(0.05),
  curve: z.number().min(0.2).max(5).default(1),
  hint: z.string().max(200).optional(),
});
export type SplitThrottle = z.infer<typeof SplitThrottleSchema>;

/** The buttons of the virtual controller, by their Xbox names, with their XInput bits. */
export const BUTTON_BITS = {
  a: 0x1000,
  b: 0x2000,
  x: 0x4000,
  y: 0x8000,
  lb: 0x0100,
  rb: 0x0200,
  back: 0x0020,
  start: 0x0010,
  ls: 0x0040,
  rs: 0x0080,
  guide: 0x0400,
  up: 0x0001,
  down: 0x0002,
  left: 0x0004,
  right: 0x0008,
} as const;
export type ButtonName = keyof typeof BUTTON_BITS;
export const BUTTON_NAMES = Object.keys(BUTTON_BITS) as ButtonName[];
export const ButtonNameSchema = z.enum(BUTTON_NAMES as [ButtonName, ...ButtonName[]]);

export const ButtonMapSchema = z.object({
  source: SourceSchema.optional(),
  hint: z.string().max(200).optional(),
});
export type ButtonMap = z.infer<typeof ButtonMapSchema>;

export const STICK_NAMES = ['lx', 'ly', 'rx', 'ry'] as const;
export type StickName = (typeof STICK_NAMES)[number];

export const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const PadProfileSchema = z.object({
  id: z.string().regex(PROFILE_ID),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000).optional(),
  /** The controller games see. */
  kind: VirtualPadKindSchema.default('xbox360'),
  sticks: z
    .object({
      lx: StickAxisSchema.prefault({}),
      ly: StickAxisSchema.prefault({}),
      rx: StickAxisSchema.prefault({}),
      ry: StickAxisSchema.prefault({}),
    })
    .prefault({}),
  triggers: z
    .object({ lt: TriggerSchema.prefault({}), rt: TriggerSchema.prefault({}) })
    .prefault({}),
  /** When it has a source, it drives both triggers and `triggers` is not used. */
  throttle: SplitThrottleSchema.optional(),
  buttons: z.partialRecord(ButtonNameSchema, ButtonMapSchema).default({}),
});
export type PadProfile = z.infer<typeof PadProfileSchema>;
export type PadProfileInput = z.input<typeof PadProfileSchema>;

/** Every source the profile uses, with where it is used ("lx", "throttle", "a"). */
export function profileSources(profile: PadProfile): { part: string; source: Source }[] {
  const out: { part: string; source: Source }[] = [];
  for (const name of STICK_NAMES) {
    const source = profile.sticks[name].source;
    if (source) out.push({ part: name, source });
  }
  const throttle = profile.throttle?.source;
  if (throttle) out.push({ part: 'throttle', source: throttle });
  else {
    for (const name of ['lt', 'rt'] as const) {
      const source = profile.triggers[name].source;
      if (source) out.push({ part: name, source });
    }
  }
  for (const name of BUTTON_NAMES) {
    const source = profile.buttons[name]?.source;
    if (source) out.push({ part: name, source });
  }
  return out;
}

/** "Stick X", "Button 5", "Hat 1 up", for a source's input. */
export function inputLabel(input: string, when?: 'above' | 'below'): string {
  const button = /^JOY_BTN(\d+)$/.exec(input);
  if (button) return `Button ${button[1]}`;
  const hat = /^JOY_BTN_POV(\d)_(\w+)$/.exec(input);
  if (hat) {
    const words: Record<string, string> = {
      U: 'up',
      UR: 'up-right',
      R: 'right',
      DR: 'down-right',
      D: 'down',
      DL: 'down-left',
      L: 'left',
      UL: 'up-left',
    };
    return `Hat ${hat[1]} ${words[hat[2]!] ?? hat[2]}`;
  }
  const axis = input.replace(/^JOY_/, '');
  const names: Record<string, string> = {
    X: 'X axis',
    Y: 'Y axis',
    Z: 'Z axis',
    RX: 'X rotation',
    RY: 'Y rotation',
    RZ: 'Z rotation',
    SLIDER1: 'Slider 1',
    SLIDER2: 'Slider 2',
  };
  const name = names[axis] ?? axis;
  if (when === 'above') return `${name}, pushed past half one way`;
  if (when === 'below') return `${name}, pushed past half the other way`;
  return name;
}

/** The words for each part of the virtual controller. */
export const PART_LABELS: Record<string, string> = {
  lx: 'Left stick, left and right',
  ly: 'Left stick, up and down',
  rx: 'Right stick, left and right',
  ry: 'Right stick, up and down',
  lt: 'Left trigger (LT)',
  rt: 'Right trigger (RT)',
  throttle: 'Throttle on both triggers',
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  lb: 'Left bumper (LB)',
  rb: 'Right bumper (RB)',
  back: 'Back (View)',
  start: 'Start (Menu)',
  ls: 'Left stick press (L3)',
  rs: 'Right stick press (R3)',
  guide: 'Guide (Xbox button)',
  up: 'D-pad up',
  down: 'D-pad down',
  left: 'D-pad left',
  right: 'D-pad right',
};

/** The DualShock 4 names of the buttons that are named differently. */
export const DS4_LABELS: Partial<Record<string, string>> = {
  a: 'Cross',
  b: 'Circle',
  x: 'Square',
  y: 'Triangle',
  lb: 'L1',
  rb: 'R1',
  lt: 'L2',
  rt: 'R2',
  back: 'Share',
  start: 'Options',
  ls: 'L3',
  rs: 'R3',
  guide: 'PS button',
};
