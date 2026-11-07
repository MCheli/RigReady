import { drawingFor, planCallouts, planList, renderPlanSvg, applyChanges } from './drawings';
import type { CalloutPlan, DeviceDrawing } from './drawings';
import { renderDeviceSvg, type ThemeName } from './render';
import type { SheetDevice } from './sheet';

/**
 * How the picture of a device is drawn, decided in one place for the app, the trainer,
 * the PDF and the kneeboard:
 *
 * - **drawing**: RigReady has a drawing of the device (or the user made or imported one):
 *   the silhouette with a label block per physical control and a leader to it.
 * - **cards**: the user arranged a layout of their own (their places are kept), or the
 *   device has a shipped layout but no drawing yet.
 * - **list**: nothing is known about the device: its controls as blocks, no picture.
 */
export type Picture =
  | {
      kind: 'drawing';
      drawing: DeviceDrawing;
      /** RigReady's drawing, RigReady's with the user's changes, or the user's own. */
      source: 'builtin' | 'changed' | 'custom';
      background?: { image: string; opacity: number };
    }
  | { kind: 'cards' }
  | { kind: 'list' };

type PictureDevice = Pick<
  SheetDevice,
  'vendorId' | 'productId' | 'name' | 'layout' | 'layoutSource' | 'controls' | 'reports'
>;

export function pictureFor(device: Omit<PictureDevice, 'controls' | 'reports'>): Picture {
  const changes = device.layout.drawing;
  const background = device.layout.background
    ? { image: device.layout.background.image, opacity: device.layout.background.opacity }
    : undefined;
  if (changes?.custom) {
    return {
      kind: 'drawing',
      drawing: applyChanges(changes.custom, changes),
      source: 'custom',
      ...(background ? { background } : {}),
    };
  }
  const builtin = drawingFor(device);
  if (device.layoutSource === 'user') {
    if (!changes || !builtin) return { kind: 'cards' };
    return {
      kind: 'drawing',
      drawing: applyChanges(builtin, changes),
      source: 'changed',
      ...(background ? { background } : {}),
    };
  }
  if (builtin) return { kind: 'drawing', drawing: builtin, source: 'builtin' };
  return device.layoutSource === 'builtin' ? { kind: 'cards' } : { kind: 'list' };
}

export interface PictureOptions {
  theme: ThemeName;
  /** Controls nothing is bound to are shown too (empty). Default true. */
  showEmpty?: boolean;
  /** Text size; with `fill`, the largest size the picture still fits in. Default 1. */
  fontScale?: number;
  /**
   * The canvas height the picture is meant to fill (canvas 1000 wide): the drawing grows
   * towards it, and the text is made as large as fits, up to `maxFontScale`.
   */
  fill?: number;
  maxFontScale?: number;
  /** The layout editor. */
  edit?: boolean;
}

/** How far label columns may run on below the drawing before the text is made smaller. */
const OVERFLOW_ALLOWED = 30;

/** The plan of a device drawn as a drawing or a list; undefined when it is drawn as cards. */
export function planPicture(
  device: PictureDevice,
  options: Omit<PictureOptions, 'theme'>,
  picture: Picture = pictureFor(device)
): CalloutPlan | undefined {
  if (picture.kind === 'cards') return undefined;
  const showEmpty = options.showEmpty ?? true;
  const plan = (fontScale: number, fill: number | undefined): CalloutPlan =>
    picture.kind === 'drawing'
      ? planCallouts(picture.drawing, device.controls, {
          showEmpty,
          fontScale,
          ...(fill !== undefined ? { fill } : {}),
        })
      : planList(device.controls, device.reports, { showEmpty, fontScale });
  const least = options.fontScale ?? 1;
  if (options.fill === undefined || options.maxFontScale === undefined) {
    return plan(least, options.fill);
  }
  // As large as fits the page: kneeboards are read at arm's length in a moving cockpit.
  // But not so large that the label columns run on far below the drawing, where the
  // leaders get long and steep. Each size is tried with the drawing grown to the page
  // (narrower columns) and at its own size (wider columns, fewer wrapped lines); of those
  // that fit, the largest text whose columns end about as high as the best manages.
  const tried: CalloutPlan[] = [];
  for (let scale = options.maxFontScale; scale >= least - 0.001; scale -= 0.04) {
    const size = Math.max(least, Math.round(scale * 100) / 100);
    for (const fill of [options.fill, undefined]) {
      const made = plan(size, fill);
      if (made.height <= options.fill) tried.push(made);
    }
  }
  if (tried.length === 0) return plan(least, options.fill);
  const best = Math.min(...tried.map((p) => p.overflow));
  const allowed = (p: CalloutPlan): number =>
    Math.max(OVERFLOW_ALLOWED, p.placed ? p.placed.drawing.size.height * p.placed.scale * 0.2 : 0);
  return tried.find((p) => p.overflow <= best + allowed(p)) ?? tried[tried.length - 1]!;
}

/** The picture of one device with its labels, as SVG markup. */
export function renderPictureSvg(device: PictureDevice, options: PictureOptions): string {
  const picture = pictureFor(device);
  const plan = planPicture(device, options, picture);
  if (!plan) {
    return renderDeviceSvg(device, {
      theme: options.theme,
      ...(options.showEmpty !== undefined ? { showEmpty: options.showEmpty } : {}),
      ...(options.fontScale !== undefined ? { fontScale: options.fontScale } : {}),
      ...(options.edit ? { edit: true } : {}),
    });
  }
  return renderPlanSvg(plan, device.controls, {
    theme: options.theme,
    ...(options.edit ? { edit: true } : {}),
    ...(picture.kind === 'drawing' && picture.background ? { background: picture.background } : {}),
  });
}
