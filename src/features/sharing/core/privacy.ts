/**
 * The privacy review's rules live in core (src/core/privacy.ts) because the diagnostics
 * export applies the same scrub. Sharing keeps importing them from here.
 */
export * from '../../../core/privacy';
