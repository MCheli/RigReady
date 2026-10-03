import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LuaDocument,
  LuaTable,
  formatLuaNumber,
  luaDocument,
  parseLuaData,
  quoteLuaString,
  writeLuaDocument,
  writeLuaValue,
} from '../../src/core/lua/data';
import { runLua } from '../../src/core/lua/sandbox';
import { fixturesDir } from '../helpers';

const recorded = path.join(fixturesDir, 'rigs', 'mark-full', 'files');
const savedGames = path.join(recorded, 'Saved Games', 'DCS');
const install = path.join(
  recorded,
  'Program Files (x86)',
  'Steam',
  'steamapps',
  'common',
  'DCSWorld'
);

async function luaFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await luaFiles(full)));
    else if (entry.name.endsWith('.lua')) out.push(full);
  }
  return out;
}

describe('Lua data reader and writer', () => {
  it('reads every DCS data file of the recorded rig and writes it back byte for byte', async () => {
    const files = await luaFiles(path.join(savedGames, 'Config'));
    expect(files.length).toBeGreaterThan(15);
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      const parsed = parseLuaData(text);
      expect(parsed.ok, `${file}: ${parsed.ok ? '' : parsed.error.message}`).toBe(true);
      if (parsed.ok) expect(writeLuaDocument(parsed.value), file).toBe(text);
    }
  });

  it('reads the vendor template diffs shipped with DCS', async () => {
    const dir = path.join(install, 'Mods', 'aircraft', 'FA-18C', 'Input', 'FA-18C', 'joystick');
    const diffs = (await fs.readdir(dir)).filter((f) => f.endsWith('.diff.lua'));
    expect(diffs.length).toBeGreaterThan(20);
    for (const name of diffs) {
      const parsed = parseLuaData(await fs.readFile(path.join(dir, name), 'utf8'));
      expect(parsed.ok, `${name}: ${parsed.ok ? '' : parsed.error.message}`).toBe(true);
      if (parsed.ok) expect(parsed.value.table('diff')).toBeInstanceOf(LuaTable);
    }
  });

  it('gives a binding diff as tables that can be read, changed and written', async () => {
    const dir = path.join(savedGames, 'Config', 'Input', 'FA-18C_hornet', 'joystick');
    const pedals = (await fs.readdir(dir)).find((f) => f.startsWith('T-Pendular-Rudder'))!;
    const parsed = parseLuaData(await fs.readFile(path.join(dir, pedals), 'utf8'));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const diff = parsed.value.table('diff')!;
    expect(diff.keys()).toContain('axisDiffs');
    const axes = diff.table('axisDiffs')!;
    const first = axes.table(axes.keys()[0]!)!;
    expect(typeof first.get('name')).toBe('string');
    expect(parsed.value.statements.map((s) => [s.kind, s.local, s.name])).toEqual([
      ['assign', true, 'diff'],
      ['return', false, 'diff'],
    ]);

    // Add a button binding the way DCS would write it.
    const keys = diff.table('keyDiffs') ?? new LuaTable();
    keys.set(
      'd3001pnilu3001cd23vd1vpnilvu0',
      LuaTable.from({ added: [{ key: 'JOY_BTN7' }], name: 'Test' })
    );
    diff.set('keyDiffs', keys);
    const again = parseLuaData(writeLuaDocument(parsed.value));
    if (!again.ok) throw new Error(again.error.message);
    expect(
      again.value.table('diff')!.table('keyDiffs')!.table('d3001pnilu3001cd23vd1vpnilvu0')!.toJs()
    ).toEqual({
      added: [{ key: 'JOY_BTN7' }],
      name: 'Test',
    });
  });

  it('writes DCS formatting: tabs, ["key"] = value, a comma after every entry', () => {
    const document = luaDocument(
      'diff',
      LuaTable.from({
        axisDiffs: {
          a2001cdnil: {
            added: [{ key: 'JOY_X', filter: { curvature: [0.15], invert: false } }],
            name: 'Roll',
          },
        },
        empty: {},
        nothing: null,
      })
    );
    expect(writeLuaDocument(document)).toBe(
      [
        'local diff = {',
        '\t["axisDiffs"] = {',
        '\t\t["a2001cdnil"] = {',
        '\t\t\t["added"] = {',
        '\t\t\t\t[1] = {',
        '\t\t\t\t\t["key"] = "JOY_X",',
        '\t\t\t\t\t["filter"] = {',
        '\t\t\t\t\t\t["curvature"] = {',
        '\t\t\t\t\t\t\t[1] = 0.15,',
        '\t\t\t\t\t\t},',
        '\t\t\t\t\t\t["invert"] = false,',
        '\t\t\t\t\t},',
        '\t\t\t\t},',
        '\t\t\t},',
        '\t\t\t["name"] = "Roll",',
        '\t\t},',
        '\t},',
        '\t["empty"] = {',
        '\t},',
        '\t["nothing"] = nil,',
        '}',
        'return diff',
      ].join('\n')
    );
    expect(writeLuaValue(LuaTable.from([1, 'two']), { indent: '  ', eol: '\r\n' })).toBe(
      '{\r\n  [1] = 1,\r\n  [2] = "two",\r\n}'
    );
    const global = luaDocument('options', LuaTable.from({ a: 1 }), false);
    expect(writeLuaDocument(global)).toBe('options = {\n\t["a"] = 1,\n}');
    global.set('extra', true);
    global.set('options', LuaTable.from({ a: 2 }));
    expect(global.get('options')).toBeInstanceOf(LuaTable);
    expect(global.get('missing')).toBeUndefined();
    expect(global.table('extra')).toBeUndefined();
    expect(writeLuaDocument(global)).toBe('options = {\n\t["a"] = 2,\n}\nextra = true');
    const withReturn = luaDocument('diff', new LuaTable());
    withReturn.set('other', 5, { local: true });
    expect(writeLuaDocument(withReturn)).toBe('local diff = {\n}\nlocal other = 5\nreturn diff');
  });

  it('reads the Lua data syntax DCS and hand edits produce', () => {
    const parsed = parseLuaData(
      [
        '\uFEFF-- a comment',
        '--[[ a long',
        '     comment ]]',
        'settings = {',
        '  name = "A \\"quoted\\" name", -- bare key',
        "  ['single'] = 'it\\'s',",
        '  [3] = -1.5e2;',
        '  hex = 0x10,',
        '  "positional one", "positional two",',
        '  flags = { true, false, nil },',
        '  long = [[first',
        'second]],',
        '  multi = "line one\\',
        'line two",',
        '  code = "\\65\\066",',
        '}',
        '',
        '',
        'second = 7;',
      ].join('\r\n')
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const settings = parsed.value.table('settings')!;
    expect(settings.get('name')).toBe('A "quoted" name');
    expect(settings.get('single')).toBe("it's");
    expect(settings.get(3)).toBe(-150);
    expect(settings.get('hex')).toBe(16);
    expect(settings.get(1)).toBe('positional one');
    expect(settings.get(2)).toBe('positional two');
    expect(settings.table('flags')!.entries.map((e) => e.value)).toEqual([true, false, null]);
    expect(settings.get('long')).toBe('first\r\nsecond');
    expect(settings.get('multi')).toBe('line one\nline two');
    expect(settings.get('code')).toBe('AB');
    expect(parsed.value.get('second')).toBe(7);
    expect(parsed.value.statements[1]!.blankLinesBefore).toBe(2);
    expect(parsed.value.format).toEqual({ indent: '  ', eol: '\r\n', finalNewline: false });
  });

  it('refuses anything that is not data, with the line number', () => {
    const cases: [string, RegExp][] = [
      ['a = {\n  x = foo(),\n}', /line 2: unexpected "\("/],
      ['a = {\n\n  x = other,\n}', /line 3: "other" is not data/],
      ['a = 1 + 2', /line 1: unexpected "\+"/],
      ['a = {\n  [true] = 1,\n}', /line 2: a table key must be a string or a number/],
      ['a = { 1, 2', /expected "," or "}" but found end of file/],
      ['a = "unfinished', /line 1: unfinished string/],
      ['a = [[never closed', /unfinished long string/],
      ['return { 1 }', /only "return <variable>" is supported/],
      ['local = 5', /expected a variable name after "local"/],
      ['a 5', /expected "=" after a/],
      ['= 5', /expected a variable name/],
      ['a = { [1 = 2 }', /expected "\]"/],
      ['a = { [1] 2 }', /expected "="/],
      ['a = -"x"', /expected a number after "-"/],
      ['a = 12abc', /malformed number/],
      ['a = "\\q"', /unsupported escape/],
      ['a = }', /unexpected "}"/],
    ];
    for (const [text, message] of cases) {
      const parsed = parseLuaData(text);
      expect(parsed.ok, text).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe('lua.parse');
        expect(parsed.error.message, text).toMatch(message);
      }
    }
    expect(parseLuaData(`a = ${'{'.repeat(300)}${'}'.repeat(300)}`)).toMatchObject({ ok: false });
  });

  it('formats numbers like Lua and escapes strings like DCS', () => {
    expect(formatLuaNumber(63.5)).toBe('63.5');
    expect(formatLuaNumber(5.1555555555556)).toBe('5.1555555555556');
    expect(formatLuaNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatLuaNumber(-0)).toBe('0');
    expect(formatLuaNumber(7424)).toBe('7424');
    expect(formatLuaNumber(0.00001)).toBe('1e-05');
    expect(formatLuaNumber(1.5e20)).toBe('1.5e+20');
    expect(formatLuaNumber(1e15)).toBe('1e+15');
    expect(formatLuaNumber(Number.NaN)).toBe('0/0');
    expect(formatLuaNumber(Number.POSITIVE_INFINITY)).toBe('math.huge');
    expect(formatLuaNumber(Number.NEGATIVE_INFINITY)).toBe('-math.huge');
    expect(quoteLuaString('C:\\Users\\"x"\nnext')).toBe('"C:\\\\Users\\\\\\"x\\"\\\nnext"');
    const round = parseLuaData(`a = ${quoteLuaString('tab\tquote"back\\slash\r\nend\0')}`);
    expect(round.ok && round.value.get('a')).toBe('tab\tquote"back\\slash\r\nend\0');
  });

  it('LuaTable keeps order and key types, and converts to and from plain data', () => {
    const table = LuaTable.of([
      ['b', 1],
      ['a', 2],
    ]);
    table.set('b', 3).set(10, 'ten');
    expect(table.keys()).toEqual(['b', 'a', 10]);
    expect(table.size).toBe(3);
    expect(table.has('a')).toBe(true);
    expect(table.delete('a')).toBe(true);
    expect(table.delete('a')).toBe(false);
    expect(table.isList()).toBe(false);
    expect(table.list()).toEqual([]);
    expect(table.toJs()).toEqual({ b: 3, '10': 'ten' });
    const list = LuaTable.from(['x', { y: [true] }, undefined]) as LuaTable;
    expect(list.isList()).toBe(true);
    expect(list.list()).toHaveLength(3);
    expect(list.toJs()).toEqual(['x', { y: [true] }, null]);
    expect(LuaTable.from({ keep: 1, drop: undefined })).toEqual(LuaTable.of([['keep', 1]]));
    expect(LuaTable.from(list)).toBe(list);
    expect(LuaTable.from(undefined)).toBeNull();
    expect(() => LuaTable.from(() => 1)).toThrow(/Cannot turn/);
    expect(new LuaTable().isList()).toBe(false);
    expect(new LuaDocument([]).format.indent).toBe('\t');
  });
});

describe('Lua sandbox', () => {
  it('runs a program and hands back data, with globals in and out', () => {
    const result = runLua(
      'local t = {}\nfor i = 1, 3 do t[i] = i * scale end\ntotal = #t\nreturn t, { name = "x", nested = { 1 } }, greeting .. "!"',
      { globals: { scale: 10, greeting: 'hi' }, read: ['total', 'undefinedGlobal'] }
    );
    if (!result.ok) throw new Error(`${result.error.message} ${result.error.detail}`);
    expect(result.value.returned.map((v) => (v instanceof LuaTable ? v.toJs() : v))).toEqual([
      [10, 20, 30],
      { name: 'x', nested: [1] },
      'hi!',
    ]);
    expect(result.value.globals).toEqual({ total: 3, undefinedGlobal: null });
    const passed = runLua('return input.list[2], input.flag, input.none', {
      globals: { input: LuaTable.from({ list: ['a', 'b'], flag: true, none: null }) },
    });
    expect(passed.ok && passed.value.returned).toEqual(['b', true, null]);
  });

  it('has no file, process or code-loading access, and reports errors with the file name', () => {
    const probe = runLua(
      'return io == nil, os == nil, require == nil, package == nil, debug == nil, load == nil, loadfile == nil, loadstring == nil'
    );
    expect(probe.ok && probe.value.returned).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(runLua('print("ignored") return unpack({1, 2})')).toMatchObject({
      ok: true,
      value: { returned: [1, 2] },
    });
    expect(runLua('return math.pow(2, 3), table.getn({1, 2})')).toMatchObject({
      ok: true,
      value: { returned: [8, 2] },
    });

    const syntax = runLua('x = = 1', { name: 'MonitorSetup/broken.lua' });
    expect(syntax).toMatchObject({ ok: false, error: { code: 'lua.run' } });
    expect(!syntax.ok && syntax.error.detail).toContain('MonitorSetup/broken.lua:1');
    const runtime = runLua('local a = nil\nreturn a.b', { name: 'f.lua' });
    expect(!runtime.ok && runtime.error.detail).toContain('f.lua:2');
    expect(runLua('error({})')).toMatchObject({ ok: false, error: { code: 'lua.run' } });
    expect(runLua('return 1', { prelude: 'this is not lua' })).toMatchObject({
      ok: false,
      error: { code: 'lua.run', message: 'The Lua prelude failed.' },
    });
    // Functions and other non-data values come back as null rather than failing.
    expect(runLua('return function() end, { f = print, [true] = 1, ok = 1 }')).toMatchObject({
      ok: true,
      value: {
        returned: [
          null,
          LuaTable.of([
            ['f', null],
            ['ok', 1],
          ]),
        ],
      },
    });
  });

  it('stops a file that never finishes', () => {
    const endless = runLua('while true do end', { name: 'loop.lua', maxInstructions: 200_000 });
    expect(endless).toEqual({
      ok: false,
      error: { code: 'lua.limit', message: 'loop.lua ran for too long and was stopped.' },
    });
  });

  it('dofile loads only what the caller hands out', () => {
    const files: Record<string, string> = {
      'devices.lua': 'devices = { HOTAS = 13 }',
      'values.lua': 'return 1, 2',
      'broken.lua': 'x = = 1',
    };
    const result = runLua(
      'dofile("devices.lua")\nlocal a, b = dofile("values.lua")\nreturn devices.HOTAS, a + b',
      { files: (name) => files[name] }
    );
    expect(result.ok && result.value.returned).toEqual([13, 3]);
    const refused = runLua('dofile("C:/Windows/win.ini")', { files: (name) => files[name] });
    expect(!refused.ok && refused.error.detail).toContain('cannot open C:/Windows/win.ini');
    expect(runLua('dofile("x")')).toMatchObject({ ok: false });
    expect(runLua('dofile("broken.lua")', { files: (name) => files[name] })).toMatchObject({
      ok: false,
    });
    expect(runLua('dofile(nil)')).toMatchObject({ ok: false });
  });

  it('evaluates the real F/A-18C and UH-1H joystick defaults from the recorded DCS install', async () => {
    // The helpers DCS gives these files, written in Lua. Engine command numbers (iCommand...)
    // are not in any file; unknown globals resolve to their own name so nothing is lost.
    const prelude = `
      setmetatable(_G, { __index = function(_, name) return name end })
      function _(text) return text end
      function join(to, from) for _, v in ipairs(from) do to[#to + 1] = v end return to end
      function external_profile(path) return dofile(path) end
      function defaultFFB() return {} end
      function ignore_features() end
      function defaultDeviceAssignmentFor(what) return { { key = "DEFAULT_" .. what } } end
      function MultiEngineDefaultDeviceAssignmentForThrust() return {} end
      function bindKeyboardCommandsToMouse() end
    `;
    const cases = [
      { module: 'FA-18C', unit: 'FA-18C', minimumKeys: 800 },
      { module: 'Uh-1H', unit: 'UH-1H', minimumKeys: 300 },
    ];
    for (const { module, unit, minimumKeys } of cases) {
      const folder = path.join(install, 'Mods', 'aircraft', module, 'Input', unit, 'joystick');
      const source = await fs.readFile(path.join(folder, 'default.lua'), 'utf8');
      const loaded = new Map<string, string>();
      for (const file of await luaFiles(install))
        loaded.set(path.resolve(file).toLowerCase(), await fs.readFile(file, 'utf8'));
      const result = runLua(source, {
        name: `${unit}/joystick/default.lua`,
        prelude,
        globals: {
          folder: `${folder}${path.sep}`,
          filename: 'default.lua',
          deviceName: 'Test Stick',
        },
        // Paths are either absolute (built from `folder`) or relative to the install folder.
        files: (requested) =>
          loaded.get(path.resolve(requested).toLowerCase()) ??
          loaded.get(path.resolve(install, requested).toLowerCase()),
      });
      expect(
        result.ok,
        `${unit}: ${result.ok ? '' : `${result.error.message} ${result.error.detail}`}`
      ).toBe(true);
      if (!result.ok) continue;
      const profile = result.value.returned[0] as LuaTable;
      const keys = profile.table('keyCommands')!.list() as LuaTable[];
      const axes = profile.table('axisCommands')!.list() as LuaTable[];
      expect(keys.length, unit).toBeGreaterThan(minimumKeys);
      expect(axes.length, unit).toBeGreaterThan(10);
      expect(keys.every((k) => typeof k.get('name') === 'string')).toBe(true);
      // Cockpit commands carry real numbers from command_defs.lua and devices.lua.
      expect(
        keys.some(
          (k) => typeof k.get('down') === 'number' && typeof k.get('cockpit_device_id') === 'number'
        )
      ).toBe(true);
    }
  });
});
