import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturesDir } from '../../../../tests/helpers';
import {
  addTool,
  dedupeTool,
  diffLines,
  hasTool,
  lineSetChanges,
  parseExportLua,
  removeTool,
} from './exportLua';

const OWNER = path.join(
  fixturesDir,
  'rigs',
  'mark-full',
  'files',
  'Saved Games',
  'DCS',
  'Scripts',
  'Export.lua'
);

/** The owner's file: CRLF on the WinWing lines, LF on the DCS-BIOS line. */
const owner = (): Promise<string> => fs.readFile(OWNER, 'utf8');

const FOUR = [
  "local wwtlfs=require('lfs')\r\n",
  "dofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')\r\n",
  '-- my comment\r\n',
  'dofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])\n',
  "pcall(function() local dcsSr=require('lfs');dofile(dcsSr.writedir()..[[Mods\\Services\\DCS-SRS\\Scripts\\DCS-SimpleRadioStandalone.lua]]); end,nil);\r\n",
  "local Tacviewlfs=require('lfs');dofile(Tacviewlfs.writedir()..'Scripts/TacviewGameExport.lua')\r\n",
  'dofile(lfs.writedir()..[[Scripts\\Something\\Else.lua]])\r\n',
].join('');

describe('Export.lua', () => {
  it('attributes the owner file lines to WinWing and DCS-BIOS', async () => {
    const parsed = parseExportLua(await owner());
    expect(parsed.tools.map((t) => [t.tool, t.lines, t.active])).toEqual([
      ['wwt', [0, 1], 1],
      ['dcs-bios', [3], 1],
    ]);
    expect(parsed.lines.map((l) => l.eol)).toEqual(['\r\n', '\r\n', '\r\n', '\n']);
    expect(parsed.eol).toBe('\r\n');
    expect(parsed.unknown).toEqual([]);
  });

  it('lists DCS-BIOS, WinWing, SRS and Tacview lines, plus anything unknown', () => {
    const parsed = parseExportLua(FOUR);
    expect(parsed.tools.map((t) => t.tool)).toEqual(['wwt', 'dcs-bios', 'srs', 'tacview']);
    expect(parsed.unknown).toEqual([6]);
    expect(parsed.lines[2]!.tool).toBeUndefined();
  });

  it('adds a tool at the end with the file dominant line ending and changes nothing else', async () => {
    const before = await owner();
    const after = addTool(before, 'export-script');
    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(before.length)).toBe(
      'dofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])\r\n'
    );
    expect(hasTool(parseExportLua(after), 'export-script')).toBe(true);
    // Adding what is already there changes nothing.
    expect(addTool(after, 'export-script')).toBe(after);
    expect(addTool(before, 'wwt')).toBe(before);
  });

  it('gives a last line without an ending one before appending', () => {
    expect(addTool('dofile(x)', 'dcs-bios')).toBe(
      'dofile(x)\r\ndofile(lfs.writedir()..[[Scripts\\DCS-BIOS\\BIOS.lua]])\r\n'
    );
    expect(addTool('a\nb\nc\r\n', 'helios').endsWith('HeliosExport16.lua]])\n')).toBe(true);
    expect(addTool('', 'dcs-bios')).toBe(
      'dofile(lfs.writedir()..[[Scripts\\DCS-BIOS\\BIOS.lua]])\r\n'
    );
  });

  it('keeps a byte order mark', () => {
    const after = addTool('﻿dofile(x)\n', 'dcs-bios');
    expect(after.startsWith('﻿dofile(x)\n')).toBe(true);
    expect(parseExportLua(after).bom).toBe(true);
  });

  it('removes only one tool, with its helper line, keeping every other byte', async () => {
    const before = await owner();
    expect(removeTool(before, 'wwt')).toBe(
      '\r\ndofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])\n'
    );
    expect(removeTool(before, 'dcs-bios')).toBe(
      "local wwtlfs=require('lfs')\r\ndofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')\r\n\r\n"
    );
    expect(removeTool(before, 'srs')).toBe(before);
    expect(removeTool(FOUR, 'srs')).toBe(FOUR.replace(/pcall\(function.*\r\n/, ''));
    // Remove then add again gives every other line back untouched.
    expect(addTool(removeTool(FOUR, 'tacview'), 'tacview')).toBe(
      FOUR.replace(/local Tacviewlfs.*\r\n/, '') +
        "local Tacviewlfs=require('lfs');dofile(Tacviewlfs.writedir()..'Scripts/TacviewGameExport.lua')\r\n"
    );
  });

  it('keeps a shared helper line that another line still uses', () => {
    const text =
      "local l=require('lfs')\ndofile(l.writedir()..[[Scripts\\DCS-BIOS\\BIOS.lua]])\ndofile(l.writedir()..[[Scripts\\Mine.lua]])\n";
    expect(removeTool(text, 'dcs-bios')).toBe(
      "local l=require('lfs')\ndofile(l.writedir()..[[Scripts\\Mine.lua]])\n"
    );
  });

  it('reports commented-out lines as disabled and does not count them as present', () => {
    const text = '--dofile(lfs.writedir()..[[Scripts\\DCS-BIOS\\BIOS.lua]])\n';
    const parsed = parseExportLua(text);
    expect(parsed.tools).toEqual([{ tool: 'dcs-bios', lines: [0], active: 0, disabled: 1 }]);
    expect(hasTool(parsed, 'dcs-bios')).toBe(false);
    expect(removeTool(text, 'dcs-bios')).toBe('');
  });

  it('finds duplicates and removes all but the first', () => {
    const line = 'dofile(lfs.writedir()..[[Scripts\\DCS-BIOS\\BIOS.lua]])';
    const text = `${line}\r\nother()\r\n${line.replace(/\\/g, '/')}\n`;
    expect(parseExportLua(text).tools[0]!.active).toBe(2);
    expect(dedupeTool(text, 'dcs-bios')).toBe(`${line}\r\nother()\r\n`);
    expect(dedupeTool(dedupeTool(text, 'dcs-bios'), 'dcs-bios')).toBe(`${line}\r\nother()\r\n`);
  });

  it('shows a change as a line diff', async () => {
    const before = await owner();
    const diff = diffLines(before, addTool(removeTool(before, 'dcs-bios'), 'export-script'));
    expect(diff.filter((d) => d.kind !== 'same')).toEqual([
      { kind: 'removed', text: 'dofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])' },
      {
        kind: 'added',
        text: 'dofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])',
      },
    ]);
  });

  it('compares versions as sets of lines, so a reorder is not a change', async () => {
    const before = await owner();
    const reordered =
      'dofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])\r\n' +
      before.split('\r\n\r\n')[0] +
      '\r\n';
    expect(lineSetChanges(before, reordered)).toEqual({ added: [], removed: [] });
    expect(lineSetChanges(before, removeTool(before, 'dcs-bios'))).toEqual({
      added: [],
      removed: ['dofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])'],
    });
  });
});
