import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { expect, test } from './harness';

/** Sharing: export a setup with a privacy review, import it on a friend's PC. */

test('share: review personal details and what runs, save a .rigready file, import it on another PC', async ({
  rig,
}) => {
  const source = await rig.launch('share-dcs', 'share-export', {
    dialogs: { save: ['Documents/Squadron F-A-18C.rigready'] },
  });
  const { page, shot, home } = source;
  // A config file that names this PC, its user and its folders, plus files that must never travel.
  const scripts = path.join(home, 'Saved Games', 'DCS', 'Scripts');
  const logs = path.join(home, 'Saved Games', 'DCS', 'Logs').replace(/\\/g, '\\\\');
  await fs.writeFile(
    path.join(scripts, 'Hooks.lua'),
    `-- set up on ${'RIG-PC'} by ${os.userInfo().username}\nlocal logs = "${logs}"\n`
  );
  await fs.writeFile(path.join(scripts, 'check_vpn.py'), 'print("vpn")\n');
  await fs.writeFile(path.join(scripts, 'tool.exe'), 'MZ');

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-share').click();
  await expect(page.getByTestId('share-page')).toBeVisible();
  await expect(page.getByTestId('share-setup')).toContainText('Squadron F/A-18C');
  await page.getByTestId('share-item-dcs-bindings').locator('input').check();
  await page.getByTestId('share-item-dcs-scripts').locator('input').check();
  const finding = (kind: string) =>
    page.locator(`[data-testid="share-finding"][data-kind="${kind}"]`);
  await expect(finding('serial')).toContainText('TPR0012345');
  await expect(finding('serial')).toHaveAttribute('data-decision', 'remove');
  await expect(finding('machineName')).toContainText('RIG-PC');
  await expect(finding('path').first()).toContainText('Replaced with {DCS_USER}');
  // Long groups start folded with one choice for all of them.
  const group = (kind: string) =>
    page.locator(`[data-testid="share-finding-group"][data-kind="${kind}"]`);
  await expect(group('deviceId')).toHaveAttribute('data-decision', 'keep');
  await expect(group('instancePath')).toHaveAttribute('data-decision', 'remove');
  await page.getByTestId('share-group-toggle-instancePath').click();
  await expect(finding('instancePath').first()).toContainText('display#');
  await shot('review');

  const stripped = page.getByTestId('share-stripped');
  await stripped.scrollIntoViewIfNeeded();
  await expect(stripped).toContainText('check_vpn.py');
  await expect(stripped).toContainText('Checks squadron VPN');
  await expect(stripped).toContainText('DCS.exe');
  await expect(stripped).toContainText('{DCS_USER}/Scripts/tool.exe');
  await expect(page.getByTestId('share-notes').locator('textarea').first()).toHaveValue(
    /Hardware it needs:\n- Pedals \(by serial\) \(044F:B68F\)/
  );
  await shot('never-shared');

  await expect(page.getByTestId('share-save')).toBeDisabled();
  await page.getByTestId('share-reviewed').locator('input').check();
  await page.getByTestId('share-save').click();
  await expect(page.getByTestId('share-saved')).toContainText('Squadron F-A-18C.rigready');
  await shot('saved');

  // With the defaults nothing in the file names this PC or its user.
  const file = path.join(home, 'Documents', 'Squadron F-A-18C.rigready');
  const entries = unzipSync(new Uint8Array(await fs.readFile(file)));
  for (const [name, data] of Object.entries(entries)) {
    const content = new TextDecoder().decode(data).toLowerCase();
    for (const secret of ['RIG-PC', os.userInfo().username, home, 'TPR0012345']) {
      expect(content, `${name} names ${secret}`).not.toContain(secret.toLowerCase());
    }
    expect(name).not.toMatch(/\.(py|exe)$/);
  }

  // A friend's racing PC: no flight gear, DCS installed.
  const evil = path.join(os.tmpdir(), `rigready-e2e-evil-${process.pid}.rigready`);
  const profile = 'id: x\nname: X\ncreatedAt: a\nupdatedAt: b\n';
  await fs.writeFile(
    evil,
    zipSync({
      'manifest.json': new TextEncoder().encode(
        JSON.stringify({
          format: 'rigready-setup',
          schemaVersion: 1,
          appVersion: '1',
          createdAt: '2026-10-03',
          name: 'X',
          compatibility: { hardware: [], software: [] },
          profile: { sha256: createHash('sha256').update(profile).digest('hex') },
        })
      ),
      'profile.yaml': new TextEncoder().encode(profile),
      '../../Startup/evil.bat': new TextEncoder().encode('format c:'),
    })
  );
  try {
    const friend = await rig.launch('share-racing-pc', 'share-import', {
      dialogs: { open: [[evil], [file]] },
    });
    const p = friend.page;
    await p.getByTestId('mode-configure').click();
    await p.getByTestId('nav-share').click();
    await p.getByTestId('share-mode-import').click();
    await p.getByTestId('import-open').click();
    await expect(p.getByTestId('import-error')).toContainText('cannot be imported');
    await expect(p.getByTestId('import-error')).toContainText('unsafe path');
    await friend.shot('rejected');

    await p.getByTestId('import-open').click();
    const wanted = p.getByTestId('import-wanted');
    await expect(wanted).toContainText('None of them will be imported');
    await expect(wanted).toContainText('check_vpn.py');
    await expect(wanted).toContainText('DCS.exe');
    await expect(
      p.locator('[data-testid="import-device"][data-present="false"]').nth(1)
    ).toContainText('WINWING');
    await expect(p.locator('[data-testid="import-software"]').first()).toContainText(
      'Installed (steam)'
    );
    await expect(p.getByTestId('import-displays')).toContainText('this PC has 2');
    await friend.shot('report');

    const parts = p.locator('[data-testid="import-part"]');
    await expect(parts).toHaveCount(4);
    // Leave the bindings out: only the setup, its layout and the scripts.
    await p
      .locator('[data-testid="import-part"][data-part="group:0"]')
      .getByTestId('import-part-check')
      .locator('input')
      .uncheck();
    await p.locator('[data-testid="import-part"][data-part="group:1"]').scrollIntoViewIfNeeded();
    await friend.shot('choose');
    await p.getByTestId('import-apply').click();
    await expect(p.getByTestId('import-result-summary')).toContainText(
      'Added the setup "Squadron F/A-18C"'
    );
    await friend.shot('imported');

    const hooks = await fs.readFile(
      path.join(friend.home, 'Saved Games', 'DCS', 'Scripts', 'Hooks.lua'),
      'utf8'
    );
    expect(hooks).toContain(
      path.join(friend.home, 'Saved Games', 'DCS', 'Logs').replace(/\\/g, '\\\\')
    );
    expect(hooks).toContain('set up on my-pc by user');
    const profiles = await fs.readdir(path.join(friend.dataRoot, 'profiles'));
    expect(profiles).toEqual(['squadron-f-a-18c.yaml']);
    const saved = await fs.readFile(path.join(friend.dataRoot, 'profiles', profiles[0]!), 'utf8');
    expect(saved).not.toContain('launch:');
    expect(saved).not.toContain('script.run');
    expect(saved).toContain('(device not found)');
  } finally {
    await fs.rm(evil, { force: true });
  }
});
