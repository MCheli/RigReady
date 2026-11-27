import type {
  BindingProposal,
  BindingProposals,
  ProposalApplied,
  ProposalPlan,
} from '../../../core/bindings';
import { sha256 } from '../../../core/files/fileStore';
import { registryValuePath } from '../../../core/files/registryValues';
import { err, ok, type Result } from '../../../core/result';
import type { ChangeRequest } from '../contract';
import { actionOf, bindingName } from './actions';
import { boundInWords, inWords, oneAtATime, resolve, whyBlocked } from './change';
import { editMapText } from './edit';
import { parseControllerMap } from './rewired';
import { ALL_AIRCRAFT, GAME_NAME, REGISTRY_KEY, overview, type BindingsContext } from './view';

/**
 * Several bindings changed as one: what another feature proposes (a setup suggested by AI)
 * shown first, then written through FileStore under one entry of the Safety page, and undone
 * as one. The same edits the page makes one at a time (core/edit.ts), folded into each
 * controller's saved map in the order given.
 *
 * A proposed binding takes the control over: what else was on that button or axis of the
 * controller is taken off it, as the review says line by line.
 */

interface Write {
  valueName: string;
  address: string;
  bytes: Uint8Array;
  deviceName: string;
  lines: string[];
}

interface Planned {
  writes: Write[];
  /** Changes that are in place already. */
  unchanged: number;
  /** What the plan was made from and what it would write. */
  seen: string;
}

const INPUT_BUTTON = /^JOY_BTN([1-9]\d{0,2})$/;
const INPUT_AXIS = /^JOY_(X|Y|Z|RX|RY|RZ|SLIDER1|SLIDER2)$/;
const ACTION_ID = /^(\d{1,6})(?::([+-]))?$/;

async function planned(ctx: BindingsContext, proposal: BindingProposal): Promise<Result<Planned>> {
  if (proposal.aircraftId !== ALL_AIRCRAFT) {
    return err(
      'nuclear-option.aircraft',
      'Nuclear Option has one set of bindings for every aircraft.'
    );
  }
  if (proposal.changes.length === 0) {
    return err('nuclear-option.proposal.empty', 'Nothing to change.');
  }
  const view = await overview(ctx);
  if (!view.ok) return view;
  // Each saved map as it becomes, change by change.
  const maps = new Map<
    string,
    { original: string; text: string; deviceName: string; lines: string[] }
  >();
  const usedControls = new Set<string>();
  const usedActions = new Set<string>();
  let unchanged = 0;
  for (const change of proposal.changes) {
    const parts = ACTION_ID.exec(change.actionId);
    const action = parts ? actionOf(Number(parts[1])) : undefined;
    if (!parts || !action || action.name === `Action ${parts[1]}`) {
      return err('nuclear-option.proposal.action', 'Nuclear Option has no such action.');
    }
    const side = parts[2] as '+' | '-' | undefined;
    const name = bindingName(action, side === undefined, side === '-' ? 1 : 0);
    if (change.op !== 'bind') {
      return err(
        'nuclear-option.proposal.op',
        `${name}: a proposed change binds an action here. Clear a binding on the Nuclear Option bindings page.`
      );
    }
    if ((change.modifiers ?? []).length > 0 || !change.deviceGuid) {
      return err(
        'nuclear-option.proposal.where',
        `${name}: a proposed change binds a button or an axis of a controller. Bind a key on the Nuclear Option bindings page.`
      );
    }
    const guid = change.deviceGuid.toUpperCase();
    const device = view.value.devices.find(
      (d) => d.kind === 'controller' && d.guid?.toUpperCase() === guid
    );
    if (!device) {
      return err(
        'nuclear-option.proposal.device',
        `${name}: Nuclear Option has saved no bindings for that controller, so RigReady cannot bind on it. Start the game once with it plugged in.`
      );
    }
    const button = INPUT_BUTTON.exec(change.input);
    const axis = INPUT_AXIS.exec(change.input);
    if (!button && !axis) {
      return err(
        'nuclear-option.proposal.input',
        `${name}: RigReady binds a button or an axis of a controller in Nuclear Option. How the game saves a hat is not known; bind one in the game.`
      );
    }
    if (usedActions.has(change.actionId)) {
      return err('nuclear-option.proposal.twice', `${name} is in the list twice.`);
    }
    usedActions.add(change.actionId);
    const control = `${device.id}|${change.input}`;
    if (usedControls.has(control)) {
      return err(
        'nuclear-option.proposal.clash',
        `Two of the changes use the same control of ${device.name}. Take one of them out.`
      );
    }
    usedControls.add(control);

    const base: ChangeRequest = {
      device: device.id,
      actionId: action.id,
      ...(side ? { side } : {}),
      ...(button ? { button: Number(button[1]) } : {}),
      ...(axis ? { axis: { name: axis[1]!, invert: false } } : {}),
    };
    const resolved = await resolve(ctx, base);
    if (!resolved.ok) return err(resolved.error.code, `${name}: ${resolved.error.message}`);
    const { stored, axes, edit } = resolved.value;
    const state = maps.get(stored.valueName) ?? {
      original: stored.text,
      text: stored.text,
      deviceName: stored.deviceName,
      lines: [],
    };
    maps.set(stored.valueName, state);
    // An axis the player reversed stays reversed when the action is put on an axis again:
    // which way a lever runs is the player's, not the proposal's.
    if (edit.axis) {
      const now = parseControllerMap(state.text);
      const reversed =
        now.ok &&
        now.value.axisMaps.some((e) => e.actionId === action.id && e.elementType === 0 && e.invert);
      edit.axis = { ...edit.axis, invert: reversed };
    }
    const edited = editMapText(state.text, { ...edit, alone: true });
    if (!edited.ok) return err(edited.error.code, `${name}: ${edited.error.message}`);
    const tookOff = edited.value.tookOff ?? [];
    if (edited.value.same && tookOff.length === 0) {
      unchanged++;
      continue;
    }
    const after = edit.axis
      ? boundInWords({ kind: 'axis', ...edit.axis }, axes)
      : `Button ${base.button}`;
    const before = inWords(edited.value.before, axes);
    state.lines.push(
      edited.value.same
        ? `${name} stays on ${after}`
        : edited.value.before.length === 0
          ? `${name}: ${after}`
          : `${name}: ${after} (was ${before})`
    );
    if (tookOff.length > 0) {
      state.lines.push(`${after} no longer does ${tookOff.join(', ')}`);
    }
    state.text = edited.value.text;
  }
  const writes: Write[] = [];
  const seen: string[] = [];
  for (const [valueName, state] of [...maps].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    seen.push(`${valueName}\n${sha256(state.original)}\n${sha256(state.text)}`);
    if (state.text === state.original) continue;
    writes.push({
      valueName,
      address: registryValuePath('HKCU', REGISTRY_KEY, valueName),
      bytes: new Uint8Array(Buffer.from(state.text, 'utf8')),
      deviceName: state.deviceName,
      lines: state.lines,
    });
  }
  return ok({ writes, unchanged, seen: sha256(seen.join('\n')) });
}

const fingerprint = (proposal: BindingProposal): string =>
  sha256(
    JSON.stringify(
      proposal.changes.map((c) => [c.op, c.deviceGuid?.toUpperCase(), c.input, c.actionId])
    )
  );

/** The most reviews remembered at once: a review is looked at, then written or dropped. */
const REMEMBERED = 20;

export function createProposals(ctx: BindingsContext, changed: () => void): BindingProposals {
  /** What each reviewed proposal would have written, to refuse a write of something else. */
  const reviewed = new Map<string, string>();

  async function plan(proposal: BindingProposal): Promise<Result<ProposalPlan>> {
    const made = await planned(ctx, proposal);
    if (!made.ok) return made;
    const key = fingerprint(proposal);
    reviewed.delete(key);
    reviewed.set(key, made.value.seen);
    for (const old of [...reviewed.keys()].slice(0, Math.max(0, reviewed.size - REMEMBERED))) {
      reviewed.delete(old);
    }
    const blocked = await whyBlocked(ctx);
    const { writes, unchanged } = made.value;
    return ok({
      summary: proposal.summary,
      files: writes.map((w) => ({
        path: w.address,
        action: 'change' as const,
        title: `${GAME_NAME}’s saved bindings for ${w.deviceName} (registry)`,
        lines: w.lines,
        // A saved map is one line of XML: there is no line-by-line text to show.
        diff: [],
      })),
      notes:
        unchanged === 0
          ? []
          : [
              unchanged === 1
                ? '1 of these is bound so already and is left as it is.'
                : `${unchanged} of these are bound so already and are left as they are.`,
            ],
      ...(blocked ? { blocked } : {}),
    });
  }

  async function applyNow(proposal: BindingProposal): Promise<Result<ProposalApplied>> {
    const blocked = await whyBlocked(ctx);
    if (blocked) return err('nuclear-option.edit.blocked', blocked);
    const made = await planned(ctx, proposal);
    if (!made.ok) return made;
    const key = fingerprint(proposal);
    const shown = reviewed.get(key);
    // Worked out again from the values as they are now: when that is not what the review
    // showed, what the user approved may not hold.
    if (shown !== undefined && shown !== made.value.seen) {
      return err(
        'nuclear-option.edit.changed',
        'The game’s saved bindings changed after the changes were shown, so nothing was written. Look at them again.'
      );
    }
    const { writes } = made.value;
    if (writes.length === 0) {
      return err(
        'nuclear-option.proposal.nothing',
        'Nothing was written: every one of these is bound so already.'
      );
    }
    const group = ctx.ports.files.beginGroup(`${GAME_NAME} bindings: ${proposal.summary}`);
    let done = 0;
    // Said with any failure once a value was written: the change is then partly made.
    const partly = (message: string): string =>
      done === 0
        ? message
        : `${message} Part of the change was already written; Undo on the Safety page takes it out.`;
    for (const write of writes) {
      const written = await ctx.ports.files.write(write.address, write.bytes, {
        reason: `Change bindings in what ${GAME_NAME} saved in the registry`,
        group,
      });
      if (!written.ok) {
        if (done > 0) changed();
        return err(written.error.code, partly(written.error.message));
      }
      done++;
      // Read back through the registry port: only report what the registry really holds.
      const back = await ctx.ports.registry.getValue('HKCU', REGISTRY_KEY, write.valueName);
      const kept =
        back.ok &&
        back.value?.type === 'binary' &&
        back.value.value.toLowerCase() === Buffer.from(write.bytes).toString('hex');
      if (!kept) {
        changed();
        return back.ok
          ? err('nuclear-option.edit.notKept', partly('The registry did not keep the change.'))
          : err(back.error.code, partly(back.error.message));
      }
    }
    reviewed.delete(key);
    changed();
    ctx.log.info(`nuclear-option-bindings: ${proposal.summary} (${writes.length} saved maps)`);
    return ok({ groupId: group.id, summary: proposal.summary, files: writes.length });
  }

  return {
    plan,
    apply: (proposal) => oneAtATime(() => applyNow(proposal)),
    undo: (groupId) =>
      oneAtATime(async (): Promise<Result<void>> => {
        const blocked = await whyBlocked(ctx);
        if (blocked) return err('nuclear-option.edit.blocked', blocked);
        const undone = await ctx.ports.files.undoGroup(groupId);
        if (!undone.ok) return undone;
        changed();
        return ok(undefined);
      }),
  };
}
