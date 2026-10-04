import type { Ports } from '../ports';

/**
 * One checklist run asks the machine each question once.
 *
 * A setup has a dozen "device connected" items, several "app running" items and more; each
 * check asks its port for the whole list (devices, processes, services, monitors, audio
 * devices). Enumerating USB devices is the slowest thing RigReady does, so within one run
 * the first answer is shared by every check that asks the same question (NFR-002).
 *
 * The cache lives exactly as long as the run: the next run (Re-check, a device plugged in
 * or removed, a fix that was applied) reads the machine again, so nothing stale is ever
 * shown. Only reads are shared; everything that changes the machine goes to the real port,
 * and so does everything a fix reads while it works.
 */
export function cachedReads(ports: Ports): Ports {
  const answers = new Map<string, Promise<unknown>>();
  /** The same answer for the same question, as a copy the caller may change. */
  const once = <T>(key: string, ask: () => Promise<T>): Promise<T> => {
    let answer = answers.get(key) as Promise<T> | undefined;
    if (!answer) {
      answer = ask();
      answers.set(key, answer);
    }
    return answer.then((value) => structuredClone(value));
  };
  const { devices, displays, processes, services, audio } = ports;
  return {
    ...ports,
    devices: {
      list: () => once('devices.list', () => devices.list()),
      subscribe: (listener) => devices.subscribe(listener),
    },
    displays: {
      read: () => once('displays.read', () => displays.read()),
      apply: (targets) => displays.apply(targets),
      canRevert: () => displays.canRevert(),
      revert: () => displays.revert(),
    },
    processes: {
      list: () => once('processes.list', () => processes.list()),
      start: (target) => processes.start(target),
      stop: (pid) => processes.stop(pid),
      close: (pid, options) => processes.close(pid, options),
    },
    services: {
      list: () => once('services.list', () => services.list()),
      get: (name) => once(`services.get ${name.toLowerCase()}`, () => services.get(name)),
    },
    audio: {
      read: () => once('audio.read', () => audio.read()),
      setDefault: (id, options) => audio.setDefault(id, options),
    },
  };
}
