import path from 'node:path';
import type { BindingRegistry } from '../../../core/bindings';
import type { CheckContext } from '../../../core/checks/registry';
import { changePreview } from '../../../core/files/preview';
import type { GameRegistry } from '../../../core/games';
import type { Logger } from '../../../core/logger';
import type { NameRegistry } from '../../../core/names';
import { allPathVariables } from '../../../core/pathVariables';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { ChangePreview } from '../../../shared/changePreview';
import type { InputDevice } from '../../../shared/models';
import { convertJoystickDiagrams } from './convert';
import {
  Kneeboard,
  KneeboardOptionsSchema,
  planPages,
  renderPage,
  type ExportOutcome,
  type KneeboardOptions,
  type KneeboardStatus,
} from './kneeboard';
import {
  LAYOUT_EXTENSION,
  layoutMatches,
  MAX_BACKGROUND_CHARS,
  parseLayout,
  serializeLayout,
  type DeviceLayout,
} from './layout';
import { KNEEBOARD_SIZE, printDocument, type PageStyle, type PaperSize } from './pages';
import { buildSheet, sheetTitle, type Sheet } from './sheet';
import { CheatSheetStore } from './store';

/**
 * Everything the cheat sheets do, against ports and core's registries: build a sheet,
 * keep notes and layouts, print, export kneeboard pages. main.ts only wires it to IPC.
 */

export interface ServiceContext {
  ports: Ports;
  log: Logger;
  bindings: BindingRegistry;
  names: NameRegistry;
  games: GameRegistry;
}

/** Games whose cheat sheets can be exported as kneeboard pages, with the folder under the user folder. */
const KNEEBOARD_GAMES: Record<string, { variable: string; folder: string }> = {
  dcs: { variable: 'DCS_USER', folder: 'Kneeboard' },
};

/** How long a sheet waits for the DirectInput reader before drawing without it. */
const INPUT_WAIT_MS = 4000;

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export class CheatSheets {
  readonly store: CheatSheetStore;
  readonly kneeboard: Kneeboard;

  constructor(private readonly ctx: ServiceContext) {
    this.store = new CheatSheetStore(ctx.ports.files, ctx.ports.folders, ctx.log);
    this.kneeboard = new Kneeboard({
      files: ctx.ports.files,
      render: ctx.ports.render,
      clock: ctx.ports.clock,
      dir: this.store.dir,
    });
  }

  supportsKneeboard(game: string): boolean {
    return game in KNEEBOARD_GAMES;
  }

  async overview() {
    const games = [];
    for (const reader of this.ctx.bindings.all()) {
      const available = await reader.available().catch((e: unknown) => {
        this.ctx.log.warn(`the bindings of ${reader.gameName} could not be read`, e);
        return false;
      });
      if (!available) continue;
      const aircraft = await reader.aircraft();
      if (!aircraft.ok) {
        this.ctx.log.warn(
          `cheat sheets: ${reader.game} bindings could not be listed`,
          aircraft.error
        );
        continue;
      }
      games.push({
        game: reader.game,
        gameName: reader.gameName,
        kneeboard: this.supportsKneeboard(reader.game),
        aircraft: aircraft.value,
      });
    }
    return ok({ games });
  }

  /** The controllers attached now; empty when the reader is slow or fails (sheets still draw). */
  private async controllers(): Promise<InputDevice[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = await Promise.race([
      this.ctx.ports.input.start(),
      new Promise<'pending'>((resolve) => {
        timer = setTimeout(() => resolve('pending'), INPUT_WAIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (started === 'pending' || !started.ok) return [];
    const current = this.ctx.ports.input.devices();
    return current.length > 0 ? current : started.value;
  }

  async sheet(game: string, aircraftId: string): Promise<Result<Sheet>> {
    const reader = this.ctx.bindings.get(game);
    if (!reader) return err('sheet.game', `RigReady cannot read the bindings of ${game}.`);
    const bindings = await reader.bindings(aircraftId);
    if (!bindings.ok) return bindings;
    const notes = await this.store.notes(game, aircraftId);
    if (!notes.ok) return notes;
    const [controllers, layoutFor, names, labels] = await Promise.all([
      this.controllers(),
      this.store.chooser(),
      this.ctx.names.devices(),
      // The binding guide's plain-language names (never fails; empty without a guide).
      this.ctx.bindings.labels(reader.game, aircraftId),
    ]);
    return ok(
      buildSheet({
        game: reader.game,
        gameName: reader.gameName,
        bindings: bindings.value,
        controllers,
        layoutFor,
        notes: notes.value,
        labels,
        nameOf: (device) => names.nameOf(device),
        route: (guid) => reader.route({ aircraftId, ...(guid ? { guid } : {}) }),
      })
    );
  }

  async setNote(
    game: string,
    aircraftId: string,
    deviceKey: string,
    control: string,
    note: string
  ): Promise<Result<{ saved: boolean }>> {
    const saved = await this.store.setNote(game, aircraftId, deviceKey, control, note);
    if (!saved.ok) return saved;
    // Read back: the note is what was asked for.
    const now = saved.value[deviceKey]?.[control] ?? '';
    return now === note.trim() ? ok({ saved: true }) : err('sheet.note', 'The note was not saved.');
  }

  // ---- layouts ----

  async exportLayout(layout: DeviceLayout): Promise<Result<{ path: string | null }>> {
    const { dialogs, files, folders } = this.ctx.ports;
    const name = layout.name
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const picked = await dialogs.save({
      title: 'Save the layout as a file',
      defaultPath: path.join(folders.documents(), `${name}.${LAYOUT_EXTENSION}`),
      filters: [{ name: 'RigReady device layout', extensions: ['json'] }],
    });
    if (!picked.ok) return picked;
    if (!picked.value) return ok({ path: null });
    const written = await files.write(picked.value, serializeLayout(layout), {
      reason: `Save the layout of ${layout.name} as a file`,
    });
    if (!written.ok) return written;
    if (!(await files.exists(picked.value))) {
      return err('sheet.layout', 'The layout file was not written.');
    }
    return ok({ path: picked.value });
  }

  async importLayout(device: { vendorId: string; productId: string; name: string }): Promise<
    Result<{
      layout: DeviceLayout | null;
      from?: 'rigready' | 'joystick-diagrams';
      skipped: string[];
      file?: string;
    }>
  > {
    const { dialogs, files } = this.ctx.ports;
    const picked = await dialogs.open({
      title: 'Import a device layout',
      filters: [
        {
          name: 'Device layouts (RigReady .json, Joystick Diagrams .svg)',
          extensions: ['json', 'svg'],
        },
      ],
    });
    if (!picked.ok) return picked;
    const file = picked.value[0];
    if (!file) return ok({ layout: null, skipped: [] });
    const stat = await files.stat(file);
    if (stat.ok && stat.value && stat.value.size > MAX_BACKGROUND_CHARS) {
      return err('sheet.import', 'That file is too large to be a device layout.');
    }
    const text = await files.readText(file);
    if (!text.ok) return text;
    const fileName = path.basename(file);
    if (file.toLowerCase().endsWith('.svg')) {
      const converted = convertJoystickDiagrams(text.value, device);
      if (!converted.ok) {
        return err('sheet.import', `${fileName} could not be converted.`, converted.reason);
      }
      return ok({
        layout: converted.layout,
        from: 'joystick-diagrams',
        skipped: converted.skipped,
        file: fileName,
      });
    }
    const parsed = parseLayout(text.value);
    if (!parsed.ok) {
      return err('sheet.import', `${fileName} is not a usable layout.`, parsed.reason);
    }
    if (!layoutMatches(parsed.layout, device.vendorId, device.productId)) {
      const made = `${parsed.layout.match.vendorId}:${parsed.layout.match.productIds.join(', ')}`;
      return err(
        'sheet.import',
        `${fileName} is a layout for another device.`,
        `It is for "${parsed.layout.name}" (${made}); this device is ${device.vendorId.toUpperCase()}:${device.productId.toUpperCase()}.`
      );
    }
    return ok({ layout: parsed.layout, from: 'rigready', skipped: [], file: fileName });
  }

  async pickBackground(): Promise<Result<{ image: string | null }>> {
    const { dialogs, files } = this.ctx.ports;
    const picked = await dialogs.open({
      title: 'Choose a photo or drawing of the device',
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    });
    if (!picked.ok) return picked;
    const file = picked.value[0];
    if (!file) return ok({ image: null });
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!type) return err('sheet.image', 'That is not a PNG, JPEG, WebP or SVG picture.');
    const bytes = await files.readBytes(file);
    if (!bytes.ok) return bytes;
    const image = `data:${type};base64,${Buffer.from(bytes.value).toString('base64')}`;
    if (image.length > MAX_BACKGROUND_CHARS) {
      return err(
        'sheet.image',
        'That picture is too large for a layout (about 6 MB at most). Save a smaller copy and try again.'
      );
    }
    return ok({ image });
  }

  // ---- print ----

  async savePdf(input: {
    game: string;
    aircraftId: string;
    devices: string[];
    paper: PaperSize;
    summary: boolean;
  }): Promise<Result<{ path: string | null; pages: number }>> {
    const sheet = await this.sheet(input.game, input.aircraftId);
    if (!sheet.ok) return sheet;
    const devices = sheet.value.devices.filter((d) => input.devices.includes(d.key));
    if (devices.length === 0 && !input.summary) {
      return err('sheet.print', 'Choose at least one device to print.');
    }
    const { dialogs, files, folders, render, clock } = this.ctx.ports;
    const name = sheetTitle(sheet.value).replace(/[\\/:*?"<>|]/g, '-');
    const picked = await dialogs.save({
      title: 'Save the cheat sheet as PDF',
      defaultPath: path.join(folders.documents(), `${name} cheat sheet.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!picked.ok) return picked;
    if (!picked.value) return ok({ path: null, pages: 0 });
    const document = printDocument(sheet.value, devices, {
      paper: input.paper,
      summary: input.summary,
      stamp: clock.now().toISOString().slice(0, 10),
    });
    const pdf = await render.pdf(document.html, { pageSize: input.paper, landscape: false });
    if (!pdf.ok) return pdf;
    const written = await files.write(picked.value, pdf.value, {
      reason: `Save the ${sheetTitle(sheet.value)} cheat sheet as PDF`,
    });
    if (!written.ok) return written;
    const stat = await files.stat(picked.value);
    if (!stat.ok || !stat.value || stat.value.size !== pdf.value.length) {
      return err('sheet.print', 'The PDF was not written completely.');
    }
    return ok({ path: picked.value, pages: document.pages });
  }

  // ---- kneeboard ----

  /** Saved Games\DCS\Kneeboard\<aircraft type>, following the setup's install when there is one. */
  async kneeboardFolder(
    game: string,
    aircraftId: string,
    check?: CheckContext
  ): Promise<Result<string>> {
    const target = KNEEBOARD_GAMES[game];
    if (!target) return err('kneeboard.game', 'Kneeboard pages are a DCS feature.');
    if (/[\\/:*?"<>|]|^\.+$/.test(aircraftId)) {
      return err('kneeboard.aircraft', 'That is not an aircraft type.');
    }
    const variables = await allPathVariables(
      check ?? { ports: this.ctx.ports, log: this.ctx.log },
      this.ctx.games
    );
    const user = variables[target.variable];
    if (!user) {
      return err('kneeboard.folder', 'The DCS folder in Saved Games was not found on this PC.');
    }
    // DCS made the folder as "Kneeboard" or "KNEEBOARD"; use the one that is there.
    const existing = await this.ctx.ports.files.list(user);
    const folder =
      (existing.ok ? existing.value : []).find(
        (name) => name.toLowerCase() === target.folder.toLowerCase()
      ) ?? target.folder;
    return ok(path.join(user, folder, aircraftId));
  }

  async kneeboardStatus(
    game: string,
    aircraftId: string,
    check?: CheckContext
  ): Promise<Result<KneeboardStatus>> {
    const sheet = await this.sheet(game, aircraftId);
    if (!sheet.ok) return sheet;
    const status = await this.kneeboard.status(sheet.value);
    if (!status.ok) return status;
    if (status.value.folder) return status;
    const folder = await this.kneeboardFolder(game, aircraftId, check);
    return ok(folder.ok ? { ...status.value, folder: folder.value } : status.value);
  }

  async exportKneeboard(
    game: string,
    aircraftId: string,
    options: KneeboardOptions,
    check?: CheckContext
  ): Promise<Result<ExportOutcome>> {
    const folder = await this.kneeboardFolder(game, aircraftId, check);
    if (!folder.ok) return folder;
    const sheet = await this.sheet(game, aircraftId);
    if (!sheet.ok) return sheet;
    return this.kneeboard.export(sheet.value, folder.value, options);
  }

  /** What exporting would change in the kneeboard folder: nothing is written. */
  async exportKneeboardPreview(
    game: string,
    aircraftId: string,
    options: KneeboardOptions
  ): Promise<Result<ChangePreview>> {
    const folder = await this.kneeboardFolder(game, aircraftId);
    if (!folder.ok) return folder;
    const sheet = await this.sheet(game, aircraftId);
    if (!sheet.ok) return sheet;
    const writes = await this.kneeboard.exportWrites(sheet.value, folder.value, options);
    if (!writes.ok) return writes;
    return changePreview(this.ctx.ports.files, writes.value);
  }

  /** What removing the exported pages would delete: nothing is removed. */
  async removeKneeboardPreview(aircraftId: string): Promise<Result<ChangePreview>> {
    const writes = await this.kneeboard.removeWrites(aircraftId);
    if (!writes.ok) return writes;
    return changePreview(this.ctx.ports.files, writes.value);
  }

  /** Writes the pages again with the options of the last export (or the defaults). */
  async regenerate(
    game: string,
    aircraftId: string,
    check?: CheckContext
  ): Promise<Result<string>> {
    const record = await this.kneeboard.record(aircraftId);
    if (!record.ok) return record;
    const options = record.value?.options ?? KneeboardOptionsSchema.parse({});
    const outcome = await this.exportKneeboard(game, aircraftId, options, check);
    if (!outcome.ok) return outcome;
    const status = await this.kneeboardStatus(game, aircraftId, check);
    if (!status.ok) return status;
    if (status.value.state !== 'current') {
      return err('kneeboard.verify', 'The pages were written but still do not match the bindings.');
    }
    const n = outcome.value.written.length;
    return ok(`Wrote ${n} kneeboard page${n === 1 ? '' : 's'} to ${outcome.value.folder}`);
  }

  /** One page exactly as the export would write it, as PNG bytes. */
  async kneeboardPreview(input: {
    game: string;
    aircraftId: string;
    deviceKey?: string | undefined;
    style: PageStyle;
  }): Promise<Result<{ image: string; width: number; height: number }>> {
    const sheet = await this.sheet(input.game, input.aircraftId);
    if (!sheet.ok) return sheet;
    const options = KneeboardOptionsSchema.parse({
      devices: input.deviceKey ? [input.deviceKey] : [],
      styles: [input.style],
      summary: !input.deviceKey,
    });
    const page = planPages(
      sheet.value,
      options,
      this.ctx.ports.clock.now().toISOString().slice(0, 10)
    )[0];
    if (!page) return err('kneeboard.empty', 'There is nothing to show for that page.');
    const size = KNEEBOARD_SIZE;
    const png = await renderPage(this.ctx.ports.render, page.html, size);
    if (!png.ok) return png;
    return ok({
      image: `data:image/png;base64,${Buffer.from(png.value).toString('base64')}`,
      width: size.width,
      height: size.height,
    });
  }
}
