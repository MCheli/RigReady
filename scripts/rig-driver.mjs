// Drives a running RigReady for the guided testing sitting, so Mark only does the physical parts.
// Start:  node scripts/rig-driver.mjs   (listens on http://127.0.0.1:47123, local only). See docs/GUIDED-RIG-SITTING.md.
// Every call is a small JSON request; screenshots land in the chosen output folder.
import { _electron } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 47123;

let app; // ElectronApplication
let page; // main window
let outDir; // set by launch; the sitting passes the Desktop folder rigready-test

async function mainWindow() {
  // The main window is the first non-hidden window with the app's shell in it.
  for (let i = 0; i < 60; i++) {
    for (const w of app.windows()) {
      if (
        await w
          .locator('#app, [data-testid]')
          .first()
          .count()
          .catch(() => 0)
      )
        return w;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return app.firstWindow();
}

function target(body) {
  if (body.testid) return page.getByTestId(body.testid).nth(body.nth ?? 0);
  if (body.role)
    return page.getByRole(body.role, { name: body.name, exact: !!body.exact }).nth(body.nth ?? 0);
  if (body.text) return page.getByText(body.text, { exact: !!body.exact }).nth(body.nth ?? 0);
  if (body.selector) return page.locator(body.selector).nth(body.nth ?? 0);
  throw new Error('give testid, role+name, text or selector');
}

const actions = {
  async launch(b) {
    if (app) throw new Error('already launched; close first');
    if (!b.outDir) throw new Error('launch needs outDir (where screenshots go)');
    outDir = b.outDir;
    fs.mkdirSync(outDir, { recursive: true });
    const env = { ...process.env, ...(b.env ?? {}) };
    app = await _electron.launch({
      executablePath: b.exe,
      args: b.args ?? [],
      env,
      timeout: 60_000,
    });
    page = await mainWindow();
    await page.waitForLoadState('domcontentloaded');
    return { windows: app.windows().length, url: page.url(), outDir };
  },
  async shot(b) {
    const file = path.join(outDir, `${b.name}.png`);
    await page.screenshot({ path: file, fullPage: !!b.full });
    return { file };
  },
  async click(b) {
    await target(b).click({ timeout: b.timeout ?? 15_000 });
    return { ok: true };
  },
  async fill(b) {
    await target(b).fill(b.value, { timeout: b.timeout ?? 15_000 });
    return { ok: true };
  },
  async press(b) {
    await page.keyboard.press(b.key);
    return { ok: true };
  },
  async wait(b) {
    await target(b).waitFor({ state: b.state ?? 'visible', timeout: b.timeout ?? 30_000 });
    return { ok: true };
  },
  async text(b) {
    const t = target(b);
    return { text: (await t.innerText({ timeout: b.timeout ?? 15_000 })).slice(0, b.max ?? 4000) };
  },
  async page(b) {
    // What is on screen, in words: headings, buttons and every data-testid that is visible.
    return page.evaluate((max) => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      const ids = [...document.querySelectorAll('[data-testid]')]
        .filter(vis)
        .map((e) => e.getAttribute('data-testid'));
      const heads = [...document.querySelectorAll('h1,h2,h3')]
        .filter(vis)
        .map((e) => e.innerText.trim());
      const buttons = [...document.querySelectorAll('button,[role=button],a')]
        .filter(vis)
        .map((e) => e.innerText.trim())
        .filter(Boolean);
      return {
        hash: location.hash,
        heads,
        buttons: [...new Set(buttons)].slice(0, max),
        testids: [...new Set(ids)].slice(0, max),
      };
    }, b.max ?? 120);
  },
  async goto(b) {
    await page.evaluate((h) => {
      location.hash = h;
    }, b.hash);
    await page.waitForTimeout(400);
    return { hash: await page.evaluate(() => location.hash) };
  },
  async windows() {
    return {
      windows: await Promise.all(
        app.windows().map(async (w) => ({ url: w.url(), title: await w.title() }))
      ),
    };
  },
  async close() {
    if (app) await app.close().catch(() => {});
    app = undefined;
    page = undefined;
    return { ok: true };
  },
};

http
  .createServer(async (req, res) => {
    const name = (req.url ?? '/').replace(/^\/+/, '').split('?')[0];
    let body = '';
    for await (const c of req) body += c;
    const reply = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      const fn = actions[name];
      if (!fn) return reply(404, { error: `no action ${name}`, actions: Object.keys(actions) });
      if (name !== 'launch' && name !== 'close' && !page) throw new Error('not launched');
      reply(200, await fn(body ? JSON.parse(body) : {}));
    } catch (e) {
      reply(500, { error: String(e?.message ?? e).slice(0, 2000) });
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`rig driver on http://127.0.0.1:${PORT}`));
