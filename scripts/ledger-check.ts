/** npm run ledger:check — validates docs/requirements/ledger.yaml. Passes when the file is absent. */
import path from 'node:path';
import { validateLedger } from './lib/ledger';

const repoRoot = path.resolve(import.meta.dirname, '..');
const ledgerFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'docs', 'requirements', 'ledger.yaml');
const report = validateLedger(ledgerFile, repoRoot);

if (!report.found) {
  console.log(`ledger: ${path.relative(repoRoot, ledgerFile)} not found, nothing to check`);
} else {
  const { todo, in_progress, done } = report.counts;
  console.log(
    `ledger: ${report.total} requirements (${done} done, ${in_progress} in progress, ${todo} todo)`
  );
  for (const problem of report.problems) console.error(`  ✗ ${problem}`);
  if (report.problems.length > 0) {
    console.error(`ledger: ${report.problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('ledger: OK');
}
