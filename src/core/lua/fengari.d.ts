/** The part of fengari (a Lua VM in JavaScript) that core/lua/sandbox.ts uses. */
declare module 'fengari' {
  /** An opaque Lua state. */
  export interface LuaState {
    readonly __luaState: unique symbol;
  }
  export type LuaBytes = Uint8Array;
  export type LuaFunction = (L: LuaState) => number;

  export function to_luastring(text: string): LuaBytes;
  export function to_jsstring(bytes: LuaBytes): string;

  export const lua: {
    LUA_OK: number;
    LUA_MULTRET: number;
    LUA_MASKCOUNT: number;
    LUA_TNIL: number;
    LUA_TBOOLEAN: number;
    LUA_TNUMBER: number;
    LUA_TSTRING: number;
    LUA_TTABLE: number;
    lua_close(L: LuaState): void;
    lua_gettop(L: LuaState): number;
    lua_settop(L: LuaState, index: number): void;
    lua_pop(L: LuaState, count: number): void;
    lua_type(L: LuaState, index: number): number;
    lua_toboolean(L: LuaState, index: number): boolean;
    lua_tonumber(L: LuaState, index: number): number;
    lua_tojsstring(L: LuaState, index: number): string;
    lua_tostring(L: LuaState, index: number): LuaBytes | null;
    lua_pushnil(L: LuaState): void;
    lua_pushboolean(L: LuaState, value: boolean): void;
    lua_pushnumber(L: LuaState, value: number): void;
    lua_pushstring(L: LuaState, value: LuaBytes): void;
    lua_pushvalue(L: LuaState, index: number): void;
    lua_pushjsfunction(L: LuaState, fn: LuaFunction): void;
    lua_createtable(L: LuaState, array: number, record: number): void;
    lua_rawset(L: LuaState, index: number): void;
    lua_next(L: LuaState, index: number): number;
    lua_getglobal(L: LuaState, name: LuaBytes): number;
    lua_setglobal(L: LuaState, name: LuaBytes): void;
    lua_pcall(L: LuaState, args: number, results: number, handler: number): number;
    lua_call(L: LuaState, args: number, results: number): void;
    lua_error(L: LuaState): number;
    lua_sethook(
      L: LuaState,
      hook: ((L: LuaState, record: unknown) => void) | null,
      mask: number,
      count: number
    ): void;
  };

  export const lauxlib: {
    luaL_newstate(): LuaState;
    luaL_requiref(L: LuaState, name: LuaBytes, open: LuaFunction, global: number): void;
    luaL_loadbuffer(L: LuaState, code: LuaBytes, size: number | null, name: LuaBytes): number;
  };

  export const lualib: {
    luaopen_base: LuaFunction;
    luaopen_table: LuaFunction;
    luaopen_string: LuaFunction;
    luaopen_math: LuaFunction;
  };
}
