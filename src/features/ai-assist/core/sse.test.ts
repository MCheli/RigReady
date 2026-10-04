import { describe, expect, it } from 'vitest';
import { JsonItemCounter, MAX_SSE_LINE, SseDecoder, type SseEvent } from './sse';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Feeds a body in pieces of `size` bytes and returns every event, the end included. */
function decode(body: Uint8Array, size: number): SseEvent[] {
  const decoder = new SseDecoder();
  const events: SseEvent[] = [];
  for (let at = 0; at < body.length; at += size) {
    events.push(...decoder.push(body.subarray(at, at + size)));
  }
  events.push(...decoder.end());
  return events;
}

const STREAM = [
  'event: message_start',
  'data: {"type":"message_start"}',
  '',
  ': a comment the server may send to keep the connection open',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Größe ✈ 日本語 🛩️"}}',
  '',
  'data: first line',
  'data: second line',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

const EXPECTED: SseEvent[] = [
  { event: 'message_start', data: '{"type":"message_start"}' },
  {
    event: 'content_block_delta',
    data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Größe ✈ 日本語 🛩️"}}',
  },
  { event: 'message', data: 'first line\nsecond line' },
  { event: 'message_stop', data: '{"type":"message_stop"}' },
];

describe('Server-Sent Events from raw bytes', () => {
  it('reads events, joins data lines, skips comments, and names an unnamed event "message"', () => {
    expect(decode(bytes(STREAM), 1_000_000)).toEqual(EXPECTED);
  });

  it('gives the same events wherever the chunks are cut: mid-event, mid-line, inside a UTF-8 character', () => {
    const body = bytes(STREAM);
    // Every chunk size from one byte up: each multi-byte character is split at every position.
    for (let size = 1; size <= 64; size++) {
      expect(decode(body, size), `chunks of ${size} bytes`).toEqual(EXPECTED);
    }
    // One cut inside the four-byte aeroplane, stated outright.
    const plane = Buffer.from(body).indexOf(Buffer.from('🛩'));
    const decoder = new SseDecoder();
    const got = [
      ...decoder.push(body.subarray(0, plane + 2)),
      ...decoder.push(body.subarray(plane + 2)),
      ...decoder.end(),
    ];
    expect(got).toEqual(EXPECTED);
  });

  it('accepts CRLF and lone CR line ends, also when a chunk ends between the CR and the LF', () => {
    const crlf = bytes(STREAM.replaceAll('\n', '\r\n'));
    for (let size = 1; size <= 40; size++) {
      expect(decode(crlf, size), `CRLF in chunks of ${size}`).toEqual(EXPECTED);
    }
    expect(decode(bytes(STREAM.replaceAll('\n', '\r')), 3)).toEqual(EXPECTED);

    const decoder = new SseDecoder();
    // The CR alone ends nothing yet: the LF that completes it must not count as an empty line.
    expect(decoder.push(bytes('data: one\r'))).toEqual([]);
    expect(decoder.push(bytes('\ndata: two\r\n\r'))).toEqual([]);
    expect(decoder.push(bytes('\n'))).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });

  it('follows the field rules: one leading space is dropped, a line without a colon is a field name, unknown fields are ignored', () => {
    const decoder = new SseDecoder();
    const events = [
      ...decoder.push(
        bytes(
          [
            '﻿data:no space',
            '',
            'data:  two spaces',
            'id: 7',
            'retry: 100',
            'whatever: x',
            '',
            'data',
            '',
            'event: named-but-empty',
            '',
            'data: after',
            '',
            '',
          ].join('\n')
        )
      ),
      ...decoder.end(),
    ];
    expect(events).toEqual([
      { event: 'message', data: 'no space' },
      { event: 'message', data: ' two spaces' },
      { event: 'message', data: '' },
      // The event that had a name but no data was dropped, and its name did not leak on.
      { event: 'message', data: 'after' },
    ]);
  });

  it('drops an event the stream ended in the middle of', () => {
    const decoder = new SseDecoder();
    expect(decoder.push(bytes('data: whole\n\nevent: message_stop\ndata: {"type":"mess'))).toEqual([
      { event: 'message', data: 'whole' },
    ]);
    expect(decoder.end()).toEqual([]);
    // Ended after the data line but before the empty line that would have ended the event.
    const other = new SseDecoder();
    expect(other.push(bytes('data: unfinished\n'))).toEqual([]);
    expect(other.end()).toEqual([]);
  });

  it('gives up on a line that never ends instead of buffering it for ever', () => {
    const decoder = new SseDecoder();
    const piece = bytes('x'.repeat(500_000));
    for (let i = 0; i * piece.length <= MAX_SSE_LINE; i++) decoder.push(piece);
    expect(decoder.overflowed).toBe(true);
    expect(decoder.push(bytes('\ndata: late\n\n'))).toEqual([]);
    expect(decoder.end()).toEqual([]);
  });
});

describe('counting the finished items of an answer that is still arriving', () => {
  const plan = JSON.stringify({
    summary: 'Braces in text do not count: { [ } ] and "quotes" \\ too.',
    items: [
      { actionId: 'a', reason: 'has a } and a \\" inside', nested: { deep: [{ x: 1 }] } },
      { actionId: 'b', list: [1, 2, [3]] },
      { actionId: 'c' },
    ],
    notes: ['a note', '{not an item}'],
    other: { object: { inside: true } },
  });

  it('counts the objects of the list as each one closes, whatever the pieces', () => {
    for (const size of [1, 2, 5, 17, plan.length]) {
      const counter = new JsonItemCounter();
      const seen: number[] = [];
      for (let at = 0; at < plan.length; at += size)
        seen.push(counter.push(plan.slice(at, at + size)));
      expect(counter.items, `pieces of ${size}`).toBe(3);
      // It only ever goes up, one item at a time when the pieces are single characters.
      expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    }
    const counter = new JsonItemCounter();
    expect(counter.push(plan.slice(0, plan.indexOf('{"actionId":"b"')))).toBe(1);
    expect(counter.push(plan.slice(plan.indexOf('{"actionId":"b"'), plan.indexOf('"notes"')))).toBe(
      3
    );
  });

  it('counts nothing in text that is not such a list', () => {
    expect(new JsonItemCounter().push('The trigger fires the gun. {really}')).toBe(0);
    expect(new JsonItemCounter().push('[{"a":1},{"b":2}]')).toBe(0);
    expect(new JsonItemCounter().push('}}]]{"items":[{}]}')).toBe(1);
  });
});
