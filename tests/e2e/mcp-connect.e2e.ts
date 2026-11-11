import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from './harness';

/**
 * Settings > AI assistants > Connect an assistant: the assistants found on the PC, one button
 * each. Claude Desktop's settings file is changed through FileStore (preview first, the other
 * server kept, undone from the Safety page); Cursor is handed its install link. The welcome
 * screen's optional step leads to the same place.
 */

test('mcp-connect: Claude Desktop connected with one button, its other server kept, undone from Safety; Cursor gets its link', async ({
  rig,
}) => {
  const run = await rig.launch('mcp-connect', 'mcp-connect');
  const { page, shot } = run;
  const file = path.join(run.home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  const original = await fs.readFile(file, 'utf8');

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  const connect = page.getByTestId('mcp-connect');
  await connect.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('mcp-state')).toContainText('Off');
  const claude = connect.locator(
    '[data-testid="mcp-connect-client"][data-client="claude-desktop"]'
  );
  const cursor = connect.locator('[data-testid="mcp-connect-client"][data-client="cursor"]');
  await expect(claude).toHaveAttribute('data-state', 'absent');
  await expect(cursor).toBeVisible();
  // General assistants first, developer tools after.
  await expect(connect.getByTestId('mcp-connect-client').first()).toHaveAttribute(
    'data-client',
    'claude-desktop'
  );
  await expect(page.getByTestId('mcp-connect-developers')).toBeVisible();
  await shot('found');

  await page.getByTestId('mcp-connect-claude-desktop').click();
  const confirm = page.getByTestId('mcp-connect-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('claude_desktop_config.json');
  await expect(confirm).toContainText('keeps every other server');
  await shot('preview');
  await page.getByTestId('mcp-connect-go').click();

  await expect(claude.getByTestId('mcp-connect-done')).toContainText(
    'Added RigReady to Claude Desktop'
  );
  await expect(claude).toHaveAttribute('data-state', 'connected');
  // Connecting turned the server on, still asking before every change.
  await expect(page.getByTestId('mcp-state')).toHaveAttribute('data-running', 'true');
  await expect(page.getByTestId('mcp-confirm-ask').locator('input')).toBeChecked();
  const written = JSON.parse(await fs.readFile(file, 'utf8')) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  expect(Object.keys(written.mcpServers)).toEqual(['filesystem', 'rigready']);
  expect(written.mcpServers['rigready']!.args.at(-1)).toBe('--mcp');
  await shot('connected');

  await page.getByTestId('mcp-connect-cursor').click();
  await expect(cursor.getByTestId('mcp-connect-done')).toContainText(
    'Asked Cursor to add RigReady'
  );
  await shot('cursor-link');

  await page.getByTestId('nav-safety').click();
  const change = page.locator(
    '[data-testid="change-group"][data-reason="Connect Claude Desktop to RigReady"]'
  );
  await expect(change).toBeVisible();
  await shot('safety');
  await change.getByTestId('change-undo').click();
  await expect(change).toHaveAttribute('data-undone', 'true');
  expect(await fs.readFile(file, 'utf8')).toBe(original);

  await page.getByTestId('nav-settings').click();
  await page.getByTestId('mcp-connect').scrollIntoViewIfNeeded();
  await expect(claude).toHaveAttribute('data-state', 'absent');
});

test('mcp-connect: the welcome screen offers an assistant as an optional step, and Not now puts it away', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('mcp-welcome', 'mcp-welcome');
  const step = page.getByTestId('welcome-assistant');
  await expect(step).toBeVisible();
  await expect(step).toContainText('Optional');
  await shot('welcome-step');

  await page.getByTestId('welcome-assistant-connect').click();
  await expect(page.getByTestId('mcp-connect')).toBeVisible();
  await expect(
    page.locator('[data-testid="mcp-connect-client"][data-client="claude-desktop"]')
  ).toBeVisible();
  // Nothing was turned on by following the step.
  await expect(page.getByTestId('mcp-state')).toContainText('Off');
  await shot('welcome-to-settings');

  await page.getByTestId('mode-fly').click();
  await page.getByTestId('welcome-assistant-skip').click();
  await expect(step).toBeHidden();
  await expect(page.getByTestId('fly-create')).toBeVisible();
});
