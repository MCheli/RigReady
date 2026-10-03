import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';

let app: WiredApp;
afterEach(() => app?.cleanup());

async function sources(dir: string): Promise<{ file: string; text: string }[]> {
  const out: { file: string; text: string }[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(full)));
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push({ file: full, text: await fs.readFile(full, 'utf8') });
    }
  }
  return out;
}

describe('check types', () => {
  it('are registered by features; core never switches over them', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const types = [
      ...app.wiring.context.checks.checkTypes(),
      ...app.wiring.context.checks.remediationTypes(),
    ];
    expect(types).toEqual(
      expect.arrayContaining(['service.running', 'file.exists', 'file.content', 'script.check'])
    );
    const core = await sources(path.join(__dirname, '../../../core'));
    for (const { file, text } of core) {
      for (const type of types) {
        expect(text.includes(`'${type}'`), `${file} names the type ${type}`).toBe(false);
      }
      expect(/switch\s*\([^)]*\.type\)/.test(text), `${file} switches over a type`).toBe(false);
    }
  });
});
