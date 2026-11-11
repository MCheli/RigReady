import path from 'node:path';
import { z } from 'zod';
import {
  ASSISTANT_SCRIPTS_STORED,
  assistantScriptsDir,
  approvalState,
  isStoredAssistantScript,
  listApprovals,
  recordApproval,
  sha256,
} from '../../../core/assistantScripts';
import type { Logger } from '../../../core/logger';
import type { Ports } from '../../../core/ports';
import type {
  CheckItem,
  LaunchAction,
  Profile,
  ProfileActions,
} from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import type { Envelope } from '../../../shared/ipc';
import { elevationIn, warningsFor } from './scriptRules';
import {
  ScriptUseSchema,
  type ProposeSetupInput,
  type DraftScriptInput,
  type SetupDraftView,
  type ScriptDraftView,
  type Drafts,
  type SavedScript,
} from './assistantModel';

/**
 * What an assistant proposes and the user decides on: changes to a setup, and scripts. A
 * draft is kept in memory only. Nothing of it reaches a file until the user presses Save
 * in RigReady's window (a channel no assistant is offered), and what is saved is exactly
 * what the window showed.
 */

/** The lines RigReady puts at the top of a script an assistant wrote. */
export function scriptHeader(input: {
  fileName: string;
  by: string;
  at: string;
  explanation: string;
}): string {
  const comment = input.fileName.endsWith('.ps1') ? '#' : '@rem';
  const line = input.explanation.split(/\r?\n/)[0]!;
  // The first sentence, or as much of it as fits, cut between words.
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
  const first =
    sentence.length <= 160 ? sentence : `${sentence.slice(0, 160).replace(/\s+\S*$/, '')}...`;
  return [
    `${comment} Written by an assistant (${input.by}) and saved in RigReady on ${input.at.slice(0, 10)}.`,
    `${comment} RigReady recorded this file's SHA-256 when you approved it, and asks again before it runs if the file changes.`,
    `${comment} It runs as you, never as administrator. What it does: ${first}`,
    '',
  ].join('\r\n');
}

interface SetupDraft {
  id: string;
  by: string;
  at: string;
  input: ProposeSetupInput;
  /** The existing setup it adds to, as it was read, or undefined for a new one. */
  base?: Profile;
}

interface ScriptDraft {
  id: string;
  by: string;
  at: string;
  input: DraftScriptInput;
  text: string;
}

export interface DraftsDeps {
  ports: Ports;
  log: Logger;
  invoke(channel: string, input?: unknown): Promise<Envelope>;
  /** The windows are told a draft came or went. */
  changed(): void;
}

const unwrap = <T>(envelope: Envelope): Result<T> =>
  envelope.ok ? ok(envelope.value as T) : envelope;

interface SetupLine {
  id: string;
  name: string;
}

/** The text a line shows for its params: the program, file or name it is about. */
function detailOf(params: Record<string, unknown>): string {
  for (const key of ['exe', 'path', 'name', 'service', 'device', 'layout']) {
    const value = params[key];
    if (typeof value === 'string' && value) {
      const args = Array.isArray(params['args']) ? (params['args'] as unknown[]).join(' ') : '';
      return args ? `${value} ${args}` : value;
    }
  }
  return JSON.stringify(params).slice(0, 160);
}

/** A script.run step or fix proposed by an assistant always asks first. */
function guarded(type: string, params: Record<string, unknown>): Record<string, unknown> {
  return type === 'script.run' ? { ...params, requiresConfirmation: true } : params;
}

export class AssistantDrafts {
  private readonly setupDrafts = new Map<string, SetupDraft>();
  private readonly scriptDrafts = new Map<string, ScriptDraft>();
  private counter = 0;

  constructor(private readonly deps: DraftsDeps) {}

  private next(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }

  private now(): string {
    return this.deps.ports.clock.now().toISOString();
  }

  private dataRoot(): string {
    return this.deps.ports.folders.dataRoot();
  }

  private async findSetup(asked: string): Promise<Result<SetupLine>> {
    const listed = unwrap<{ profiles: SetupLine[] }>(await this.deps.invoke('fly:state'));
    if (!listed.ok) return listed;
    const wanted = asked.trim().toLowerCase();
    const found = listed.value.profiles.find(
      (p) => p.id === wanted || p.name.trim().toLowerCase() === wanted
    );
    if (!found) {
      return err(
        'ai.setup',
        `There is no setup "${asked}".`,
        `Setups: ${listed.value.profiles.map((p) => `${p.name} (${p.id})`).join(', ') || 'none'}.`
      );
    }
    return ok(found);
  }

  private async knownTypes(): Promise<Result<{ checks: Set<string>; fixes: Set<string> }>> {
    const types = unwrap<{ checks: { type: string }[]; remediations: { type: string }[] }>(
      await this.deps.invoke('profiles:types')
    );
    if (!types.ok) return types;
    return ok({
      checks: new Set(types.value.checks.map((c) => c.type)),
      fixes: new Set(types.value.remediations.map((r) => r.type)),
    });
  }

  // -------------------------------------------------------------------------
  // Setup proposals
  // -------------------------------------------------------------------------

  async proposeSetup(
    by: string,
    input: ProposeSetupInput
  ): Promise<Result<{ draftId: string; message: string }>> {
    if (!input.setup && !input.newSetup) {
      return err('ai.input', 'Name an existing setup, or give newSetup for a new one.');
    }
    if (input.addChecks.length === 0 && input.addSteps.length === 0 && input.setup) {
      return err('ai.input', 'The proposal adds nothing: give addChecks or addSteps.');
    }
    const types = await this.knownTypes();
    if (!types.ok) return types;
    for (const check of input.addChecks) {
      if (!types.value.checks.has(check.type)) {
        return err('ai.type', `There is no check type "${check.type}". Read profiles:types.`);
      }
      if (check.remediation && !types.value.fixes.has(check.remediation.type)) {
        return err(
          'ai.type',
          `There is no fix type "${check.remediation.type}". Read profiles:types.`
        );
      }
    }
    for (const step of input.addSteps) {
      if (!types.value.fixes.has(step.type)) {
        return err('ai.type', `There is no step type "${step.type}". Read profiles:types.`);
      }
    }
    let base: Profile | undefined;
    if (input.setup) {
      const line = await this.findSetup(input.setup);
      if (!line.ok) return line;
      const profile = unwrap<Profile>(
        await this.deps.invoke('profiles:get', { id: line.value.id })
      );
      if (!profile.ok) return profile;
      base = profile.value;
    }
    const id = this.next('p');
    this.setupDrafts.set(id, { id, by, at: this.now(), input, ...(base ? { base } : {}) });
    this.deps.changed();
    const target = base ? `the setup ${base.name}` : `a new setup "${input.newSetup!.name}"`;
    return ok({
      draftId: id,
      message: `The proposal for ${target} is shown in RigReady. Nothing is saved until the user presses Save there.`,
    });
  }

  /** The checks and steps of a proposal, with ids that do not clash with the setup's own. */
  private merged(draft: SetupDraft): { checks: CheckItem[]; actions: ProfileActions } {
    const taken = new Set([
      ...(draft.base?.checks ?? []).map((c) => c.id),
      ...['preLaunch', 'postLaunch', 'standDown'].flatMap(
        (phase) =>
          (draft.base?.actions?.[phase as 'preLaunch'] ?? []).map((a: LaunchAction) => a.id) ?? []
      ),
    ]);
    let n = 0;
    const fresh = (prefix: string): string => {
      do n += 1;
      while (taken.has(`${prefix}${n}`));
      taken.add(`${prefix}${n}`);
      return `${prefix}${n}`;
    };
    const checks: CheckItem[] = [
      ...(draft.base?.checks ?? []),
      ...draft.input.addChecks.map((c) => ({
        id: fresh('ai'),
        type: c.type,
        title: c.title,
        required: c.required,
        params: c.params,
        ...(c.remediation
          ? {
              remediation: {
                type: c.remediation.type,
                params: guarded(c.remediation.type, c.remediation.params),
              },
            }
          : {}),
      })),
    ];
    const actions = {
      preLaunch: [...(draft.base?.actions?.preLaunch ?? [])],
      postLaunch: [...(draft.base?.actions?.postLaunch ?? [])],
      standDown: [...(draft.base?.actions?.standDown ?? [])],
    };
    for (const step of draft.input.addSteps) {
      actions[step.phase].push({
        id: fresh('ais'),
        title: step.title,
        type: step.type,
        params: guarded(step.type, step.params),
        continueOnError: step.continueOnError,
        delaySeconds: step.delaySeconds,
      });
    }
    return { checks, actions };
  }

  private setupView(draft: SetupDraft): SetupDraftView {
    const { checks, actions } = this.merged(draft);
    const added = new Set(checks.slice(draft.base?.checks.length ?? 0).map((c) => c.id));
    const exact = draft.base
      ? { ...draft.base, checks, actions }
      : {
          name: draft.input.newSetup!.name,
          ...(draft.input.newSetup!.game ? { game: draft.input.newSetup!.game } : {}),
          checks: checks.map(({ id: _id, ...c }) => c),
          actions,
        };
    return {
      id: draft.id,
      by: draft.by,
      at: draft.at,
      summary: draft.input.summary,
      target: draft.base
        ? { kind: 'existing', id: draft.base.id, name: draft.base.name }
        : {
            kind: 'new',
            name: draft.input.newSetup!.name,
            ...(draft.input.newSetup!.game ? { game: draft.input.newSetup!.game } : {}),
          },
      checks: checks
        .filter((c) => added.has(c.id))
        .map((c) => ({
          title: c.title,
          type: c.type,
          detail: detailOf(c.params),
          required: c.required,
          ...(c.remediation
            ? { fix: `${c.remediation.type}: ${detailOf(c.remediation.params)}` }
            : {}),
        })),
      steps: (['preLaunch', 'postLaunch', 'standDown'] as const).flatMap((phase) =>
        actions[phase]
          .filter((a) => a.id.startsWith('ais'))
          .map((a) => ({ phase, title: a.title, type: a.type, detail: detailOf(a.params) }))
      ),
      exact: JSON.stringify(exact, null, 2),
    };
  }

  /** The user pressed Save: the setup is written through its own channel, as the editor does. */
  async saveSetup(
    draftId: string
  ): Promise<Result<{ setupId: string; name: string; message: string }>> {
    const draft = this.setupDrafts.get(draftId);
    if (!draft) return err('ai.draft', 'That proposal is gone. Ask the assistant again.');
    const { checks, actions } = this.merged(draft);
    let saved: Result<Profile>;
    if (draft.base) {
      const current = unwrap<Profile>(
        await this.deps.invoke('profiles:get', { id: draft.base.id })
      );
      if (!current.ok) return current;
      if (current.value.updatedAt !== draft.base.updatedAt) {
        return err(
          'ai.stale',
          `${draft.base.name} was changed after the assistant read it, so this proposal was not saved. Ask the assistant again.`
        );
      }
      saved = unwrap<Profile>(
        await this.deps.invoke('profiles:save', { ...draft.base, checks, actions })
      );
    } else {
      const setup = draft.input.newSetup!;
      saved = unwrap<Profile>(
        await this.deps.invoke('profiles:create', {
          name: setup.name,
          ...(setup.game ? { game: setup.game } : {}),
          checks: checks.map(({ id: _id, ...c }) => c),
          actions,
        })
      );
    }
    if (!saved.ok) return saved;
    this.setupDrafts.delete(draftId);
    this.deps.changed();
    return ok({
      setupId: saved.value.id,
      name: saved.value.name,
      message: `Saved ${saved.value.name}.`,
    });
  }

  // -------------------------------------------------------------------------
  // Scripts
  // -------------------------------------------------------------------------

  private scriptPath(fileName: string): string {
    return path.join(assistantScriptsDir(this.dataRoot()), fileName);
  }

  async draftScript(
    by: string,
    input: DraftScriptInput
  ): Promise<Result<{ draftId: string; message: string }>> {
    const elevation = elevationIn(input.content);
    if (elevation) {
      return err(
        'ai.elevation',
        `The script asks for administrator rights (${elevation}). RigReady runs scripts as the user only; write it without that.`
      );
    }
    if (input.use) {
      const setup = await this.findSetup(input.use.setup);
      if (!setup.ok) return setup;
      if (input.use.as === 'fix' && !input.use.forCheck) {
        return err('ai.input', 'A fix needs forCheck: the check it fixes, by id or title.');
      }
    }
    const at = this.now();
    const text =
      scriptHeader({ fileName: input.fileName, by, at, explanation: input.explanation }) +
      input.content.replace(/\r?\n/g, '\r\n');
    const id = this.next('s');
    this.scriptDrafts.set(id, { id, by, at, input, text });
    this.deps.changed();
    return ok({
      draftId: id,
      message: `The script ${input.fileName} and your explanation are shown in RigReady. It is saved only when the user presses Save there, and it never runs without the user being asked.`,
    });
  }

  private async scriptView(draft: ScriptDraft): Promise<ScriptDraftView> {
    return {
      id: draft.id,
      by: draft.by,
      at: draft.at,
      fileName: draft.input.fileName,
      stored: `${ASSISTANT_SCRIPTS_STORED}${draft.input.fileName}`,
      text: draft.text,
      explanation: draft.input.explanation,
      warnings: warningsFor(draft.input.content),
      replaces: await this.deps.ports.files.exists(this.scriptPath(draft.input.fileName)),
      ...(draft.input.use ? { use: draft.input.use } : {}),
    };
  }

  /**
   * The user pressed Save on a script: the text they saw is written into the data folder,
   * read back, hashed and the hash recorded as their approval; then, when the draft says
   * where it goes, the setup gets the step (asking before every run).
   */
  async saveScript(
    draftId: string
  ): Promise<
    Result<{ file: string; stored: string; sha256: string; message: string; setupId?: string }>
  > {
    const draft = this.scriptDrafts.get(draftId);
    if (!draft) return err('ai.draft', 'That script is gone. Ask the assistant again.');
    const file = this.scriptPath(draft.input.fileName);
    const stored = `${ASSISTANT_SCRIPTS_STORED}${draft.input.fileName}`;
    const dir = assistantScriptsDir(this.dataRoot());
    const made = await this.deps.ports.files.mkdir(dir);
    if (!made.ok) return made;
    const written = await this.deps.ports.files.write(file, draft.text, {
      reason: `Saved the script ${draft.input.fileName} an assistant wrote`,
    });
    if (!written.ok) return written;
    const back = await this.deps.ports.files.readBytes(file);
    if (!back.ok) return back;
    const hash = sha256(back.value);
    if (hash !== sha256(draft.text)) {
      return err(
        'ai.writeBack',
        `${draft.input.fileName} did not read back as written, so it was not approved.`
      );
    }
    const approved = await recordApproval(this.deps.ports.files, this.dataRoot(), {
      file: draft.input.fileName,
      sha256: hash,
      approvedAt: this.now(),
      draftedBy: draft.by,
      explanation: draft.input.explanation,
    });
    if (!approved.ok) return approved;
    let setupId: string | undefined;
    let placed = '';
    if (draft.input.use) {
      const added = await this.placeScript(draft.input.use, stored);
      if (!added.ok) {
        this.scriptDrafts.delete(draftId);
        this.deps.changed();
        return err(
          added.error.code,
          `Saved ${draft.input.fileName}, but it could not be added to the setup: ${added.error.message}`,
          added.error.detail
        );
      }
      setupId = added.value.id;
      placed = ` and added it to ${added.value.name}, asking before every run`;
    }
    this.scriptDrafts.delete(draftId);
    this.deps.changed();
    return ok({
      file: draft.input.fileName,
      stored,
      sha256: hash,
      message: `Saved ${draft.input.fileName}${placed}.`,
      ...(setupId ? { setupId } : {}),
    });
  }

  private async placeScript(
    use: z.infer<typeof ScriptUseSchema>,
    stored: string
  ): Promise<Result<Profile>> {
    const line = await this.findSetup(use.setup);
    if (!line.ok) return line;
    const profile = unwrap<Profile>(await this.deps.invoke('profiles:get', { id: line.value.id }));
    if (!profile.ok) return profile;
    const p = structuredClone(profile.value);
    const run = {
      exe: stored,
      args: use.args,
      requiresConfirmation: true,
      ...(use.timeoutSeconds ? { timeoutSeconds: use.timeoutSeconds } : {}),
    };
    const ids = new Set(p.checks.map((c) => c.id));
    let n = 0;
    const fresh = (): string => {
      do n += 1;
      while (ids.has(`ai${n}`));
      return `ai${n}`;
    };
    if (use.as === 'check') {
      p.checks.push({
        id: fresh(),
        type: 'script.check',
        title: use.title,
        required: true,
        params: {
          exe: stored,
          args: use.args,
          ...(use.timeoutSeconds ? { timeoutSeconds: use.timeoutSeconds } : {}),
        },
      });
    } else if (use.as === 'fix') {
      const wanted = use.forCheck!.trim().toLowerCase();
      const check = p.checks.find(
        (c) => c.id.toLowerCase() === wanted || c.title.trim().toLowerCase() === wanted
      );
      if (!check) return err('ai.item', `${p.name} has no check "${use.forCheck}".`);
      check.remediation = { type: 'script.run', params: run };
    } else {
      const actions = {
        preLaunch: [...(p.actions?.preLaunch ?? [])],
        postLaunch: [...(p.actions?.postLaunch ?? [])],
        standDown: [...(p.actions?.standDown ?? [])],
      };
      const taken = new Set(
        Object.values(actions)
          .flat()
          .map((a) => a.id)
      );
      let k = 0;
      do k += 1;
      while (taken.has(`ais${k}`));
      actions[use.as].push({
        id: `ais${k}`,
        title: use.title,
        type: 'script.run',
        params: run,
        continueOnError: true,
        delaySeconds: 0,
      });
      p.actions = actions;
    }
    return unwrap<Profile>(await this.deps.invoke('profiles:save', p));
  }

  /** The scripts in the folder, each with how it stands against its approval. */
  async scripts(): Promise<Result<SavedScript[]>> {
    const dir = assistantScriptsDir(this.dataRoot());
    const entries = await this.deps.ports.files.listEntries(dir);
    if (!entries.ok) return entries;
    const approvals = await listApprovals(this.deps.ports.files, this.dataRoot());
    if (!approvals.ok) return approvals;
    const out: SavedScript[] = [];
    for (const entry of entries.value) {
      if (entry.isDirectory || !/\.(ps1|cmd)$/i.test(entry.name)) continue;
      const state = await approvalState(this.deps.ports.files, this.dataRoot(), entry.path);
      if (!state.ok) continue;
      const text = await this.deps.ports.files.readText(entry.path);
      const approval = approvals.value.find(
        (a) => a.file.toLowerCase() === entry.name.toLowerCase()
      );
      out.push({
        file: entry.name,
        stored: `${ASSISTANT_SCRIPTS_STORED}${entry.name}`,
        state: state.value.state,
        text: text.ok ? text.value.slice(0, 40_000) : '',
        sha256: state.value.state === 'approved' ? state.value.approval.sha256 : state.value.sha256,
        ...(approval
          ? {
              approvedAt: approval.approvedAt,
              draftedBy: approval.draftedBy,
              explanation: approval.explanation,
            }
          : {}),
      });
    }
    return ok(out.sort((a, b) => a.file.localeCompare(b.file)));
  }

  /**
   * The user looked at a script that changed and approves it as it is now. `sha256` is the
   * hash the window showed: if the file changed again since, nothing is approved.
   */
  async approveScript(fileName: string, shown: string): Promise<Result<SavedScript>> {
    if (!/^[a-z0-9][a-z0-9-]{0,47}\.(ps1|cmd)$/i.test(fileName)) {
      return err('ai.input', 'Not a script of the assistant.');
    }
    const file = this.scriptPath(fileName);
    if (!isStoredAssistantScript(`${ASSISTANT_SCRIPTS_STORED}${fileName}`)) {
      return err('ai.input', 'Not a script of the assistant.');
    }
    const state = await approvalState(this.deps.ports.files, this.dataRoot(), file);
    if (!state.ok) return state;
    const now = state.value.state === 'approved' ? state.value.approval.sha256 : state.value.sha256;
    if (now !== shown) {
      return err(
        'script.changed',
        `${fileName} changed again while you were looking at it. Look at it once more.`
      );
    }
    const previous = state.value.state === 'unapproved' ? undefined : state.value.approval;
    const approved = await recordApproval(this.deps.ports.files, this.dataRoot(), {
      file: fileName,
      sha256: now,
      approvedAt: this.now(),
      draftedBy: previous?.draftedBy ?? 'unknown',
      explanation: previous?.explanation ?? '',
    });
    if (!approved.ok) return approved;
    this.deps.changed();
    const listed = await this.scripts();
    if (!listed.ok) return listed;
    const found = listed.value.find((s) => s.file === fileName);
    return found && found.state === 'approved'
      ? ok(found)
      : err('script.changed', `${fileName} could not be approved.`);
  }

  async drafts(): Promise<Result<Drafts>> {
    return ok({
      setups: [...this.setupDrafts.values()].map((d) => this.setupView(d)),
      scripts: await Promise.all([...this.scriptDrafts.values()].map((d) => this.scriptView(d))),
    });
  }

  discard(id: string): boolean {
    const removed = this.setupDrafts.delete(id) || this.scriptDrafts.delete(id);
    if (removed) this.deps.changed();
    return removed;
  }
}
