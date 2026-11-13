/**
 * Names on a drawing of the monitors. A small screen drawn to scale next to a very wide
 * one is a narrow box, and its name does not fit in it. Cutting the name to "M…", turning
 * it on its side or leaving it out all hide which screen is which. So a box whose name
 * does not fit gets a short mark instead, and a key under the drawing says what each mark
 * stands for. A box with room keeps its name.
 */

/** Space kept free on both sides of a name inside its box, in px. */
export const NAME_PADDING = 10;

/**
 * Roughly how wide a line of the app's text is drawn, in px. The app's font averages a
 * little over half its size per character; this errs on the wide side, so a name that is
 * said to fit does fit.
 */
export function textWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.62;
}

/** Does this name fit on one line in a box this wide? */
export function nameFits(label: string, boxWidthPx: number, fontPx: number): boolean {
  return textWidth(label, fontPx) + NAME_PADDING <= boxWidthPx;
}

export interface KeyBox {
  id: string;
  label: string;
  /** Where it is drawn, for the order of the marks: from left to right, then top to bottom. */
  left: number;
  top: number;
  /** How wide it is drawn, in px: the narrowest, when it is drawn in more than one size. */
  width: number;
  /** A number the drawing already shows on this box (Identify's). It is the mark then. */
  number?: number | undefined;
}

export interface KeyEntry {
  id: string;
  /** What stands in the box: "A", "B", ..., or the number the box already shows. */
  mark: string;
  label: string;
  /** True when the mark is a letter that the box has to show itself. */
  lettered: boolean;
}

/**
 * The key of a drawing: one entry for every box whose name does not fit in it, in the
 * order the boxes stand. Empty when every name fits.
 */
export function mapKey(boxes: readonly KeyBox[], fontPx: number): KeyEntry[] {
  let next = 0;
  return [...boxes]
    .sort((a, b) => a.left - b.left || a.top - b.top)
    .filter((box) => !nameFits(box.label, box.width, fontPx))
    .map((box) => {
      if (box.number !== undefined) {
        return { id: box.id, mark: String(box.number), label: box.label, lettered: false };
      }
      const n = next++;
      // Past Z there are more screens than letters: they go on as numbers.
      const mark = n < 26 ? String.fromCharCode(65 + n) : String(n + 1);
      return { id: box.id, mark, label: box.label, lettered: true };
    });
}

/**
 * How wide the whole drawing is, in px: as wide as the room it has, but never so wide that
 * it would be taller than `maxHeight`. `ratio` is its height as a fraction of its width.
 * Before the room is measured the widest it can be is assumed.
 */
export function frameWidth(room: number | undefined, maxHeight: number, ratio: number): number {
  const widest = ratio > 0 ? maxHeight / ratio : (room ?? 0);
  return room !== undefined && room > 0 ? Math.min(room, widest) : widest;
}
