/**
 * A feature that changes the machine (applies a layout, starts an app) calls
 * notifyMachineChanged(); screens that show machine state subscribe and refresh.
 * This is how features stay in sync without importing each other.
 */
const listeners = new Set<() => void>();

export function notifyMachineChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Returns the unsubscribe function. */
export function onMachineChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
