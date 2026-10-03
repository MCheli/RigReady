import { describe, expect, it } from 'vitest';
import {
  FILE_SOURCES,
  PLACEHOLDER_FILES,
  REGISTRY_SOURCES,
  filterDcsLog,
  filterLibraryFolders,
  redactStreamDeckManifest,
  wantUninstallEntry,
} from './recordPlan';
import { NEUTRAL_STEAM_ID, sanitizeIdentifiers } from './sanitize';

describe('record plan', () => {
  it('never lists the files that hold credentials', () => {
    const everything = JSON.stringify([FILE_SOURCES, PLACEHOLDER_FILES, REGISTRY_SOURCES]);
    // SimAppPro's account file sits two levels above the one file that is recorded.
    const simAppPro = FILE_SOURCES.filter((s) => s.dir.startsWith('SimAppPro'));
    expect(simAppPro).toEqual([
      { root: 'appData', dir: 'SimAppPro\\GameExtendDisplay\\MFD', include: ['DCS_config.json'] },
    ]);
    for (const forbidden of [
      'network.vault',
      'steam_authdata',
      '"config.json"',
      'Cookies',
      'Login',
    ]) {
      expect(everything, forbidden).not.toContain(forbidden);
    }
    // No source takes a whole user folder.
    for (const source of FILE_SOURCES) {
      expect(source.dir.length, source.dir).toBeGreaterThan(0);
      if (source.root !== 'steamLibrary') expect(source.include, source.dir).not.toContain('**');
    }
  });

  it('keeps uninstall entries of sims and helper apps only', () => {
    expect(wantUninstallEntry('Steam App 223750', 'DCS World Steam Edition')).toBe(true);
    expect(wantUninstallEntry('Steam App 440', 'Team Fortress 2')).toBe(false);
    expect(wantUninstallEntry('{GUID}', 'TrackIR 5')).toBe(true);
    expect(wantUninstallEntry('{GUID}', 'HidHide')).toBe(true);
    expect(wantUninstallEntry('{GUID}', 'Elgato Stream Deck')).toBe(true);
    expect(wantUninstallEntry('{GUID}', 'Steam')).toBe(true);
    expect(wantUninstallEntry('{GUID}', 'Steam Link')).toBe(false);
    expect(wantUninstallEntry('{GUID}', '1Password')).toBe(false);
    expect(wantUninstallEntry('{GUID}', '')).toBe(false);
  });

  it('cuts dcs.log down to the lines that identify the build and the controllers', () => {
    const log = [
      '=== Log opened UTC 2026-07-26 18:12:06',
      'line two',
      'line three',
      '2026 INFO APP (Main): Command line: "C:\\DCS\\bin\\DCS.exe" --restarted',
      '2026 INFO APP (Main): DCS/2.9.28.26283 (x86_64; MT; Windows NT 10.0.26200)',
      '2026 INFO APP (Main): CPU: 16 cores, user home is C:\\Users\\Someone',
      '2026 INFO INPUT (Main): created [WINWING MFD1-R] with full id [WINWING MFD1-R {806E0610-B756-11f0-8024-444553540000}],SUPPLEMENTAL|UNKNOWN',
      '2026 INFO VISUALIZER (Main): lots more',
    ].join('\r\n');
    const kept = filterDcsLog(log).trimEnd().split('\r\n');
    expect(kept).toHaveLength(6);
    expect(kept.join('\n')).toContain('DCS/2.9.28.26283');
    expect(kept.join('\n')).toContain('with full id [WINWING MFD1-R {806E0610');
    expect(kept.join('\n')).not.toContain('Someone');
  });

  it('empties every Settings object of a Stream Deck manifest and keeps the structure', () => {
    const manifest = JSON.stringify({
      Name: 'DCS',
      Controllers: [
        {
          Actions: {
            '0,0': {
              Name: 'Text',
              UUID: 'com.elgato.streamdeck.system.text',
              Settings: { pastedText: 'hunter2', isSendingEnter: true },
              States: [{ Title: 'Login' }],
            },
            '1,0': { UUID: 'com.ctytler.dcs.switch', Settings: { nested: { Settings: { a: 1 } } } },
          },
        },
      ],
    });
    const redacted = redactStreamDeckManifest(manifest);
    expect(redacted).not.toContain('hunter2');
    expect(JSON.parse(redacted)).toEqual({
      Name: 'DCS',
      Controllers: [
        {
          Actions: {
            '0,0': {
              Name: 'Text',
              UUID: 'com.elgato.streamdeck.system.text',
              Settings: {},
              States: [{ Title: 'Login' }],
            },
            '1,0': { UUID: 'com.ctytler.dcs.switch', Settings: {} },
          },
        },
      ],
    });
  });

  it('keeps only the recorded sims in the Steam library list', () => {
    const vdf = [
      '"libraryfolders"',
      '{',
      '\t"0"',
      '\t{',
      '\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"',
      '\t\t"totalsize"\t\t"0"',
      '\t\t"apps"',
      '\t\t{',
      '\t\t\t"223750"\t\t"798459966433"',
      '\t\t\t"440"\t\t"123"',
      '\t\t\t"2399420"\t\t"53734805758"',
      '\t\t}',
      '\t}',
      '}',
      '',
    ].join('\n');
    const filtered = filterLibraryFolders(vdf);
    expect(filtered).toContain('"223750"');
    expect(filtered).toContain('"2399420"');
    expect(filtered).not.toContain('"440"');
    expect(filtered).toContain('"totalsize"\t\t"0"');
    expect(filtered.split('\n')).toHaveLength(vdf.split('\n').length - 1);
  });

  it('removes Steam account ids and player names from recorded text', () => {
    expect(sanitizeIdentifiers('\t"LastOwner"\t\t"76561197992831494"\n')).toBe(
      `\t"LastOwner"\t\t"${NEUTRAL_STEAM_ID}"\n`
    );
    expect(sanitizeIdentifiers('    "Player Name": "Jane Doe",\n    "Player Nick":"JD",')).toBe(
      '    "Player Name": "Player",\n    "Player Nick":"Player",'
    );
    expect(sanitizeIdentifiers('"buildid" "25625823" 7656119')).toBe(
      '"buildid" "25625823" 7656119'
    );
  });
});
