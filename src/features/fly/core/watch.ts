import type { FileStore } from '../../../core/ports';

/**
 * Notices profile files changed on disk (a hand edit in Notepad) by comparing their
 * modification times every `intervalMs`. Polling keeps it on the FileStore port and is
 * cheap: one folder listing.
 */
export class ProfileWatcher {
  private timer: ReturnType<typeof setInterval> | undefined;
  private known = new Map<string, number>();
  private busy = false;

  constructor(
    private readonly files: FileStore,
    private readonly dir: string,
    private readonly changed: (ids: string[]) => void,
    private readonly intervalMs = 1500
  ) {}

  /** Starts watching (once); the current files are the baseline. */
  async start(): Promise<void> {
    if (this.timer) return;
    this.known = await this.snapshot();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async snapshot(): Promise<Map<string, number>> {
    const entries = await this.files.listEntries(this.dir);
    const map = new Map<string, number>();
    if (!entries.ok) return map;
    for (const entry of entries.value) {
      if (!entry.isDirectory && entry.name.endsWith('.yaml')) {
        map.set(entry.name.slice(0, -'.yaml'.length), entry.mtimeMs);
      }
    }
    return map;
  }

  /** One comparison; exposed for tests. Reports added, changed and removed profile ids. */
  async poll(): Promise<string[]> {
    if (this.busy) return [];
    this.busy = true;
    try {
      const now = await this.snapshot();
      const ids = new Set<string>();
      for (const [id, mtime] of now) if (this.known.get(id) !== mtime) ids.add(id);
      for (const id of this.known.keys()) if (!now.has(id)) ids.add(id);
      this.known = now;
      if (ids.size > 0) this.changed([...ids].sort());
      return [...ids];
    } finally {
      this.busy = false;
    }
  }
}
