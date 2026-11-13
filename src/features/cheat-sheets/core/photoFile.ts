import type { DeviceLayout } from './layout';
import type { Sheet } from './sheet';

/**
 * A photo of the user's own, on its way into a drawing and out of what others can read.
 *
 * In: a file is a picture when its first bytes say so; the ending of its name proves
 * nothing. Out: a photo is the user's, of their own desk. It is kept in RigReady's folder
 * and shown in RigReady's own windows; the answer an assistant gets about a sheet carries
 * a grey box in its place.
 */

/** A photo file larger than this is refused before it is read. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export type PictureKind = 'image/jpeg' | 'image/png' | 'image/webp';

const ascii = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, to));

const startsWith = (bytes: Uint8Array, start: number[]): boolean =>
  bytes.length >= start.length && start.every((value, at) => bytes[at] === value);

/** The photo formats of phones that the app cannot draw: HEIC and its relatives. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** What the first bytes of a file say it is. */
export function pictureKind(bytes: Uint8Array): PictureKind | 'heic' | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 12))) {
    return 'heic';
  }
  return undefined;
}

/** "3.2 MB", "31 MB". */
function megabytes(size: number): string {
  const mb = size / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** Why a file of this size is not taken as a photo; undefined when it may be read. */
export function photoSizeProblem(name: string, size: number): string | undefined {
  if (size === 0) return `${name} is empty. Choose a JPEG, PNG or WebP photo.`;
  if (size <= MAX_PHOTO_BYTES) return undefined;
  return `${name} is too large (${megabytes(size)}). RigReady takes photos up to ${megabytes(MAX_PHOTO_BYTES)}. Save a smaller copy and choose that.`;
}

/** Why a file that is not a JPEG, PNG or WebP picture is not taken as a photo. */
export function photoKindProblem(name: string, kind: 'heic' | undefined): string {
  if (kind === 'heic') {
    return `${name} is an HEIC photo, which RigReady cannot open. Save or send it as a JPEG and choose that.`;
  }
  return `${name} is not a picture RigReady can open. Choose a JPEG, PNG or WebP photo.`;
}

// ---- out ----

/**
 * What stands in for a photo where it is left out: a plain grey box. It is this SVG in
 * base64 (a test reads it back): a 100 by 100 rect, fill #8a8f98 at a quarter strength.
 */
export const PICTURE_LEFT_OUT =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBw' +
  'cmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0i' +
  'IzhhOGY5OCIgZmlsbC1vcGFjaXR5PSIwLjI1Ii8+PC9zdmc+';

/** A layout with every picture of the user's swapped for the grey box. */
export function layoutWithoutPictures(layout: DeviceLayout): DeviceLayout {
  const custom = layout.drawing?.custom;
  if (!layout.background && !custom?.image && !custom?.views?.length) return layout;
  const next: DeviceLayout = { ...layout };
  if (layout.background) next.background = { ...layout.background, image: PICTURE_LEFT_OUT };
  if (layout.drawing && custom) {
    next.drawing = {
      ...layout.drawing,
      custom: {
        ...custom,
        ...(custom.image ? { image: PICTURE_LEFT_OUT } : {}),
        ...(custom.views
          ? { views: custom.views.map((view) => ({ ...view, image: PICTURE_LEFT_OUT })) }
          : {}),
      },
    };
  }
  return next;
}

/** True when a layout carries the grey box where a photo was left out. */
export function hasLeftOut(layout: DeviceLayout): boolean {
  const custom = layout.drawing?.custom;
  return (
    layout.background?.image === PICTURE_LEFT_OUT ||
    custom?.image === PICTURE_LEFT_OUT ||
    (custom?.views ?? []).some((view) => view.image === PICTURE_LEFT_OUT)
  );
}

/**
 * The saved view a grey box stands for: the one of the same name. A view can be dropped or
 * moved before the layout comes back (an assistant reordered "Front" and "Back"), so its
 * place in the list says nothing by itself; it decides only between views that share a
 * name. Undefined when no saved view has that name, or several do and none at that place.
 */
function savedViewFor<V extends { name: string }>(
  saved: readonly V[],
  name: string,
  index: number
): V | undefined {
  const named = saved.filter((view) => view.name === name);
  if (named.length === 1) return named[0];
  const there = saved[index];
  return there && there.name === name ? there : undefined;
}

/**
 * A layout that comes back with grey boxes (read without its photos, changed, saved
 * again) gets the photos of the saved layout back, each into the view of the same name,
 * so saving it never costs the user a photo or puts one under another view's markers.
 * Undefined when a box has no saved photo to come back to.
 */
export function withSavedPictures(
  layout: DeviceLayout,
  saved: DeviceLayout | undefined
): DeviceLayout | undefined {
  const next: DeviceLayout = { ...layout };
  if (layout.background?.image === PICTURE_LEFT_OUT) {
    const image = saved?.background?.image;
    if (!image || image === PICTURE_LEFT_OUT) return undefined;
    next.background = { ...layout.background, image };
  }
  const custom = layout.drawing?.custom;
  if (!layout.drawing || !custom) return next;
  const before = saved?.drawing?.custom;
  let image = custom.image;
  if (image === PICTURE_LEFT_OUT) {
    image = before?.image;
    if (!image || image === PICTURE_LEFT_OUT) return undefined;
  }
  const views = custom.views?.map((view, index) => {
    if (view.image !== PICTURE_LEFT_OUT) return view;
    const old = savedViewFor(before?.views ?? [], view.name, index)?.image;
    return old && old !== PICTURE_LEFT_OUT ? { ...view, image: old } : undefined;
  });
  if (views?.some((view) => view === undefined)) return undefined;
  next.drawing = {
    ...layout.drawing,
    custom: {
      ...custom,
      ...(image ? { image } : {}),
      ...(views ? { views: views.filter((view) => view !== undefined) } : {}),
    },
  };
  return next;
}

/**
 * The sheet as an assistant may read it: every control, name and label, and where each
 * control is, but none of the user's photos.
 */
export function sheetWithoutPictures(sheet: Sheet): Sheet {
  return {
    ...sheet,
    devices: sheet.devices.map((device) => ({
      ...device,
      layout: layoutWithoutPictures(device.layout),
    })),
  };
}
