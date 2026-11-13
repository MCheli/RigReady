import { describe, expect, it } from 'vitest';
import { clip } from './clip';

describe('MCP-013 a text that is cut says so', () => {
  it('leaves a text that fits alone, to the last character', () => {
    expect(clip('', 10)).toBe('');
    expect(clip('profiles:list', 13)).toBe('profiles:list');
  });

  it('marks the cut and counts what is not shown', () => {
    expect(clip('profiles:save {"name":"F/A-18C"}', 13)).toBe(
      'profiles:save… (19 more characters not shown)'
    );
    expect(clip('abcdef', 5)).toBe('abcde… (1 more character not shown)');
  });
});
