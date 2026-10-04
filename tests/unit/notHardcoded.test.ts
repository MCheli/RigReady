import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRig } from '../../src/platform/fake';
import { fixturesDir, repoRoot } from '../helpers';

/**
 * Nothing in the shipped code may name the owner's rig: not his name, not this PC's name
 * or user folder, and no serial number, device instance, monitor id, audio endpoint or
 * controller GUID of the recorded rig (fixtures/rigs/mark-full).
 *
 * What is searched: every source file under src/ except tests, with comments taken out.
 * Comments are left alone on purpose: several quote a real id as an example of the format
 * ("806E0610-B756-11F0-8024-444553540000"), which no code path can act on. Tests are left
 * out because they are about the recorded rig.
 */

const SOURCE = /\.(ts|vue|css|html|mjs|json|ps1|py)$/;

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (SOURCE.test(entry.name) && !/\.test\.ts$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Block comments, HTML comments and whole-line `//` and `#` comments removed. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*(\/\/|#).*$/gm, '');
}

/** Every identifier of the recorded rig that would only ever be true on the owner's PC. */
async function ownerIdentifiers(): Promise<Map<string, string>> {
  const rig = await loadRig(path.join(fixturesDir, 'rigs', 'mark-full'));
  const ids = new Map<string, string>();
  const add = (value: string | undefined, what: string): void => {
    // Short or all-zero values ("1", "000000000000") are not identifying.
    if (value && value.length >= 6 && !/^0+$/.test(value)) ids.set(value.toLowerCase(), what);
  };
  for (const device of rig.devices) {
    add(device.serial, `serial of ${device.name}`);
    add(device.instanceId.split('\\').pop(), `instance of ${device.name}`);
  }
  for (const display of rig.displays) {
    add(display.serial, `serial of ${display.name}`);
    add(display.usbSerial, `USB serial of ${display.name}`);
    add(display.id.split('#')[2], `connector instance of ${display.name}`);
  }
  for (const controller of rig.input) add(controller.guid, `GUID of ${controller.name}`);
  for (const endpoint of rig.audio.devices) {
    add(endpoint.id.split('.').pop(), `endpoint id of ${endpoint.name}`);
  }
  return ids;
}

describe('nothing is hardcoded to the owner’s rig', () => {
  it('comment stripping keeps code and drops block, HTML and whole-line comments', () => {
    const text = [
      '/** doc 806E0610 */',
      'const a = "kept"; // trailing stays',
      '  // whole line goes',
      '<!-- html goes -->',
      "const url = 'https://example.com/x';",
    ].join('\n');
    const stripped = withoutComments(text);
    expect(stripped).toContain('const a = "kept"; // trailing stays');
    expect(stripped).toContain("'https://example.com/x'");
    expect(stripped).not.toMatch(/doc 806E0610|whole line goes|html goes/);
  });

  it('no source file names the owner, this PC, or a serial, instance, monitor or GUID of the recorded rig', async () => {
    const ids = await ownerIdentifiers();
    // The recording has plenty to look for; an empty list would prove nothing.
    expect(ids.size).toBeGreaterThan(60);
    expect([...ids.values()].some((what) => what.startsWith('GUID of'))).toBe(true);

    const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
      author?: { name?: string };
    };
    const surname = pkg.author?.name?.trim().split(/\s+/).pop();
    const people = new Map<string, string>();
    if (surname && surname.length >= 4) people.set(surname.toLowerCase(), 'the owner’s name');
    // On the owner's PC these are his; anywhere else they prove the same thing for that PC.
    const user = os.userInfo().username.toLowerCase();
    people.set(`users\\${user}\\`, 'this PC’s user folder');
    people.set(`users\\\\${user}\\\\`, 'this PC’s user folder');
    people.set(`users/${user}/`, 'this PC’s user folder');
    if (os.hostname().length >= 6) people.set(os.hostname().toLowerCase(), 'this PC’s name');

    const files = await sourceFiles(path.join(repoRoot, 'src'));
    expect(files.length).toBeGreaterThan(200);
    const hits: string[] = [];
    for (const file of files) {
      const text = withoutComments(await fs.readFile(file, 'utf8')).toLowerCase();
      for (const [needle, what] of [...ids, ...people]) {
        if (text.includes(needle)) {
          hits.push(`${path.relative(repoRoot, file)}: ${what} (${needle})`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
