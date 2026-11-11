// Drives a running RigReady for the guided testing sitting, so Mark only does the physical parts.
// Start:  node scripts/rig-driver.mjs   (listens on http://127.0.0.1:47123, local only). See docs/GUIDED-RIG-SITTING.md.
// Every call is a small JSON request carrying the token printed at start; screenshots land in the
// chosen output folder.
import { _electron } from '@playwright/test';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// 47123 unless RIG_DRIVER_PORT says otherwise (a second driver for a dry run beside a sitting).
const PORT = Number(process.env.RIG_DRIVER_PORT ?? 47123);
// Every request must carry this in an x-rig-token header. The driver can start any program and
// click anything in RigReady, and a web page open on this PC can post to a local port too.
const TOKEN = process.env.RIG_DRIVER_TOKEN ?? crypto.randomBytes(16).toString('hex');

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

function matches(body) {
  if (body.testid) return page.getByTestId(body.testid);
  if (body.role) return page.getByRole(body.role, { name: body.name, exact: !!body.exact });
  if (body.text) return page.getByText(body.text, { exact: !!body.exact });
  if (body.selector) return page.locator(body.selector);
  throw new Error('give testid, role+name, text or selector');
}

function target(body) {
  return matches(body).nth(body.nth ?? 0);
}

const actions = {
  async launch(b) {
    if (app) throw new Error('already launched; close first');
    if (!b.outDir) throw new Error('launch needs outDir (where screenshots go)');
    if (!b.exe || !fs.existsSync(b.exe)) throw new Error(`no such exe: ${b.exe}`);
    outDir = b.outDir;
    fs.mkdirSync(outDir, { recursive: true });
    const env = { ...process.env, ...(b.env ?? {}) };
    try {
      app = await _electron.launch({
        executablePath: b.exe,
        args: b.args ?? [],
        env,
        timeout: 60_000,
      });
    } catch (e) {
      // A second start only hands over to the copy already running, then ends at once.
      if (/has been closed/.test(String(e?.message)))
        throw new Error(
          'RigReady ended as soon as it started: a copy is probably running already (the installer starts one when it finishes). Quit it from the tray, then launch again.'
        );
      throw e;
    }
    page = await mainWindow();
    await page.waitForLoadState('domcontentloaded');
    return { windows: app.windows().length, url: page.url(), outDir };
  },
  // The window as it is, or with a target just that element (scrolled into view first).
  async shot(b) {
    const file = path.join(outDir, `${b.name}.png`);
    const one = b.testid || b.role || b.text || b.selector;
    if (one) await target(b).screenshot({ path: file, timeout: b.timeout ?? 15_000 });
    else await page.screenshot({ path: file, fullPage: !!b.full });
    return { file };
  },
  // Brings a target into view, or with no target puts everything that scrolls back at its top.
  async scroll(b) {
    if (b.testid || b.role || b.text || b.selector)
      await target(b).scrollIntoViewIfNeeded({ timeout: b.timeout ?? 15_000 });
    else
      await page.evaluate(() => {
        for (const e of document.querySelectorAll('*')) if (e.scrollTop > 0) e.scrollTop = 0;
      });
    return { ok: true };
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
  // Every match of a target with what tells its state: its text, its classes and data-* values,
  // and whether it reads as pressed, checked, selected or disabled. For "which control lit up".
  async inspect(b) {
    const found = await matches(b).evaluateAll(
      (els, max) =>
        els.slice(0, max).map((e) => {
          const aria = {};
          for (const name of ['pressed', 'checked', 'selected', 'current', 'disabled', 'expanded'])
            if (e.hasAttribute(`aria-${name}`)) aria[name] = e.getAttribute(`aria-${name}`);
          return {
            tag: e.tagName.toLowerCase(),
            testid: e.getAttribute('data-testid') ?? undefined,
            text: (e.innerText ?? e.textContent ?? '').trim().slice(0, 300),
            class: e.getAttribute('class') ?? undefined,
            data: { ...e.dataset },
            aria,
            disabled: e.disabled === true ? true : undefined,
            checked: typeof e.checked === 'boolean' ? e.checked : undefined,
            value: typeof e.value === 'string' ? e.value : undefined,
          };
        }),
      b.max ?? 40
    );
    return { count: found.length, found };
  },
  // Answers the next native file dialog, which Playwright cannot reach. {save: path} answers one
  // Save dialog, {open: [paths]} one Open dialog; null or [] cancels it. Each answer is used once.
  async dialog(b) {
    await app.evaluate(({ dialog }, answer) => {
      if (answer.save !== undefined) {
        const real = dialog.showSaveDialog;
        dialog.showSaveDialog = async () => {
          dialog.showSaveDialog = real;
          return { canceled: answer.save === null, filePath: answer.save ?? '' };
        };
      }
      if (answer.open !== undefined) {
        const real = dialog.showOpenDialog;
        dialog.showOpenDialog = async () => {
          dialog.showOpenDialog = real;
          return { canceled: answer.open.length === 0, filePaths: answer.open };
        };
      }
    }, b);
    return { ok: true };
  },
  // Makes another window (a popped-out cheat sheet, a panel) the one the other actions act on.
  async use(b) {
    const all = app.windows();
    const next = all[b.index ?? 0];
    if (!next) throw new Error(`no window ${b.index}; there are ${all.length}`);
    page = next;
    return { url: page.url().slice(0, 200), title: await page.title() };
  },
  // Closes one extra window and goes back to the main one. The main window is index 0: `close`
  // is for that, since closing it by itself would only send RigReady to the tray.
  async closeWindow(b) {
    const all = app.windows();
    const gone = all[b.index];
    if (!b.index || !gone) throw new Error(`no extra window ${b.index}; there are ${all.length}`);
    await gone.close();
    if (gone === page) page = await mainWindow();
    return { windows: app.windows().length };
  },
  async page(b) {
    // What is on screen, in words: headings, buttons and every data-testid that is visible.
    return page.evaluate((max) => {
      // Shown, and not parked off to the side (a closed drawer still has a size).
      const vis = (e) => {
        if (!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)) return false;
        if (
          e.checkVisibility &&
          !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        )
          return false;
        const r = e.getBoundingClientRect();
        return r.right > 0 && r.left < window.innerWidth;
      };
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
        // The address cut short: an Identify overlay's is a whole page in a data: address.
        app.windows().map(async (w) => ({ url: w.url().slice(0, 200), title: await w.title() }))
      ),
    };
  },
  async close() {
    if (app) await app.close().catch(() => {});
    app = undefined;
    page = undefined;
    return { ok: true };
  },
  // Closes the app and ends the driver itself, so nothing is left listening after a sitting.
  async stop() {
    await actions.close();
    setTimeout(() => process.exit(0), 100);
    return { ok: true, stopped: true };
  },
};

// Playwright can fail outside the call that started it (an app that will not start, a window that
// closed under a click). The driver logs it and stays up: a sitting must not lose its driver.
for (const event of ['unhandledRejection', 'uncaughtException'])
  process.on(event, (e) => console.error(`${event}: ${e?.message ?? e}`));

http
  .createServer(async (req, res) => {
    const name = (req.url ?? '/').replace(/^\/+/, '').split('?')[0];
    let body = '';
    for await (const c of req) body += c;
    const reply = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    // A browser always names the page it posts from; the driver's own caller never does.
    if (req.headers.origin !== undefined || req.headers['x-rig-token'] !== TOKEN)
      return reply(403, { error: 'forbidden: send the x-rig-token the driver printed at start' });
    try {
      const fn = actions[name];
      if (!fn) return reply(404, { error: `no action ${name}`, actions: Object.keys(actions) });
      if (!['launch', 'close', 'stop'].includes(name) && !page) throw new Error('not launched');
      reply(200, await fn(body ? JSON.parse(body) : {}));
    } catch (e) {
      reply(500, { error: String(e?.message ?? e).slice(0, 2000) });
    }
  })
  .on('error', (e) => {
    // A driver left over from an earlier run holds the port: say so instead of a stack trace.
    if (e.code === 'EADDRINUSE') {
      console.error(
        `port ${PORT} is in use: another rig driver is running. POST /stop to it, or set RIG_DRIVER_PORT.`
      );
      process.exit(1);
    }
    throw e;
  })
  .listen(PORT, '127.0.0.1', () =>
    console.log(`rig driver on http://127.0.0.1:${PORT}\nx-rig-token: ${TOKEN}`)
  );
