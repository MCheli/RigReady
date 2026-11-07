import { describe, expect, it } from 'vitest';
import { isBenignWindowError } from './benign';

describe('window errors that are not shown as a notice', () => {
  it('the ResizeObserver loop messages Chromium raises without an Error object', () => {
    expect(
      isBenignWindowError('ResizeObserver loop completed with undelivered notifications.', null)
    ).toBe(true);
    expect(isBenignWindowError('ResizeObserver loop limit exceeded', undefined)).toBe(true);
  });

  it('a real exception is shown even when its message looks the same', () => {
    const thrown = new Error('ResizeObserver loop limit exceeded');
    expect(isBenignWindowError(thrown.message, thrown)).toBe(false);
  });

  it('anything else is shown', () => {
    expect(isBenignWindowError('Cannot read properties of undefined', null)).toBe(false);
    expect(isBenignWindowError('ResizeObserver loop completed, then crashed', null)).toBe(false);
    expect(isBenignWindowError(undefined, null)).toBe(false);
  });
});
