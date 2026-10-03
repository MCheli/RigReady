import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';

/**
 * Validates docs/requirements/ledger.yaml (see docs/ARCHITECTURE.md, "Requirements ledger").
 *
 * Evidence entries are strings:
 *   - a test:        "<test file>#<test title>"   (" > " and "::" also separate file and title)
 *   - a screenshot:  "artifacts/screens/<flow>/<name>.png"
 *   - any other file path, relative to the repository root
 * A test's file must exist and contain the title; a path must exist.
 */

const EvidenceSchema = z.union([
  z.string().min(1),
  z.object({ test: z.string().min(1) }).loose(),
  z.object({ screenshot: z.string().min(1) }).loose(),
  z.object({ path: z.string().min(1) }).loose(),
]);

const EntrySchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/, 'ids look like FLY-001 or CFG-PROFILE-002'),
    title: z.string().min(1),
    job: z.enum(['fly', 'configure', 'troubleshoot', 'platform']),
    done_means: z.array(z.string().min(1)).min(1),
    status: z.enum(['todo', 'in_progress', 'done']),
    evidence: z.array(EvidenceSchema).default([]),
  })
  .loose();

const LedgerSchema = z.object({ requirements: z.array(z.unknown()) }).loose();

export interface LedgerReport {
  found: boolean;
  total: number;
  counts: { todo: number; in_progress: number; done: number };
  problems: string[];
}

const TEST_FILE = /\.(test|spec)\.ts$/;

function splitTest(reference: string): { file: string; title?: string } {
  for (const separator of ['#', ' > ', '::']) {
    const index = reference.indexOf(separator);
    if (index > 0)
      return {
        file: reference.slice(0, index).trim(),
        title: reference.slice(index + separator.length).trim(),
      };
  }
  return { file: reference.trim() };
}

/** Returns a problem description, or undefined when the evidence exists. */
function checkEvidence(
  evidence: z.infer<typeof EvidenceSchema>,
  repoRoot: string
): { problem?: string; isTest: boolean } {
  let reference: string;
  let forcedTest = false;
  if (typeof evidence === 'string') reference = evidence;
  else if ('test' in evidence) {
    reference = evidence.test as string;
    forcedTest = true;
  } else if ('screenshot' in evidence) reference = evidence.screenshot as string;
  else reference = evidence.path as string;

  const { file, title } = splitTest(reference);
  const isTest = forcedTest || TEST_FILE.test(file);
  const absolute = path.resolve(repoRoot, file);
  if (!absolute.startsWith(path.resolve(repoRoot)))
    return { problem: `evidence points outside the repository: ${reference}`, isTest };
  if (!existsSync(absolute)) return { problem: `evidence does not exist: ${file}`, isTest };
  if (isTest && title) {
    const text = readFileSync(absolute, 'utf8');
    if (!text.includes(title)) return { problem: `test "${title}" not found in ${file}`, isTest };
  }
  return { isTest };
}

export function validateLedger(ledgerFile: string, repoRoot: string): LedgerReport {
  const report: LedgerReport = {
    found: false,
    total: 0,
    counts: { todo: 0, in_progress: 0, done: 0 },
    problems: [],
  };
  if (!existsSync(ledgerFile)) return report;
  report.found = true;

  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(ledgerFile, 'utf8'));
  } catch (e) {
    report.problems.push(
      `not valid YAML: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
    );
    return report;
  }
  // A bare list of entries is accepted as well as { requirements: [...] }.
  const wrapped = Array.isArray(raw) ? { requirements: raw } : raw;
  const ledger = LedgerSchema.safeParse(wrapped);
  if (!ledger.success) {
    report.problems.push('the file must contain a "requirements" list');
    return report;
  }

  const seen = new Set<string>();
  ledger.data.requirements.forEach((rawEntry, index) => {
    const parsed = EntrySchema.safeParse(rawEntry);
    const label =
      rawEntry &&
      typeof rawEntry === 'object' &&
      typeof (rawEntry as { id?: unknown }).id === 'string'
        ? (rawEntry as { id: string }).id
        : `entry ${index + 1}`;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        report.problems.push(`${label}: ${issue.path.join('.') || 'entry'}: ${issue.message}`);
      }
      return;
    }
    const entry = parsed.data;
    report.total++;
    report.counts[entry.status]++;
    if (seen.has(entry.id)) report.problems.push(`${entry.id}: duplicate id`);
    seen.add(entry.id);

    if (entry.status !== 'done') return;
    if (entry.evidence.length === 0) {
      report.problems.push(`${entry.id}: status is done but there is no evidence`);
      return;
    }
    let tests = 0;
    for (const evidence of entry.evidence) {
      const checked = checkEvidence(evidence, repoRoot);
      if (checked.problem) report.problems.push(`${entry.id}: ${checked.problem}`);
      if (checked.isTest) tests++;
    }
    if (tests === 0)
      report.problems.push(`${entry.id}: done needs at least one automated test as evidence`);
  });
  return report;
}
