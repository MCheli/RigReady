import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { BackupOutcomeView, Overview, RestorePreviewView, Suggestion } from '../contract';
import { cleanValues, MAX_RECORD_ROWS, recordRows, rowsFromData, shortBinary } from './records';

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

describe('records as rows', () => {
  it('lists an exported registry key as one row per value under its sub-key, without the container levels', () => {
    const rows = rowsFromData({
      values: { Version: { type: 'string', value: '1.2' } },
      keys: {
        Games: {
          values: {},
          keys: {
            '5_0': {
              values: {
                IsHidden: { type: 'binary', value: '00' },
                ExeLaunch: { type: 'string', value: '' },
                Rpm: { type: 'number', value: 6500 },
                Blob: { type: 'binary', value: 'ab'.repeat(40) },
                Paths: { type: 'strings', value: ['a', 'b'] },
              },
            },
          },
        },
      },
    });
    expect(rows).toEqual([
      { group: '', label: 'Version', value: '1.2' },
      { group: 'Games › 5_0', label: 'IsHidden', value: '00' },
      { group: 'Games › 5_0', label: 'ExeLaunch', value: '(empty)' },
      { group: 'Games › 5_0', label: 'Rpm', value: '6500' },
      { group: 'Games › 5_0', label: 'Blob', value: 'AB AB AB AB AB AB AB AB … (40 bytes)' },
      { group: 'Games › 5_0', label: 'Paths', value: 'a, b' },
    ]);
  });

  it('lists any other data by the path to each value, and nothing for text that is not data', () => {
    expect(rowsFromData({ a: 1, b: { c: true, d: [1, 2], e: null } })).toEqual([
      { group: '', label: 'a', value: '1' },
      { group: 'b', label: 'c', value: 'true' },
      { group: 'b', label: 'd', value: '1, 2' },
      { group: 'b', label: 'e', value: '(none)' },
    ]);
    expect(rowsFromData('just text')).toEqual([{ group: '', label: 'Value', value: 'just text' }]);
    expect(recordRows(undefined, 'not json {')).toEqual([]);
  });

  it('shortens long binary data and long text, and stops at the row limit', () => {
    expect(shortBinary('')).toBe('(empty)');
    expect(shortBinary('0a0b')).toBe('0A 0B');
    expect(shortBinary('00'.repeat(17))).toBe('00 00 00 00 00 00 00 00 … (17 bytes)');
    const many: Record<string, number> = {};
    for (let n = 0; n < MAX_RECORD_ROWS + 50; n++) many[`v${n}`] = n;
    expect(rowsFromData(many)).toHaveLength(MAX_RECORD_ROWS);
    const cleaned = cleanValues([
      { label: 'L'.repeat(500), name: 'same', value: 'x'.repeat(1000), group: 'G' },
      { label: 'same', name: 'same', value: 'v' },
    ]);
    expect(cleaned[0]!.label).toHaveLength(200);
    expect(cleaned[0]!.value).toHaveLength(400);
    expect(cleaned[0]!.value.endsWith('…')).toBe(true);
    expect(cleaned[1]).toEqual({ label: 'same', value: 'v' });
  });

  it('prefers the rows the source described', () => {
    expect(
      recordRows([{ group: 'Games', label: 'Favourite', name: 'IsFavorite', value: 'On' }], '{}')
    ).toEqual([{ group: 'Games', label: 'Favourite', name: 'IsFavorite', value: 'On' }]);
  });
});

describe('records and setups in a backup', () => {
  it('the Fanatec registry record is listed with friendly labels, On/Off and shortened binary, and the raw data is kept', async () => {
    const app = await wiredApp('racing-fresh');
    apps.push(app);
    const suggestion = (await app.invoke<Suggestion[]>('backup:suggestions')).find(
      (s) => s.label === 'Fanatec App settings'
    )!;
    await app.invoke<Overview>('backup:saveItem', {
      scope: '@always',
      item: { label: suggestion.label, path: suggestion.path, kind: suggestion.kind },
    });
    const outcome = await app.invoke<BackupOutcomeView>('backup:backUp', {
      scope: { kind: 'full' },
    });
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    const record = preview.records[0]!;
    expect(record.moreRows).toBe(false);
    expect(record.rows.length).toBeGreaterThan(100);
    expect(record.rows).toContainEqual({
      group: 'Games › 0_0',
      label: 'Steam edition installed',
      name: 'IsSteamInstalled',
      value: 'On',
    });
    expect(record.rows).toContainEqual({
      group: 'LEDs › RevRaw',
      label: 'Slider led raw 1',
      name: 'SliderLedRaw1',
      value: '6500',
    });
    expect(record.rows).toContainEqual({
      group: 'Games › 0_0',
      label: 'Default profile',
      name: 'DefaultProfile',
      value: '(empty)',
    });
    // No row shows JSON punctuation or a value longer than a line.
    for (const row of record.rows) {
      expect(row.value).not.toMatch(/[{}"]/);
      expect(row.value.length).toBeLessThanOrEqual(400);
    }
    expect(record.text).toContain('"IsSteamInstalled"');
  });

  it('a backup names its setups by name, also after the setup was renamed or deleted', async () => {
    const app = await wiredApp('flying-all-good', { files: [] });
    apps.push(app);
    const outcome = await app.invoke<BackupOutcomeView>('backup:backUp', {
      scope: { kind: 'full' },
    });
    expect(outcome.backup.profiles).toEqual(['DCS F/A-18C']);
    const removed = await app.wiring.context.profiles.remove('dcs-f-a-18c');
    expect(removed.ok).toBe(true);
    const overview = await app.invoke<Overview>('backup:overview');
    const listed = overview.backups.find((b) => b.id === outcome.backup.id)!;
    expect(listed.profiles).toEqual(['DCS F/A-18C']);
    expect(JSON.stringify(listed)).not.toContain('dcs-f-a-18c');
  });
});
