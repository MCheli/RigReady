import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { DefaultRoleSchema, FlowSchema } from './core/audio';

export const AudioDeviceViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  flow: FlowSchema,
  /** Windows' default device for this flow. */
  isDefault: z.boolean(),
  /** Windows' default communication device for this flow. */
  isCommunications: z.boolean(),
});
export type AudioDeviceView = z.infer<typeof AudioDeviceViewSchema>;

export const AudioViewSchema = z.object({
  playback: z.array(AudioDeviceViewSchema),
  recording: z.array(AudioDeviceViewSchema),
});
export type AudioView = z.infer<typeof AudioViewSchema>;

export const audioContract = defineContract('audio', {
  /** Every active playback and recording device, with Windows' defaults marked. */
  view: channel(noInput, AudioViewSchema),
  /** Makes a device a Windows default and reads it back. */
  setDefault: channel(
    z.object({ id: z.string().min(1), role: DefaultRoleSchema }),
    z.object({ view: AudioViewSchema, message: z.string() })
  ),
});
