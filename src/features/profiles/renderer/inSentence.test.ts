import { describe, expect, it } from 'vitest';
import { inSentence } from './inSentence';

describe('a fix label inside the line "fix: …" of the setup editor', () => {
  it('lowers only an ordinary first word, and keeps names and abbreviations as written', () => {
    expect(inSentence('Start TrackIR')).toBe('start TrackIR');
    expect(inSentence('Switch iRacing’s control profile')).toBe('switch iRacing’s control profile');
    expect(inSentence('Write the RigReady screen setup')).toBe('write the RigReady screen setup');
    expect(inSentence('Set the DCS options')).toBe('set the DCS options');
    expect(inSentence('Restore from a backup')).toBe('restore from a backup');
    // A first word that is a name or an abbreviation keeps its capitals.
    expect(inSentence('DCS bindings')).toBe('DCS bindings');
    expect(inSentence('TrackIR settings')).toBe('TrackIR settings');
    expect(inSentence('iRacing control profile')).toBe('iRacing control profile');
    expect(inSentence('F/A-18C setup')).toBe('F/A-18C setup');
    expect(inSentence('Su-25T')).toBe('Su-25T');
    // One letter, punctuation after the word, and nothing at all.
    expect(inSentence('A reminder')).toBe('a reminder');
    expect(inSentence('Start: now')).toBe('start: now');
    expect(inSentence('')).toBe('');
  });
});
