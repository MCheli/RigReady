import { z } from 'zod';

/**
 * Saved Games\DCS\Scripts\Export.lua is shared by every tool that reads data out of DCS:
 * each adds a line that loads its own script (docs/research/dcs.md section 4). This module
 * finds each tool's lines and adds or removes one tool's lines without touching anything
 * else: every other line keeps its bytes, including its own line ending.
 *
 * Pure: no file access, so the renderer can use it to show what a change will do.
 */

export const EXPORT_TOOLS = [
  'wwt',
  'dcs-bios',
  'export-script',
  'srs',
  'tacview',
  'helios',
] as const;
export const ExportToolSchema = z.enum(EXPORT_TOOLS);
export type ExportTool = z.infer<typeof ExportToolSchema>;

export interface ExportToolInfo {
  id: ExportTool;
  name: string;
  /** What it is for, in one line. */
  purpose: string;
  /** Matches the script a line loads (forward and back slashes alike, any case). */
  signature: RegExp;
  /** The tool's own line(s), as its installer writes them. */
  canonical: string[];
  /** Where its script is installed, relative to the Saved Games DCS folder. Any one is enough. */
  scripts: string[];
}

export const TOOL_INFO: Record<ExportTool, ExportToolInfo> = {
  wwt: {
    id: 'wwt',
    name: 'WinWing (SimAppPro)',
    purpose:
      'Sends cockpit data to SimAppPro for WinWing backlights, UFC/ICP displays and vibration.',
    signature: /Scripts[\\/]+wwt[\\/]+wwtExport\.lua/i,
    canonical: [
      "local wwtlfs=require('lfs')",
      "dofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')",
    ],
    scripts: ['Scripts/wwt/wwtExport.lua'],
  },
  'dcs-bios': {
    id: 'dcs-bios',
    name: 'DCS-BIOS',
    purpose: 'Cockpit data for home-built panels and tools that drive hardware without SimAppPro.',
    signature: /Scripts[\\/]+DCS-BIOS[\\/]+BIOS\.lua/i,
    canonical: ['dofile(lfs.writedir()..[[Scripts\\DCS-BIOS\\BIOS.lua]])'],
    scripts: ['Scripts/DCS-BIOS/BIOS.lua'],
  },
  'export-script': {
    id: 'export-script',
    name: 'DCS-ExportScript',
    purpose:
      'Feeds the Stream Deck "DCS Interface" plugin (lamps and displays on Stream Deck keys).',
    signature: /DCS-ExportScript[\\/]+ExportScript\.lua/i,
    canonical: ['dofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])'],
    scripts: ['Scripts/DCS-ExportScript/ExportScript.lua'],
  },
  srs: {
    id: 'srs',
    name: 'SRS (SimpleRadio Standalone)',
    purpose: 'Radio frequencies for SimpleRadio voice comms.',
    signature: /DCS-SimpleRadioStandalone\.lua/i,
    canonical: [
      "pcall(function() local dcsSr=require('lfs');dofile(dcsSr.writedir()..[[Mods\\Services\\DCS-SRS\\Scripts\\DCS-SimpleRadioStandalone.lua]]); end,nil);",
    ],
    scripts: [
      'Mods/Services/DCS-SRS/Scripts/DCS-SimpleRadioStandalone.lua',
      'Scripts/DCS-SimpleRadioStandalone.lua',
    ],
  },
  tacview: {
    id: 'tacview',
    name: 'Tacview',
    purpose:
      'Flight recording (older Tacview versions; current ones install as a mod and need no line).',
    signature: /TacviewGameExport\.lua/i,
    canonical: [
      "local Tacviewlfs=require('lfs');dofile(Tacviewlfs.writedir()..'Scripts/TacviewGameExport.lua')",
    ],
    scripts: ['Scripts/TacviewGameExport.lua'],
  },
  helios: {
    id: 'helios',
    name: 'Helios',
    purpose: 'Virtual cockpit gauges on extra screens.',
    signature: /Scripts[\\/]+Helios[\\/]+HeliosExport\d*\.lua/i,
    canonical: ['dofile(lfs.writedir()..[[Scripts\\Helios\\HeliosExport16.lua]])'],
    scripts: ['Scripts/Helios/HeliosExport16.lua'],
  },
};

export interface ExportLine {
  /** 0-based line number. */
  index: number;
  /** The line without its ending. */
  text: string;
  /** Its own ending: CRLF, LF, or none for a last line without one. */
  eol: '\r\n' | '\n' | '';
  /** The tool the line belongs to; 'unknown' for a load nobody recognises. */
  tool?: ExportTool | 'unknown';
  /** A `local x=require('lfs')` line that only serves another line. */
  helperFor?: string;
  /** Commented out (starts with --). */
  disabled: boolean;
}

export interface ExportToolUse {
  tool: ExportTool;
  /** Every line of the tool, helper lines included. */
  lines: number[];
  /** Active (not commented out) load lines. More than one means a duplicate. */
  active: number;
  /** Load lines that are commented out. */
  disabled: number;
}

export interface ParsedExport {
  bom: boolean;
  lines: ExportLine[];
  tools: ExportToolUse[];
  /** Lines that load something no known tool owns. */
  unknown: number[];
  /** The ending most lines use: what an added line gets. */
  eol: '\r\n' | '\n';
}

const LOAD = /\b(dofile|loadfile|loadstring|require)\s*\(/;
const HELPER =
  /^\s*local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*require\s*\(\s*['"]lfs['"]\s*\)\s*;?\s*$/;
const BOM = '﻿';

function splitLines(text: string): ExportLine[] {
  const lines: ExportLine[] = [];
  let start = 0;
  while (start < text.length) {
    const lf = text.indexOf('\n', start);
    if (lf < 0) {
      lines.push({ index: lines.length, text: text.slice(start), eol: '', disabled: false });
      break;
    }
    const crlf = lf > start && text[lf - 1] === '\r';
    lines.push({
      index: lines.length,
      text: text.slice(start, crlf ? lf - 1 : lf),
      eol: crlf ? '\r\n' : '\n',
      disabled: false,
    });
    start = lf + 1;
  }
  return lines;
}

export function toolOf(text: string): ExportTool | undefined {
  return EXPORT_TOOLS.find((tool) => TOOL_INFO[tool].signature.test(text));
}

/** Reads Export.lua into lines attributed to tools. Never fails: anything unrecognised is 'unknown'. */
export function parseExportLua(raw: string): ParsedExport {
  const bom = raw.startsWith(BOM);
  const lines = splitLines(bom ? raw.slice(1) : raw);
  for (const line of lines) {
    const trimmed = line.text.trim();
    line.disabled = trimmed.startsWith('--');
    const code = line.disabled ? trimmed.replace(/^--+/, '') : trimmed;
    const tool = toolOf(code);
    if (tool) line.tool = tool;
    else if (!line.disabled && !HELPER.test(code) && LOAD.test(code)) line.tool = 'unknown';
  }
  // A helper line belongs to the next line that uses its variable.
  for (const line of lines) {
    const match = HELPER.exec(line.disabled ? line.text.replace(/^\s*--+/, '') : line.text);
    if (!match || line.tool) continue;
    const name = match[1]!;
    const user = lines.find(
      (other) =>
        other.index > line.index && other.tool && new RegExp(`\\b${name}\\b`).test(other.text)
    );
    if (user && user.tool !== 'unknown') {
      line.helperFor = name;
      line.tool = user.tool;
      line.disabled = line.disabled || user.disabled;
    }
  }
  const tools: ExportToolUse[] = [];
  for (const tool of EXPORT_TOOLS) {
    const own = lines.filter((l) => l.tool === tool);
    if (own.length === 0) continue;
    const loads = own.filter((l) => !l.helperFor);
    tools.push({
      tool,
      lines: own.map((l) => l.index),
      active: loads.filter((l) => !l.disabled).length,
      disabled: loads.filter((l) => l.disabled).length,
    });
  }
  const endings = lines.filter((l) => l.eol !== '');
  const crlf = endings.filter((l) => l.eol === '\r\n').length;
  return {
    bom,
    lines,
    tools,
    unknown: lines.filter((l) => l.tool === 'unknown').map((l) => l.index),
    eol: endings.length === 0 || crlf * 2 >= endings.length ? '\r\n' : '\n',
  };
}

function join(
  parsed: Pick<ParsedExport, 'bom'>,
  lines: Pick<ExportLine, 'text' | 'eol'>[]
): string {
  return (parsed.bom ? BOM : '') + lines.map((l) => l.text + l.eol).join('');
}

/** True when the tool has at least one active (not commented-out) line. */
export function hasTool(parsed: ParsedExport, tool: ExportTool): boolean {
  return (parsed.tools.find((t) => t.tool === tool)?.active ?? 0) > 0;
}

/**
 * Appends the tool's line(s) at the end, unless the tool is already active. The last
 * line gets an ending first if it has none; new lines use the file's dominant ending.
 */
export function addTool(raw: string, tool: ExportTool): string {
  const parsed = parseExportLua(raw);
  if (hasTool(parsed, tool)) return raw;
  const lines: Pick<ExportLine, 'text' | 'eol'>[] = parsed.lines.map((l) => ({ ...l }));
  const last = lines[lines.length - 1];
  if (last && last.eol === '') last.eol = parsed.eol;
  for (const text of TOOL_INFO[tool].canonical) lines.push({ text, eol: parsed.eol });
  return join(parsed, lines);
}

/** Lines that would be deleted to remove a tool: its loads, and helpers nothing else still uses. */
function linesToRemove(parsed: ParsedExport, tool: ExportTool, keepFirst: boolean): Set<number> {
  const loads = parsed.lines.filter((l) => l.tool === tool && !l.helperFor);
  const removing = new Set(
    (keepFirst ? loads.filter((l) => !l.disabled).slice(1) : loads).map((l) => l.index)
  );
  for (const helper of parsed.lines.filter((l) => l.tool === tool && l.helperFor)) {
    const name = new RegExp(`\\b${helper.helperFor}\\b`);
    const stillUsed = parsed.lines.some(
      (l) => l.index !== helper.index && !removing.has(l.index) && !l.helperFor && name.test(l.text)
    );
    if (!stillUsed) removing.add(helper.index);
  }
  return removing;
}

/** Deletes every line of the tool (active or commented out). Nothing else changes. */
export function removeTool(raw: string, tool: ExportTool): string {
  const parsed = parseExportLua(raw);
  const removing = linesToRemove(parsed, tool, false);
  if (removing.size === 0) return raw;
  return join(
    parsed,
    parsed.lines.filter((l) => !removing.has(l.index))
  );
}

/** Keeps the first active load of the tool and deletes the other active ones. */
export function dedupeTool(raw: string, tool: ExportTool): string {
  const parsed = parseExportLua(raw);
  const removing = linesToRemove(parsed, tool, true);
  if (removing.size === 0) return raw;
  return join(
    parsed,
    parsed.lines.filter((l) => !removing.has(l.index))
  );
}

export interface LineDiff {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** A line diff (longest common subsequence) for showing a change before it is made. */
export function diffLines(before: string, after: string): LineDiff[] {
  const a = splitLines(before.replace(/^﻿/, '')).map((l) => l.text);
  const b = splitLines(after.replace(/^﻿/, '')).map((l) => l.text);
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: LineDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: 'removed', text: a[i++]! });
    } else {
      out.push({ kind: 'added', text: b[j++]! });
    }
  }
  while (i < n) out.push({ kind: 'removed', text: a[i++]! });
  while (j < m) out.push({ kind: 'added', text: b[j++]! });
  return out;
}

/**
 * What changed between two versions as sets of non-blank lines, ignoring order: SimAppPro
 * moves its own line to the top every time it starts, which is not a change that matters.
 */
export function lineSetChanges(
  before: string,
  after: string
): { added: string[]; removed: string[] } {
  const set = (text: string): string[] =>
    splitLines(text.replace(/^﻿/, ''))
      .map((l) => l.text.trim())
      .filter((t) => t !== '');
  const a = set(before);
  const b = set(after);
  return {
    added: b.filter((line) => !a.includes(line)),
    removed: a.filter((line) => !b.includes(line)),
  };
}
