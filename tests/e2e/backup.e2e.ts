import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/** Backups: tracked files, one-click backup, restore on another PC, snapshots and "what changed". */

async function invoke(page: Page, channel: string, input?: unknown): Promise<unknown> {
  const result = (await page.evaluate(
    ([c, i]) =>
      (
        globalThis as unknown as {
          rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
        }
      ).rigready.invoke(c as string, i),
    [channel, input] as const
  )) as { ok: boolean; value?: unknown; error?: { message: string } };
  if (!result.ok) throw new Error(`${channel}: ${result.error?.message}`);
  return result.value;
}

const track = (page: Page, scope: string, item: object): Promise<unknown> =>
  invoke(page, 'backup:saveItem', { scope, item });

async function openBackups(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-backups').click();
  await expect(page.getByTestId('backups-page')).toBeVisible();
}

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('backup: choose what to track, back up everything in one click, see what is inside, export it', async ({
  rig,
}) => {
  const run = await rig.launch('backup-dcs', 'backup-full', {
    dialogs: { save: ['Documents/USB stick/rig.zip'] },
  });
  const { page, shot } = run;
  await openBackups(page);
  await expect(page.getByTestId('backups-empty')).toBeVisible();
  await expect(page.getByTestId('backup-summary')).toContainText('1 setup and 0 tracked items');
  await shot('nothing-yet');
  // Something the setup expects that is not on this PC (yet): kept, and flagged.
  await track(page, 'dcs-f-a-18c', {
    label: 'Squadron missions',
    path: '{DOCUMENTS}/Squadron missions',
    kind: 'folder',
  });

  await page.getByTestId('backups-tab-tracked').click();
  await expect(page.getByTestId('tracked-empty')).toBeVisible();
  const whole = page.locator('[data-testid="suggestion"][data-label="DCS settings and bindings"]');
  await expect(whole).toContainText('Everything in Saved Games\\DCS except logs');
  await whole.getByTestId('suggestion-add').click();
  const added = page.locator(
    '[data-testid="tracked-item"][data-label="DCS settings and bindings"]'
  );
  await expect(added).toContainText('27 files');
  await expect(added).toContainText('Leaves out Logs/**');
  await expect(whole.getByTestId('suggestion-added')).toBeVisible();

  // The setup's own list: its bindings, and a folder of my own with a pattern, previewed first.
  await page.getByTestId('tracked-scope-dcs-f-a-18c').click();
  await page
    .locator('[data-testid="suggestion"][data-label="DCS bindings"]')
    .getByTestId('suggestion-add')
    .click();
  await expect(
    page.locator('[data-testid="tracked-item"][data-label="DCS bindings"]')
  ).toContainText('18 files');
  await page.getByTestId('tracked-add').click();
  const editor = page.getByTestId('item-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('item-label').locator('input').fill('Export scripts');
  await editor.getByTestId('item-game').click();
  await page.getByRole('option', { name: 'DCS World' }).click();
  await editor.getByTestId('item-path').locator('input').fill('{DCS_USER}/Scripts');
  await expect(editor.getByTestId('item-preview-count')).toHaveText(/^5 files · \d+ KB$/);
  await editor.getByTestId('item-exclude').locator('textarea').first().fill('wwt/**');
  await expect(editor.getByTestId('item-preview-count')).toContainText('3 files');
  await expect(editor.getByTestId('item-preview-file')).toHaveCount(3);
  await shot('editor-preview');
  await editor.getByTestId('item-save').click();
  await expect(
    page.locator('[data-testid="tracked-item"][data-label="Export scripts"]')
  ).toContainText('3 files');
  await expect(
    page.locator('[data-testid="tracked-item"][data-label="Export scripts"]')
  ).toContainText('DCS World');
  await expect(
    page.locator('[data-testid="tracked-item"][data-label="Squadron missions"]')
  ).toContainText('Not on this PC');
  await shot('tracked');

  await page.getByTestId('backups-tab-backups').click();
  await expect(page.getByTestId('backup-summary')).toContainText('4 tracked items');
  await page.getByTestId('backup-all').click();
  await expect(page.getByTestId('backup-outcome-title')).toContainText('Backed up');
  await expect(page.getByTestId('backup-row')).toHaveCount(1);
  await page.getByTestId('backup-toggle').click();
  await expect(page.getByTestId('backup-contents')).toContainText('DCS bindings');
  await expect(page.getByTestId('backup-contents')).toContainText('Setups');
  await shot('backed-up');

  const dir = path.join(run.dataRoot, 'backups');
  const [name] = (await fs.readdir(dir)).filter((f) => f.endsWith('.zip'));
  expect(name).toMatch(/^\d{4}-\d\d-\d\d \d\d-\d\d Everything\.zip$/);
  const entries = unzipSync(new Uint8Array(await fs.readFile(path.join(dir, name!))));
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
  expect(manifest.scope.kind).toBe('full');
  expect(Object.keys(entries)).toContain('rigready/profiles/dcs-f-a-18c.yaml');
  expect(Object.keys(entries).some((k) => k.endsWith('Config/options.lua'))).toBe(true);
  expect(Object.keys(entries).some((k) => k.includes('/Logs/'))).toBe(false);

  await page.getByTestId('backup-menu').click();
  await page.getByTestId('backup-export').click();
  await expect(page.getByTestId('backup-message')).toContainText('Exported to');
  const exported = path.join(run.home, 'Documents', 'USB stick', 'rig.zip');
  expect(await fs.readFile(exported)).toEqual(await fs.readFile(path.join(dir, name!)));
  await shot('exported');

  // A backup of just the ticked items, renamed, then deleted.
  await page.getByTestId('backups-tab-tracked').click();
  await page.getByTestId('tracked-scope-dcs-f-a-18c').click();
  await page
    .locator('[data-testid="tracked-item"][data-label="DCS bindings"]')
    .getByTestId('tracked-select')
    .locator('input')
    .check();
  await page.getByTestId('tracked-backup-selected').click();
  await expect(page.getByTestId('tracked-message')).toContainText('Backed up 18 files');
  await page.getByTestId('backups-tab-backups').click();
  const selected = page.locator('[data-testid="backup-row"][data-name$="Selected items"]');
  await expect(selected.getByTestId('backup-sub')).toContainText('Selected items');
  await selected.getByTestId('backup-menu').click();
  await page.getByTestId('backup-rename').click();
  await page.getByTestId('backup-rename-input').locator('input').fill('Bindings before the rebind');
  await page.getByTestId('backup-rename-save').click();
  const renamed = page.locator(
    '[data-testid="backup-row"][data-name="Bindings before the rebind"]'
  );
  await expect(renamed).toContainText('18 files');
  await shot('two-backups');
  await renamed.getByTestId('backup-menu').click();
  await page.getByTestId('backup-delete').click();
  await expect(page.getByTestId('backup-delete-dialog')).toBeVisible();
  await shot('delete-confirm');
  await page.getByTestId('backup-delete-confirm').click();
  await expect(page.getByTestId('backup-message')).toContainText(
    'Deleted "Bindings before the rebind"'
  );
  await expect(page.getByTestId('backup-row')).toHaveCount(1);
});

test('restore: a backup from this rig onto a freshly installed PC, with a preview, choices and a report', async ({
  rig,
}) => {
  // The old PC: track the bindings, the options and the MFD viewports, back up, export.
  const old = await rig.launch('backup-dcs', 'restore-source', {
    // open: what the file picker answers for the tool file below (relative to the fake user folder).
    dialogs: { save: ['Documents/rig.zip'], open: [['../tools/tool.ini']] },
  });
  await track(old.page, 'dcs-f-a-18c', {
    label: 'DCS bindings',
    path: '{DCS_USER}/Config/Input',
    kind: 'folder',
  });
  await track(old.page, 'dcs-f-a-18c', {
    label: 'DCS options',
    path: '{DCS_USER}/Config/options.lua',
    kind: 'file',
  });
  await track(old.page, '@always', {
    label: 'DCS monitor setups (install)',
    path: '{DCS_INSTALL}/Config/MonitorSetup',
    kind: 'folder',
  });
  // A file outside every known folder: stored as a full path.
  const loose = path.join(old.home, '..', 'tools', 'tool.ini');
  await fs.mkdir(path.dirname(loose), { recursive: true });
  await fs.writeFile(loose, 'volume=3\n');
  // Outside the folders RigReady may use, so it is chosen in the file picker (NFR-005).
  await invoke(old.page, 'backup:browse', { kind: 'file' });
  await track(old.page, '@always', { label: 'Tool settings', path: loose, kind: 'file' });
  await openBackups(old.page);
  await old.page.getByTestId('backup-all').click();
  await expect(old.page.getByTestId('backup-outcome-title')).toContainText('Backed up');
  await old.page.getByTestId('backup-menu').click();
  await old.page.getByTestId('backup-export').click();
  await expect(old.page.getByTestId('backup-message')).toContainText('Exported to');
  const archive = path.join(old.home, 'Documents', 'rig.zip');

  // The new PC: another user folder, bindings gone, DCS in a second Steam library.
  const run = await rig.launch('backup-new-pc', 'restore', { dialogs: { open: [[archive]] } });
  const { page, shot, home } = run;
  const steamRoot = path.join(home, 'Program Files (x86)', 'Steam');
  const library = path.join(home, 'Games', 'SteamLibrary');
  await fs.mkdir(path.join(library, 'steamapps', 'common'), { recursive: true });
  await fs.rename(
    path.join(steamRoot, 'steamapps', 'common', 'DCSWorld'),
    path.join(library, 'steamapps', 'common', 'DCSWorld')
  );
  const vdf = (p: string): string => p.replace(/\\/g, '\\\\');
  await fs.writeFile(
    path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${vdf(steamRoot)}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${vdf(library)}"\n\t}\n}\n`
  );
  await fs.rm(path.join(library, 'steamapps', 'common', 'DCSWorld', 'Config', 'MonitorSetup'), {
    recursive: true,
    force: true,
  });

  await openBackups(page);
  await expect(page.getByTestId('backups-empty')).toBeVisible();
  await page.getByTestId('backup-open-file').click();
  await expect(page.getByTestId('backup-message')).toContainText('Added "rig"');
  await expect(page.getByTestId('backup-sub')).toContainText('added from a file');
  await shot('opened');

  await page.getByTestId('backup-restore').click();
  await expect(page.getByTestId('restore-manifest')).toContainText('rig');
  const bindings = page.locator('[data-testid="restore-item"][data-label="DCS bindings"]');
  await expect(bindings.getByTestId('restore-item-target')).toHaveText(
    path.join(home, 'Saved Games', 'DCS', 'Config', 'Input')
  );
  // Long file lists start folded; every binding file is new here.
  await bindings.getByTestId('restore-item-toggle').click();
  await expect(bindings.locator('[data-testid="restore-file"][data-status="new"]')).toHaveCount(18);
  await bindings.getByTestId('restore-item-toggle').click();
  const monitors = page.locator(
    '[data-testid="restore-item"][data-label="DCS monitor setups (install)"]'
  );
  await expect(monitors.getByTestId('restore-item-target')).toHaveText(
    path.join(library, 'steamapps', 'common', 'DCSWorld', 'Config', 'MonitorSetup')
  );
  const tool = page.locator('[data-testid="restore-item"][data-label="Tool settings"]');
  await expect(tool.getByTestId('restore-item-absolute')).toContainText('Stored as a full path');
  await expect(tool.getByTestId('restore-item-check').locator('input')).not.toBeChecked();
  const options = page.locator('[data-testid="restore-file"][data-path="options.lua"]');
  await expect(options).toHaveAttribute('data-status', 'different');
  await expect(
    page.locator('[data-testid="restore-own"][data-ref="profile:dcs-f-a-18c"]')
  ).toHaveAttribute('data-status', 'new');
  // Keep my options.lua and put the backed-up one next to it.
  await options.getByTestId('restore-file-action').click();
  await page.getByRole('option', { name: 'Keep both' }).click();
  await expect(page.getByTestId('restore-plan')).toContainText('1 kept side by side');
  await page.evaluate('window.scrollTo(0, 0)');
  await shot('preview');

  await page.getByTestId('restore-apply').click();
  await expect(page.getByTestId('restore-report-title')).toContainText('Restored');
  await expect(page.getByTestId('restore-keptBoth')).toContainText('options (restored');
  await expect(page.getByTestId('restore-run-checks')).toBeVisible();
  await shot('report');

  const input = path.join(home, 'Saved Games', 'DCS', 'Config', 'Input');
  expect(await fs.readFile(path.join(input, 'disabled.lua'))).toEqual(
    await fs.readFile(path.join(old.home, 'Saved Games', 'DCS', 'Config', 'Input', 'disabled.lua'))
  );
  expect(
    await fs.readFile(path.join(home, 'Saved Games', 'DCS', 'Config', 'options.lua'), 'utf8')
  ).toContain('1920');
  await fs.access(
    path.join(home, 'Saved Games', 'DCS', 'Config', `options (restored ${today()}).lua`)
  );
  expect(
    (
      await fs.readdir(
        path.join(library, 'steamapps', 'common', 'DCSWorld', 'Config', 'MonitorSetup')
      )
    ).length
  ).toBeGreaterThan(0);
  await fs.access(path.join(run.dataRoot, 'profiles', 'dcs-f-a-18c.yaml'));

  await expect(page.getByTestId('restore-safety')).toBeVisible();
  // "Run checks now" goes to Fly, which now has the restored setup.
  await page.getByTestId('restore-run-checks').click();
  await expect(page).toHaveURL(/#\/fly/);
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-safety').click();
  await expect(
    page.locator('[data-testid="change-group"][data-reason="Restore backup \\"rig\\""]')
  ).toBeVisible();
  await shot('safety');

  // A PC without DCS: its files are listed as not restorable, with the reason.
  const bare = await rig.launch('backup-no-dcs', 'restore-no-dcs', {
    dialogs: { open: [[archive]] },
  });
  await openBackups(bare.page);
  await bare.page.getByTestId('backup-open-file').click();
  await bare.page.getByTestId('backup-restore').click();
  const missing = bare.page.locator('[data-testid="restore-item"][data-label="DCS bindings"]');
  await expect(missing).toHaveAttribute('data-restorable', 'false');
  await expect(missing.getByTestId('restore-item-problem')).toContainText(
    '{DCS_USER} is not on this PC'
  );
  await bare.shot('not-restorable');
});

test('backup: snapshots compare line by line and can be put back; "what changed" since it last worked', async ({
  rig,
}) => {
  const run = await rig.launch('backup-dcs', 'backup-history');
  const { page, shot, home } = run;
  await track(page, 'dcs-f-a-18c', {
    label: 'DCS export scripts',
    path: '{DCS_USER}/Scripts',
    kind: 'folder',
  });
  await track(page, 'dcs-f-a-18c', {
    label: 'DCS options',
    path: '{DCS_USER}/Config/options.lua',
    kind: 'file',
  });
  await openBackups(page);
  await page.getByTestId('backups-tab-snapshots').click();
  await expect(page.getByTestId('snapshots-empty')).toBeVisible();
  await page.getByTestId('snapshot-item').click();
  await page.getByRole('option', { name: 'DCS export scripts (DCS F/A-18C)' }).click();
  await page.getByTestId('snapshot-name').locator('input').fill('Before Tacview');
  await page.getByTestId('snapshot-take').click();
  await expect(page.getByTestId('snapshot-message')).toContainText(
    'Saved snapshot "Before Tacview"'
  );
  await expect(page.getByTestId('snapshot-row')).toHaveCount(1);
  await shot('snapshot-taken');

  const exportLua = path.join(home, 'Saved Games', 'DCS', 'Scripts', 'Export.lua');
  const original = await fs.readFile(exportLua, 'utf8');
  await run.changeFiles('Add Tacview to Export.lua', [
    {
      path: 'Saved Games/DCS/Scripts/Export.lua',
      content: `${original}local Tacviewlfs=require('lfs');dofile(Tacviewlfs.writedir()..'Scripts/TacviewGameExport.lua')\n`,
    },
  ]);
  await page.getByTestId('snapshot-compare').click();
  const comparison = page.getByTestId('snapshot-comparison');
  await expect(comparison).toBeVisible();
  const changed = comparison.locator('[data-testid="diff-file"][data-key="Export.lua"]');
  await expect(changed).toHaveAttribute('data-status', 'changed');
  await expect(changed.getByTestId('diff-summary')).toHaveText('1 line added, 0 removed');
  await changed.getByTestId('diff-toggle').click();
  await expect(changed.getByTestId('diff-lines')).toContainText('TacviewGameExport.lua');
  await expect(comparison.getByTestId('diff-unchanged')).toHaveText('4 other files unchanged.');
  await shot('snapshot-diff');
  await comparison.getByTestId('snapshot-compare-restore').click();
  await page.getByTestId('snapshot-restore-confirm').click();
  await expect(page.getByTestId('snapshot-message')).toContainText('Put back 1 file');
  expect(await fs.readFile(exportLua, 'utf8')).toBe(original);

  // What changed since it last worked: the game starting records the files.
  await page.getByTestId('backups-tab-changes').click();
  await expect(page.getByTestId('changes-never')).toBeVisible();
  await run.mutate([
    {
      op: 'startProcess',
      name: 'DCS.exe',
      path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe',
    },
  ]);
  await expect(page.getByTestId('changes-known-title')).toContainText('Last worked');
  await expect(page.getByTestId('changes-known')).toContainText('Launched DCS.exe');
  await expect(page.getByTestId('diff-none')).toBeVisible();
  const optionsLua = path.join(home, 'Saved Games', 'DCS', 'Config', 'options.lua');
  const options = await fs.readFile(optionsLua, 'utf8');
  await run.changeFiles('Change DCS options', [
    {
      path: 'Saved Games/DCS/Config/options.lua',
      content: options.replace('["fullScreen"] = false', '["fullScreen"] = true'),
    },
  ]);
  const optionsChange = page.locator(
    '[data-testid="diff-file"][data-key="{DCS_USER}/Config/options.lua"]'
  );
  await expect(optionsChange).toHaveAttribute('data-status', 'changed');
  await optionsChange.getByTestId('diff-toggle').click();
  await expect(optionsChange.getByTestId('diff-lines')).toContainText('["fullScreen"] = true');
  await shot('what-changed');
});
