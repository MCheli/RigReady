import { lauxlib, lua, lualib, to_luastring, type LuaState } from 'fengari';
import { err, ok, type Result } from '../result';
import { LuaTable, type LuaValue } from './data';

/**
 * Runs Lua that is a real program (DCS input defaults with join() and
 * external_profile(), MonitorSetup files with `if` and arithmetic) in a sandbox and
 * hands back plain data.
 *
 * The sandbox has the base, table, string and math libraries and nothing else: no io,
 * no os, no package, no debug, no loading of files except through the `files` callback.
 * It stops after a fixed number of VM instructions, so a file cannot hang the app.
 * Functions that DCS provides to these files (`_`, `join`, `external_profile`, ...) are
 * written in Lua by the caller and passed as `prelude`.
 */
export interface LuaRunOptions {
  /** Shown in error messages, e.g. the file name. */
  name?: string;
  /** Lua run first, in the same environment (define the helper functions the file expects). */
  prelude?: string;
  /** Data made available as global variables before anything runs. */
  globals?: Record<string, LuaValue>;
  /** What dofile(path) may load: the text of the file, or undefined to refuse. */
  files?: (path: string) => string | undefined;
  /** Global variables to read back afterwards. */
  read?: string[];
  /** VM instruction budget. Default 20 million. */
  maxInstructions?: number;
}

export interface LuaRunResult {
  /** What the chunk returned. */
  returned: LuaValue[];
  /** The globals named in `read`. A missing one is null. */
  globals: Record<string, LuaValue>;
}

/** Lua 5.1 names that DCS files use and Lua 5.3 dropped. */
const COMPATIBILITY = `
unpack = unpack or table.unpack
table.getn = table.getn or function(t) return #t end
math.pow = math.pow or function(a, b) return a ^ b end
string.gfind = string.gfind or string.gmatch
loadstring = nil
`;

const MAX_DEPTH = 64;

function pushValue(L: LuaState, value: LuaValue): void {
  if (value === null) lua.lua_pushnil(L);
  else if (typeof value === 'boolean') lua.lua_pushboolean(L, value);
  else if (typeof value === 'number') lua.lua_pushnumber(L, value);
  else if (typeof value === 'string') lua.lua_pushstring(L, to_luastring(value));
  else {
    lua.lua_createtable(L, 0, value.size);
    for (const entry of value.entries) {
      pushValue(L, entry.key);
      pushValue(L, entry.value);
      lua.lua_rawset(L, -3);
    }
  }
}

/** Converts the value at `index` to data. Functions and other non-data values become null. */
function readValue(L: LuaState, index: number, depth: number): LuaValue {
  const type = lua.lua_type(L, index);
  if (type === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, index);
  if (type === lua.LUA_TNUMBER) return lua.lua_tonumber(L, index);
  if (type === lua.LUA_TSTRING) return lua.lua_tojsstring(L, index);
  if (type !== lua.LUA_TTABLE || depth > MAX_DEPTH) return null;

  const absolute = index < 0 ? lua.lua_gettop(L) + index + 1 : index;
  const entries: { key: string | number; value: LuaValue }[] = [];
  lua.lua_pushnil(L);
  while (lua.lua_next(L, absolute) !== 0) {
    const keyType = lua.lua_type(L, -2);
    if (keyType === lua.LUA_TNUMBER || keyType === lua.LUA_TSTRING) {
      const key = keyType === lua.LUA_TNUMBER ? lua.lua_tonumber(L, -2) : lua.lua_tojsstring(L, -2);
      entries.push({ key, value: readValue(L, -1, depth + 1) });
    }
    lua.lua_pop(L, 1);
  }
  // Lua iterates the array part first and the rest in hash order: list keys first, in order,
  // then the others sorted, so the result does not depend on the VM's hashing.
  const numeric = entries
    .filter((e) => typeof e.key === 'number')
    .sort((a, b) => (a.key as number) - (b.key as number));
  const named = entries
    .filter((e) => typeof e.key === 'string')
    .sort((a, b) => (a.key as string).localeCompare(b.key as string));
  const table = new LuaTable();
  for (const entry of [...numeric, ...named]) table.entries.push(entry);
  return table;
}

function errorText(L: LuaState): string {
  const text = lua.lua_type(L, -1) === lua.LUA_TSTRING ? lua.lua_tojsstring(L, -1) : 'error';
  lua.lua_pop(L, 1);
  return text;
}

/** Runs a Lua chunk in the sandbox. Fails with `lua.run` (and the Lua error text) or `lua.limit`. */
export function runLua(source: string, options: LuaRunOptions = {}): Result<LuaRunResult> {
  const L = lauxlib.luaL_newstate();
  let exhausted = false;
  try {
    for (const [name, open] of [
      ['_G', lualib.luaopen_base],
      ['table', lualib.luaopen_table],
      ['string', lualib.luaopen_string],
      ['math', lualib.luaopen_math],
    ] as const) {
      lauxlib.luaL_requiref(L, to_luastring(name), open, 1);
      lua.lua_pop(L, 1);
    }
    // The base library's own file and code loaders are removed; dofile is replaced below.
    for (const name of ['loadfile', 'load', 'dofile', 'require', 'collectgarbage']) {
      lua.lua_pushnil(L);
      lua.lua_setglobal(L, to_luastring(name));
    }
    lua.lua_pushjsfunction(L, () => 0);
    lua.lua_setglobal(L, to_luastring('print'));

    const { files } = options;
    lua.lua_pushjsfunction(L, (state) => {
      const requested =
        lua.lua_type(state, 1) === lua.LUA_TSTRING ? lua.lua_tojsstring(state, 1) : '';
      const text = files?.(requested);
      if (text === undefined) {
        lua.lua_pushstring(state, to_luastring(`cannot open ${requested}`));
        return lua.lua_error(state);
      }
      const base = lua.lua_gettop(state);
      const status = lauxlib.luaL_loadbuffer(
        state,
        to_luastring(text),
        null,
        to_luastring(`@${requested}`)
      );
      if (status !== lua.LUA_OK) return lua.lua_error(state);
      lua.lua_call(state, 0, lua.LUA_MULTRET);
      return lua.lua_gettop(state) - base;
    });
    lua.lua_setglobal(L, to_luastring('dofile'));

    for (const [name, value] of Object.entries(options.globals ?? {})) {
      pushValue(L, value);
      lua.lua_setglobal(L, to_luastring(name));
    }

    const budget = options.maxInstructions ?? 20_000_000;
    const step = 10_000;
    let used = 0;
    lua.lua_sethook(
      L,
      (state) => {
        used += step;
        if (used < budget) return;
        exhausted = true;
        lua.lua_pushstring(state, to_luastring('instruction limit reached'));
        lua.lua_error(state);
      },
      lua.LUA_MASKCOUNT,
      step
    );

    const run = (code: string, chunk: string, results: number): string | undefined => {
      if (
        lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(`@${chunk}`)) !==
        lua.LUA_OK
      ) {
        return errorText(L);
      }
      return lua.lua_pcall(L, 0, results, 0) === lua.LUA_OK ? undefined : errorText(L);
    };

    const name = options.name ?? 'chunk';
    const failure =
      run(COMPATIBILITY, 'compatibility', 0) ??
      (options.prelude !== undefined ? run(options.prelude, 'prelude', 0) : undefined);
    if (failure !== undefined) return err('lua.run', 'The Lua prelude failed.', failure);

    const before = lua.lua_gettop(L);
    const problem = run(source, name, lua.LUA_MULTRET);
    if (problem !== undefined) {
      return exhausted
        ? err('lua.limit', `${name} ran for too long and was stopped.`)
        : err('lua.run', `${name} could not be evaluated.`, problem);
    }
    const returned: LuaValue[] = [];
    for (let index = before + 1; index <= lua.lua_gettop(L); index++) {
      returned.push(readValue(L, index, 0));
    }
    lua.lua_settop(L, before);

    const globals: Record<string, LuaValue> = {};
    for (const global of options.read ?? []) {
      lua.lua_getglobal(L, to_luastring(global));
      globals[global] = readValue(L, -1, 0);
      lua.lua_pop(L, 1);
    }
    return ok({ returned, globals });
  } catch (e) {
    return exhausted
      ? err('lua.limit', `${options.name ?? 'The Lua file'} ran for too long and was stopped.`)
      : err(
          'lua.run',
          'The Lua file could not be evaluated.',
          e instanceof Error ? e.message : String(e)
        );
  } finally {
    lua.lua_sethook(L, null, 0, 0);
    lua.lua_close(L);
  }
}
