import path from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { BindingProposal, BindingReader, BindingRegistry } from '../../../core/bindings';
import { JsonStore } from '../../../core/jsonStore';
import type { Logger } from '../../../core/logger';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { AI_KEY_SECRET } from '../../../core/settings';
import {
  approximateTokens,
  DEFAULT_MODEL,
  messageBody,
  modelInfo,
  MODELS,
  sendMessage,
  testKey,
  type MessageAnswer,
} from './anthropic';
import { draftSchema, draftTask, validateDraft } from './draft';
import { describeInput, fits, hasInput } from './inputs';
import {
  matchActions,
  parsePack,
  PLACE_TITLES,
  resolvePack,
  ROLE_TITLES,
  ROLES,
  TIER_TITLES,
  TIERS,
  type Pack,
} from './pack';
import {
  ProgressSchema,
  type AiStatus,
  type AircraftList,
  type AppliedView,
  type GuideView,
  type PlanView,
  type Prepared,
  type Progress,
  type RequestKind,
  type Sent,
  type Staged,
  type StagedView,
  type UsageView,
} from './model';
import { shippedPack } from './shipped';
import { contextText, takeSnapshot, type Snapshot } from './snapshot';
import {
  cleanAnswer,
  markConflicts,
  MAX_QUESTION,
  questionTask,
  suggestionSchema,
  suggestionTask,
  SYSTEM_PROMPT,
  validatePlan,
  type SuggestionPlan,
} from './suggest';

export interface AiAssistContext {
  ports: Ports;
  log: Logger;
  bindings: BindingRegistry;
}

const GAME = 'dcs';

const SettingsSchema = z.object({ model: z.string().default(DEFAULT_MODEL) });
const ProgressFileSchema = z.object({ aircraft: z.record(z.string(), ProgressSchema).default({}) });

/** What is and is not sent to Anthropic, shown in Settings and before every request. */
export const WHAT_IS_SENT = [
  "Sent: the aircraft's name, and DCS's list of its actions (ids, names, categories) with what each is bound to now.",
  'Sent: for each controller used in DCS, its DirectInput product name (such as "WINWING MFD1-C"), what it is used as, how many buttons and hats it has, and the names of its axes.',
  "Sent: RigReady's guide for the aircraft when there is one, and your question.",
  'Never sent: file paths, device ids (GUIDs), serial numbers, the names you gave your devices, your Windows user or PC name, or the contents of your files.',
  'The key goes only to api.anthropic.com, in a request header. It is stored encrypted for your Windows account and never written to settings, logs, backups, shared setups or screenshots.',
  "Anthropic's API terms and privacy policy apply to what is sent.",
];

const MAX_TOKENS: Record<RequestKind, number> = {
  suggest: 16000,
  draft: 16000,
  ask: 8000,
  explain: 8000,
};

interface PreparedRequest {
  kind: RequestKind;
  aircraftId: string;
  model: string;
  body: Record<string, unknown>;
  snapshot: Snapshot;
  question: string;
}

interface Round {
  aircraftId: string;
  plan: SuggestionPlan;
}

const safeName = (id: string): string => id.replace(/[^A-Za-z0-9_.-]/g, '_');

export class AiAssist {
  private readonly settings: JsonStore<typeof SettingsSchema>;
  private readonly progressStore: JsonStore<typeof ProgressFileSchema>;
  private readonly prepared = new Map<string, PreparedRequest>();
  private readonly rounds = new Map<string, Round>();
  private sequence = 0;

  constructor(private readonly ctx: AiAssistContext) {
    const root = path.join(ctx.ports.folders.dataRoot(), 'ai-assist');
    this.settings = new JsonStore(
      ctx.ports.files,
      path.join(root, 'settings.json'),
      SettingsSchema
    );
    this.progressStore = new JsonStore(
      ctx.ports.files,
      path.join(root, 'progress.json'),
      ProgressFileSchema
    );
  }

  private next(prefix: string): string {
    this.sequence += 1;
    return `${prefix}${this.sequence}`;
  }

  private reader(): Result<BindingReader> {
    const reader = this.ctx.bindings.get(GAME);
    return reader ? ok(reader) : err('ai.noBindings', 'No DCS bindings feature is available.');
  }

  private draftPath(aircraftId: string): string {
    return path.join(
      this.ctx.ports.folders.dataRoot(),
      'ai-assist',
      'guides',
      `${safeName(aircraftId)}.yaml`
    );
  }

  /** The shipped guide, or one drafted earlier, for an aircraft. */
  async guideFor(
    aircraftId: string
  ): Promise<{ pack: Pack; kind: 'shipped' | 'drafted' } | undefined> {
    const pack = shippedPack(aircraftId);
    if (pack) return { pack, kind: 'shipped' };
    const file = this.draftPath(aircraftId);
    if (!(await this.ctx.ports.files.exists(file))) return undefined;
    const text = await this.ctx.ports.files.readText(file);
    if (!text.ok) return undefined;
    const parsed = parsePack(text.value, path.basename(file));
    if (!parsed.ok) {
      this.ctx.log.warn(`ai-assist: ${parsed.error.message}`);
      return undefined;
    }
    return { pack: parsed.value, kind: 'drafted' };
  }

  async aircraft(): Promise<Result<AircraftList>> {
    const reader = this.ctx.bindings.get(GAME);
    if (!reader || !(await reader.available())) {
      return ok({ available: false, gameName: reader?.gameName ?? 'DCS World', aircraft: [] });
    }
    const list = await reader.aircraft();
    if (!list.ok) return list;
    const aircraft = await Promise.all(
      list.value.map(async (a) => ({ ...a, guide: (await this.guideFor(a.id))?.kind ?? null }))
    );
    // Aircraft with a guide first, then the ones with bindings of the user's own.
    aircraft.sort(
      (a, b) =>
        Number(b.guide !== null) - Number(a.guide !== null) ||
        Number(b.hasUserBindings) - Number(a.hasUserBindings)
    );
    return ok({ available: true, gameName: reader.gameName, aircraft });
  }

  private async snapshot(aircraftId: string): Promise<Result<Snapshot>> {
    const reader = this.reader();
    if (!reader.ok) return reader;
    return takeSnapshot(reader.value, aircraftId, (await this.guideFor(aircraftId))?.pack);
  }

  // -------------------------------------------------------------------------
  // The guide and the walkthrough (no key needed)
  // -------------------------------------------------------------------------

  private async progressOf(aircraftId: string): Promise<Result<Progress>> {
    const file = await this.progressStore.read();
    if (!file.ok) return file;
    return ok(file.value.aircraft[aircraftId] ?? ProgressSchema.parse({}));
  }

  private async saveProgress(
    aircraftId: string,
    change: (p: Progress) => Progress
  ): Promise<Result<Progress>> {
    let saved: Progress | undefined;
    const written = await this.progressStore.update((file) => {
      saved = change(file.aircraft[aircraftId] ?? ProgressSchema.parse({}));
      return { aircraft: { ...file.aircraft, [aircraftId]: saved } };
    });
    return written.ok ? ok(saved!) : written;
  }

  private stagedView(staged: Staged[], snapshot: Snapshot): StagedView[] {
    const views = staged.map((s) => ({
      ...s,
      replaces: [] as string[],
      clashesWith: [] as string[],
      already: false,
      selected: true,
    }));
    markConflicts(views, snapshot);
    return views.map(({ selected: _selected, ...view }) => view);
  }

  async guide(aircraftId: string): Promise<Result<GuideView>> {
    const snapshot = await this.snapshot(aircraftId);
    if (!snapshot.ok) return snapshot;
    const found = await this.guideFor(aircraftId);
    const progress = await this.progressOf(aircraftId);
    if (!progress.ok) return progress;
    const s = snapshot.value;
    const items = found ? resolvePack(found.pack, s.actions, s.bindings) : [];
    const { staged, ...rest } = progress.value;
    return ok({
      aircraftId,
      aircraftName: s.aircraftName,
      guide: found
        ? {
            kind: found.kind,
            summary: found.pack.summary,
            sources: found.pack.sources,
            ...(found.pack.drafted ? { drafted: found.pack.drafted } : {}),
            roles: ROLES.flatMap((role) => {
              const plan = found.pack.roles[role];
              return plan
                ? [{ role, title: ROLE_TITLES[role], summary: plan.summary, items: plan.items }]
                : [];
            }),
          }
        : null,
      tiers: TIERS.map((tier) => ({
        tier,
        title: TIER_TITLES[tier],
        items: items
          .filter((r) => r.item.tier === tier)
          .map((r) => ({
            id: r.item.id,
            title: r.item.title,
            tier: r.item.tier,
            place: r.item.place,
            placeTitle: PLACE_TITLES[r.item.place],
            role: r.item.role,
            roleTitle: ROLE_TITLES[r.item.role],
            need: r.item.need,
            what: r.item.what,
            when: r.item.when,
            ...(r.item.note ? { note: r.item.note } : {}),
            status: r.status,
            actions: r.actions.map((a) => ({
              actionId: a.actionId,
              label: a.label,
              dcsName: a.dcsName,
              kind: a.kind,
              editable: a.editable,
              bound: a.bound.map((b) => ({
                text: `${b.device} · ${[...b.modifiers, b.inputLabel].join(' + ')}`,
                keyboard: b.keyboard,
                ignored: b.ignored === true,
                source: b.source,
              })),
            })),
          })),
      })),
      progress: rest,
      staged: this.stagedView(staged, s),
      controllers: s.controllers.map((c) => ({
        name: c.givenName ?? c.name,
        role: c.role,
        guid: c.guid,
      })),
    });
  }

  async setProgress(
    aircraftId: string,
    itemId: string,
    state: 'done' | 'skipped' | 'open',
    current?: string
  ): Promise<Result<Progress>> {
    return this.saveProgress(aircraftId, (p) => {
      const done = p.done.filter((id) => id !== itemId);
      const skipped = p.skipped.filter((id) => id !== itemId);
      if (state === 'done') done.push(itemId);
      if (state === 'skipped') skipped.push(itemId);
      return { ...p, done, skipped, ...(current ? { current } : {}) };
    });
  }

  async setCurrent(aircraftId: string, itemId: string): Promise<Result<Progress>> {
    return this.saveProgress(aircraftId, (p) => ({ ...p, current: itemId }));
  }

  async resetProgress(aircraftId: string): Promise<Result<Progress>> {
    return this.saveProgress(aircraftId, (p) => ({ done: [], skipped: [], staged: p.staged }));
  }

  /** Stages "bind this action to the control just pressed". Nothing is written. */
  async stage(
    aircraftId: string,
    change: { actionId: string; deviceGuid: string; input: string }
  ): Promise<Result<GuideView>> {
    const snapshot = await this.snapshot(aircraftId);
    if (!snapshot.ok) return snapshot;
    const s = snapshot.value;
    const action = s.actions.find((a) => a.id === change.actionId);
    if (!action) return err('ai.action', `${s.aircraftName} has no such action.`);
    if (!action.editable) {
      return err(
        'ai.notWritable',
        `RigReady cannot write "${action.name}" yet. Bind it once in DCS's own controls screen.`
      );
    }
    const controller = s.controllers.find((c) => c.guid === change.deviceGuid.toUpperCase());
    if (!controller) {
      return err(
        'ai.device',
        'That controller is not one DCS uses for this aircraft (or it is marked "not used in DCS").'
      );
    }
    const info = describeInput(change.input);
    if (!info || !hasInput(controller.controls, change.input)) {
      return err('ai.input', `${controller.name} has no such control.`);
    }
    if (!fits(action.kind, change.input)) {
      return err(
        'ai.kind',
        action.kind === 'axis'
          ? `"${action.name}" needs an axis: move a lever, slider or stick instead.`
          : `"${action.name}" needs a button or hat, not an axis.`
      );
    }
    const found = await this.guideFor(aircraftId);
    const label = found
      ? found.pack.items
          .flatMap((item) => matchActions(item, s.actions))
          .find((m) => m.action.id === action.id)?.label
      : undefined;
    const staged: Staged = {
      id: this.next('g'),
      actionId: action.id,
      label: label ?? action.name,
      dcsName: action.name,
      deviceGuid: controller.guid,
      deviceName: controller.givenName ?? controller.name,
      input: change.input,
      inputLabel: info.label,
    };
    const saved = await this.saveProgress(aircraftId, (p) => ({
      ...p,
      staged: [...p.staged.filter((x) => x.actionId !== action.id), staged],
    }));
    if (!saved.ok) return saved;
    return this.guide(aircraftId);
  }

  async unstage(aircraftId: string, id?: string): Promise<Result<GuideView>> {
    const saved = await this.saveProgress(aircraftId, (p) => ({
      ...p,
      staged: id ? p.staged.filter((s) => s.id !== id) : [],
    }));
    if (!saved.ok) return saved;
    return this.guide(aircraftId);
  }

  private async proposalFromStaged(aircraftId: string): Promise<Result<BindingProposal>> {
    const progress = await this.progressOf(aircraftId);
    if (!progress.ok) return progress;
    const staged = progress.value.staged;
    if (staged.length === 0) return err('ai.nothing', 'Nothing is staged.');
    const snapshot = await this.snapshot(aircraftId);
    if (!snapshot.ok) return snapshot;
    const views = this.stagedView(staged, snapshot.value);
    const clash = views.find((v) => v.clashesWith.length > 0);
    if (clash) {
      return err(
        'ai.clash',
        `Two staged changes use ${clash.inputLabel} on ${clash.deviceName}. Remove one of them first.`
      );
    }
    return ok({
      aircraftId,
      summary: `Bind ${staged.length} ${staged.length === 1 ? 'action' : 'actions'} from the binding guide (${snapshot.value.aircraftName})`,
      changes: staged.map((s) => ({
        op: 'bind',
        deviceGuid: s.deviceGuid,
        input: s.input,
        actionId: s.actionId,
      })),
    });
  }

  private proposals(): Result<NonNullable<BindingReader['proposals']>> {
    const reader = this.reader();
    if (!reader.ok) return reader;
    const proposals = reader.value.proposals;
    return proposals
      ? ok(proposals)
      : err('ai.unsupported', 'The bindings feature cannot take proposed changes.');
  }

  /** Exactly what the staged changes would write; nothing is written. */
  async reviewStaged(aircraftId: string): Promise<Result<PlanView>> {
    const proposal = await this.proposalFromStaged(aircraftId);
    if (!proposal.ok) return proposal;
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    return proposals.value.plan(proposal.value);
  }

  /** Writes the staged changes through the bindings feature (backup first, one undoable change). */
  async applyStaged(aircraftId: string): Promise<Result<AppliedView>> {
    const proposal = await this.proposalFromStaged(aircraftId);
    if (!proposal.ok) return proposal;
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    const applied = await proposals.value.apply(proposal.value);
    if (!applied.ok) return applied;
    const cleared = await this.saveProgress(aircraftId, (p) => ({ ...p, staged: [] }));
    if (!cleared.ok) return cleared;
    return applied;
  }

  async undo(groupId: string): Promise<Result<{ undone: boolean }>> {
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    const undone = await proposals.value.undo(groupId);
    return undone.ok ? ok({ undone: true }) : undone;
  }

  // -------------------------------------------------------------------------
  // The key and the model
  // -------------------------------------------------------------------------

  private async key(): Promise<Result<string>> {
    const key = await this.ctx.ports.secrets.get(AI_KEY_SECRET);
    if (!key.ok) return key;
    if (!key.value) return err('ai.noKey', 'No Anthropic API key is stored. Add one in Settings.');
    return ok(key.value);
  }

  async status(): Promise<Result<AiStatus>> {
    const settings = await this.settings.read();
    if (!settings.ok) return settings;
    const key = await this.ctx.ports.secrets.get(AI_KEY_SECRET);
    const present = key.ok && key.value !== undefined && key.value !== '';
    return ok({
      keyPresent: present,
      ...(present ? { keyHint: `…${key.value!.slice(-4)}` } : {}),
      model: modelInfo(settings.value.model).id,
      models: MODELS.map(({ id, name, input, output }) => ({ id, name, input, output })),
      whatIsSent: WHAT_IS_SENT,
    });
  }

  async setModel(model: string): Promise<Result<AiStatus>> {
    if (!MODELS.some((m) => m.id === model)) return err('ai.model', 'Unknown model.');
    const saved = await this.settings.write({ model });
    if (!saved.ok) return saved;
    return this.status();
  }

  async testKey(): Promise<Result<{ valid: boolean; message: string }>> {
    const key = await this.key();
    if (!key.ok) return key;
    const settings = await this.settings.read();
    if (!settings.ok) return settings;
    const checked = await testKey(this.ctx.ports.http, key.value, settings.value.model);
    if (!checked.ok) return checked;
    this.ctx.log.info(`ai-assist: key test ${checked.value.valid ? 'passed' : 'failed'}`);
    return ok(
      checked.value.valid
        ? { valid: true, message: `The key works with ${modelInfo(checked.value.model).name}.` }
        : { valid: false, message: checked.value.reason }
    );
  }

  // -------------------------------------------------------------------------
  // Requests: prepared (shown to the user exactly), then sent
  // -------------------------------------------------------------------------

  async prepare(input: {
    kind: RequestKind;
    aircraftId: string;
    question?: string;
    actionId?: string;
  }): Promise<Result<Prepared>> {
    const key = await this.key();
    if (!key.ok) return key;
    const settings = await this.settings.read();
    if (!settings.ok) return settings;
    const snapshot = await this.snapshot(input.aircraftId);
    if (!snapshot.ok) return snapshot;
    const s = snapshot.value;
    const model = modelInfo(settings.value.model).id;
    let task: string;
    let schema: Record<string, unknown> | undefined;
    let question = '';
    if (input.kind === 'suggest') {
      if (s.controllers.length === 0) {
        return err(
          'ai.noControllers',
          'No controller that DCS uses for this aircraft is connected.'
        );
      }
      task = suggestionTask(s);
      schema = suggestionSchema(s.controllers.map((c) => c.ref));
    } else if (input.kind === 'draft') {
      task = draftTask(s);
      schema = draftSchema();
    } else if (input.kind === 'explain') {
      const action = s.actions.find((a) => a.id === input.actionId);
      if (!action) return err('ai.action', `${s.aircraftName} has no such action.`);
      question = `What does "${action.name}" do?`;
      task = questionTask(s, question, action.id);
    } else {
      question = (input.question ?? '').trim();
      if (question.length === 0) return err('ai.question', 'Type a question first.');
      if (question.length > MAX_QUESTION) {
        return err('ai.question', `Keep the question under ${MAX_QUESTION} characters.`);
      }
      task = questionTask(s, question);
    }
    const body = messageBody({
      model,
      system: SYSTEM_PROMPT,
      context: contextText(s),
      task,
      ...(schema ? { schema } : {}),
      maxTokens: MAX_TOKENS[input.kind],
    });
    const requestId = this.next('r');
    this.prepared.set(requestId, {
      kind: input.kind,
      aircraftId: input.aircraftId,
      model,
      body,
      snapshot: s,
      question,
    });
    const text = JSON.stringify(body);
    const tokens = approximateTokens(text);
    return ok({
      requestId,
      kind: input.kind,
      model,
      body: JSON.stringify(body, null, 2),
      chars: text.length,
      approxTokens: tokens,
      approxCost: (tokens * modelInfo(model).input) / 1_000_000,
      contents: [
        `${s.actions.length} actions of the ${s.aircraftName}, with what each is bound to now`,
        `${s.controllers.length} ${s.controllers.length === 1 ? 'controller' : 'controllers'}: ${s.controllers.map((c) => c.name).join(', ') || 'none'}`,
        s.pack
          ? "RigReady's binding guide for this aircraft"
          : 'No guide (there is none for this aircraft)',
        question ? `Your question: "${question}"` : 'The task: what RigReady asks the model to do',
      ],
    });
  }

  private usage(answer: MessageAnswer): UsageView {
    return { model: answer.model, ...answer.usage, cost: answer.cost };
  }

  async send(requestId: string): Promise<Result<Sent>> {
    const request = this.prepared.get(requestId);
    if (!request) return err('ai.expired', 'That request is no longer ready. Ask again.');
    this.prepared.delete(requestId);
    const key = await this.key();
    if (!key.ok) return key;
    const answer = await sendMessage(this.ctx.ports.http, key.value, request.body);
    if (!answer.ok) {
      this.ctx.log.warn(`ai-assist: ${request.kind} failed: ${answer.error.code}`);
      return answer;
    }
    const usage = this.usage(answer.value);
    this.ctx.log.info(
      `ai-assist: ${request.kind} answered by ${usage.model}: ${usage.input} in, ${usage.cacheRead} cached, ${usage.cacheWrite} cache-written, ${usage.output} out`
    );
    if (request.kind === 'suggest') {
      const plan = validatePlan(answer.value.text, request.snapshot);
      if (!plan.ok) return err('ai.invalid', plan.why);
      const roundId = this.next('round');
      this.rounds.set(roundId, { aircraftId: request.aircraftId, plan: plan.value });
      this.ctx.log.info(
        `ai-assist: ${plan.value.suggestions.length} suggestions kept, ${plan.value.dropped.length} dropped`
      );
      return ok({
        kind: 'suggest',
        roundId,
        summary: plan.value.summary,
        notes: plan.value.notes,
        suggestions: plan.value.suggestions.map(
          ({ deviceGuid: _g, deviceRef: _r, ...view }) => view
        ),
        dropped: plan.value.dropped,
        usage,
      });
    }
    if (request.kind === 'draft') {
      const draft = validateDraft(
        answer.value.text,
        request.snapshot,
        usage.model,
        new Date(this.ctx.ports.clock.now()).toISOString()
      );
      if (!draft.ok) return err('ai.invalid', draft.why);
      const written = await this.ctx.ports.files.write(
        this.draftPath(request.aircraftId),
        `# Drafted by ${usage.model} for RigReady. Format: see packs/README.md in RigReady's source.\n${yaml.dump(draft.value.pack, { lineWidth: 100 })}`,
        { reason: 'Binding guide drafted by AI' }
      );
      if (!written.ok) return written;
      return ok({
        kind: 'draft',
        items: draft.value.pack.items.length,
        dropped: draft.value.dropped,
        usage,
      });
    }
    const text = cleanAnswer(answer.value.text);
    if (text.length === 0) return err('ai.empty', 'The model sent an empty answer. Try again.');
    return ok({ kind: 'answer', question: request.question, text, usage });
  }

  private proposalFromRound(roundId: string, selected: string[]): Result<BindingProposal> {
    const round = this.rounds.get(roundId);
    if (!round) return err('ai.expired', 'Those suggestions are no longer available. Ask again.');
    const wanted = new Set(selected);
    const chosen = round.plan.suggestions.filter((s) => wanted.has(s.id));
    if (chosen.length === 0) return err('ai.nothing', 'Tick at least one suggestion.');
    const inputs = new Map<string, string>();
    for (const s of chosen) {
      const key = `${s.deviceGuid}|${s.input}`;
      const other = inputs.get(key);
      if (other) {
        return err(
          'ai.clash',
          `"${other}" and "${s.label}" both use ${s.inputLabel} on ${s.deviceName}. Untick one.`
        );
      }
      inputs.set(key, s.label);
    }
    return ok({
      aircraftId: round.aircraftId,
      summary: `Bind ${chosen.length} ${chosen.length === 1 ? 'action' : 'actions'} suggested by AI`,
      changes: chosen.map((s) => ({
        op: 'bind',
        deviceGuid: s.deviceGuid,
        input: s.input,
        actionId: s.actionId,
      })),
    });
  }

  async reviewSuggestions(roundId: string, selected: string[]): Promise<Result<PlanView>> {
    const proposal = this.proposalFromRound(roundId, selected);
    if (!proposal.ok) return proposal;
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    return proposals.value.plan(proposal.value);
  }

  async applySuggestions(roundId: string, selected: string[]): Promise<Result<AppliedView>> {
    const proposal = this.proposalFromRound(roundId, selected);
    if (!proposal.ok) return proposal;
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    return proposals.value.apply(proposal.value);
  }

  async deleteDraft(aircraftId: string): Promise<Result<{ deleted: boolean }>> {
    const file = this.draftPath(aircraftId);
    if (!(await this.ctx.ports.files.exists(file))) return ok({ deleted: false });
    const removed = await this.ctx.ports.files.remove(file, {
      reason: 'Delete the binding guide drafted by AI',
    });
    return removed.ok ? ok({ deleted: true }) : removed;
  }
}
