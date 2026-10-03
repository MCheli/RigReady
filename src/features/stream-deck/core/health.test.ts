import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { Overview } from '../contract';

let app: WiredApp;
afterEach(() => app?.cleanup());

const FILES = ['AppData/Roaming/Elgato/**', 'Program Files/Elgato/**', 'Saved Games/DCS/**'];
const overview = (): Promise<Overview> => app.invoke<Overview>('stream-deck:overview');
const scripts = (): string => path.join(app.home, 'Saved Games', 'DCS', 'Scripts');

describe('Stream Deck health', () => {
  it('says which actions use plugins that are not installed and that DCS-ExportScript is missing', async () => {
    app = await wiredApp('stream-deck-owner', { files: FILES });
    const { findings } = await overview();
    const byId = new Map(findings.map((f) => [f.id, f]));

    expect(byId.get('missing-plugins')).toMatchObject({
      severity: 'bad',
      title: '66 actions use 2 plugins that are not installed',
    });
    expect(byId.get('missing-avionics.madjack.dcs')).toMatchObject({
      title: '65 actions use DCS-BIOS plugin by Mad Jack, which is not installed',
      link: { url: 'https://forum.dcs.world/topic/230609-new-streamdeck-plugin/' },
    });
    expect(byId.get('missing-com.barraider.supermacro')?.title).toBe(
      '1 action uses Super Macro by BarRaider, which is not installed'
    );

    // The recorded Export.lua loads wwt and DCS-BIOS, not DCS-ExportScript.
    const exportFinding = byId.get('dcs-interface-export')!;
    expect(exportFinding).toMatchObject({
      severity: 'bad',
      title: '32 actions will stay blank in DCS: DCS-ExportScript is not loaded',
      route: { to: '/configure/dcs-setup' },
    });
    expect(exportFinding.detail).toContain('does not load DCS-ExportScript');
    expect(exportFinding.detail).toContain('DCS World (32)');
    // Mad Jack's plugin is not installed, so its DCS-BIOS dependency is not judged.
    expect(byId.has('dcs-bios-avionics.madjack.dcs')).toBe(false);
    // Nothing is backed up yet.
    expect(byId.get('no-backup')?.severity).toBe('warn');
    // Problems come first.
    expect(findings[0]!.severity).toBe('bad');
  });

  it('is satisfied once Export.lua loads DCS-ExportScript and the script is there', async () => {
    app = await wiredApp('stream-deck-owner', { files: FILES });
    await fs.appendFile(
      path.join(scripts(), 'Export.lua'),
      '\r\ndofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])\r\n'
    );
    await fs.mkdir(path.join(scripts(), 'DCS-ExportScript'), { recursive: true });
    await fs.writeFile(path.join(scripts(), 'DCS-ExportScript', 'ExportScript.lua'), '-- x');
    await fs.writeFile(
      path.join(scripts(), 'DCS-ExportScript', 'Config.lua'),
      'ExportScript.Config.IkarusPort = 1725'
    );
    const { findings } = await overview();
    expect(findings.some((f) => f.id.startsWith('dcs-interface'))).toBe(false);
  });

  it('notices a commented-out line, a missing script folder and a wrong port', async () => {
    app = await wiredApp('stream-deck-owner', { files: FILES });
    const exportLua = path.join(scripts(), 'Export.lua');
    await fs.writeFile(
      exportLua,
      '-- dofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])\n'
    );
    expect(
      (await overview()).findings.find((f) => f.id === 'dcs-interface-export')?.detail
    ).toContain('does not load DCS-ExportScript');

    await fs.writeFile(
      exportLua,
      'dofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])\n'
    );
    expect(
      (await overview()).findings.find((f) => f.id === 'dcs-interface-export')?.detail
    ).toContain('the DCS-ExportScript folder is missing');

    await fs.mkdir(path.join(scripts(), 'DCS-ExportScript'), { recursive: true });
    await fs.writeFile(path.join(scripts(), 'DCS-ExportScript', 'ExportScript.lua'), '-- x');
    await fs.writeFile(
      path.join(scripts(), 'DCS-ExportScript', 'Config.lua'),
      'ExportScript.Config.IkarusPort = 1626'
    );
    expect((await overview()).findings.find((f) => f.id === 'dcs-interface-port')?.title).toBe(
      'DCS-ExportScript sends to port 1626, DCS Interface listens on 1725'
    );

    await fs.rm(exportLua);
    expect(
      (await overview()).findings.find((f) => f.id === 'dcs-interface-export')?.detail
    ).toContain('There is no Export.lua');
  });

  it('says so when DCS is not on this PC at all', async () => {
    app = await wiredApp('stream-deck-owner', {
      files: ['AppData/Roaming/Elgato/**', 'Program Files/Elgato/**'],
    });
    await fs.rm(path.join(app.home, 'Saved Games', 'DCS'), { recursive: true, force: true });
    const { findings } = await overview();
    expect(findings.find((f) => f.id === 'dcs-interface-no-dcs')?.severity).toBe('info');
  });

  it('checks DCS-BIOS for a DCS-BIOS plugin that is installed', async () => {
    app = await wiredApp('stream-deck-owner', { files: FILES });
    const plugin = path.join(
      app.home,
      'AppData',
      'Roaming',
      'Elgato',
      'StreamDeck',
      'Plugins',
      'avionics.madjack.dcs.sdPlugin'
    );
    await fs.mkdir(plugin, { recursive: true });
    await fs.writeFile(
      path.join(plugin, 'manifest.json'),
      '{"Name":"Streamdeck-DCS","Version":"2.0"}'
    );
    // The recorded Export.lua loads DCS-BIOS: fine.
    let { findings } = await overview();
    expect(findings.some((f) => f.id === 'missing-avionics.madjack.dcs')).toBe(false);
    expect(findings.some((f) => f.id === 'dcs-bios-avionics.madjack.dcs')).toBe(false);
    await fs.writeFile(path.join(scripts(), 'Export.lua'), '-- nothing\n');
    ({ findings } = await overview());
    expect(findings.find((f) => f.id === 'dcs-bios-avionics.madjack.dcs')?.title).toBe(
      '65 actions need DCS-BIOS, which DCS does not load'
    );
  });

  it('stops nagging about backups once there is a recent one, and says when it gets old', async () => {
    app = await wiredApp('stream-deck-owner', {
      files: ['AppData/Roaming/Elgato/**', 'Program Files/Elgato/**'],
    });
    await app.invoke('stream-deck:createBackup', {});
    let result = await overview();
    expect(result.findings.some((f) => f.id === 'no-backup' || f.id === 'old-backup')).toBe(false);
    expect(result.backups).toHaveLength(1);
    app.clock.advance(45 * 86_400_000);
    result = await overview();
    expect(result.findings.find((f) => f.id === 'old-backup')?.title).toBe(
      'The newest Stream Deck backup is 45 days old'
    );
  });

  it('reports a clean setup as having no findings', async () => {
    app = await wiredApp('stream-deck-new-pc', { files: [] });
    const result = await overview();
    expect(result.status.installed).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.downloadUrl).toMatch(/^https:\/\/www\.elgato\.com\//);
  });
});
