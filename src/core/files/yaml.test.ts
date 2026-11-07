import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { loadDataYaml } from './yaml';

/** Nine levels of ten aliases each: under a kilobyte that stands for a billion strings. */
function aliasBomb(levels = 9): string {
  let doc = 'l0: &l0 [x, x, x, x, x, x, x, x, x, x]\n';
  for (let i = 1; i < levels; i++) {
    doc += `l${i}: &l${i} [${Array.from({ length: 10 }, () => `*l${i - 1}`).join(', ')}]\n`;
  }
  return `${doc}name: bomb\n`;
}

describe('YAML from a file', () => {
  it('refuses a document that multiplies itself through aliases, at once', () => {
    const bomb = aliasBomb();
    expect(bomb.length).toBeLessThan(1024);
    // What js-yaml alone hands over: cheap to load, and ruinous to write out again.
    expect(() => yaml.load(bomb)).not.toThrow();
    const started = Date.now();
    expect(() => loadDataYaml(bomb)).toThrow(/more than 1,000,000 values/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('reads what RigReady writes, and a hand-edited file with anchors', () => {
    const profile = { id: 'dcs', name: 'DCS', checks: [{ type: 'device', params: { a: 1 } }] };
    expect(loadDataYaml(yaml.dump(profile, { noRefs: true }))).toEqual(profile);
    const anchored = `base: &b {x: 1, y: [1, 2]}\nuses: [${Array.from({ length: 200 }, () => '*b').join(', ')}]\n`;
    expect((loadDataYaml(anchored) as { uses: unknown[] }).uses).toHaveLength(200);
    // Five levels of ten stand for a hundred thousand values: big, but not refused.
    expect(() => loadDataYaml(aliasBomb(5))).not.toThrow();
  });

  it('still says where a syntax error is', () => {
    expect(() => loadDataYaml('name: [unclosed')).toThrow(/line|unexpected|flow/i);
  });
});
