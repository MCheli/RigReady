/**
 * DCS Lua Parser
 * Custom recursive descent parser for DCS World Lua binding files
 *
 * DCS binding files use a specific Lua format:
 * local diff = {
 *   ["axisDiffs"] = { ... },
 *   ["keyDiffs"] = { ... },
 * }
 * return diff
 */

import type { DCSBindingFile, DCSAxisDiff, DCSKeyDiff, DCSAxisFilter } from '../../shared/dcsTypes';

// Token types
type TokenType =
  | 'LOCAL'
  | 'RETURN'
  | 'NIL'
  | 'TRUE'
  | 'FALSE'
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'LBRACE'
  | 'RBRACE'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'LPAREN'
  | 'RPAREN'
  | 'EQUALS'
  | 'COMMA'
  | 'DOT'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

class LuaLexer {
  private input: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;

  constructor(input: string) {
    this.input = input;
  }

  private peek(offset: number = 0): string {
    return this.input[this.pos + offset] || '';
  }

  private advance(): string {
    const char = this.input[this.pos++] || '';
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        this.advance();
      } else if (char === '-' && this.peek(1) === '-') {
        // Skip comments
        this.advance();
        this.advance();
        if (this.peek() === '[' && this.peek(1) === '[') {
          // Multi-line comment
          this.advance();
          this.advance();
          while (this.pos < this.input.length) {
            if (this.peek() === ']' && this.peek(1) === ']') {
              this.advance();
              this.advance();
              break;
            }
            this.advance();
          }
        } else {
          // Single-line comment
          while (this.pos < this.input.length && this.peek() !== '\n') {
            this.advance();
          }
        }
      } else {
        break;
      }
    }
  }

  private readString(quote: string): string {
    let result = '';
    this.advance(); // Skip opening quote

    if (quote === '[') {
      // Long string [[...]]
      if (this.peek() === '[') {
        this.advance();
        while (this.pos < this.input.length) {
          if (this.peek() === ']' && this.peek(1) === ']') {
            this.advance();
            this.advance();
            break;
          }
          result += this.advance();
        }
        return result;
      }
    }

    while (this.pos < this.input.length) {
      const char = this.peek();
      if (char === quote) {
        this.advance();
        break;
      }
      if (char === '\\') {
        this.advance();
        const escaped = this.advance();
        switch (escaped) {
          case 'n':
            result += '\n';
            break;
          case 't':
            result += '\t';
            break;
          case 'r':
            result += '\r';
            break;
          case '\\':
            result += '\\';
            break;
          case '"':
            result += '"';
            break;
          case "'":
            result += "'";
            break;
          default:
            result += escaped;
        }
      } else {
        result += this.advance();
      }
    }
    return result;
  }

  private readNumber(): string {
    let result = '';
    const isNegative = this.peek() === '-';
    if (isNegative) {
      result += this.advance();
    }

    while (this.pos < this.input.length) {
      const char = this.peek();
      if (/[0-9.]/.test(char) || (result.length > 0 && /[eE]/.test(char))) {
        result += this.advance();
        // Handle exponent sign
        if (
          /[eE]/.test(result[result.length - 1]) &&
          (this.peek() === '+' || this.peek() === '-')
        ) {
          result += this.advance();
        }
      } else if (char === 'x' || char === 'X') {
        // Hexadecimal
        result += this.advance();
        while (/[0-9a-fA-F]/.test(this.peek())) {
          result += this.advance();
        }
        break;
      } else {
        break;
      }
    }
    return result;
  }

  private readIdentifier(): string {
    let result = '';
    while (this.pos < this.input.length) {
      const char = this.peek();
      if (/[a-zA-Z0-9_]/.test(char)) {
        result += this.advance();
      } else {
        break;
      }
    }
    return result;
  }

  nextToken(): Token {
    this.skipWhitespace();

    const line = this.line;
    const column = this.column;

    if (this.pos >= this.input.length) {
      return { type: 'EOF', value: '', line, column };
    }

    const char = this.peek();

    // String literals
    if (char === '"' || char === "'") {
      return { type: 'STRING', value: this.readString(char), line, column };
    }

    // Long strings
    if (char === '[' && this.peek(1) === '[') {
      return { type: 'STRING', value: this.readString('['), line, column };
    }

    // Numbers (including negative)
    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(this.peek(1)))) {
      return { type: 'NUMBER', value: this.readNumber(), line, column };
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      const value = this.readIdentifier();
      switch (value) {
        case 'local':
          return { type: 'LOCAL', value, line, column };
        case 'return':
          return { type: 'RETURN', value, line, column };
        case 'nil':
          return { type: 'NIL', value, line, column };
        case 'true':
          return { type: 'TRUE', value, line, column };
        case 'false':
          return { type: 'FALSE', value, line, column };
        default:
          return { type: 'IDENTIFIER', value, line, column };
      }
    }

    // Single character tokens
    this.advance();
    switch (char) {
      case '{':
        return { type: 'LBRACE', value: char, line, column };
      case '}':
        return { type: 'RBRACE', value: char, line, column };
      case '[':
        return { type: 'LBRACKET', value: char, line, column };
      case ']':
        return { type: 'RBRACKET', value: char, line, column };
      case '(':
        return { type: 'LPAREN', value: char, line, column };
      case ')':
        return { type: 'RPAREN', value: char, line, column };
      case '=':
        return { type: 'EQUALS', value: char, line, column };
      case ',':
        return { type: 'COMMA', value: char, line, column };
      case '.':
        return { type: 'DOT', value: char, line, column };
      default:
        // Skip unknown characters
        return this.nextToken();
    }
  }
}

class LuaParser {
  private lexer: LuaLexer;
  private currentToken: Token;

  constructor(input: string) {
    this.lexer = new LuaLexer(input);
    this.currentToken = this.lexer.nextToken();
  }

  private advance(): Token {
    const token = this.currentToken;
    this.currentToken = this.lexer.nextToken();
    return token;
  }

  private expect(type: TokenType): Token {
    if (this.currentToken.type !== type) {
      throw new Error(
        `Expected ${type} but got ${this.currentToken.type} at line ${this.currentToken.line}, column ${this.currentToken.column}`
      );
    }
    return this.advance();
  }

  private peek(): Token {
    return this.currentToken;
  }

  parse(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Parse top-level statements
    while (this.peek().type !== 'EOF') {
      if (this.peek().type === 'LOCAL') {
        this.advance(); // Skip 'local'
        const name = this.expect('IDENTIFIER').value;
        if (this.peek().type === 'EQUALS') {
          this.advance(); // Skip '='
          result[name] = this.parseValue();
        }
      } else if (this.peek().type === 'RETURN') {
        this.advance(); // Skip 'return'
        // Return statement - the returned value is the main result
        if (this.peek().type === 'IDENTIFIER') {
          const varName = this.advance().value;
          if (result[varName]) {
            return result[varName] as Record<string, unknown>;
          }
        } else if (this.peek().type === 'LBRACE') {
          return this.parseTable() as Record<string, unknown>;
        }
      } else {
        // Skip unexpected tokens
        this.advance();
      }
    }

    // Return the first variable if no return statement
    const keys = Object.keys(result);
    if (keys.length > 0) {
      return result[keys[0]] as Record<string, unknown>;
    }

    return result;
  }

  private parseValue(): unknown {
    const token = this.peek();

    switch (token.type) {
      case 'LBRACE':
        return this.parseTable();
      case 'STRING':
        this.advance();
        return token.value;
      case 'NUMBER':
        this.advance();
        return parseFloat(token.value);
      case 'TRUE':
        this.advance();
        return true;
      case 'FALSE':
        this.advance();
        return false;
      case 'NIL':
        this.advance();
        return null;
      case 'IDENTIFIER':
        this.advance();
        return token.value;
      default:
        throw new Error(
          `Unexpected token ${token.type} at line ${token.line}, column ${token.column}`
        );
    }
  }

  private parseTable(): Record<string, unknown> | unknown[] {
    this.expect('LBRACE');

    // Check if this is an array or object
    const result: Record<string, unknown> = {};
    const arrayResult: unknown[] = [];
    let isArray = true;
    let index = 1;

    while (this.peek().type !== 'RBRACE' && this.peek().type !== 'EOF') {
      // Skip commas
      if (this.peek().type === 'COMMA') {
        this.advance();
        continue;
      }

      // Check for key
      if (this.peek().type === 'LBRACKET') {
        // [key] = value or [index] = value
        this.advance(); // Skip '['
        const key = this.parseValue();
        this.expect('RBRACKET');
        this.expect('EQUALS');
        const value = this.parseValue();

        if (typeof key === 'number' && key === index) {
          arrayResult.push(value);
          index++;
        } else {
          isArray = false;
          result[String(key)] = value;
        }
      } else if (this.peek().type === 'IDENTIFIER') {
        // identifier = value
        const key = this.advance().value;
        if (this.peek().type === 'EQUALS') {
          this.advance();
          const value = this.parseValue();
          isArray = false;
          result[key] = value;
        } else {
          // Just a value in an array
          arrayResult.push(key);
          index++;
        }
      } else {
        // Value without key (array element)
        const value = this.parseValue();
        arrayResult.push(value);
        index++;
      }
    }

    this.expect('RBRACE');

    // If we have both array and object entries, merge them
    if (arrayResult.length > 0 && Object.keys(result).length > 0) {
      arrayResult.forEach((v, i) => {
        result[String(i + 1)] = v;
      });
      return result;
    }

    return isArray && arrayResult.length > 0 ? arrayResult : result;
  }
}

/**
 * Parse a DCS Lua binding file into structured data
 */
export function parseDCSBindingFile(content: string): DCSBindingFile {
  try {
    const parser = new LuaParser(content);
    const parsed = parser.parse();

    const axisDiffs = (parsed['axisDiffs'] as DCSAxisDiff) || {};
    const keyDiffs = (parsed['keyDiffs'] as DCSKeyDiff) || {};
    const forceFeedback = (parsed['forceFeedback'] as Record<string, unknown>) || {};

    return {
      axisDiffs,
      keyDiffs,
      forceFeedback,
      raw: content,
    };
  } catch (error) {
    console.error('Failed to parse DCS binding file:', error);
    return {
      axisDiffs: {},
      keyDiffs: {},
      raw: content,
    };
  }
}

/**
 * Extract axis bindings from parsed DCS file
 */
export function extractAxisBindings(
  axisDiffs: DCSAxisDiff
): { id: string; name: string; key: string; filter?: DCSAxisFilter; isRemoved?: boolean }[] {
  const bindings: {
    id: string;
    name: string;
    key: string;
    filter?: DCSAxisFilter;
    isRemoved?: boolean;
  }[] = [];

  for (const [actionId, actionData] of Object.entries(axisDiffs)) {
    const name = actionData.name || actionId;

    // Process added bindings
    if (actionData.added) {
      for (const [, bindingData] of Object.entries(actionData.added)) {
        if (typeof bindingData === 'object' && bindingData !== null) {
          const binding = bindingData as { key?: string; filter?: DCSAxisFilter };
          if (binding.key) {
            bindings.push({
              id: actionId,
              name,
              key: binding.key,
              filter: binding.filter,
              isRemoved: false,
            });
          }
        }
      }
    }

    // Process removed bindings
    if (actionData.removed) {
      for (const [, bindingData] of Object.entries(actionData.removed)) {
        if (typeof bindingData === 'object' && bindingData !== null) {
          const binding = bindingData as { key?: string };
          if (binding.key) {
            bindings.push({
              id: actionId,
              name,
              key: binding.key,
              isRemoved: true,
            });
          }
        }
      }
    }
  }

  return bindings;
}

/**
 * Extract key bindings from parsed DCS file
 */
export function extractKeyBindings(
  keyDiffs: DCSKeyDiff
): { id: string; name: string; key: string; reformers?: string[]; isRemoved?: boolean }[] {
  const bindings: {
    id: string;
    name: string;
    key: string;
    reformers?: string[];
    isRemoved?: boolean;
  }[] = [];

  for (const [actionId, actionData] of Object.entries(keyDiffs)) {
    const name = actionData.name || actionId;

    // Process added bindings
    if (actionData.added) {
      for (const [, bindingData] of Object.entries(actionData.added)) {
        if (typeof bindingData === 'object' && bindingData !== null) {
          const binding = bindingData as { key?: string; reformers?: string[] };
          if (binding.key) {
            bindings.push({
              id: actionId,
              name,
              key: binding.key,
              reformers: binding.reformers,
              isRemoved: false,
            });
          }
        }
      }
    }

    // Process removed bindings
    if (actionData.removed) {
      for (const [, bindingData] of Object.entries(actionData.removed)) {
        if (typeof bindingData === 'object' && bindingData !== null) {
          const binding = bindingData as { key?: string };
          if (binding.key) {
            bindings.push({
              id: actionId,
              name,
              key: binding.key,
              isRemoved: true,
            });
          }
        }
      }
    }
  }

  return bindings;
}

/**
 * Extract device name from DCS input file path
 * Format: {GUID}.diff.lua where GUID includes device name
 */
export function extractDeviceNameFromPath(filePath: string): string {
  const match = filePath.match(/\{([^}]+)\}\.diff\.lua$/i);
  if (match) {
    // GUID format includes device name
    return match[1];
  }
  return 'Unknown Device';
}

/**
 * Extract device GUID from DCS input file path
 */
export function extractDeviceGuidFromPath(filePath: string): string {
  const match = filePath.match(/(\{[^}]+\})\.diff\.lua$/i);
  if (match) {
    return match[1];
  }
  return '';
}

export { LuaParser, LuaLexer };
