import { err, ok, type Result } from '../result';

/**
 * Reader and writer for the Lua DATA files DCS keeps: binding diffs (.diff.lua),
 * options.lua, modifiers.lua, disabled.lua, appSettings.lua. These are table literals
 * assigned to a variable, nothing more. Anything else (function calls, operators,
 * control flow) is refused with a line number; use core/lua/sandbox.ts for files that
 * are real programs (input defaults, MonitorSetup).
 *
 * The writer emits DCS's own formatting, so reading a file and writing it back
 * unchanged gives the same bytes.
 */

export type LuaValue = string | number | boolean | null | LuaTable;

/** A Lua table with its entries in file order and its keys as written (string or number). */
export class LuaTable {
  readonly entries: { key: string | number; value: LuaValue }[] = [];

  static of(entries: Iterable<[string | number, LuaValue]>): LuaTable {
    const table = new LuaTable();
    for (const [key, value] of entries) table.set(key, value);
    return table;
  }

  /**
   * From plain data: an array becomes keys 1..n, an object string keys; undefined
   * properties are left out.
   */
  static from(value: unknown): LuaValue {
    if (value === null || value === undefined) return null;
    if (value instanceof LuaTable) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    const table = new LuaTable();
    if (Array.isArray(value)) {
      value.forEach((item, index) => table.set(index + 1, LuaTable.from(item)));
    } else if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) table.set(key, LuaTable.from(item));
      }
    } else {
      throw new Error(`Cannot turn a ${typeof value} into Lua data`);
    }
    return table;
  }

  get size(): number {
    return this.entries.length;
  }

  has(key: string | number): boolean {
    return this.entries.some((e) => e.key === key);
  }

  get(key: string | number): LuaValue | undefined {
    return this.entries.find((e) => e.key === key)?.value;
  }

  /** The nested table under a key, when there is one. */
  table(key: string | number): LuaTable | undefined {
    const value = this.get(key);
    return value instanceof LuaTable ? value : undefined;
  }

  /** Replaces the value of an existing key in place, or appends a new entry. */
  set(key: string | number, value: LuaValue): this {
    const existing = this.entries.find((e) => e.key === key);
    if (existing) existing.value = value;
    else this.entries.push({ key, value });
    return this;
  }

  delete(key: string | number): boolean {
    const index = this.entries.findIndex((e) => e.key === key);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  keys(): (string | number)[] {
    return this.entries.map((e) => e.key);
  }

  /** True when the keys are exactly 1..n in order: a list. */
  isList(): boolean {
    return this.entries.length > 0 && this.entries.every((e, index) => e.key === index + 1);
  }

  /** The values of a list (keys 1..n). Empty for anything else. */
  list(): LuaValue[] {
    return this.isList() ? this.entries.map((e) => e.value) : [];
  }

  /** Plain data: a list becomes an array, anything else an object (number keys as strings). */
  toJs(): unknown {
    const convert = (value: LuaValue): unknown =>
      value instanceof LuaTable ? value.toJs() : value;
    if (this.isList()) return this.entries.map((e) => convert(e.value));
    return Object.fromEntries(this.entries.map((e) => [String(e.key), convert(e.value)]));
  }
}

export interface LuaStatement {
  /** The variable assigned, or returned. */
  name: string;
  kind: 'assign' | 'return';
  /** `local name = ...` */
  local: boolean;
  /** Absent for `return name`. */
  value?: LuaValue;
  /** Empty lines before this statement, kept so a rewrite does not reflow the file. */
  blankLinesBefore: number;
}

/** A parsed data file: its assignments in order, plus the formatting needed to write it back. */
export class LuaDocument {
  constructor(
    readonly statements: LuaStatement[],
    readonly format: { indent: string; eol: string; finalNewline: boolean } = {
      indent: '\t',
      eol: '\n',
      finalNewline: false,
    }
  ) {}

  /** The value assigned to a top-level variable (`diff`, `options`, ...). */
  get(name: string): LuaValue | undefined {
    return this.statements.find((s) => s.kind === 'assign' && s.name === name)?.value;
  }

  table(name: string): LuaTable | undefined {
    const value = this.get(name);
    return value instanceof LuaTable ? value : undefined;
  }

  /** Replaces a variable's value, or adds the assignment at the end (before a return). */
  set(name: string, value: LuaValue, options: { local?: boolean } = {}): void {
    const existing = this.statements.find((s) => s.kind === 'assign' && s.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    const statement: LuaStatement = {
      name,
      kind: 'assign',
      local: options.local ?? false,
      value,
      blankLinesBefore: 0,
    };
    const returnAt = this.statements.findIndex((s) => s.kind === 'return');
    if (returnAt < 0) this.statements.push(statement);
    else this.statements.splice(returnAt, 0, statement);
  }
}

type Token =
  | { type: 'name'; value: string; line: number }
  | { type: 'string'; value: string; line: number }
  | { type: 'number'; value: number; line: number }
  | { type: 'symbol'; value: string; line: number }
  | { type: 'end'; line: number };

class ParseError extends Error {}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const fail = (message: string): never => {
    throw new ParseError(`line ${line}: ${message}`);
  };
  const longBracket = (at: number): number => {
    // "[" "="* "[" : returns the number of "=" or -1.
    if (text[at] !== '[') return -1;
    let level = 0;
    while (text[at + 1 + level] === '=') level++;
    return text[at + 1 + level] === '[' ? level : -1;
  };
  const readLong = (level: number): string => {
    const close = `]${'='.repeat(level)}]`;
    const start = i + level + 2;
    const end = text.indexOf(close, start);
    if (end < 0) fail('unfinished long string or comment');
    let body = text.slice(start, end);
    // A newline right after the opening bracket is not part of the string.
    if (body.startsWith('\r\n')) body = body.slice(2);
    else if (body.startsWith('\n')) body = body.slice(1);
    line += text.slice(i, end).split('\n').length - 1;
    i = end + close.length;
    return body;
  };

  while (i < text.length) {
    const c = text[i]!;
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') {
      i++;
    } else if (c === '-' && text[i + 1] === '-') {
      i += 2;
      const level = longBracket(i);
      if (level >= 0) readLong(level);
      else while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '"' || c === "'") {
      const startLine = line;
      let value = '';
      i++;
      for (;;) {
        if (i >= text.length || text[i] === '\n') fail('unfinished string');
        const ch = text[i]!;
        if (ch === c) break;
        if (ch !== '\\') {
          value += ch;
          i++;
          continue;
        }
        const next = text[i + 1];
        i += 2;
        if (next === 'n') value += '\n';
        else if (next === 't') value += '\t';
        else if (next === 'r') value += '\r';
        else if (next === 'a') value += '\x07';
        else if (next === 'b') value += '\b';
        else if (next === 'f') value += '\f';
        else if (next === 'v') value += '\v';
        else if (next === '\\' || next === '"' || next === "'") value += next;
        else if (next === '\n') {
          value += '\n';
          line++;
        } else if (next === '\r') {
          value += '\n';
          if (text[i] === '\n') i++;
          line++;
        } else if (next !== undefined && /[0-9]/.test(next)) {
          let digits = next;
          while (digits.length < 3 && /[0-9]/.test(text[i] ?? '')) digits += text[i++];
          value += String.fromCharCode(Number.parseInt(digits, 10));
        } else {
          fail(`unsupported escape \\${next ?? ''}`);
        }
      }
      i++;
      tokens.push({ type: 'string', value, line: startLine });
    } else if (c === '[' && longBracket(i) >= 0) {
      const startLine = line;
      tokens.push({ type: 'string', value: readLong(longBracket(i)), line: startLine });
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const match = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(
        text.slice(i)
      );
      if (!match) fail('malformed number');
      const raw = match![0];
      i += raw.length;
      if (/[A-Za-z_]/.test(text[i] ?? '')) fail('malformed number');
      tokens.push({ type: 'number', value: Number(raw), line });
    } else if (/[A-Za-z_]/.test(c)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))!;
      i += match[0].length;
      tokens.push({ type: 'name', value: match[0], line });
    } else if ('{}[]=,;-'.includes(c)) {
      tokens.push({ type: 'symbol', value: c, line });
      i++;
    } else {
      fail(`unexpected "${c}" (only table data is supported here)`);
    }
  }
  tokens.push({ type: 'end', line });
  return tokens;
}

/** Parses a Lua data file. Fails with `lua.parse` and a line number on anything that is not table data. */
export function parseLuaData(text: string): Result<LuaDocument> {
  let tokens: Token[];
  try {
    tokens = tokenize(text);
  } catch (e) {
    if (e instanceof ParseError) return err('lua.parse', `Not a Lua data file: ${e.message}`);
    throw e;
  }
  let position = 0;
  const peek = (): Token => tokens[position]!;
  const next = (): Token => tokens[position++]!;
  const fail = (token: Token, message: string): never => {
    throw new ParseError(`line ${token.line}: ${message}`);
  };
  const isSymbol = (token: Token, value: string): boolean =>
    token.type === 'symbol' && token.value === value;
  const describe = (token: Token): string =>
    token.type === 'end' ? 'end of file' : `"${String(token.value)}"`;

  const value = (depth: number): LuaValue => {
    const token = next();
    if (token.type === 'string' || token.type === 'number') return token.value;
    if (token.type === 'name') {
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'nil') return null;
      return fail(
        token,
        `"${token.value}" is not data (variables and function calls are not supported)`
      );
    }
    if (isSymbol(token, '-')) {
      const number = next();
      if (number.type !== 'number') return fail(number, 'expected a number after "-"');
      return -number.value;
    }
    if (isSymbol(token, '{')) {
      if (depth > 200) return fail(token, 'tables are nested too deeply');
      const table = new LuaTable();
      let positional = 0;
      for (;;) {
        const head = peek();
        if (isSymbol(head, '}')) {
          next();
          return table;
        }
        let key: string | number;
        if (isSymbol(head, '[')) {
          next();
          const keyValue = value(depth + 1);
          if (typeof keyValue !== 'string' && typeof keyValue !== 'number') {
            return fail(head, 'a table key must be a string or a number');
          }
          key = keyValue;
          if (!isSymbol(peek(), ']'))
            return fail(peek(), `expected "]" but found ${describe(peek())}`);
          next();
          if (!isSymbol(peek(), '='))
            return fail(peek(), `expected "=" but found ${describe(peek())}`);
          next();
        } else if (head.type === 'name' && isSymbol(tokens[position + 1]!, '=')) {
          key = head.value;
          position += 2;
        } else {
          key = ++positional;
        }
        table.set(key, value(depth + 1));
        const separator = peek();
        if (isSymbol(separator, ',') || isSymbol(separator, ';')) next();
        else if (!isSymbol(separator, '}')) {
          return fail(separator, `expected "," or "}" but found ${describe(separator)}`);
        }
      }
    }
    return fail(token, `unexpected ${describe(token)}`);
  };

  // Blank lines before each statement, counted on the raw text.
  const lines = text.split('\n');
  const blankBefore = (line: number): number => {
    let count = 0;
    for (let at = line - 2; at >= 0 && lines[at]!.trim() === ''; at--) count++;
    return count;
  };

  try {
    const statements: LuaStatement[] = [];
    while (peek().type !== 'end') {
      const first = next();
      if (first.type !== 'name')
        return fail(first, `expected a variable name but found ${describe(first)}`);
      const blankLinesBefore = statements.length === 0 ? 0 : blankBefore(first.line);
      if (first.value === 'return') {
        const name = next();
        if (name.type !== 'name') return fail(name, 'only "return <variable>" is supported');
        statements.push({ name: name.value, kind: 'return', local: false, blankLinesBefore });
        if (isSymbol(peek(), ';')) next();
        continue;
      }
      let local = false;
      let name: string = first.value;
      if (first.value === 'local') {
        local = true;
        const declared = next();
        if (declared.type !== 'name') {
          return fail(declared, 'expected a variable name after "local"');
        }
        name = declared.value;
      }
      if (!isSymbol(peek(), '=')) {
        return fail(peek(), `expected "=" after ${name} but found ${describe(peek())}`);
      }
      next();
      statements.push({
        name,
        kind: 'assign',
        local,
        value: value(0),
        blankLinesBefore,
      });
      if (isSymbol(peek(), ';')) next();
    }
    // The indentation of the first entry of the first table is the file's indent unit.
    const indent = /\{\r?\n( +|\t)\S/.exec(text)?.[1] ?? '\t';
    return ok(
      new LuaDocument(statements, {
        indent,
        eol: text.includes('\r\n') ? '\r\n' : '\n',
        finalNewline: /\n\s*$/.test(text),
      })
    );
  } catch (e) {
    if (e instanceof ParseError) return err('lua.parse', `Not a Lua data file: ${e.message}`);
    throw e;
  }
}

/** A number the way Lua's "%.14g" prints it, which is how DCS writes them. */
export function formatLuaNumber(value: number): string {
  if (Number.isNaN(value)) return '0/0';
  if (!Number.isFinite(value)) return value > 0 ? 'math.huge' : '-math.huge';
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const rounded = Number(value.toPrecision(14));
  const exponent = rounded === 0 ? 0 : Math.floor(Math.log10(Math.abs(rounded)));
  if (exponent < -4 || exponent >= 14) {
    // %g switches to exponent form here, with at least two exponent digits.
    const [mantissa, power] = rounded.toExponential().split('e') as [string, string];
    const sign = power.startsWith('-') ? '-' : '+';
    return `${mantissa}e${sign}${power.replace(/^[+-]/, '').padStart(2, '0')}`;
  }
  return String(rounded);
}

/** A string literal with the escapes Lua's "%q" uses. */
export function quoteLuaString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\\n')
    .replace(/\0/g, '\\0');
  return `"${escaped}"`;
}

function writeValue(value: LuaValue, indent: string, level: number, eol: string): string {
  if (value === null) return 'nil';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return formatLuaNumber(value);
  if (typeof value === 'string') return quoteLuaString(value);
  const inner = indent.repeat(level + 1);
  let out = `{${eol}`;
  for (const { key, value: item } of value.entries) {
    const name = typeof key === 'number' ? `[${formatLuaNumber(key)}]` : `[${quoteLuaString(key)}]`;
    out += `${inner}${name} = ${writeValue(item, indent, level + 1, eol)},${eol}`;
  }
  return `${out}${indent.repeat(level)}}`;
}

/** One value in DCS's formatting: tab-indented, ["key"] = value, one entry per line. */
export function writeLuaValue(
  value: LuaValue,
  options: { indent?: string; eol?: string } = {}
): string {
  return writeValue(value, options.indent ?? '\t', 0, options.eol ?? '\n');
}

/** The whole file. An unchanged document gives back the text it was parsed from. */
export function writeLuaDocument(document: LuaDocument): string {
  const { indent, eol, finalNewline } = document.format;
  const parts = document.statements.map((statement) => {
    const gap = eol.repeat(statement.blankLinesBefore);
    if (statement.kind === 'return') return `${gap}return ${statement.name}`;
    const head = statement.local ? `local ${statement.name}` : statement.name;
    return `${gap}${head} = ${writeValue(statement.value ?? null, indent, 0, eol)}`;
  });
  return parts.join(eol) + (finalNewline ? eol : '');
}

/** A new document in DCS's binding-file shape: `local <name> = {...}` followed by `return <name>`. */
export function luaDocument(name: string, value: LuaValue, local = true): LuaDocument {
  return new LuaDocument(
    [
      { name, kind: 'assign', local, value, blankLinesBefore: 0 },
      ...(local ? [{ name, kind: 'return' as const, local: false, blankLinesBefore: 0 }] : []),
    ],
    { indent: '\t', eol: '\n', finalNewline: false }
  );
}
