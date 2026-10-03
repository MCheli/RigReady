import type { AudioProvider } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { AudioState } from '../../../shared/models';
import type { AudioView } from '../contract';
import { defaultOf, makeDefault, type DefaultRole } from './audio';

/** The Audio page's list: devices by flow, defaults first, then by name. */
export function audioView(state: AudioState): AudioView {
  const list = (flow: 'playback' | 'recording') =>
    state.devices
      .filter((d) => d.flow === flow)
      .map((d) => ({
        id: d.id,
        name: d.name,
        flow,
        isDefault: defaultOf(state, flow)?.id === d.id,
        isCommunications: defaultOf(state, flow, true)?.id === d.id,
      }))
      .sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          Number(b.isCommunications) - Number(a.isCommunications) ||
          a.name.localeCompare(b.name)
      );
  return { playback: list('playback'), recording: list('recording') };
}

export async function readView(audio: AudioProvider): Promise<Result<AudioView>> {
  const state = await audio.read();
  return state.ok ? ok(audioView(state.value)) : state;
}

/** The Audio page's "Make default" and "Use for calls". */
export async function setDefaultFromPage(
  audio: AudioProvider,
  id: string,
  role: DefaultRole
): Promise<Result<{ view: AudioView; message: string }>> {
  const state = await audio.read();
  if (!state.ok) return state;
  const device = state.value.devices.find((d) => d.id === id);
  if (!device) {
    return err(
      'audio.missing',
      'That device is no longer connected.',
      'It may have been unplugged or turned off. The list has been refreshed.'
    );
  }
  const done = await makeDefault(audio, device, role);
  if (!done.ok) return done;
  const kind = device.flow === 'playback' ? 'output' : 'input';
  const message =
    role === 'communications'
      ? `${device.name} is now the default for calls`
      : role === 'both'
        ? `${device.name} is now the default ${kind}, also for calls`
        : `${device.name} is now the default ${kind}`;
  return ok({ view: audioView(done.value), message });
}
