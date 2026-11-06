// The description of a GitHub release: the version's own section of CHANGELOG.md.
//
//   node scripts/release-notes.mjs <version or tag> <out-file> [changelog-file]
//
// The Release workflow runs it for the tag it was given, so a release's notes are what the
// changelog says about the version, not GitHub's list of merged pull requests (for 2.0.0 that
// list would be five unrelated pull requests, the rebuild having been committed directly).
// It fails when the section is missing, empty, or its heading still says "(not released)":
// the changelog is dated in the same change as the version bump, and a tag on an undated
// changelog is a mistake that should stop the release before its forty minutes of tests.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The body of the "## <version> ..." section of a changelog (the heading's own line left
 * out), or an error that says why there is nothing to publish.
 */
export function releaseNotes(changelog, version) {
  const wanted = String(version).trim().replace(/^v/, '');
  const lines = String(changelog).split(/\r?\n/);
  // Headings inside a fenced code block are text, not sections.
  const headings = new Map();
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && /^##\s+(.*)$/.exec(line);
    if (m) headings.set(i, m[1].trim());
  });
  const start = [...headings].find(
    ([, title]) => title === wanted || title.startsWith(`${wanted} `)
  )?.[0];
  if (start === undefined) throw new Error(`CHANGELOG.md has no "## ${wanted}" section`);
  if (/not released/i.test(headings.get(start))) {
    throw new Error(
      `CHANGELOG.md still says "## ${headings.get(start)}": date the heading before tagging`
    );
  }
  const end = [...headings.keys()].find((i) => i > start) ?? lines.length;
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
  if (!body) throw new Error(`the "## ${wanted}" section of CHANGELOG.md is empty`);
  return `${body}\n`;
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [version, outFile, changelogFile] = process.argv.slice(2);
  if (!version || !outFile) {
    console.error('usage: node scripts/release-notes.mjs <version or tag> <out-file> [changelog]');
    process.exit(2);
  }
  const changelog = changelogFile
    ? path.resolve(changelogFile)
    : path.join(path.resolve(import.meta.dirname, '..'), 'CHANGELOG.md');
  try {
    const notes = releaseNotes(readFileSync(changelog, 'utf8'), version);
    mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    writeFileSync(path.resolve(outFile), notes);
    console.log(
      `release notes for ${version.replace(/^v/, '')}: ${notes.split('\n').length - 1} lines -> ${outFile}`
    );
  } catch (e) {
    console.error(`release notes: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
