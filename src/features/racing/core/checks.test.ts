import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { AcView, RacingOverview } from '../contract';

interface Candidate {
  key: string;
  group: string;
  title: string;
  selectedByDefault: boolean;
  kind?: string;
  game?: string;
  check: {
    type: string;
    params: Record<string, unknown>;
    remediation?: { type: string; params: Record<string, unknown> };
  };
}

describe('racing checks, capture and overview', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  it('capture on a racing rig proposes the wheel in PC mode, the helper apps and the game checks', async () => {
    app = await wiredApp('racing-fresh');
    const { candidates } = await app.invoke<{ candidates: Candidate[] }>('profiles:capture');
    const racing = candidates.filter((c) => c.key.startsWith('racing:'));
    const byKey = new Map(racing.map((c) => [c.key, c]));
    expect(byKey.get('racing:wheel-base')).toMatchObject({
      group: 'devices',
      title: 'Wheel base in PC mode',
      selectedByDefault: true,
      check: { type: 'racing.wheelBase', params: { vendorId: '0EB7', productId: '0007' } },
    });
    // Running helper apps are kept, with a fix that starts them from where they are installed.
    const fanatec = byKey.get('racing:app:fanatec-service')!;
    expect(fanatec.selectedByDefault).toBe(true);
    expect(fanatec.check).toMatchObject({
      type: 'process.running',
      params: { name: 'FanatecService.exe' },
    });
    expect(String(fanatec.check.remediation!.params['exe'])).toMatch(
      /Fanatec[\\/]FanatecService[\\/]Service[\\/]FanatecService\.exe$/
    );
    expect(byKey.get('racing:app:trophi')!.selectedByDefault).toBe(true);
    // What is only useful on track is closed again by Stand down; the driver's service stays.
    expect(byKey.get('racing:app:trophi')!.check.params).toMatchObject({ stopOnStandDown: true });
    expect(fanatec.check.params).toMatchObject({ stopOnStandDown: false });
    // Game-specific checks belong to their game: kept in a setup for it, not shown otherwise.
    expect(byKey.get('racing:iracing-service')).toMatchObject({
      game: 'iracing',
      selectedByDefault: true,
    });
    expect(byKey.get('racing:iracing-devices')).toMatchObject({
      game: 'iracing',
      selectedByDefault: true,
    });
    expect(byKey.get('racing:wheel-settings:lmu')!.check).toMatchObject({
      type: 'racing.wheelSettings',
      required: false,
    });
    // The ultrawide layout and the wheel itself come from the monitor and device captures.
    expect(candidates.some((c) => c.group === 'displays')).toBe(true);
    expect(
      candidates.some((c) => c.title === 'FANATEC Podium Wheel Base DD2' && c.selectedByDefault)
    ).toBe(true);
  });

  it("with the flight gear connected, racing items are marked as racing gear or as one game's, so a flight setup leaves them out", async () => {
    app = await wiredApp('flying-all-good');
    const { candidates, suggested } = await app.invoke<{
      candidates: Candidate[];
      suggested: { kind?: string; game?: string };
    }>('profiles:capture');
    const racing = candidates.filter((c) => c.key.startsWith('racing:'));
    expect(racing.every((c) => c.kind === 'racing' || c.game !== undefined)).toBe(true);
    expect(racing.filter((c) => !c.game).map((c) => c.key)).toEqual([
      'racing:wheel-base',
      'racing:app:fanatec-service',
      'racing:app:trophi',
    ]);
    // Eleven flight controllers against one wheel: the rig is set up for flying.
    expect(suggested).toMatchObject({ kind: 'flight', game: 'dcs' });
  });

  it('capture offers SimHub and Crew Chief when they are installed, even when not running', async () => {
    app = await wiredApp('racing-fresh');
    const simhub = path.join(app.ports.folders.programFilesX86(), 'SimHub');
    await fs.mkdir(simhub, { recursive: true });
    await fs.writeFile(path.join(simhub, 'SimHubWPF.exe'), '');
    await mutate(app, [
      {
        op: 'setRegistryValue',
        hive: 'HKLM',
        key: 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CrewChiefV4',
        name: 'DisplayName',
        value: { type: 'string', value: 'CrewChiefV4' },
      },
      {
        op: 'startProcess',
        name: 'CrewChiefV4.exe',
        path: 'C:\\Program Files (x86)\\Britton IT Ltd\\CrewChiefV4\\CrewChiefV4.exe',
      },
    ]);
    const { candidates } = await app.invoke<{ candidates: Candidate[] }>('profiles:capture');
    const simhubCandidate = candidates.find((c) => c.key === 'racing:app:simhub')!;
    expect(simhubCandidate).toMatchObject({
      selectedByDefault: false,
      check: { params: { name: 'SimHubWPF.exe' } },
    });
    expect(candidates.find((c) => c.key === 'racing:app:crewchief')).toMatchObject({
      selectedByDefault: true,
    });
  });

  it('an iRacing setup at the desk is Not ready; Make ready starts the apps and applies the racing layout', async () => {
    app = await wiredApp('racing-not-ready');
    const before = await app.invoke<{
      ready: boolean;
      failed: number;
      warnings: number;
      results: { title: string; status: string }[];
    }>('fly:check', { profileId: 'racing-iracing' });
    expect(before).toMatchObject({ ready: false, failed: 2, warnings: 1 });
    expect(
      before.results
        .filter((i) => i.status !== 'pass')
        .map((i) => i.title)
        .sort()
    ).toEqual(['Fanatec Service', 'Monitor layout', 'trophi.ai']);
    await app.invoke('fly:makeReady', { profileId: 'racing-iracing' });
    const after = await app.invoke<{ ready: boolean; failed: number; warnings: number }>(
      'fly:check',
      { profileId: 'racing-iracing' }
    );
    expect(after).toMatchObject({ ready: true, failed: 0, warnings: 0 });
    expect(app.ports.processes.started.map((s) => s.exe)).toEqual([
      'C:\\Program Files\\Fanatec\\FanatecService\\Service\\FanatecService.exe',
      'C:\\Users\\User\\AppData\\Local\\trophi.ai\\Game\\trophi.ai.exe',
    ]);
  });

  it('the iRacing service check reads the Windows service', async () => {
    app = await wiredApp('racing-fresh');
    const check = app.wiring.context.checks.check('racing.iracingService')!;
    expect(await check.run({}, app.ctx)).toMatchObject({ pass: true, summary: 'Running' });
    await mutate(app, [{ op: 'setService', name: 'iRacingService', state: 'stopped' }]);
    expect(await check.run({}, app.ctx)).toMatchObject({ pass: false, summary: 'Not running' });
    await mutate(app, [{ op: 'setService', name: 'iRacingService', state: 'absent' }]);
    expect(await check.run({}, app.ctx)).toMatchObject({ pass: false, summary: 'Not installed' });
  });

  it('the overview shows the wheel, helper apps and each racing game at a glance', async () => {
    app = await wiredApp('racing-fresh');
    await mutate(app, [{ op: 'setSteamBuild', appId: '2399420', stateFlags: 6 }]);
    const view = await app.invoke<RacingOverview>('racing:overview');
    expect(view.wheel).toMatchObject({ connected: true, mode: 'pc' });
    expect(view.apps.map((a) => a.id)).toEqual(['fanatec-service', 'trophi']);
    const games = new Map(view.games.map((g) => [g.id, g]));
    expect(games.get('iracing')).toMatchObject({
      installed: true,
      version: '2026.04.21.01',
      attention: false,
      bindings: '183 bindings · controllers connected',
    });
    expect(games.get('lmu')).toMatchObject({
      updatePending: true,
      bindings: '37 bindings · controllers connected',
    });
    expect(games.get('beamng')!.bindings).toBe('1 controller map · connected');
    expect(games.get('assetto-corsa')!.attention).toBe(false);

    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '0EB7' } }]);
    const unplugged = new Map(
      (await app.invoke<RacingOverview>('racing:overview')).games.map((g) => [g.id, g])
    );
    expect(unplugged.get('iracing')).toMatchObject({
      attention: true,
      bindings: '1 controller not connected',
    });
    expect(unplugged.get('lmu')!.attention).toBe(true);
    expect(unplugged.get('beamng')!.attention).toBe(true);
  });

  it('reads Assetto Corsa controllers and bindings from controls.ini', async () => {
    app = await wiredApp('racing-fresh');
    const view = await app.invoke<AcView>('racing:assettoCorsa');
    expect(view.inputMethod).toBe('WHEEL');
    expect(view.controllers.map((c) => [c.index, c.state, c.used])).toEqual([
      [0, 'connected', true],
      [1, 'moved', false],
    ]);
    expect(view.bindings).toContainEqual({
      action: 'STEER',
      label: 'Steering',
      controller: 'FANATEC Podium Wheel Base DD2',
      input: 'Wheel',
    });
    expect(view.bindings).toContainEqual({
      action: 'BRAKES',
      label: 'Brake',
      controller: 'FANATEC Podium Wheel Base DD2',
      input: 'Brake',
    });
    expect(view.bindings).toContainEqual({
      action: 'GEARUP',
      label: 'Shift up',
      controller: 'Keyboard',
      input: 'Space',
    });
    expect(view.forceFeedback).toContainEqual({ label: 'Steering lock (degrees)', value: '1080' });
  });
});
