import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { UpdateChannel, UpdateFeed, UpdateOffer } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';

/** The file in the fake user folder a test writes to steer the fake update feed of a running app. */
export const UPDATE_FEED_FILE = 'rigready-update-feed.json';

const OfferSchema = z.object({ version: z.string(), notes: z.string().optional() });

/** What the steering file may say. Every field is optional; a missing file is an empty feed. */
export const FakeUpdateFeedSchema = z.object({
  /** The newest version published per channel. */
  stable: OfferSchema.optional(),
  beta: OfferSchema.optional(),
  /** Checking fails with this text, like a dead network. */
  checkError: z.string().optional(),
  /** The download fails with this text. */
  downloadError: z.string().optional(),
  /** The download stays at 40% for as long as this is true. */
  hold: z.boolean().optional(),
});
export type FakeUpdateFeedState = z.infer<typeof FakeUpdateFeedSchema>;

/**
 * An update feed that never touches the network. Tests set `feed` directly; a scenario
 * run of the real app is steered through the JSON file `<fake home>/rigready-update-feed.json`,
 * read again at every check and while a download is held.
 */
export class FakeUpdateFeed implements UpdateFeed {
  version = '2.0.0';
  reason: string | undefined;
  feed: FakeUpdateFeedState = {};
  /** Every check, download and install, for assertions. */
  readonly checks: UpdateChannel[] = [];
  downloads = 0;
  installs = 0;
  installOnQuit = false;
  private found: UpdateOffer | undefined;

  constructor(private readonly file?: string) {}

  private async refresh(): Promise<void> {
    if (!this.file) return;
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch {
      return;
    }
    try {
      this.feed = FakeUpdateFeedSchema.parse(JSON.parse(text));
    } catch {
      // Half-written by the test: the next read sees the whole file.
    }
  }

  currentVersion(): string {
    return this.version;
  }

  unavailable(): string | undefined {
    return this.reason;
  }

  async check(channel: UpdateChannel): Promise<Result<UpdateOffer | null>> {
    await this.refresh();
    this.checks.push(channel);
    if (this.feed.checkError) {
      return err('update.check', 'Could not check for updates.', this.feed.checkError);
    }
    const offer = this.feed[channel];
    this.found = offer ? { ...offer } : undefined;
    return ok(offer ? { ...offer } : null);
  }

  async download(onProgress: (percent: number) => void): Promise<Result<void>> {
    if (!this.found) return err('update.download', 'There is nothing to download.');
    this.downloads++;
    onProgress(40);
    for (;;) {
      await this.refresh();
      if (!this.feed.hold) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.feed.downloadError) {
      return err('update.download', 'The update could not be downloaded.', this.feed.downloadError);
    }
    onProgress(100);
    return ok(undefined);
  }

  setInstallOnQuit(on: boolean): void {
    this.installOnQuit = on;
  }

  async quitAndInstall(): Promise<Result<void>> {
    // A scenario run has nothing to install; the call is recorded and the app stays up.
    this.installs++;
    return ok(undefined);
  }
}
