import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ok } from '../src/core/result';
import type { FakePorts } from '../src/platform/fake';

/**
 * Makes the fake machine accept every change and carry out none of them: the way a real
 * change fails silently (a program that Windows starts and that dies at once, a display
 * driver that answers "done" and leaves the layout alone, a file another program puts
 * back). An action that reports success under this has not looked at the result.
 */
export interface Sabotage {
  /** What was asked of the machine meanwhile ("processes.start TrackIR5.exe"). */
  attempts: string[];
  /** Ends it: the fake machine works again. */
  restore(): void;
}

export function sabotage(ports: FakePorts): Sabotage {
  const undo: (() => void)[] = [];
  const attempts: string[] = [];
  const replace = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void => {
    const own = Object.prototype.hasOwnProperty.call(target, key);
    const previous = target[key];
    target[key] = value;
    undo.push(() => {
      if (own) target[key] = previous;
      else delete target[key];
    });
  };

  // A start that Windows accepts, with a process id, for a program that never shows up.
  replace(ports.processes, 'start', async (target) => {
    ports.processes.started.push(target);
    attempts.push(`processes.start ${path.win32.basename(target.exe)}`);
    return ok({ pid: 424242 });
  });
  // A close and a terminate that are answered with success while the program keeps running.
  replace(ports.processes, 'close', async (pid, options = {}) => {
    const found = ports.state.processes.find((p) => p.pid === pid);
    ports.processes.closed.push({ pid, name: found?.name ?? String(pid), options });
    attempts.push(`processes.close ${found?.name ?? pid}`);
    return ok({ outcome: 'closed' as const });
  });
  replace(ports.processes, 'stop', async (pid) => {
    attempts.push(`processes.stop ${pid}`);
    return ok(undefined);
  });
  // A layout change that is accepted and changes nothing.
  replace(ports.displays, 'apply', async () => {
    attempts.push('displays.apply');
    const now = { displays: structuredClone(ports.state.displays) };
    return ok({ previous: now, current: structuredClone(now) });
  });
  // A default device that stays what it was.
  replace(ports.audio, 'setDefault', async (id, options = {}) => {
    attempts.push(`audio.setDefault ${id}`);
    ports.audio.calls.push({
      id,
      roles: options.roles ?? ['console', 'multimedia', 'communications'],
    });
    return ok(structuredClone(ports.state.audio));
  });

  // File changes that are made and then put back (another program restored its own copy).
  const files = ports.files;
  const snapshot = async (file: string): Promise<() => Promise<void>> => {
    let before: Buffer | null = null;
    try {
      before = await fs.readFile(file);
    } catch {
      before = null;
    }
    return async () => {
      if (before === null) await fs.rm(file, { force: true });
      else {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, before);
      }
    };
  };
  const listFiles = async (dir: string, out: string[] = []): Promise<string[]> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await listFiles(full, out);
      else out.push(full);
    }
    return out;
  };
  const snapshotTree = async (dir: string): Promise<() => Promise<void>> => {
    const existed = await fs.stat(dir).then(
      () => true,
      () => false
    );
    const before = new Map<string, Buffer>();
    for (const file of await listFiles(dir)) before.set(file, await fs.readFile(file));
    return async () => {
      if (!existed) {
        await fs.rm(dir, { recursive: true, force: true });
        return;
      }
      for (const file of await listFiles(dir)) {
        if (!before.has(file)) await fs.rm(file, { force: true });
      }
      for (const [file, bytes] of before) await fs.writeFile(file, bytes);
    };
  };

  const write = files.write.bind(files);
  replace(files, 'write', async (file, content, options) => {
    attempts.push(`files.write ${file}`);
    const revert = await snapshot(file);
    const result = await write(file, content, options);
    await revert();
    return result;
  });
  const copy = files.copy.bind(files);
  replace(files, 'copy', async (from, to, options) => {
    attempts.push(`files.copy ${to}`);
    const revert = await snapshot(to);
    const result = await copy(from, to, options);
    await revert();
    return result;
  });
  const remove = files.remove.bind(files);
  replace(files, 'remove', async (file, options) => {
    attempts.push(`files.remove ${file}`);
    const revert = await snapshot(file);
    const result = await remove(file, options);
    await revert();
    return result;
  });
  const move = files.move.bind(files);
  replace(files, 'move', async (from, to, options) => {
    attempts.push(`files.move ${to}`);
    const revertFrom = await snapshot(from);
    const revertTo = await snapshot(to);
    const result = await move(from, to, options);
    await revertFrom();
    await revertTo();
    return result;
  });
  const copyTree = files.copyTree.bind(files);
  replace(files, 'copyTree', async (fromDir, toDir, options) => {
    attempts.push(`files.copyTree ${toDir}`);
    const revert = await snapshotTree(toDir);
    const result = await copyTree(fromDir, toDir, options);
    await revert();
    return result;
  });

  return {
    attempts,
    restore: () => {
      for (const step of undo.reverse()) step();
    },
  };
}
