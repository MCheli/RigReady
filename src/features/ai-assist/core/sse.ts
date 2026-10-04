/**
 * Server-Sent Events, read from raw bytes as they arrive. A chunk may end anywhere: in the
 * middle of a line, between the CR and the LF of a line end, or inside a UTF-8 character;
 * nothing is handed out until it is whole. Follows the WHATWG event-stream rules: lines
 * end in LF, CRLF or CR; a line starting with ":" is a comment; "data" lines of one event
 * are joined with a newline; an empty line ends the event; an event that was not ended
 * when the stream closed is dropped.
 */

export interface SseEvent {
  /** The `event:` field; "message" when the event names none. */
  event: string;
  data: string;
}

/** Longest single line accepted; a stream that exceeds it is not an event stream. */
export const MAX_SSE_LINE = 2_000_000;

export class SseDecoder {
  private readonly utf8 = new TextDecoder('utf-8');
  /** Decoded text that does not yet end in a line end. */
  private pending = '';
  private event = '';
  private data: string[] = [];
  private overflow = false;

  /** True once a line grew past MAX_SSE_LINE; nothing more is parsed after that. */
  get overflowed(): boolean {
    return this.overflow;
  }

  /** Feeds the next bytes and returns the events they completed. */
  push(bytes: Uint8Array): SseEvent[] {
    return this.take(this.utf8.decode(bytes, { stream: true }), false);
  }

  /** The stream closed: returns what the last bytes completed. An unfinished event is dropped. */
  end(): SseEvent[] {
    return this.take(this.utf8.decode(), true);
  }

  private take(text: string, closed: boolean): SseEvent[] {
    if (this.overflow) return [];
    const events: SseEvent[] = [];
    const buffer = this.pending + text;
    let start = 0;
    for (let i = 0; i < buffer.length; i++) {
      const c = buffer.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      if (c === 13) {
        // A CR at the very end may be the first half of a CRLF: wait for the next bytes.
        if (i === buffer.length - 1 && !closed) break;
        const event = this.line(buffer.slice(start, i));
        if (event) events.push(event);
        if (buffer.charCodeAt(i + 1) === 10) i++;
      } else {
        const event = this.line(buffer.slice(start, i));
        if (event) events.push(event);
      }
      start = i + 1;
    }
    this.pending = buffer.slice(start);
    if (this.pending.length > MAX_SSE_LINE) {
      this.overflow = true;
      this.pending = '';
    }
    return events;
  }

  /** One complete line; returns the event it ended, if any. */
  private line(line: string): SseEvent | undefined {
    if (line === '') {
      const data = this.data;
      const event = this.event;
      this.data = [];
      this.event = '';
      return data.length === 0 ? undefined : { event: event || 'message', data: data.join('\n') };
    }
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    // "id" and "retry" are for reconnecting, which a one-shot answer never does.
    return undefined;
  }
}

/**
 * Counts the finished entries of the first array of objects in a JSON document that is
 * still arriving: the objects directly inside an array that is directly inside the root
 * object, which is where both structured answers (a plan, a guide) keep their items.
 * It only counts; the document is parsed and checked for real when it is complete.
 */
export class JsonItemCounter {
  /** The open containers, outermost first: "{" and "[". */
  private open = '';
  private inString = false;
  private escaped = false;
  private finished = 0;

  get items(): number {
    return this.finished;
  }

  push(text: string): number {
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') this.inString = true;
      else if (c === '{' || c === '[') this.open += c;
      else if (c === '}' || c === ']') {
        if (this.open === '{[{') this.finished++;
        this.open = this.open.slice(0, -1);
      }
    }
    return this.finished;
  }
}
