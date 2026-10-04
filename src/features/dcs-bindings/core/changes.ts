import path from 'node:path';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { Applied, ChangePlan, PlannedFile } from './model';
import { lineDiff } from './textDiff';

export type { Applied, ChangePlan, PlannedFile };

/**
 * A plan of file changes, shown to the user in full before anything is written, and
 * the one place that writes binding files: through FileStore (backup and journal
 * first), as one undoable group, never while DCS is running, and verified afterwards.
 */

export type Step =
  | { kind: 'write'; path: string; content: string; before: string | null }
  | { kind: 'remove'; path: string; before: string }
  | { kind: 'move'; from: string; to: string; content: string; before: string };

export interface StepInfo {
  title: string;
  lines: string[];
}

export class PlanBuilder {
  readonly steps: (Step & StepInfo)[] = [];
  readonly notes: string[] = [];

  write(file: string, before: string | null, content: string, info: StepInfo): void {
    if (before === content) return;
    this.steps.push({ kind: 'write', path: file, content, before, ...info });
  }

  remove(file: string, before: string, info: StepInfo): void {
    this.steps.push({ kind: 'remove', path: file, before, ...info });
  }

  move(from: string, to: string, before: string, content: string, info: StepInfo): void {
    // Windows file names ignore case: a rename that only changes case is the same file.
    if (from.toLowerCase() === to.toLowerCase()) {
      this.write(from, before, content, info);
      return;
    }
    this.steps.push({ kind: 'move', from, to, content, before, ...info });
  }

  note(text: string): void {
    if (!this.notes.includes(text)) this.notes.push(text);
  }
}

export const DCS_RUNNING =
  'DCS is running. It keeps bindings in memory and writes them back when you press OK in its controls screen, which would overwrite this change. Close DCS first.';

function toView(step: Step & StepInfo): PlannedFile {
  if (step.kind === 'move') {
    return {
      path: step.from,
      to: step.to,
      action: 'rename',
      title: step.title,
      lines: step.lines,
      diff: step.before === step.content ? [] : lineDiff(step.before, step.content),
    };
  }
  if (step.kind === 'remove') {
    return {
      path: step.path,
      action: 'delete',
      title: step.title,
      lines: step.lines,
      diff: lineDiff(step.before, ''),
    };
  }
  return {
    path: step.path,
    action: step.before === null ? 'create' : 'change',
    title: step.title,
    lines: step.lines,
    diff: lineDiff(step.before ?? '', step.content),
  };
}

export function planView(summary: string, builder: PlanBuilder, dcsRunning: boolean): ChangePlan {
  return {
    summary,
    files: builder.steps.map(toView),
    notes: builder.notes,
    ...(dcsRunning ? { blocked: DCS_RUNNING } : {}),
  };
}

/** Writes a plan as one journal group and checks every file afterwards. */
export async function executePlan(
  ports: Ports,
  summary: string,
  builder: PlanBuilder,
  dcsRunning: boolean,
  /** Told once the files hold the change (the cheat sheets and other readers refresh). */
  changed?: () => void
): Promise<Result<Applied>> {
  if (dcsRunning) return err('dcs.running', DCS_RUNNING);
  if (builder.steps.length === 0) {
    return err('dcs.nothingToDo', 'There is nothing to change: the files already look like this.');
  }
  const { files } = ports;
  // Nothing may be overwritten that the plan did not see.
  for (const step of builder.steps) {
    const target = step.kind === 'move' ? step.to : step.path;
    const source = step.kind === 'move' ? step.from : step.path;
    const now = (await files.exists(source)) ? await files.readText(source) : undefined;
    const current = now === undefined ? null : now.ok ? now.value : undefined;
    if (current === undefined || current !== step.before) {
      return err(
        'dcs.changedMeanwhile',
        `${path.basename(source)} changed after this preview was made. Nothing was written; look at the preview again.`
      );
    }
    if (step.kind === 'move' && (await files.exists(target))) {
      return err(
        'dcs.targetExists',
        `${path.basename(target)} already exists. Nothing was written.`
      );
    }
  }

  const group = files.beginGroup(summary);
  const options = { reason: summary, group };
  for (const step of builder.steps) {
    if (step.kind === 'write') {
      const made = await files.mkdir(path.dirname(step.path));
      if (!made.ok) return made;
      const written = await files.write(step.path, step.content, options);
      if (!written.ok) return written;
    } else if (step.kind === 'remove') {
      const removed = await files.remove(step.path, options);
      if (!removed.ok) return removed;
    } else {
      // A rename whose content also changes is a write of the new file and a removal of the old.
      const made = await files.mkdir(path.dirname(step.to));
      if (!made.ok) return made;
      if (step.content === step.before) {
        const moved = await files.move(step.from, step.to, options);
        if (!moved.ok) return moved;
      } else {
        const written = await files.write(step.to, step.content, options);
        if (!written.ok) return written;
        const removed = await files.remove(step.from, options);
        if (!removed.ok) return removed;
      }
    }
  }

  // Read back: never report success for something that did not happen.
  for (const step of builder.steps) {
    if (step.kind === 'remove') {
      if (await files.exists(step.path)) {
        return err('dcs.verify', `${step.path} is still there after removing it.`);
      }
      continue;
    }
    const target = step.kind === 'move' ? step.to : step.path;
    const text = await files.readText(target);
    if (!text.ok || text.value !== step.content) {
      return err('dcs.verify', `${target} does not hold what was written.`);
    }
    if (step.kind === 'move' && (await files.exists(step.from))) {
      return err('dcs.verify', `${step.from} is still there after renaming it.`);
    }
  }
  changed?.();
  return ok({ groupId: group.id, summary, files: builder.steps.length });
}
