import { z } from 'zod';
import {
  AudioStateSchema,
  DeviceInfoSchema,
  DisplayLayoutSchema,
  InputDeviceSchema,
  ProcessInfoSchema,
  RotationSchema,
  type AudioState,
  type DeviceInfo,
  type DisplayInfo,
  type InputDevice,
  type ProcessInfo,
} from '../../shared/models';

/** A recorded rig: fixtures/rigs/<name>/*.json. */
export const RigFixtureSchema = z.object({
  devices: z.array(DeviceInfoSchema),
  displays: DisplayLayoutSchema,
  processes: z.array(ProcessInfoSchema),
  audio: AudioStateSchema,
  input: z.array(InputDeviceSchema).default([]),
});
export interface RigState {
  devices: DeviceInfo[];
  displays: DisplayInfo[];
  processes: ProcessInfo[];
  audio: AudioState;
  input: InputDevice[];
}

const DeviceMatchSchema = z
  .object({
    vendorId: z.string().optional(),
    productId: z.string().optional(),
    serial: z.string().optional(),
    /** Case-insensitive substring of the product name. */
    name: z.string().optional(),
  })
  .refine(
    (m) => Object.values(m).some((v) => v !== undefined),
    'A device match needs at least one field'
  );

const DisplayMatchSchema = z
  .object({
    id: z.string().optional(),
    /** Exact EDID name. */
    name: z.string().optional(),
    /** Which one, when several share the name (0-based, in fixture order). */
    index: z.number().int().optional(),
  })
  .refine((m) => m.id !== undefined || m.name !== undefined, 'A display match needs id or name');

/** Changes applied on top of a recorded rig to produce a situation worth testing. */
export const MutationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('unplugDevice'), match: DeviceMatchSchema }),
  z.object({ op: z.literal('stopProcess'), name: z.string() }),
  z.object({ op: z.literal('startProcess'), name: z.string(), path: z.string() }),
  z.object({
    op: z.literal('setDisplay'),
    match: DisplayMatchSchema,
    set: z.object({
      enabled: z.boolean().optional(),
      primary: z.boolean().optional(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      rotation: RotationSchema.optional(),
    }),
  }),
  z.object({ op: z.literal('unplugDisplay'), match: DisplayMatchSchema }),
]);
export type Mutation = z.infer<typeof MutationSchema>;

export const ScenarioSchema = z.object({
  description: z.string(),
  /** Folder name under fixtures/rigs. */
  rig: z.string(),
  /** Another scenario file (relative to this one) whose mutations are applied first. */
  extends: z.string().optional(),
  mutations: z.array(MutationSchema).default([]),
  /** Profile YAML files (relative to this file) copied into the data root at startup. */
  profiles: z.array(z.string()).default([]),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

function matchesDevice(device: DeviceInfo, match: z.infer<typeof DeviceMatchSchema>): boolean {
  if (match.vendorId && device.vendorId !== match.vendorId.toUpperCase()) return false;
  if (match.productId && device.productId !== match.productId.toUpperCase()) return false;
  if (match.serial && device.serial !== match.serial) return false;
  if (match.name && !device.name.toLowerCase().includes(match.name.toLowerCase())) return false;
  return true;
}

function findDisplays(
  displays: DisplayInfo[],
  match: z.infer<typeof DisplayMatchSchema>
): DisplayInfo[] {
  let found = displays.filter(
    (d) =>
      (match.id === undefined || d.id === match.id.toLowerCase()) &&
      (match.name === undefined || d.name === match.name)
  );
  if (match.index !== undefined) {
    const one = found[match.index];
    found = one ? [one] : [];
  }
  return found;
}

/** Applies mutations to a copy of the state. Throws when a mutation matches nothing: a scenario that silently does nothing is a bug. */
export function applyMutations(state: RigState, mutations: Mutation[]): RigState {
  const next: RigState = structuredClone(state);
  for (const mutation of mutations) {
    switch (mutation.op) {
      case 'unplugDevice': {
        const before = next.devices.length;
        next.devices = next.devices.filter((d) => !matchesDevice(d, mutation.match));
        if (next.devices.length === before) {
          throw new Error(`unplugDevice matched no device: ${JSON.stringify(mutation.match)}`);
        }
        break;
      }
      case 'stopProcess': {
        const before = next.processes.length;
        next.processes = next.processes.filter(
          (p) => p.name.toLowerCase() !== mutation.name.toLowerCase()
        );
        if (next.processes.length === before) {
          throw new Error(`stopProcess matched no process: ${mutation.name}`);
        }
        break;
      }
      case 'startProcess': {
        const pid = Math.max(1000, ...next.processes.map((p) => p.pid)) + 4;
        next.processes.push({ pid, name: mutation.name, path: mutation.path });
        break;
      }
      case 'setDisplay': {
        const found = findDisplays(next.displays, mutation.match);
        if (found.length === 0) {
          throw new Error(`setDisplay matched no display: ${JSON.stringify(mutation.match)}`);
        }
        for (const display of found) {
          Object.assign(display, mutation.set);
          if (!display.enabled)
            Object.assign(display, {
              primary: false,
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              rotation: 0,
            });
        }
        break;
      }
      case 'unplugDisplay': {
        const found = new Set(findDisplays(next.displays, mutation.match));
        if (found.size === 0) {
          throw new Error(`unplugDisplay matched no display: ${JSON.stringify(mutation.match)}`);
        }
        next.displays = next.displays.filter((d) => !found.has(d));
        break;
      }
    }
  }
  return next;
}
