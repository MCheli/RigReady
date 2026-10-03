import os from 'node:os';
import { cleanupScenarioTemp } from '../src/platform/fake';

/**
 * Test runs that were killed leave their temp folders behind. Both test runners call
 * this before they start; folders younger than an hour are left for runs in progress.
 */
export default async function cleanTemp(): Promise<void> {
  await cleanupScenarioTemp(os.tmpdir(), Date.now(), 60 * 60 * 1000, [
    'rigready-scenario-',
    'rigready-e2e-',
    'rigready-test-',
  ]);
}
