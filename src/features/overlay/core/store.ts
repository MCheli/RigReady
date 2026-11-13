import path from 'node:path';
import { JsonStore } from '../../../core/jsonStore';
import type { FileStore, KnownFolders } from '../../../core/ports';
import { fromThrown, type Result } from '../../../core/result';
import { OverlaySettingsSchema, type OverlaySettings } from './settings';

/** `<data root>/overlay/settings.json`: see `settings.ts` for what is in it. */
export class OverlayStore {
  private readonly file: JsonStore<typeof OverlaySettingsSchema>;

  constructor(files: FileStore, folders: KnownFolders) {
    this.file = new JsonStore(
      files,
      path.join(folders.dataRoot(), 'overlay', 'settings.json'),
      OverlaySettingsSchema
    );
  }

  /** The settings; the defaults when nothing was saved yet. A damaged file is an error. */
  async read(): Promise<Result<OverlaySettings>> {
    try {
      return await this.file.read();
    } catch (e) {
      return fromThrown('overlay.settings', 'The overlay settings could not be read.', e);
    }
  }

  /** Reads, changes, writes. Answers with what was written. */
  async update(
    change: (current: OverlaySettings) => OverlaySettings
  ): Promise<Result<OverlaySettings>> {
    try {
      return await this.file.update(change);
    } catch (e) {
      return fromThrown('overlay.settings', 'The overlay settings could not be saved.', e);
    }
  }
}
