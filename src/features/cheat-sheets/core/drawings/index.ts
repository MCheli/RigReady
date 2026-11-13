import { DRAWINGS } from './builtin';
import { drawingMatches, parseDrawing, type DeviceDrawing } from './silhouette';

/**
 * Device drawings with automatic callouts: the picture of a device RigReady has a drawing
 * of (see docs/research/controller-drawings.md). `../picture.ts` decides, per device,
 * whether its sheet is drawn this way, as the cards of a layout, or as a list.
 */

export interface BuiltinDrawings {
  drawings: DeviceDrawing[];
  broken: { name: string; reason: string }[];
}

let cached: BuiltinDrawings | undefined;

/** The shipped drawings, validated like any imported file. */
export function builtinDrawings(): BuiltinDrawings {
  if (cached) return cached;
  const drawings: DeviceDrawing[] = [];
  const broken: BuiltinDrawings['broken'] = [];
  for (const raw of DRAWINGS) {
    const parsed = parseDrawing(raw);
    if (parsed.ok) drawings.push(parsed.drawing);
    else broken.push({ name: raw.name, reason: parsed.reason });
  }
  cached = { drawings, broken };
  return cached;
}

/** The shipped drawing of a device: by its product id first, else by a part of its name. */
export function drawingFor(device: {
  vendorId?: string | undefined;
  productId?: string | undefined;
  name?: string | undefined;
}): DeviceDrawing | undefined {
  const { drawings } = builtinDrawings();
  const pid = device.productId?.toUpperCase();
  return (
    drawings.find((d) => pid !== undefined && drawingMatches(d, { ...device, name: '' })) ??
    drawings.find((d) => drawingMatches(d, { ...device, productId: undefined }))
  );
}

export {
  planCallouts,
  planList,
  crossings,
  segmentsCross,
  stack,
  wrapText,
  numbersOf,
  LAYOUT_METRICS,
} from './callouts';
export type {
  CalloutPlan,
  Callout,
  Row,
  PlanOptions,
  ReportedShape,
  NamedControl,
} from './callouts';
export { renderPlanSvg } from './renderDrawing';
export type { RenderDrawingOptions } from './renderDrawing';
export {
  parseDrawing,
  pathBox,
  drawnInputs,
  applyChanges,
  drawingMatches,
  DeviceDrawingSchema,
  DrawingChangesSchema,
  DRAWING_FORMAT,
  DRAWING_VERSION,
  MAX_PICTURE_CHARS,
  MAX_VIEWS,
} from './silhouette';
export type {
  DeviceDrawing,
  DeviceDrawingInput,
  DrawingChanges,
  DrawingView,
  PhysicalControl,
  Side,
} from './silhouette';
export * as photo from './photo';
export type { HatWay, HatWays, Photo, Placement, Unplaced } from './photo';
