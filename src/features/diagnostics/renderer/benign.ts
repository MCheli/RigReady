/**
 * Window errors that are not errors. Chromium reports a ResizeObserver callback that
 * changed a layout it was observing as an "error" event with no Error object; the
 * notifications are simply delivered on the next frame, so nothing is lost and there
 * is nothing for the user to do. Showing it as a notice would cover the page (it did:
 * a Save button on the setup editor, on a slow CI runner).
 */
const BENIGN = [
  /^ResizeObserver loop completed with undelivered notifications\.?$/,
  /^ResizeObserver loop limit exceeded\.?$/,
];

export function isBenignWindowError(message: string | undefined, error: unknown): boolean {
  // A real exception is never filtered, whatever its message says.
  if (error !== undefined && error !== null) return false;
  const text = (message ?? '').trim();
  return BENIGN.some((pattern) => pattern.test(text));
}
