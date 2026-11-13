import { describe, expect, it } from 'vitest';
import type { ActivityOutcome } from '../core/activity';
import { HIDDEN_TOKEN, outcomeLine, textAsShown } from './outcomeWords';

const TOKEN = `rr_${'5c'.repeat(32)}`;

describe('MCP-013 how a call ended, said to the person at the PC', () => {
  it('a refusal reads "You said no." in the list and in the short line alike', () => {
    // What the assistant is answered is written for the assistant; the window does not repeat it.
    const forTheAssistant = 'The user did not allow "Make DCS F/A-18C ready" in RigReady.';
    expect(outcomeLine({ outcome: 'denied', message: forTheAssistant })).toBe('You said no.');
  });

  it('says what happened once, and what the call itself reported after it', () => {
    expect(outcomeLine({ outcome: 'ok', message: 'Done' })).toBe('Done.');
    expect(outcomeLine({ outcome: 'ok', message: '' })).toBe('Done.');
    expect(outcomeLine({ outcome: 'ok', message: '1 setup' })).toBe('Done. 1 setup');
    expect(outcomeLine({ outcome: 'error', message: 'No setup has that id.' })).toBe(
      'Failed. No setup has that id.'
    );
    expect(outcomeLine({ outcome: 'error', message: '' })).toBe('Failed.');
  });

  it('every outcome that did not run says so in the words of the person, never "The user"', () => {
    const outcomes: ActivityOutcome[] = ['denied', 'timeout', 'refused', 'busy', 'rate'];
    for (const outcome of outcomes) {
      const line = outcomeLine({ outcome, message: 'The user did not allow it in RigReady.' });
      expect(line, outcome).not.toContain('The user');
      expect(line, outcome).toMatch(/\.$/);
    }
    expect(outcomeLine({ outcome: 'timeout', message: '' })).toContain('did not run');
  });
});

describe('MCP-014 the text to paste, as the page draws it', () => {
  const text = `Endpoint: http://127.0.0.1:29170/mcp\nHeader: Authorization: Bearer ${TOKEN}`;

  it('shows a placeholder where the token is until the user asks to see it', () => {
    const drawn = textAsShown(text, TOKEN, false);
    expect(drawn).not.toContain(TOKEN);
    expect(drawn).not.toMatch(/rr_[0-9a-f]{8}/);
    expect(drawn).toContain(`Bearer ${HIDDEN_TOKEN}`);
    expect(drawn).toContain('http://127.0.0.1:29170/mcp');
  });

  it('shows it when asked, and leaves a text without a token as it is', () => {
    expect(textAsShown(text, TOKEN, true)).toBe(text);
    expect(textAsShown('claude mcp add rigready', undefined, false)).toBe(
      'claude mcp add rigready'
    );
  });
});
