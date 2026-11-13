import { errorText } from '../../../renderer/ipc';
import { MAX_PICTURE_CHARS, type Photo } from '../core/drawings';
import type { useCheatSheets } from './store';

/**
 * A photo on its way into a drawing. The main process has checked that the file is a
 * picture and not too large; here it is drawn again as the copy RigReady keeps.
 */

/** A photo is kept no larger than this on its long side: plenty for a sheet. */
const LONG_SIDE = 1400;
const QUALITY = 0.85;

function load(image: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () =>
      resolve(probe.naturalWidth > 0 && probe.naturalHeight > 0 ? probe : undefined);
    probe.onerror = () => resolve(undefined);
    probe.src = image;
  });
}

/**
 * The picture as RigReady keeps it: drawn again, as a JPEG no larger than a sheet needs.
 * Drawing it again turns a phone's photo the right way up, and leaves behind everything
 * else the camera stored in the file (where and when it was taken). Undefined when the
 * file cannot be drawn.
 */
export async function preparePhoto(image: string): Promise<Photo | undefined> {
  const picture = await load(image);
  if (!picture) return undefined;
  const scale = Math.min(1, LONG_SIDE / Math.max(picture.naturalWidth, picture.naturalHeight));
  const width = Math.max(1, Math.round(picture.naturalWidth * scale));
  const height = Math.max(1, Math.round(picture.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext('2d');
  if (!pen) return undefined;
  pen.fillStyle = '#ffffff';
  pen.fillRect(0, 0, width, height);
  pen.drawImage(picture, 0, 0, width, height);
  const kept = canvas.toDataURL('image/jpeg', QUALITY);
  return kept.startsWith('data:image/jpeg;base64,') ? { image: kept, width, height } : undefined;
}

export interface ChosenPhoto {
  /** Absent when the user closed the dialog, or with a `problem`. */
  photo?: Photo;
  /** Why the file chosen was not taken, in plain words. */
  problem?: string;
}

/**
 * Asks for a photo file and makes RigReady's copy of it. `kept` is how much the photos
 * already in the drawing take; a photo that would make them too much together is refused.
 */
export async function choosePhoto(
  api: ReturnType<typeof useCheatSheets>['api'],
  kept: number
): Promise<ChosenPhoto> {
  const result = await api.pickPhoto();
  if (!result.ok) return { problem: errorText(result.error) };
  const { image, file } = result.value;
  if (!image) return {};
  const photo = await preparePhoto(image);
  if (!photo) {
    return {
      problem: `${file ?? 'That file'} could not be opened as a picture. Choose a JPEG, PNG or WebP photo.`,
    };
  }
  // All the photos of one drawing together: the most a layout holds (MAX_PICTURE_CHARS).
  if (kept + photo.image.length > MAX_PICTURE_CHARS) {
    return {
      problem:
        'The photos of this device are too large together. Remove one, or choose a smaller photo.',
    };
  }
  return { photo };
}
