import { afterEach, describe, expect, it } from 'vitest';
import type { ActionReport, ChecklistReport } from '../../../core/checks/engine';
import { err } from '../../../core/result';
import {
  mutate,
  scenarioRig,
  wiredApp,
  type TestRig,
  type WiredApp,
} from '../../../../tests/helpers';
import type { AudioView } from '../contract';
import {
  audioCapture,
  audioDefaultCheck,
  AudioParamsSchema,
  createAudioStandDown,
  createSetDefaultRemediation,
  PreviousDefaults,
  rolesFor,
  type AudioParams,
} from './audio';
import { audioView } from './view';

let rig: TestRig | undefined;
let app: WiredApp | undefined;
afterEach(async () => {
  await rig?.cleanup();
  await app?.cleanup();
  rig = undefined;
  app = undefined;
});

const NO_FILES = { files: [] };

const HEADPHONES = {
  id: '{0.0.0.00000000}.{20e0482c-9de0-4efc-bcac-f2b35cff7d43}',
  name: 'Headphones (Arctis Pro Wireless Game)',
};
const HEADSET_MIC = {
  id: '{0.0.1.00000000}.{2255b204-0d8f-4fb5-8c8a-10ee65d5a884}',
  name: 'Headset Microphone (Arctis Pro Wireless Chat)',
};
const output: AudioParams = { flow: 'playback', ...HEADPHONES, role: 'default' };
const input: AudioParams = { flow: 'recording', ...HEADSET_MIC, role: 'both' };

describe('audio.defaultDevice check', () => {
  it('passes when the headset is the default output and the headset mic the default input', async () => {
    rig = await scenarioRig('audio-headset-ready', NO_FILES);
    expect(await audioDefaultCheck.run(output, rig.ctx)).toEqual({
      pass: true,
      summary: 'Default output',
    });
    expect(await audioDefaultCheck.run(input, rig.ctx)).toEqual({
      pass: true,
      summary: 'Default input, also for calls',
    });
  });

  it('fails naming the device Windows uses instead', async () => {
    rig = await scenarioRig('audio-default-speakers', NO_FILES);
    expect(await audioDefaultCheck.run(output, rig.ctx)).toEqual({
      pass: false,
      summary: 'Default is Speakers (Realtek(R) Audio)',
    });
    await rig.cleanup();
    rig = await scenarioRig('audio-mic-wrong', NO_FILES);
    expect(await audioDefaultCheck.run(input, rig.ctx)).toEqual({
      pass: false,
      summary: 'Default is Microphone (Steam Streaming Microphone)',
    });
  });

  it('checks the communications default only when the setup asks for it', async () => {
    rig = await scenarioRig('audio-headset-ready', NO_FILES);
    // The recorded rig gives calls to the Dell's speakers, not the headset.
    expect((await audioDefaultCheck.run(output, rig.ctx)).pass).toBe(true);
    expect(await audioDefaultCheck.run({ ...output, role: 'both' }, rig.ctx)).toEqual({
      pass: false,
      summary: 'Default for calls is DELL G3223D (NVIDIA High Definition Audio)',
    });
    expect(await audioDefaultCheck.run({ ...output, role: 'communications' }, rig.ctx)).toEqual({
      pass: false,
      summary: 'Default for calls is DELL G3223D (NVIDIA High Definition Audio)',
    });
    await mutate(rig, [
      { op: 'setAudioDefault', flow: 'playback', match: { id: HEADPHONES.id }, role: 'both' },
    ]);
    expect(await audioDefaultCheck.run({ ...output, role: 'communications' }, rig.ctx)).toEqual({
      pass: true,
      summary: 'Default output for calls',
    });
  });

  it('says an unplugged device is not connected, and what Windows uses meanwhile', async () => {
    rig = await scenarioRig('audio-headset-unplugged', NO_FILES);
    expect(await audioDefaultCheck.run(output, rig.ctx)).toEqual({
      pass: false,
      summary: 'Headphones (Arctis Pro Wireless Game) is not connected',
      details: ['Windows is using Realtek Digital Output (Realtek(R) Audio) instead.'],
    });
    rig.ports.state.audio.defaultPlayback = undefined;
    expect((await audioDefaultCheck.run(output, rig.ctx)).details).toEqual([
      'Windows has no default output device.',
    ]);
  });

  it('finds a device by name when Windows gave it a new id', async () => {
    rig = await scenarioRig('audio-headset-ready', NO_FILES);
    const outcome = await audioDefaultCheck.run({ ...output, id: '{old-id}' }, rig.ctx);
    expect(outcome).toEqual({
      pass: true,
      summary: 'Default output',
      details: [
        'Found by name: Windows now lists Headphones (Arctis Pro Wireless Game) under a different id.',
      ],
    });
    await mutate(rig, [
      { op: 'setAudioDefault', flow: 'playback', match: { name: 'Speakers (Realtek' } },
    ]);
    expect(await audioDefaultCheck.run({ ...output, id: '{old-id}' }, rig.ctx)).toMatchObject({
      pass: false,
      details: [expect.stringContaining('Found by name')],
    });
  });

  it('fails clearly when the audio devices cannot be read', async () => {
    rig = await scenarioRig('audio-headset-ready', NO_FILES);
    rig.ports.audio.read = async () => err('audio.read', 'Could not read the audio devices.');
    expect(await audioDefaultCheck.run(output, rig.ctx)).toEqual({
      pass: false,
      summary: 'Could not read the audio devices.',
    });
  });

  it('defaults the role to the main default and validates the flow', () => {
    expect(AudioParamsSchema.parse({ flow: 'playback', ...HEADPHONES }).role).toBe('default');
    expect(AudioParamsSchema.safeParse({ flow: 'speakers', ...HEADPHONES }).success).toBe(false);
    expect(rolesFor('default')).toEqual(['console', 'multimedia']);
    expect(rolesFor('communications')).toEqual(['communications']);
    expect(rolesFor('both')).toEqual(['console', 'multimedia', 'communications']);
  });
});

describe('audio.setDefault fix', () => {
  it('sets only the roles the check covers, then reads it back', async () => {
    rig = await scenarioRig('audio-default-speakers', NO_FILES);
    const fix = createSetDefaultRemediation(new PreviousDefaults());
    expect(fix.describe(output)).toBe(
      'Make Headphones (Arctis Pro Wireless Game) the default output'
    );
    expect(fix.describe({ ...output, role: 'communications' })).toBe(
      'Make Headphones (Arctis Pro Wireless Game) the default for calls'
    );
    expect(await fix.run(output, rig.ctx)).toEqual({
      ok: true,
      value: 'Made Headphones (Arctis Pro Wireless Game) the default output',
    });
    expect(rig.ports.audio.calls).toEqual([
      { id: HEADPHONES.id, roles: ['console', 'multimedia'] },
    ]);
    expect((await audioDefaultCheck.run(output, rig.ctx)).pass).toBe(true);
    // Calls still go where they went.
    expect(rig.ports.state.audio.defaultCommsPlayback?.name).toContain('DELL');
    expect(
      await fix.run({ flow: 'recording', ...HEADSET_MIC, role: 'communications' }, rig.ctx)
    ).toEqual({
      ok: true,
      value: 'Made Headset Microphone (Arctis Pro Wireless Chat) the default for calls',
    });
  });

  it('cannot make an unplugged device the default, and says so', async () => {
    rig = await scenarioRig('audio-headset-unplugged', NO_FILES);
    const fix = createSetDefaultRemediation(new PreviousDefaults());
    expect(await fix.run(output, rig.ctx)).toEqual({
      ok: false,
      error: {
        code: 'audio.missing',
        message:
          'Headphones (Arctis Pro Wireless Game) is not connected, so it cannot be made the default.',
        detail: 'Plug it in or switch it on, then check again.',
      },
    });
    expect(rig.ports.audio.calls).toEqual([]);
  });

  it('never reports success when Windows did not change the default', async () => {
    rig = await scenarioRig('audio-default-speakers', NO_FILES);
    const fix = createSetDefaultRemediation(new PreviousDefaults());
    // Windows accepts the call but nothing changes.
    rig.ports.audio.setDefault = async () => rig!.ports.audio.read();
    expect(await fix.run(output, rig.ctx)).toMatchObject({
      ok: false,
      error: { message: 'Windows did not make Headphones (Arctis Pro Wireless Game) the default.' },
    });
    rig.ports.audio.setDefault = async () => err('audio.setDefault', 'COM failed');
    expect(await fix.run(output, rig.ctx)).toMatchObject({
      ok: false,
      error: { message: 'COM failed' },
    });
    rig.ports.audio.read = async () => err('audio.read', 'nope');
    expect(await fix.run(output, rig.ctx)).toMatchObject({ ok: false });
  });

  it('Stand down switches back to the device that was the default before the fix', async () => {
    rig = await scenarioRig('audio-default-speakers', NO_FILES);
    const previous = new PreviousDefaults();
    const fix = createSetDefaultRemediation(previous);
    const standDown = createAudioStandDown(previous);
    expect(await standDown(output, rig.ctx)).toEqual({ ok: true, value: null });
    await fix.run(output, rig.ctx);
    await fix.run(output, rig.ctx); // a second Make ready does not forget the speakers
    expect(await standDown(output, rig.ctx)).toEqual({
      ok: true,
      value: 'Speakers (Realtek(R) Audio) is the default again',
    });
    expect(rig.ports.state.audio.defaultPlayback?.name).toBe('Speakers (Realtek(R) Audio)');
    // Only once.
    expect(await standDown(output, rig.ctx)).toEqual({ ok: true, value: null });

    // If the user picked another device themselves meanwhile, it is left alone.
    await fix.run(output, rig.ctx);
    await mutate(rig, [
      { op: 'setAudioDefault', flow: 'playback', match: { name: 'Steam Streaming Speakers' } },
    ]);
    expect(await standDown(output, rig.ctx)).toEqual({ ok: true, value: null });
  });

  it('Stand down also restores the calls default and reports failures', async () => {
    rig = await scenarioRig('audio-headset-ready', NO_FILES);
    const previous = new PreviousDefaults();
    const fix = createSetDefaultRemediation(previous);
    const standDown = createAudioStandDown(previous);
    const both = { ...output, role: 'both' as const };
    await fix.run(both, rig.ctx);
    expect(await standDown(both, rig.ctx)).toEqual({
      ok: true,
      value: 'DELL G3223D (NVIDIA High Definition Audio) is the default for calls again',
    });
    await fix.run(both, rig.ctx);
    rig.ports.audio.setDefault = async () => err('audio.setDefault', 'COM failed');
    expect(await standDown(both, rig.ctx)).toMatchObject({ ok: false });
    rig.ports.audio.read = async () => err('audio.read', 'nope');
    await fix.run(both, rig.ctx);
    expect(await standDown(both, rig.ctx)).toMatchObject({ ok: true, value: null });
  });
});

describe('audio capture', () => {
  it('offers the default output and input, and the calls device only when it differs', async () => {
    rig = await scenarioRig('flying-fresh', NO_FILES);
    const result = await audioCapture.capture(rig.ctx);
    if (!result.ok) throw new Error('capture failed');
    expect(
      result.value.map((c) => [c.title, c.selectedByDefault, c.check.required, c.check.params])
    ).toEqual([
      [
        'Sound output: Speakers (Realtek(R) Audio)',
        true,
        true,
        {
          flow: 'playback',
          id: '{0.0.0.00000000}.{5b14908e-d9a8-4e31-a5e6-9d272469e892}',
          name: 'Speakers (Realtek(R) Audio)',
          role: 'default',
        },
      ],
      [
        'Sound output for calls: DELL G3223D (NVIDIA High Definition Audio)',
        false,
        false,
        expect.objectContaining({ role: 'communications' }),
      ],
      [
        'Microphone: ' + HEADSET_MIC.name,
        true,
        true,
        { flow: 'recording', ...HEADSET_MIC, role: 'both' },
      ],
    ]);
    // Every proposed check passes right now, and its fix is the matching set-default.
    for (const candidate of result.value) {
      const params = AudioParamsSchema.parse(candidate.check.params);
      expect((await audioDefaultCheck.run(params, rig.ctx)).pass).toBe(true);
      expect(candidate.check.remediation).toEqual({
        type: 'audio.setDefault',
        params: candidate.check.params,
      });
    }
  });

  it('offers nothing for a flow without a default, and passes read errors on', async () => {
    rig = await scenarioRig('flying-fresh', NO_FILES);
    rig.ports.state.audio = { devices: [] };
    expect(await audioCapture.capture(rig.ctx)).toEqual({ ok: true, value: [] });
    rig.ports.audio.read = async () => err('audio.read', 'nope');
    expect(await audioCapture.capture(rig.ctx)).toMatchObject({ ok: false });
  });
});

describe('Audio page and Fly, through IPC', () => {
  it('lists devices by flow with the defaults first and changes them, verified', async () => {
    app = await wiredApp('audio-default-speakers', NO_FILES);
    const view = await app.invoke<AudioView>('audio:view');
    expect(view.playback).toHaveLength(8);
    expect(view.recording).toHaveLength(2);
    expect(view.playback[0]).toMatchObject({
      name: 'Speakers (Realtek(R) Audio)',
      isDefault: true,
    });
    expect(view.playback[1]).toMatchObject({
      name: expect.stringContaining('DELL'),
      isCommunications: true,
    });
    expect(view.recording[0]).toMatchObject({
      ...HEADSET_MIC,
      isDefault: true,
      isCommunications: true,
    });

    const set = await app.invoke<{ view: AudioView; message: string }>('audio:setDefault', {
      id: HEADPHONES.id,
      role: 'default',
    });
    expect(set.message).toBe('Headphones (Arctis Pro Wireless Game) is now the default output');
    expect(set.view.playback[0]).toMatchObject({ ...HEADPHONES, isDefault: true });
    const calls = await app.invoke<{ message: string }>('audio:setDefault', {
      id: HEADPHONES.id,
      role: 'communications',
    });
    expect(calls.message).toBe(
      'Headphones (Arctis Pro Wireless Game) is now the default for calls'
    );
    const both = await app.invoke<{ message: string }>('audio:setDefault', {
      id: HEADSET_MIC.id,
      role: 'both',
    });
    expect(both.message).toBe(
      'Headset Microphone (Arctis Pro Wireless Chat) is now the default input, also for calls'
    );
    await expect(app.invoke('audio:setDefault', { id: '{gone}', role: 'default' })).rejects.toThrow(
      /no longer connected/
    );
    app.ports.audio.read = async () => err('audio.read', 'Could not read the audio devices.');
    await expect(app.invoke('audio:view')).rejects.toThrow(/Could not read/);
    await expect(
      app.invoke('audio:setDefault', { id: HEADPHONES.id, role: 'default' })
    ).rejects.toThrow(/Could not read/);
    expect(audioView({ devices: [] })).toEqual({ playback: [], recording: [] });
  });

  it('Make ready sets the headset as default; Stand down puts the speakers back', async () => {
    app = await wiredApp('audio-default-speakers', NO_FILES);
    const P = { profileId: 'audio-headset' };
    const before = await app.invoke<ChecklistReport>('fly:check', P);
    expect(before.results.find((r) => r.title === 'Headset is default output')).toMatchObject({
      status: 'fail',
      summary: 'Default is Speakers (Realtek(R) Audio)',
      fix: 'Make Headphones (Arctis Pro Wireless Game) the default output',
    });
    const made = await app.invoke<ActionReport>('fly:makeReady', P);
    expect(made.steps).toEqual([
      {
        itemId: 'a1',
        title: 'Headset is default output',
        ok: true,
        message: 'Made Headphones (Arctis Pro Wireless Game) the default output',
      },
    ]);
    expect(made.report.ready).toBe(true);
    const down = await app.invoke<ActionReport>('fly:standDown', P);
    expect(down.steps).toContainEqual({
      itemId: 'a1',
      title: 'Headset is default output',
      ok: true,
      message: 'Speakers (Realtek(R) Audio) is the default again',
    });
  });

  it('with the headset unplugged Make ready says why it cannot help', async () => {
    app = await wiredApp('audio-headset-unplugged', NO_FILES);
    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId: 'audio-headset' });
    expect(made.steps).toEqual([
      {
        itemId: 'a1',
        title: 'Headset is default output',
        ok: false,
        message:
          'Headphones (Arctis Pro Wireless Game) is not connected, so it cannot be made the default. Plug it in or switch it on, then check again.',
      },
    ]);
    expect(made.report.ready).toBe(false);
  });
});
