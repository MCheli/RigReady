import { describe, expect, it } from 'vitest';
import { ariaCurrent, currentEntry, scrollOnMove } from './nav';

const ENTRIES = [
  '/configure/profiles',
  '/configure/dcs',
  '/configure/dcs-bindings',
  '/configure/racing',
  '/configure/racing/wheel',
  '/configure/cheat-sheets',
];

describe('where you are in the side navigation', () => {
  it('is the entry of the page itself', () => {
    expect(currentEntry(ENTRIES, '/configure/racing')).toBe('/configure/racing');
    expect(currentEntry(ENTRIES, '/configure/dcs')).toBe('/configure/dcs');
  });

  it('is the entry above for a page one below it', () => {
    expect(currentEntry(ENTRIES, '/configure/cheat-sheets/learn')).toBe('/configure/cheat-sheets');
    expect(currentEntry(ENTRIES, '/configure/profiles/dcs-f-a-18c')).toBe('/configure/profiles');
    expect(currentEntry(ENTRIES, '/configure/profiles/capture')).toBe('/configure/profiles');
    expect(currentEntry(ENTRIES, '/configure/racing/iracing')).toBe('/configure/racing');
  });

  it('is the nearest entry where one lies below another, and only that one', () => {
    expect(currentEntry(ENTRIES, '/configure/racing/wheel')).toBe('/configure/racing/wheel');
    expect(currentEntry(ENTRIES, '/configure/racing/wheel/presets')).toBe(
      '/configure/racing/wheel'
    );
  });

  it('does not take an address that merely begins the same for a page below', () => {
    expect(currentEntry(ENTRIES, '/configure/dcs-bindings')).toBe('/configure/dcs-bindings');
    expect(currentEntry(ENTRIES, '/configure/dcs-bindings/F-A-18C')).toBe(
      '/configure/dcs-bindings'
    );
    expect(currentEntry(ENTRIES, '/configure/dcsx')).toBeUndefined();
  });

  it('is none outside the navigation', () => {
    expect(currentEntry(ENTRIES, '/fly')).toBeUndefined();
    expect(currentEntry(ENTRIES, '/configure')).toBeUndefined();
    expect(currentEntry([], '/configure/racing')).toBeUndefined();
  });

  it('says "page" on the page itself and "location" on a page below it', () => {
    const path = '/configure/cheat-sheets/learn';
    const current = currentEntry(ENTRIES, path);
    expect(ariaCurrent('/configure/cheat-sheets', current, path)).toBe('location');
    expect(ariaCurrent('/configure/racing', current, path)).toBeUndefined();
    expect(
      ariaCurrent(
        '/configure/racing',
        currentEntry(ENTRIES, '/configure/racing'),
        '/configure/racing'
      )
    ).toBe('page');
  });
});

describe('WOW-UI-013: where a page starts after a move', () => {
  it('a new page starts at its top, wherever the last one was scrolled to', () => {
    expect(scrollOnMove('/', '/configure/profiles/capture', null)).toEqual({ top: 0 });
    expect(scrollOnMove('/configure/devices', '/configure/profiles/ace-nights', null)).toEqual({
      top: 0,
    });
  });

  it('going back or forward returns to where that page was', () => {
    const was = { left: 0, top: 640 };
    expect(scrollOnMove('/configure/devices', '/', was)).toBe(was);
  });

  it("a change that keeps the page's address, a chosen device or a tab in the query, leaves the scroll alone", () => {
    expect(scrollOnMove('/configure/devices', '/configure/devices', null)).toBe(false);
  });

  it('a tab with an address of its own starts at its top', () => {
    expect(
      scrollOnMove('/configure/dcs-bindings/devices', '/configure/dcs-bindings', null)
    ).toEqual({ top: 0 });
  });
});
