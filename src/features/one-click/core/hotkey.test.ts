/**
 * WOW-WIN-007: the optional system-wide hotkey. Through IPC on every feature wired onto the
 * fake machine, whose Hotkeys port says what "Windows" has registered.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAKE_READY_HOTKEY } from '../../../core/hotkeys';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { sabotage } from '../../../../tests/sabotage';
import type { HotkeyState } from '../contract';

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

const state = (a: WiredApp): Promise<HotkeyState> => a.invoke<HotkeyState>('one-click:hotkey');
const set = (a: WiredApp, hotkey: string | null): Promise<HotkeyState> =>
  a.invoke<HotkeyState>('one-click:setHotkey', { hotkey });
const raw = (a: WiredApp, hotkey: string | null) =>
  a.wiring.handlers.get('one-click:setHotkey')!({ hotkey });
const file = (a: WiredApp): string => path.join(a.ports.folders.dataRoot(), 'one-click.json');
const stored = async (a: WiredApp): Promise<unknown> =>
  JSON.parse(await fs.readFile(file(a), 'utf8'));

describe('WOW-WIN-007 the hotkey that makes the rig ready from anywhere', () => {
  it('is off until one is chosen: nothing is registered and nothing is written', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    expect(await state(app)).toEqual({ active: false });
    expect(app.ports.hotkeys.active.size).toBe(0);
    await expect(fs.access(file(app))).rejects.toThrow();
  });

  it('is registered with Windows when chosen, stored, and reported from what Windows has', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    expect(await set(app, 'ctrl + alt + r')).toEqual({ hotkey: 'Ctrl+Alt+R', active: true });
    // Handed to Windows as an accelerator, under the name the shell listens for.
    expect([...app.ports.hotkeys.active]).toEqual([[MAKE_READY_HOTKEY, 'Control+Alt+R']]);
    expect(await stored(app)).toEqual({ hotkey: 'Ctrl+Alt+R' });
    expect(await state(app)).toEqual({ hotkey: 'Ctrl+Alt+R', active: true });

    // Changed: the new one is registered, the old one is gone.
    expect(await set(app, 'Ctrl+Shift+F9')).toEqual({ hotkey: 'Ctrl+Shift+F9', active: true });
    expect([...app.ports.hotkeys.active]).toEqual([[MAKE_READY_HOTKEY, 'Control+Shift+F9']]);

    // Turned off: given back to Windows, and the setting says off.
    expect(await set(app, null)).toEqual({ active: false });
    expect(app.ports.hotkeys.active.size).toBe(0);
    expect(await stored(app)).toEqual({});
    expect(await state(app)).toEqual({ active: false });
  });

  it('works again after a restart: the stored hotkey is registered when RigReady starts', async () => {
    app = await wiredApp('flying-all-good', {
      files: [],
      beforeWiring: async (rig) => {
        const dataRoot = rig.ports.folders.dataRoot();
        await fs.mkdir(dataRoot, { recursive: true });
        await fs.writeFile(
          path.join(dataRoot, 'one-click.json'),
          JSON.stringify({ hotkey: 'Ctrl+Alt+R' })
        );
      },
    });
    const running = app;
    await expect
      .poll(() => running.ports.hotkeys.active.get(MAKE_READY_HOTKEY))
      .toBe('Control+Alt+R');
    expect(await state(app)).toEqual({ hotkey: 'Ctrl+Alt+R', active: true });
    // On quit it goes back to Windows.
    for (const feature of app.wiring.features) await feature.dispose?.();
    expect(app.ports.hotkeys.active.size).toBe(0);
  });

  it('a combination another program has is refused, and the one before keeps working', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await set(app, 'Ctrl+Alt+R');
    app.ports.hotkeys.taken.add('Control+Alt+F12');
    expect(await raw(app, 'Ctrl+Alt+F12')).toMatchObject({
      ok: false,
      error: {
        code: 'hotkey.taken',
        message: 'Ctrl + Alt + F12 cannot be the hotkey.',
        detail: expect.stringContaining('another program is probably using it'),
      },
    });
    expect(await state(app)).toEqual({ hotkey: 'Ctrl+Alt+R', active: true });
    expect(await stored(app)).toEqual({ hotkey: 'Ctrl+Alt+R' });
  });

  it('never says a hotkey is on, or off, when Windows did not do it', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    // Windows accepts every change and carries out none (tests/sabotage.ts).
    const broken = sabotage(app.ports);
    const chosen = await raw(app, 'Ctrl+Alt+R');
    broken.restore();
    expect(broken.attempts).toContain('hotkeys.register Control+Alt+R');
    expect(chosen).toMatchObject({ ok: false, error: { code: 'hotkey.notRegistered' } });
    expect(await state(app)).toEqual({ active: false });
    await expect(fs.access(file(app))).rejects.toThrow();

    await set(app, 'Ctrl+Alt+R');
    const again = sabotage(app.ports);
    const off = await raw(app, null);
    again.restore();
    expect(again.attempts).toContain(`hotkeys.unregister ${MAKE_READY_HOTKEY}`);
    expect(off).toMatchObject({ ok: false, error: { code: 'hotkey.stillOn' } });
    expect(await state(app)).toEqual({ hotkey: 'Ctrl+Alt+R', active: true });
  });

  it('says so when Windows no longer has the stored hotkey, or when it was started with one it cannot get', async () => {
    app = await wiredApp('flying-all-good', {
      files: [],
      beforeWiring: async (rig) => {
        rig.ports.hotkeys.taken.add('Control+Alt+R');
        const dataRoot = rig.ports.folders.dataRoot();
        await fs.mkdir(dataRoot, { recursive: true });
        await fs.writeFile(
          path.join(dataRoot, 'one-click.json'),
          JSON.stringify({ hotkey: 'Ctrl+Alt+R' })
        );
      },
    });
    const view = await state(app);
    expect(view).toMatchObject({ hotkey: 'Ctrl+Alt+R', active: false });
    expect(view.problem).toMatch(/another program is probably using it/);
    // The other program lets go: choosing it again registers it.
    app.ports.hotkeys.taken.clear();
    expect(await set(app, 'Ctrl+Alt+R')).toEqual({ hotkey: 'Ctrl+Alt+R', active: true });
  });

  it('refuses what is not a hotkey, with why', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    for (const [text, why] of [
      ['R', /Hold Ctrl, Alt or the Windows key/],
      ['Shift+F5', /Hold Ctrl, Alt or the Windows key/],
      ['Ctrl+Alt', /needs a key besides/],
      ['Ctrl+Escape', /cannot be part of a hotkey/],
      ['', /Press a key combination/],
    ] as const) {
      const answer = await raw(app, text);
      expect(answer).toMatchObject({ ok: false, error: { code: 'hotkey.invalid' } });
      expect(!answer.ok && answer.error.message).toMatch(why);
    }
    expect(app.ports.hotkeys.active.size).toBe(0);
  });

  it('a damaged settings file is reported and left as it is', async () => {
    app = await wiredApp('flying-all-good', {
      files: [],
      beforeWiring: async (rig) => {
        const dataRoot = rig.ports.folders.dataRoot();
        await fs.mkdir(dataRoot, { recursive: true });
        await fs.writeFile(path.join(dataRoot, 'one-click.json'), '{ not json');
      },
    });
    expect(await app.wiring.handlers.get('one-click:hotkey')!(undefined)).toMatchObject({
      ok: false,
      error: { code: 'store.invalid' },
    });
    expect(await raw(app, 'Ctrl+Alt+R')).toMatchObject({
      ok: false,
      error: { code: 'store.invalid' },
    });
    expect(await raw(app, null)).toMatchObject({ ok: false, error: { code: 'store.invalid' } });
    expect(await fs.readFile(file(app), 'utf8')).toBe('{ not json');
    expect(app.ports.hotkeys.active.size).toBe(0);
  });

  it('a stored value that is not a hotkey is shown as a problem, not registered', async () => {
    app = await wiredApp('flying-all-good', {
      files: [],
      beforeWiring: async (rig) => {
        const dataRoot = rig.ports.folders.dataRoot();
        await fs.mkdir(dataRoot, { recursive: true });
        await fs.writeFile(
          path.join(dataRoot, 'one-click.json'),
          JSON.stringify({ hotkey: 'Shift+Q' })
        );
      },
    });
    expect(await state(app)).toMatchObject({ hotkey: 'Shift+Q', active: false });
    expect((await state(app)).problem).toMatch(/Hold Ctrl, Alt or the Windows key/);
    expect(app.ports.hotkeys.active.size).toBe(0);
  });
});
