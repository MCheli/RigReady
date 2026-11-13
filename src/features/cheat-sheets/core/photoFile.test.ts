import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { FakeRender } from '../../../platform/fake';
import { cheatSheetsContract } from '../contract';
import { photo as photos, type DeviceDrawing } from './drawings';
import type { DeviceLayout } from './layout';
import {
  hasLeftOut,
  layoutWithoutPictures,
  MAX_PHOTO_BYTES,
  PICTURE_LEFT_OUT,
  photoKindProblem,
  photoSizeProblem,
  pictureKind,
  withSavedPictures,
} from './photoFile';
import { pictureFor } from './picture';
import type { Sheet, SheetDevice } from './sheet';

/**
 * A photo of the user's own on its way in (what is taken as a photo and what is refused,
 * with the reason) and on its way out (RigReady's own windows show it; what an assistant
 * reads has a grey box in its place, and saving such a layout again keeps the photo).
 */

const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };
const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
  'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
];
/** A tiny real PNG, standing in for the user's photo of a device, and a second one. */
const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAFklEQVR4nGNsaGhgwAaYsIoOWgkAVXYBjYpOvYQAAAAASUVORK5CYII=';
const SECOND = 'data:image/jpeg;base64,/9j/4A==';
const PNG_BYTES = Buffer.from(PHOTO.split(',')[1]!, 'base64');
const JPEG_START = [0xff, 0xd8, 0xff, 0xe0];

const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'latin1'));

describe('what a file is', () => {
  it('is told by its first bytes: JPEG, PNG and WebP are photos, HEIC is named, the rest is not a picture', () => {
    expect(pictureKind(new Uint8Array(PNG_BYTES))).toBe('image/png');
    expect(pictureKind(new Uint8Array([...JPEG_START, 0, 16]))).toBe('image/jpeg');
    expect(pictureKind(bytesOf('RIFF\x24\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
    expect(pictureKind(bytesOf('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00'))).toBe('heic');
    expect(pictureKind(bytesOf('\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00'))).toBe('heic');
    // A film, a text, a page with a script, a file cut short, nothing at all.
    expect(pictureKind(bytesOf('\x00\x00\x00\x18ftypisom\x00\x00\x00\x00'))).toBeUndefined();
    expect(pictureKind(bytesOf('hello, this is a text'))).toBeUndefined();
    expect(pictureKind(bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBe(
      undefined
    );
    expect(pictureKind(bytesOf('RIFF\x24\x00\x00\x00WAVEfmt '))).toBeUndefined();
    expect(pictureKind(new Uint8Array([0x89, 0x50]))).toBeUndefined();
    expect(pictureKind(new Uint8Array())).toBeUndefined();
  });

  it('is refused in plain words when it is empty, too large, or not a picture RigReady can open', () => {
    expect(photoSizeProblem('stick.jpg', 3_000_000)).toBeUndefined();
    expect(photoSizeProblem('stick.jpg', MAX_PHOTO_BYTES)).toBeUndefined();
    expect(photoSizeProblem('stick.jpg', 0)).toBe(
      'stick.jpg is empty. Choose a JPEG, PNG or WebP photo.'
    );
    expect(photoSizeProblem('stick.jpg', 31 * 1024 * 1024)).toBe(
      'stick.jpg is too large (31 MB). RigReady takes photos up to 25 MB. Save a smaller copy and choose that.'
    );
    expect(photoKindProblem('IMG_0042.heic', 'heic')).toBe(
      'IMG_0042.heic is an HEIC photo, which RigReady cannot open. Save or send it as a JPEG and choose that.'
    );
    expect(photoKindProblem('notes.jpg', undefined)).toBe(
      'notes.jpg is not a picture RigReady can open. Choose a JPEG, PNG or WebP photo.'
    );
  });
});

/** A layout with a drawing of two photos, and one with a background photo. */
function drawingOfPhotos(): DeviceDrawing {
  let drawing = photos.photoDrawing(
    { title: 'Pedals', vendorId: '044F', productId: 'B68F' },
    { image: PHOTO, width: 800, height: 600 }
  );
  drawing = photos.addView(drawing, { image: SECOND, width: 800, height: 600 }, 'Back')!;
  return photos.place(drawing, photos.controlOfInput('axis:Z'), { x: 250, y: 200 });
}
const layoutOf = (custom: DeviceDrawing): DeviceLayout =>
  ({
    name: 'Pedals',
    drawing: { anchors: {}, sides: {}, names: {}, custom },
  }) as unknown as DeviceLayout;
const imagesOf = (layout: DeviceLayout): (string | undefined)[] => [
  layout.background?.image,
  layout.drawing?.custom?.image,
  ...(layout.drawing?.custom?.views ?? []).map((view) => view.image),
];

describe('a layout without its photos', () => {
  it('has a plain grey box where each photo was, and everything else as it was', () => {
    // The box is a picture with nothing in it but a grey rectangle.
    const svg = Buffer.from(PICTURE_LEFT_OUT.split(',')[1]!, 'base64').toString('utf8');
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100" height="100" fill="#8a8f98" fill-opacity="0.25"/></svg>'
    );

    const layout = layoutOf(drawingOfPhotos());
    expect(hasLeftOut(layout)).toBe(false);
    const bare = layoutWithoutPictures(layout);
    expect(imagesOf(bare)).toEqual([undefined, undefined, PICTURE_LEFT_OUT, PICTURE_LEFT_OUT]);
    expect(hasLeftOut(bare)).toBe(true);
    expect(JSON.stringify(bare)).not.toContain(PHOTO);
    // Where the photos are, their names and every control: unchanged.
    expect(bare.drawing!.custom!.controls).toEqual(layout.drawing!.custom!.controls);
    expect(
      bare.drawing!.custom!.views!.map(({ name, x, y, w, h }) => ({ name, x, y, w, h }))
    ).toEqual(layout.drawing!.custom!.views!.map(({ name, x, y, w, h }) => ({ name, x, y, w, h })));
    // The layout handed in is not touched.
    expect(imagesOf(layout)).toEqual([undefined, undefined, PHOTO, SECOND]);

    // A drawing of one picture as they were made before, and a background photo.
    const before = { ...drawingOfPhotos(), image: PHOTO };
    delete before.views;
    const old = {
      ...layoutOf(before),
      background: { image: SECOND, x: 0, y: 0, w: 300, h: 200, opacity: 0.8 },
    } as DeviceLayout;
    const oldBare = layoutWithoutPictures(old);
    expect(imagesOf(oldBare)).toEqual([PICTURE_LEFT_OUT, PICTURE_LEFT_OUT]);
    expect(oldBare.background).toMatchObject({ x: 0, y: 0, w: 300, h: 200, opacity: 0.8 });
    expect(hasLeftOut(oldBare)).toBe(true);

    // Nothing to leave out: the same layout comes back.
    const plain = { name: 'Stick' } as unknown as DeviceLayout;
    expect(layoutWithoutPictures(plain)).toBe(plain);
  });

  it('gets its photos back from the saved layout, each at its place, or says it cannot', () => {
    const saved = layoutOf(drawingOfPhotos());
    const bare = layoutWithoutPictures(saved);
    // Changed while it was read without its photos: a control moved.
    const moved: DeviceLayout = {
      ...bare,
      drawing: {
        ...bare.drawing!,
        custom: photos.moveTo(bare.drawing!.custom!, 'axis-Z', { x: 300, y: 300 }),
      },
    };
    const restored = withSavedPictures(moved, saved)!;
    expect(imagesOf(restored)).toEqual([undefined, undefined, PHOTO, SECOND]);
    expect(restored.drawing!.custom!.controls[0]!.at).toEqual({ x: 300, y: 300 });
    expect(hasLeftOut(restored)).toBe(false);

    // A photo of its own beside a box: the new photo stays, the box gets the saved one.
    const mixed: DeviceLayout = {
      ...bare,
      drawing: {
        ...bare.drawing!,
        custom: {
          ...bare.drawing!.custom!,
          views: bare.drawing!.custom!.views!.map((view, index) =>
            index === 0 ? { ...view, image: `${PHOTO}#new` } : view
          ),
        },
      },
    };
    expect(imagesOf(withSavedPictures(mixed, saved)!)).toEqual([
      undefined,
      undefined,
      `${PHOTO}#new`,
      SECOND,
    ]);

    // No saved layout, a saved one with no photo there, or one more box than photos.
    expect(withSavedPictures(bare, undefined)).toBeUndefined();
    expect(withSavedPictures(bare, { name: 'Pedals' } as unknown as DeviceLayout)).toBeUndefined();
    expect(withSavedPictures(bare, bare)).toBeUndefined();
    const three = layoutWithoutPictures(
      layoutOf(
        photos.addView(drawingOfPhotos(), { image: PHOTO, width: 400, height: 300 }, 'Side')!
      )
    );
    expect(withSavedPictures(three, saved)).toBeUndefined();

    // A background photo comes back the same way.
    const withBackground = {
      name: 'Stick',
      background: { image: PHOTO, x: 0, y: 0, w: 300, h: 200, opacity: 1 },
    } as unknown as DeviceLayout;
    const boxed = layoutWithoutPictures(withBackground);
    expect(withSavedPictures(boxed, withBackground)!.background!.image).toBe(PHOTO);
    expect(withSavedPictures(boxed, { name: 'Stick' } as unknown as DeviceLayout)).toBeUndefined();
    // A layout with no box in it comes back as it is.
    expect(withSavedPictures(saved, undefined)).toEqual(saved);
  });
});

// ---- in the app ----

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function start(): Promise<WiredApp> {
  app = await wiredApp('cheat-sheets-hornet', { files: FILES });
  return app;
}

const byTitle = (sheet: Sheet, title: string): SheetDevice => {
  const device = sheet.devices.find((d) => d.title === title);
  if (!device) throw new Error(`No device ${title} in ${sheet.devices.map((d) => d.title)}`);
  return device;
};
const PEDALS = { vendorId: '044F', productId: 'B68F' };
const pngPages = (running: WiredApp): string[] =>
  (running.ports.render as FakeRender).calls.filter((c) => c.kind === 'png').map((c) => c.html);

describe('choosing a photo', () => {
  it('takes a JPEG, PNG or WebP with its file name, and refuses the rest with the reason', async () => {
    const running = await start();
    const docs = path.join(running.home, 'Documents');
    await fs.mkdir(docs, { recursive: true });
    await fs.writeFile(path.join(docs, 'stick.jpg'), Buffer.from(JPEG_START));
    await fs.writeFile(path.join(docs, 'throttle.png'), PNG_BYTES);
    // A text with the ending of a picture, and a phone's HEIC with the ending of a JPEG.
    await fs.writeFile(path.join(docs, 'notes.jpg'), 'hello, this is a text');
    await fs.writeFile(
      path.join(docs, 'IMG_0042.jpg'),
      bytesOf('\x00\x00\x00\x18ftypheic\x00\x00')
    );
    await fs.writeFile(path.join(docs, 'empty.png'), '');
    // One byte over the limit, without writing 25 MB.
    const huge = path.join(docs, 'huge.jpg');
    await fs.writeFile(huge, Buffer.from(JPEG_START));
    await fs.truncate(huge, MAX_PHOTO_BYTES + 1);
    running.ports.dialogs.script.open.push(
      ['Documents/stick.jpg'],
      ['Documents/throttle.png'],
      ['Documents/notes.jpg'],
      ['Documents/IMG_0042.jpg'],
      ['Documents/empty.png'],
      ['Documents/huge.jpg'],
      ['Documents/gone.jpg'],
      []
    );
    const pick = (): Promise<unknown> => running.invoke('cheat-sheets:pickPhoto');
    expect(await pick()).toEqual({ image: 'data:image/jpeg;base64,/9j/4A==', file: 'stick.jpg' });
    expect(await pick()).toEqual({ image: PHOTO, file: 'throttle.png' });
    await expect(pick()).rejects.toThrow(
      'notes.jpg is not a picture RigReady can open. Choose a JPEG, PNG or WebP photo.'
    );
    await expect(pick()).rejects.toThrow(/IMG_0042\.jpg is an HEIC photo.*as a JPEG/);
    await expect(pick()).rejects.toThrow(/empty\.png is empty/);
    await expect(pick()).rejects.toThrow(
      /huge\.jpg is too large \(25 MB\)\. RigReady takes photos up to 25 MB/
    );
    await expect(pick()).rejects.toThrow(/gone\.jpg is not there any more/);
    // The dialog closed without a choice: nothing, and no complaint.
    expect(await pick()).toEqual({ image: null });
    // Choosing touches nothing outside RigReady's folder: the photo is saved with the
    // layout, when the user saves.
    const journal = await running.ports.files.journal();
    expect(journal.ok && journal.value).toEqual([]);
  });
});

describe('the photos of a saved drawing', () => {
  it('are in RigReady’s own windows and on the pages the user exports, and left out of what an assistant reads', async () => {
    const running = await start();
    const pedals = byTitle(
      await running.invoke<Sheet>('cheat-sheets:windowSheet', HORNET),
      'Pedals'
    );
    const layout: DeviceLayout = {
      ...pedals.layout,
      drawing: { anchors: {}, sides: {}, names: {}, custom: drawingOfPhotos() },
    };
    await running.invoke('cheat-sheets:saveLayout', { ...PEDALS, layout });

    // The window: the photos, and a drawing made of them.
    const inWindow = byTitle(
      await running.invoke<Sheet>('cheat-sheets:windowSheet', HORNET),
      'Pedals'
    );
    expect(imagesOf(inWindow.layout)).toEqual([undefined, undefined, PHOTO, SECOND]);
    expect(pictureFor(inWindow)).toMatchObject({ kind: 'drawing', source: 'custom' });

    // What an assistant reads: the same sheet, a grey box for each photo.
    const read = await running.invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const toRead = byTitle(read, 'Pedals');
    expect(imagesOf(toRead.layout)).toEqual([
      undefined,
      undefined,
      PICTURE_LEFT_OUT,
      PICTURE_LEFT_OUT,
    ]);
    expect(JSON.stringify(read)).not.toContain(PHOTO);
    expect(toRead.layout.drawing!.custom!.controls).toEqual(
      inWindow.layout.drawing!.custom!.controls
    );
    expect(toRead.controls).toEqual(inWindow.controls);
    // Only the two channels for RigReady's own windows carry photos, and no assistant
    // is offered those or the file dialog.
    const { channels } = cheatSheetsContract;
    expect(channels.sheet.meta?.tier).toBe('read');
    expect(channels.kneeboardPreview.meta?.tier).toBe('read');
    expect(channels.windowSheet.meta?.tier).toBe('off');
    expect(channels.windowKneeboardPreview.meta?.tier).toBe('off');
    expect(channels.pickPhoto.meta?.tier).toBe('off');

    // The kneeboard page: with the photos in the window, with grey boxes for an assistant.
    const page = { ...HORNET, deviceKey: pedals.key, style: 'light' };
    await running.invoke('cheat-sheets:windowKneeboardPreview', page);
    await running.invoke('cheat-sheets:kneeboardPreview', page);
    const [shown, answered] = pngPages(running).slice(-2);
    expect(shown).toContain(`href="${PHOTO}"`);
    expect(answered).not.toContain(PHOTO);
    expect(answered).toContain(`href="${PICTURE_LEFT_OUT}"`);
    expect(answered!.replaceAll(PICTURE_LEFT_OUT, '')).toBe(
      shown!.replaceAll(SECOND, '').replaceAll(PHOTO, '')
    );

    // The pages the user exports to the game carry the photos.
    await running.invoke('cheat-sheets:exportKneeboard', {
      ...HORNET,
      options: { devices: [pedals.key], styles: ['light'], summary: false },
    });
    expect(pngPages(running).at(-1)).toContain(`href="${PHOTO}"`);
  });

  it('stay saved when a layout read without them is saved again, and a box with no photo behind it is refused', async () => {
    const running = await start();
    const pedals = byTitle(
      await running.invoke<Sheet>('cheat-sheets:windowSheet', HORNET),
      'Pedals'
    );
    const layout: DeviceLayout = {
      ...pedals.layout,
      drawing: { anchors: {}, sides: {}, names: {}, custom: drawingOfPhotos() },
    };

    // Nothing saved yet: a layout with grey boxes has no photo to come back to.
    await expect(
      running.invoke('cheat-sheets:saveLayout', {
        ...PEDALS,
        layout: layoutWithoutPictures(layout),
      })
    ).rejects.toThrow(
      'This layout has a grey box where a photo was left out, and there is no saved photo to put back. Add the photo in RigReady, on the cheat sheet.'
    );
    expect(
      pictureFor(byTitle(await running.invoke<Sheet>('cheat-sheets:windowSheet', HORNET), 'Pedals'))
        .kind
    ).not.toBe('drawing');

    await running.invoke('cheat-sheets:saveLayout', { ...PEDALS, layout });
    // Read as an assistant reads it, a control moved, saved again.
    const read = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Pedals');
    expect(hasLeftOut(read.layout)).toBe(true);
    await running.invoke('cheat-sheets:saveLayout', {
      ...PEDALS,
      layout: {
        ...read.layout,
        drawing: {
          ...read.layout.drawing!,
          custom: photos.moveTo(read.layout.drawing!.custom!, 'axis-Z', { x: 300, y: 300 }),
        },
      },
    });
    const after = byTitle(
      await running.invoke<Sheet>('cheat-sheets:windowSheet', HORNET),
      'Pedals'
    );
    expect(imagesOf(after.layout)).toEqual([undefined, undefined, PHOTO, SECOND]);
    expect(after.layout.drawing!.custom!.controls[0]!.at).toEqual({ x: 300, y: 300 });
  });
});
