/**
 * Changes the real default audio devices, then puts them back. Only runs with
 * RIGREADY_RIG_APPLY=1 (npm run rig:smoke:apply). The defaults are captured first and
 * restored in a finally block; the test fails loudly if they do not end as they began.
 */
import { describe, expect, it } from 'vitest';
import { WindowsAudioProvider, defaultEndpointId } from '../../src/platform/windows/audio';
import type { AudioRole, AudioState } from '../../src/shared/models';

const enabled = process.env['RIGREADY_RIG_APPLY'] === '1';

const ROLES: AudioRole[] = ['console', 'multimedia', 'communications'];

/** Every default there is: one endpoint id per flow and role, read straight from Windows. */
function allDefaults(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const flow of ['playback', 'recording'] as const) {
    for (const role of ROLES) out[`${flow}/${role}`] = defaultEndpointId(flow, role);
  }
  return out;
}

const defaults = (state: AudioState) => ({
  playback: state.defaultPlayback?.id,
  recording: state.defaultRecording?.id,
  commsPlayback: state.defaultCommsPlayback?.id,
  commsRecording: state.defaultCommsRecording?.id,
});

describe.runIf(enabled)('real audio default device (capture and restore)', () => {
  it('switches the default playback and recording device and restores every role exactly', async () => {
    const audio = new WindowsAudioProvider();
    const captured = allDefaults();
    const before = await audio.read();
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const original = before.value;

    const restore = async (): Promise<void> => {
      // Each role of each flow can point at a different device: put back every one.
      for (const [key, id] of Object.entries(captured)) {
        if (id) await audio.setDefault(id, { roles: [key.split('/')[1] as AudioRole] });
      }
    };

    try {
      // Setting the current default again changes nothing and must succeed.
      if (original.defaultPlayback) {
        const same = await audio.setDefault(original.defaultPlayback.id, {
          roles: ['console', 'multimedia'],
        });
        expect(same.ok, same.ok ? '' : `${same.error.message} ${same.error.detail ?? ''}`).toBe(
          true
        );
        if (same.ok) expect(defaults(same.value)).toEqual(defaults(original));
      }

      for (const flow of ['playback', 'recording'] as const) {
        const current = flow === 'playback' ? original.defaultPlayback : original.defaultRecording;
        const other = original.devices.find((d) => d.flow === flow && d.id !== current?.id);
        if (!current || !other) {
          console.log(`  ${flow}: only one device, nothing to switch to`);
          continue;
        }
        const switched = await audio.setDefault(other.id);
        expect(
          switched.ok,
          switched.ok ? '' : `${switched.error.message} ${switched.error.detail ?? ''}`
        ).toBe(true);
        if (!switched.ok) continue;
        const now = defaults(switched.value);
        expect(flow === 'playback' ? now.playback : now.recording).toBe(other.id);
        expect(flow === 'playback' ? now.commsPlayback : now.commsRecording).toBe(other.id);
        console.log(`  ${flow}: ${current.name} -> ${other.name}`);

        // Only the communications role: the main default stays where it is.
        const comms = await audio.setDefault(current.id, { roles: ['communications'] });
        expect(comms.ok).toBe(true);
        if (comms.ok) {
          const mixed = defaults(comms.value);
          expect(flow === 'playback' ? mixed.playback : mixed.recording).toBe(other.id);
          expect(flow === 'playback' ? mixed.commsPlayback : mixed.commsRecording).toBe(current.id);
        }
      }

      expect(
        await audio.setDefault('{0.0.0.00000000}.{00000000-0000-0000-0000-000000000000}')
      ).toMatchObject({ ok: false, error: { code: 'audio.missing' } });
    } finally {
      await restore();
      const after = await audio.read();
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(defaults(after.value)).toEqual(defaults(original));
        expect(allDefaults()).toEqual(captured);
        console.log(
          `  restored: playback ${after.value.defaultPlayback?.name ?? 'none'}; recording ${after.value.defaultRecording?.name ?? 'none'}`
        );
      }
    }
  });
});

describe.runIf(!enabled)('real audio default device', () => {
  it.skip('skipped: set RIGREADY_RIG_APPLY=1 (npm run rig:smoke:apply) to change and restore the real default devices', () => {});
});
