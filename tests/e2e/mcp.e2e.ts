import { createRequire } from 'node:module';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, repoRoot, test } from './harness';

/**
 * Settings > AI assistants: the MCP server turned on, an assistant paired and its client
 * configuration copied, then a real MCP client (the official SDK, from this test) asking
 * for Make ready, the question in RigReady's window, and what the assistant did.
 */

test('mcp: turned on in Settings, an assistant paired, its change asked in the window and listed', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('mcp-settings', 'mcp-settings');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  const section = page.getByTestId('mcp-settings');
  await section.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('mcp-state')).toContainText('Off');
  await shot('off');

  await page.getByTestId('mcp-enable').locator('input').check();
  await expect(page.getByTestId('mcp-state')).toHaveAttribute('data-running', 'true');
  const state = await page.getByTestId('mcp-state').innerText();
  const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(state)?.[0];
  expect(url, state).toBeTruthy();
  // The stdio form needs nothing but the path of RigReady and --mcp.
  await expect(page.getByTestId('mcp-client-config')).toContainText('"--mcp"');
  await page.getByTestId('mcp-copy').click();
  await expect(page.getByTestId('mcp-copied')).toBeVisible();
  await shot('on');

  await page.getByTestId('mcp-pair-name').locator('input').fill('Claude Code');
  await page.getByTestId('mcp-pair').click();
  await expect(page.getByTestId('mcp-fresh-token')).toBeVisible();
  const token = /rr_[0-9a-f]{64}/.exec(await page.getByTestId('mcp-fresh-token').innerText())?.[0];
  expect(token).toBeTruthy();
  await expect(page.getByTestId('mcp-client-config')).toContainText(token!);
  await expect(page.getByTestId('mcp-pairing')).toContainText('Claude Code');
  await shot('paired');

  const client = new Client({ name: 'e2e-assistant', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url!), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  try {
    const listed = await client.callTool({ name: 'setups_list', arguments: {} });
    const first = (listed.structuredContent as { setups: { id: string; name: string }[] })
      .setups[0]!;
    const setup = first.id;
    expect(first.name).not.toBe(first.id);
    const call = client.callTool({ name: 'rig_make_ready', arguments: { setup } });
    const question = page.getByTestId('mcp-question');
    await expect(question).toBeVisible();
    await expect(question).toContainText('Claude Code asks to change the rig');
    // The assistant named the setup by its id; the question names it as the user knows it.
    await expect(page.getByTestId('mcp-question-summary')).toHaveText(`Make ${first.name} ready`);
    await expect(page.getByTestId('mcp-question-detail')).toHaveCount(0);
    await shot('question');
    await page.getByTestId('mcp-question-allow').click();
    const result = await call;
    expect(result.isError).toBeFalsy();
    await expect(page.getByTestId('mcp-done')).toContainText('Claude Code');
    await expect(page.getByTestId('mcp-activity').first()).toContainText(
      `Claude Code: Make ${first.name} ready`
    );
    await expect(page.getByTestId('mcp-activity').first()).toContainText('Done');
    // Two calls so far (the list of setups, and this), and the pairing says two.
    await expect(page.getByTestId('mcp-activity')).toHaveCount(2);
    await expect(page.getByTestId('mcp-pairing')).toContainText(', 2 calls');
    await shot('activity');

    // "Allow, and stop asking": this change goes ahead, and the next one is not asked about.
    const second = client.callTool({ name: 'rig_make_ready', arguments: { setup } });
    await expect(question).toBeVisible();
    await shot('question-stop-asking');
    await page.getByTestId('mcp-question-allow-always').click();
    expect((await second).isError).toBeFalsy();
    await expect(page.getByTestId('mcp-confirm-launchOnly').locator('input')).toBeChecked();
    const third = await client.callTool({ name: 'rig_make_ready', arguments: { setup } });
    expect(third.isError).toBeFalsy();
    await expect(question).toBeHidden();

    // A file change the assistant makes is on the Safety page under its name, and undoes the same.
    const created = await client.callTool({
      name: 'setup_create_from_rig',
      arguments: { name: 'Made by an assistant' },
    });
    expect(created.isError).toBeFalsy();
    const made = (created.structuredContent as { id: string }).id;
    const removed = await client.callTool({
      name: 'rigready_call',
      arguments: { channel: 'profiles:remove', input: { id: made } },
    });
    expect(removed.isError).toBeFalsy();
    await page.getByTestId('nav-safety').click();
    const change = page.getByTestId('change-group').first();
    await expect(change).toContainText('Made by an assistant');
    await expect(change.getByTestId('change-by')).toContainText('by Claude Code');
    await shot('safety-by-assistant');
    await change.getByTestId('change-undo').click();
    await expect(change.getByTestId('change-undone')).toBeVisible();
    await expect(change.getByTestId('change-by')).toContainText('by Claude Code');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('mcp-settings').scrollIntoViewIfNeeded();
  } finally {
    await client.close();
  }

  // Forgetting the pairing ends its access at once.
  await page.getByTestId('mcp-forget').click();
  await expect(page.getByTestId('mcp-pairing')).toHaveCount(0);
  const again = new Client({ name: 'e2e-assistant', version: '1.0.0' });
  await expect(
    again.connect(
      new StreamableHTTPClientTransport(new URL(url!), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      })
    )
  ).rejects.toThrow();

  await page.getByTestId('mcp-enable').locator('input').uncheck();
  await expect(page.getByTestId('mcp-state')).toContainText('Off');
});

test('mcp: a channel called directly is asked about in words with the call under them, and a no is counted', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('mcp-settings', 'mcp-question-plain');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('mcp-settings').scrollIntoViewIfNeeded();
  await page.getByTestId('mcp-enable').locator('input').check();
  await expect(page.getByTestId('mcp-state')).toHaveAttribute('data-running', 'true');
  const state = await page.getByTestId('mcp-state').innerText();
  const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(state)?.[0];
  expect(url, state).toBeTruthy();
  await page.getByTestId('mcp-pair-name').locator('input').fill('Claude Code');
  await page.getByTestId('mcp-pair').click();
  const token = /rr_[0-9a-f]{64}/.exec(await page.getByTestId('mcp-fresh-token').innerText())?.[0];
  expect(token).toBeTruthy();
  const pairing = page.getByTestId('mcp-pairing');
  await expect(pairing).toContainText(', 0 calls');

  const client = new Client({ name: 'e2e-assistant', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url!), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  try {
    const listed = await client.callTool({ name: 'setups_list', arguments: {} });
    const setup = (listed.structuredContent as { setups: { id: string; name: string }[] })
      .setups[0]!;
    await expect(pairing).toContainText(', 1 call');

    // One of the app's channels, called by its name: the question says what it does.
    const deletes = "Deletes a setup's file and its desktop shortcut, if it has one";
    const made = `profiles:remove {"id":"${setup.id}"}`;
    const removal = client.callTool({
      name: 'rigready_call',
      arguments: { channel: 'profiles:remove', input: { id: setup.id } },
    });
    const question = page.getByTestId('mcp-question');
    await expect(question).toBeVisible();
    await expect(question).toContainText('Claude Code asks to change the rig');
    await expect(page.getByTestId('mcp-question-summary')).toHaveText(deletes);
    await expect(page.getByTestId('mcp-question-detail')).toHaveText(made);
    await shot('question-in-words');
    await page.getByTestId('mcp-question-deny').click();
    expect((await removal).isError).toBe(true);
    await expect(question).toBeHidden();

    // A launch is asked about as a launch, and by the setup's name.
    const launch = client.callTool({ name: 'rig_launch', arguments: { setup: setup.id } });
    await expect(question).toBeVisible();
    await expect(question).toContainText('Claude Code asks to launch a game');
    await expect(page.getByTestId('mcp-question-summary')).toHaveText(`Launch ${setup.name}`);
    await expect(page.getByTestId('mcp-question-allow-always')).toHaveCount(0);
    await shot('question-launch');
    await page.getByTestId('mcp-question-deny').click();
    expect((await launch).isError).toBe(true);

    // What was refused is in the list with the call as it was made, and in the pairing's count.
    const rows = page.getByTestId('mcp-activity');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(`Claude Code: Launch ${setup.name}`);
    await expect(rows.nth(0)).toContainText('You said no');
    await expect(rows.nth(0).getByTestId('mcp-activity-detail')).toHaveCount(0);
    await expect(rows.nth(1)).toContainText(`Claude Code: ${deletes}`);
    await expect(rows.nth(1).getByTestId('mcp-activity-detail')).toHaveText(made);
    await expect(rows.nth(1)).toContainText('You said no');
    await expect(pairing).toContainText(', 3 calls');
    await rows.nth(2).scrollIntoViewIfNeeded();
    await shot('said-no-and-counted');
  } finally {
    await client.close();
  }
});

test('mcp: RigReady.exe --mcp is a stdio bridge to the running RigReady, and says so when it is not', async ({
  rig,
}) => {
  const { page, dataRoot } = await rig.launch('mcp-settings', 'mcp-bridge');
  // The same isolated profile as the running app: the bridge decrypts the token it stored.
  const root = path.dirname(dataRoot);
  const user = path.join(root, 'user');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['RIGREADY_SCENARIO'];
  Object.assign(env, {
    USERPROFILE: user,
    APPDATA: path.join(user, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(user, 'AppData', 'Local'),
    RIGREADY_HOME: dataRoot,
  });
  const electron = createRequire(__filename)('electron') as unknown as string;
  const bridge = (): StdioClientTransport =>
    new StdioClientTransport({ command: electron, args: [repoRoot, '--mcp'], env, stderr: 'pipe' });

  // Before the server is on: a plain answer, no crash.
  const early = new Client({ name: 'e2e-stdio', version: '1.0.0' });
  await expect(early.connect(bridge())).rejects.toThrow(/RigReady is not running/);
  await early.close().catch(() => undefined);

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('mcp-enable').locator('input').check();
  await expect(page.getByTestId('mcp-state')).toHaveAttribute('data-running', 'true');

  const client = new Client({ name: 'e2e-stdio', version: '1.0.0' });
  await client.connect(bridge());
  try {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('rig_check');
    const check = await client.callTool({ name: 'rig_check', arguments: {} });
    expect(check.isError).toBeFalsy();
    await expect(page.getByTestId('mcp-activity').first()).toContainText('RigReady.exe --mcp');
  } finally {
    await client.close();
  }
});
