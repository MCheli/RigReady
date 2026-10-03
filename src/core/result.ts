import { z } from 'zod';

/** Expected failures travel as values. Throwing is reserved for bugs. */
export const RigErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  detail: z.string().optional(),
});
export type RigError = z.infer<typeof RigErrorSchema>;

export type Result<T, E = RigError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = (code: string, message: string, detail?: string): Result<never, RigError> => ({
  ok: false,
  error: detail === undefined ? { code, message } : { code, message, detail },
});

/** Converts a thrown value into a RigError result. Use at port boundaries. */
export function fromThrown(
  code: string,
  message: string,
  thrown: unknown
): Result<never, RigError> {
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return err(code, message, detail);
}

/** Runs fn and converts a throw into an error result. */
export async function attempt<T>(
  code: string,
  message: string,
  fn: () => Promise<T> | T
): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return fromThrown(code, message, e);
  }
}
