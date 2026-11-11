import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { FileStore } from './ports';
import { err, ok, type Result } from './result';

/**
 * Scripts the built-in assistant (or an assistant over MCP) drafted and the user saved.
 * They live in one folder inside RigReady's data folder, and each carries an approval: the
 * SHA-256 of the file as the user saw it when they pressed Save. Before such a script runs,
 * as a check, a fix or a launch step, the file is hashed again; a file that changed since
 * is not run until the user has looked at it and approved it again.
 *
 * And an assistant never runs one itself: while a call of an assistant is being carried
 * out (`runAsAssistant`), a script from this folder is refused, so the only way it runs is
 * from RigReady's own window, where "Run this program?" is asked first.
 */

/** Below the data root. */
export const ASSISTANT_SCRIPTS_DIR = path.join('scripts', 'assistant');
/** How a setup names the folder: with the path variable of the data root. */
export const ASSISTANT_SCRIPTS_STORED = '{RIGREADY_HOME}/scripts/assistant/';
export const APPROVALS_FILE = 'approvals.json';

export const ScriptApprovalSchema = z.object({
  /** The file name inside the folder: "srs-check.ps1". */
  file: z.string().min(1).max(80),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  approvedAt: z.string(),
  /** Who drafted it: "Built-in assistant", or an MCP pairing's name. */
  draftedBy: z.string().max(80),
  /** The plain-language explanation the user read before saving. */
  explanation: z.string().max(4000),
});
export type ScriptApproval = z.infer<typeof ScriptApprovalSchema>;

export const ApprovalsFileSchema = z.object({
  scripts: z.array(ScriptApprovalSchema).default([]),
});

export const assistantScriptsDir = (dataRoot: string): string =>
  path.join(dataRoot, ASSISTANT_SCRIPTS_DIR);

/** Is this resolved path a file in the assistant's scripts folder? */
export function isAssistantScript(resolved: string, dataRoot: string): boolean {
  const dir = path.resolve(assistantScriptsDir(dataRoot)).toLowerCase();
  const file = path.resolve(resolved).toLowerCase();
  return file.startsWith(dir + path.sep) && path.dirname(file) === dir;
}

/** Does a stored path (as a setup has it) name a file in the assistant's scripts folder? */
export function isStoredAssistantScript(stored: string): boolean {
  return stored
    .replace(/\\/g, '/')
    .toLowerCase()
    .startsWith(ASSISTANT_SCRIPTS_STORED.toLowerCase());
}

export function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Every approval, as recorded. */
export async function listApprovals(
  files: FileStore,
  dataRoot: string
): Promise<Result<ScriptApproval[]>> {
  const file = path.join(assistantScriptsDir(dataRoot), APPROVALS_FILE);
  if (!(await files.exists(file))) return ok([]);
  const text = await files.readText(file);
  if (!text.ok) return text;
  let raw: unknown;
  try {
    raw = JSON.parse(text.value);
  } catch {
    return err('script.approvals', 'The list of approved assistant scripts cannot be read.');
  }
  const parsed = ApprovalsFileSchema.safeParse(raw);
  if (!parsed.success) {
    return err('script.approvals', 'The list of approved assistant scripts cannot be read.');
  }
  return ok(parsed.data.scripts);
}

/** Records (or replaces) the approval of one file, with the hash of the content given. */
export async function recordApproval(
  files: FileStore,
  dataRoot: string,
  approval: ScriptApproval
): Promise<Result<ScriptApproval>> {
  const current = await listApprovals(files, dataRoot);
  if (!current.ok) return current;
  const scripts = [
    ...current.value.filter((s) => s.file.toLowerCase() !== approval.file.toLowerCase()),
    approval,
  ];
  const written = await files.write(
    path.join(assistantScriptsDir(dataRoot), APPROVALS_FILE),
    JSON.stringify({ scripts }, null, 2),
    { reason: `Approved the assistant's script ${approval.file}` }
  );
  return written.ok ? ok(approval) : written;
}

export type ApprovalState =
  | { state: 'approved'; approval: ScriptApproval }
  | { state: 'changed'; approval: ScriptApproval; sha256: string }
  | { state: 'unapproved'; sha256: string };

/** How a file of the folder stands against its approval, hashed now. */
export async function approvalState(
  files: FileStore,
  dataRoot: string,
  resolved: string
): Promise<Result<ApprovalState>> {
  const bytes = await files.readBytes(resolved);
  if (!bytes.ok) return bytes;
  const hash = sha256(bytes.value);
  const approvals = await listApprovals(files, dataRoot);
  if (!approvals.ok) return approvals;
  const name = path.basename(resolved).toLowerCase();
  const approval = approvals.value.find((a) => a.file.toLowerCase() === name);
  if (!approval) return ok({ state: 'unapproved', sha256: hash });
  if (approval.sha256 !== hash) return ok({ state: 'changed', approval, sha256: hash });
  return ok({ state: 'approved', approval });
}

/**
 * Whether a script may run now: an assistant script must match its approval, and no
 * assistant may be the one running it. Any other script is not this module's business.
 */
export async function mayRunScript(
  files: FileStore,
  dataRoot: string,
  resolved: string
): Promise<Result<void>> {
  if (!isAssistantScript(resolved, dataRoot)) return ok(undefined);
  const name = path.basename(resolved);
  const acting = actingAssistant();
  if (acting !== undefined) {
    return err(
      'script.assistant',
      `${name} was written by an assistant, so ${acting} cannot run it. Run it from RigReady's window, where it asks you first.`
    );
  }
  const state = await approvalState(files, dataRoot, resolved);
  if (!state.ok) return state;
  if (state.value.state === 'approved') return ok(undefined);
  return err(
    'script.changed',
    state.value.state === 'changed'
      ? `${name} has changed since you approved it, so it was not run. Open the assistant, look at the script again and approve it.`
      : `${name} has not been approved, so it was not run. Open the assistant, look at the script and approve it.`
  );
}

const acting = new AsyncLocalStorage<string>();

/** Runs work on behalf of an assistant: whatever it calls knows who asked. */
export function runAsAssistant<T>(name: string, work: () => Promise<T>): Promise<T> {
  return acting.run(name, work);
}

/** The assistant whose call is being carried out, if any. */
export function actingAssistant(): string | undefined {
  return acting.getStore();
}
