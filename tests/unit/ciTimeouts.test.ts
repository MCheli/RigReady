import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../helpers';

/**
 * A CI job without a time limit of its own may run for GitHub's six hours when it hangs, and
 * holds a runner all that time. Every job of the CI workflow names its limit.
 */

interface Job {
  'timeout-minutes'?: unknown;
}

describe('the time limits of the CI jobs', () => {
  it('every job has a limit in whole minutes, of an hour at most', async () => {
    const text = await fs.readFile(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const jobs = Object.entries((yaml.load(text) as { jobs: Record<string, Job> }).jobs);
    // The workflow has seven jobs today: a job added later needs a limit as well.
    expect(jobs.length).toBeGreaterThanOrEqual(7);
    const without = jobs
      .filter(([, job]) => {
        const limit = job['timeout-minutes'];
        return !(typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 60);
      })
      .map(([id]) => id);
    expect(without).toEqual([]);
  });
});
