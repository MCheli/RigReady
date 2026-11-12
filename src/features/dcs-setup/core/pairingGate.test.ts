import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { PlanPairing, ScreensPreview, ScreensState } from '../contract';
import type { ScreenSetup } from './screens';

/**
 * The rule behind the Screens tab's "Use in DCS" button, where it holds: in the service.
 * No call here goes through the page. The channels are called as the window calls them,
 * and as an assistant calls them through the MCP server.
 */

let app: WiredApp | undefined;
let clients: Client[] = [];

afterEach(async () => {
  for (const client of clients) await client.close().catch(() => undefined);
  clients = [];
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
    app = undefined;
  }
});

const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/**',
  'AppData/Roaming/SimAppPro/**',
  'AppData/Local/Programs/SimAppPro/**',
];

interface Imported {
  setup: ScreenSetup;
  unmatched: string[];
  pairing: PlanPairing;
}

/** The rig as it flies, with three small screens that Windows gives one name: the import cannot be sure. */
async function rig(): Promise<WiredApp> {
  app = await wiredApp('flying-fresh', { files: FILES });
  return app;
}
const dcsDir = (of: WiredApp): string => path.join(of.ports.folders.savedGames(), 'DCS');
const rigReadyLua = (of: WiredApp): string =>
  path.join(dcsDir(of), 'Config', 'MonitorSetup', 'RigReady.lua');
const optionsLua = (of: WiredApp): string => path.join(dcsDir(of), 'Config', 'options.lua');
const importPlan = (of: WiredApp, pairs: Record<string, string> = {}): Promise<Imported> =>
  of.invoke<Imported>('dcs-setup:importSimAppPro', { desktopId: 'current', pairs });

const REASON =
  "Check which screen is which first. RigReady was not sure of these when it read SimAppPro's plan: " +
  'Left DDI on USB_Monitor (2 of 3); Right DDI on USB_Monitor (1 of 3); AMPCD on USB_Monitor (3 of 3).';

describe('DCS-MON-007 a pairing nobody checked is not written, whoever asks', () => {
  it('refuses the plan as it was imported, says why, and writes it once the user said it is right', async () => {
    const running = await rig();
    const imported = await importPlan(running);
    expect(imported.pairing.certain).toBe(false);
    const options = await fs.readFile(optionsLua(running), 'utf8');

    // The preview hands the caller what to show the user.
    const preview = await running.invoke<ScreensPreview>('dcs-setup:previewScreens', {
      setup: imported.setup,
    });
    expect(preview.pairingToCheck).toEqual(imported.pairing);

    const refused = running.invoke('dcs-setup:applyScreens', { setup: imported.setup });
    await expect(refused).rejects.toThrow(`dcs-setup:applyScreens: dcs.screens.pairing ${REASON}`);
    // Nothing happened: no file, options.lua as it was, nothing to undo, nothing saved.
    expect(await running.ports.files.exists(rigReadyLua(running))).toBe(false);
    expect(await fs.readFile(optionsLua(running), 'utf8')).toBe(options);
    expect((await running.invoke<ScreensState>('dcs-setup:screens')).saved).toBeUndefined();

    const applied = await running.invoke<{ changes: string[] }>('dcs-setup:applyScreens', {
      setup: imported.setup,
      pairingChecked: true,
    });
    expect(applied.changes[0]).toBe('Created RigReady.lua');
    expect(await fs.readFile(rigReadyLua(running), 'utf8')).toBe(preview.lua);

    // What is in use was checked: it is not asked about again, not even after a new import.
    const again = await importPlan(running);
    expect(again.pairing.certain).toBe(false);
    const after = await running.invoke<ScreensPreview>('dcs-setup:previewScreens', {
      setup: again.setup,
    });
    expect(after.pairingToCheck).toBeUndefined();
    await running.invoke('dcs-setup:applyScreens', { setup: again.setup });
  });

  it('is not got around by editing the setup, or by applying part of it first', async () => {
    const running = await rig();
    const { setup, pairing } = await importPlan(running);

    // A crop changed: the display is still on a monitor nobody is sure of.
    const edited = structuredClone(setup);
    edited.aircraft[0]!.placements[0]!.crop.top += 16;
    await expect(running.invoke('dcs-setup:applyScreens', { setup: edited })).rejects.toThrow(
      /dcs\.screens\.pairing/
    );

    // Without the displays in doubt there is nothing to ask about.
    const doubtful = new Set(pairing.screens.filter((s) => !s.certain).map((s) => s.displayId));
    const sure: ScreenSetup = {
      ...setup,
      aircraft: setup.aircraft.map((a) => ({
        ...a,
        placements: a.placements.filter((p) => !doubtful.has(p.displayId)),
      })),
    };
    expect(sure.aircraft[0]!.placements.length).toBeLessThan(setup.aircraft[0]!.placements.length);
    await running.invoke('dcs-setup:applyScreens', { setup: sure });
    const written = await fs.readFile(rigReadyLua(running), 'utf8');

    // That did not answer the question for the rest of the plan.
    await expect(running.invoke('dcs-setup:applyScreens', { setup })).rejects.toThrow(
      /dcs\.screens\.pairing/
    );
    expect(await fs.readFile(rigReadyLua(running), 'utf8')).toBe(written);
  });

  it('does not ask when the user chose every screen in doubt by hand', async () => {
    const running = await rig();
    const first = await importPlan(running);
    const doubt = first.pairing.screens.filter((s) => !s.certain);
    expect(doubt).toHaveLength(3);
    // Every one of the three on another monitor than RigReady took it for.
    const pairs = Object.fromEntries(
      doubt.map((s, at) => [s.planId, doubt[(at + 1) % doubt.length]!.displayId!])
    );
    const chosen = await importPlan(running, pairs);
    expect(chosen.pairing.certain).toBe(true);
    const preview = await running.invoke<ScreensPreview>('dcs-setup:previewScreens', {
      setup: chosen.setup,
    });
    expect(preview.pairingToCheck).toBeUndefined();
    await running.invoke('dcs-setup:applyScreens', { setup: chosen.setup });
    expect(await fs.readFile(rigReadyLua(running), 'utf8')).toBe(preview.lua);

    // One screen chosen and two still in doubt: the question stands for those two.
    const partly = await importPlan(running, {});
    const one = await importPlan(running, {
      [doubt[0]!.planId]: doubt[1]!.displayId!,
      [doubt[1]!.planId]: doubt[0]!.displayId!,
    });
    expect(partly.pairing.certain).toBe(false);
    expect(one.pairing.screens.filter((s) => !s.certain).map((s) => s.planId)).toEqual([
      doubt[2]!.planId,
    ]);
    await expect(running.invoke('dcs-setup:applyScreens', { setup: one.setup })).rejects.toThrow(
      /dcs\.screens\.pairing/
    );
  });

  it('refuses an assistant the same way, with the reason in the answer it gets', async () => {
    const running = await rig();
    await running.invoke('mcp:setOptions', { port: 0, confirm: 'never' });
    const status = await running.invoke<{ running: boolean; endpoint?: { url: string } }>(
      'mcp:enable'
    );
    expect(status.running).toBe(true);
    const paired = await running.invoke<{ token: string }>('mcp:pair', { name: 'Test assistant' });
    const client = new Client({ name: 'rigready-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(status.endpoint!.url), {
        requestInit: { headers: { Authorization: `Bearer ${paired.token}` } },
      })
    );
    const call = (channel: string, input: unknown) =>
      client.callTool({ name: 'rigready_call', arguments: { channel, input } });
    const text = (result: { content: unknown }): string =>
      (result.content as { type: string; text?: string }[])[0]?.text ?? '';

    const imported = await call('dcs-setup:importSimAppPro', { desktopId: 'current' });
    expect(imported.isError, text(imported)).toBeFalsy();
    const { setup, pairing } = imported.structuredContent as Imported;
    expect(pairing.certain).toBe(false);

    const refused = await call('dcs-setup:applyScreens', { setup });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toBe(`dcs.screens.pairing: ${REASON}`);
    expect(await running.ports.files.exists(rigReadyLua(running))).toBe(false);

    // The assistant showed the user the pairing, and the user said it is right.
    const applied = await call('dcs-setup:applyScreens', { setup, pairingChecked: true });
    expect(applied.isError, text(applied)).toBeFalsy();
    expect(await running.ports.files.exists(rigReadyLua(running))).toBe(true);
  });
});
