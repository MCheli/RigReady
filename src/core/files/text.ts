import type { FileStore } from '../ports';
import { err, type Result } from '../result';

/** Text without the byte order mark some editors (and PowerShell's Out-File) put first. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The largest file RigReady reads as one of its own data files (settings, setups, layouts, stores). */
export const MAX_DATA_FILE_BYTES = 16 * 1024 * 1024;

const megabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Reads one of RigReady's own data files: refused when it is larger than anything
 * RigReady would have written (a damaged or foreign file is not parsed for minutes),
 * and without a byte order mark.
 */
export async function readDataText(
  files: FileStore,
  file: string,
  maxBytes = MAX_DATA_FILE_BYTES
): Promise<Result<string>> {
  const stat = await files.stat(file);
  if (!stat.ok) return stat;
  if (stat.value && stat.value.size > maxBytes) {
    return err(
      'file.tooLarge',
      `${file} is too large to be read (${megabytes(stat.value.size)}; the limit is ${megabytes(maxBytes)}).`
    );
  }
  const text = await files.readText(file);
  if (!text.ok) return text;
  return { ok: true, value: stripBom(text.value) };
}
