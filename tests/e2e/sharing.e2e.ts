import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { expect, screensDir, test } from './harness';

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

/** Width and height of a PNG file, from its header. */
async function pngSize(file: string): Promise<{ width: number; height: number }> {
  const bytes = await fs.readFile(file);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('share: a picture of a setup is previewed in both shapes and saved where the user says, and says saved only once the file is there', async ({
  rig,
}) => {
  const flow = 'share-picture';
  const run = await rig.launch('share-picture', flow, {
    dialogs: { save: [null, 'Documents/my rig.png', 'Documents/my rig square.png'] },
  });
  const { page, shot, home } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-share').click();
  await page.getByTestId('share-mode-picture').click();
  const picture = page.getByTestId('share-picture');
  await picture.getByTestId('share-picture-setup').click();
  await page.getByRole('option', { name: 'DCS F/A-18C', exact: true }).click();

  // The preview is the picture itself, at full size, scaled to the page.
  const image = picture.getByTestId('share-picture-image');
  const natural = () =>
    image.evaluate((element) => {
      const img = element as unknown as { naturalWidth: number; naturalHeight: number };
      return `${img.naturalWidth}x${img.naturalHeight}`;
    });
  await expect(image).toBeVisible();
  await expect.poll(natural).toBe('1920x1080');
  await expect(picture.getByTestId('share-picture-contents')).toHaveText(
    '4 monitors · 12 controllers · 3 helper apps · 1920 × 1080 PNG'
  );
  await expect(image).toHaveAttribute(
    'alt',
    'A picture of DCS F/A-18C: 4 monitors · 12 controllers · 3 helper apps'
  );
  await expect(picture.getByTestId('share-picture-foot')).toContainText(
    'No serial number, user name, PC name or folder path is in the picture'
  );
  await shot('wide-preview');

  // Cancelling the Save dialog writes nothing and claims nothing.
  await picture.getByTestId('share-picture-save').click();
  await expect(picture.getByTestId('share-picture-save')).toBeEnabled();
  await expect(picture.getByTestId('share-picture-saved')).toHaveCount(0);
  await expect(picture.getByTestId('share-picture-error')).toHaveCount(0);

  // Saved: the file is on disk, a PNG of exactly 1920 by 1080.
  await picture.getByTestId('share-picture-save').click();
  const wide = path.join(home, 'Documents', 'my rig.png');
  await expect(picture.getByTestId('share-picture-saved')).toContainText(`Saved ${wide}`);
  expect(await pngSize(wide)).toEqual({ width: 1920, height: 1080 });
  await shot('saved');

  // Square, for a profile picture: drawn again, and "saved" is gone until it is saved again.
  await picture.getByTestId('share-picture-square').click();
  await expect.poll(natural).toBe('1080x1080');
  await expect(image).toHaveAttribute('data-shape', 'square');
  await expect(picture.getByTestId('share-picture-saved')).toHaveCount(0);
  await shot('square-preview');
  await picture.getByTestId('share-picture-save').click();
  const square = path.join(home, 'Documents', 'my rig square.png');
  await expect(picture.getByTestId('share-picture-saved')).toContainText(`Saved ${square}`);
  expect(await pngSize(square)).toEqual({ width: 1080, height: 1080 });

  // The saved files themselves, kept beside the screenshots: they are the result.
  await fs.copyFile(wide, path.join(screensDir, flow, 'rig-wide.png'));
  await fs.copyFile(square, path.join(screensDir, flow, 'rig-square.png'));
  // What was saved is what was shown: the preview's bytes are the file's bytes.
  const shown = await image.evaluate((element) =>
    (element as unknown as { src: string }).src.slice('data:image/png;base64,'.length)
  );
  expect(Buffer.from(shown, 'base64').equals(await fs.readFile(square))).toBe(true);

  // The other setup of this PC, which checks its pedals by serial number, draws as well.
  await picture.getByTestId('share-picture-setup').click();
  await page.getByRole('option', { name: 'Squadron F/A-18C', exact: true }).click();
  await expect(image).toHaveAttribute(
    'alt',
    /A picture of Squadron F\/A-18C: 4 monitors · 12 controllers/
  );
});
