import { describe, expect, it } from 'vitest';
import {
  clockText,
  countdownLeft,
  countdownShort,
  countdownTitle,
  durationText,
  elapsedText,
  fixTotalText,
  lastSessionLine,
  problemText,
  standDownHeldText,
  stoodDownLine,
  stoodDownText,
  timesText,
  totalsLine,
  totalText,
  waitText,
  whenText,
} from './sessionText';

/** A moment on this PC's clock, so the tests read the same in every time zone. */
const local = (year: number, month: number, day: number, hour = 12, minute = 0): Date =>
  new Date(year, month - 1, day, hour, minute);

describe('how long a session was', () => {
  it('says hours and minutes the way a person would', () => {
    expect(durationText(0)).toBe('less than a minute');
    expect(durationText(59)).toBe('less than a minute');
    expect(durationText(60)).toBe('1 min');
    expect(durationText(42 * 60 + 30)).toBe('42 min');
    expect(durationText(3600)).toBe('1 h');
    expect(durationText(3600 + 42 * 60)).toBe('1 h 42 min');
    expect(durationText(-5)).toBe('less than a minute');
  });

  it('adds many up to the minute at first, and in whole hours from ten hours on', () => {
    expect(totalText(0)).toBe('0 min');
    expect(totalText(45 * 60)).toBe('45 min');
    expect(totalText(3600 + 42 * 60)).toBe('1 h 42 min');
    expect(totalText(9 * 3600 + 59 * 60)).toBe('9 h 59 min');
    expect(totalText(14 * 3600 + 10 * 60)).toBe('14 h');
    expect(totalText(14 * 3600 + 40 * 60)).toBe('15 h');
  });

  it('counts a running session as a clock, and a wait in seconds', () => {
    expect(elapsedText(0)).toBe('0:00:00');
    expect(elapsedText(42 * 60 + 17)).toBe('0:42:17');
    expect(elapsedText(3 * 3600 + 5)).toBe('3:00:05');
    expect(elapsedText(-1)).toBe('0:00:00');
    expect(waitText(8.4)).toBe('8 s');
    expect(waitText(80)).toBe('1 min 20 s');
    expect(waitText(120)).toBe('2 min');
    expect(waitText(12 * 60 + 31)).toBe('12 min');
  });
});

describe('when a session was', () => {
  const now = local(2026, 10, 8, 20); // a Thursday evening
  it('today, yesterday, the weekday within a week, then the date', () => {
    expect(whenText(local(2026, 10, 8, 9), now)).toBe('today');
    expect(whenText(local(2026, 10, 7, 23, 59), now)).toBe('yesterday');
    expect(whenText(local(2026, 10, 6, 21), now)).toBe('Tuesday');
    expect(whenText(local(2026, 10, 2, 21), now)).toBe('Friday');
    // A week ago today is a date, not "Thursday": that would read as today's.
    expect(whenText(local(2026, 10, 1, 21), now)).toBe('1 Oct');
    expect(whenText(local(2025, 12, 24, 21), now)).toBe('24 Dec 2025');
  });

  it('goes by the calendar day, not by twenty-four hours', () => {
    // Half an hour ago, but before midnight: yesterday.
    expect(whenText(local(2026, 10, 7, 23, 50), local(2026, 10, 8, 0, 20))).toBe('yesterday');
    // A clock that is behind does not say "tomorrow".
    expect(whenText(local(2026, 10, 9, 1), now)).toBe('today');
  });

  it('gives the time of day on this clock', () => {
    expect(clockText(local(2026, 10, 8, 7, 5))).toBe('07:05');
    expect(clockText(local(2026, 10, 8, 20, 14))).toBe('20:14');
  });
});

describe('the line under the setup name', () => {
  const now = local(2026, 10, 8, 20);
  const tuesday = local(2026, 10, 6, 19).toISOString();
  it('says when the last session was and how long', () => {
    expect(lastSessionLine({ startedAt: tuesday, durationSeconds: 6120 }, now)).toBe(
      'Last session Tuesday, 1 h 42 min'
    );
    expect(
      lastSessionLine(
        { startedAt: local(2026, 10, 8, 9).toISOString(), durationSeconds: 1800 },
        now
      )
    ).toBe('Last session today, 30 min');
    expect(
      lastSessionLine({ startedAt: local(2026, 9, 12, 21).toISOString(), durationSeconds: 60 }, now)
    ).toBe('Last session 12 Sep, 1 min');
  });
  it('uses no word of flying: it reads the same to someone who only races', () => {
    const lines = [
      lastSessionLine({ startedAt: tuesday, durationSeconds: 1800 }, now),
      lastSessionLine({ startedAt: tuesday }, now),
      lastSessionLine(undefined, now),
    ];
    for (const line of lines) expect(line).not.toMatch(/fl(y|own|ew|ight)|pilot/i);
  });
  it('says so when there was none', () => {
    expect(lastSessionLine(undefined, now)).toBe('No session yet');
  });
  it('leaves the length out when it is not known', () => {
    expect(lastSessionLine({ startedAt: tuesday }, now)).toBe('Last session Tuesday');
  });
});

describe('the history in one line', () => {
  it('sessions, hours, and what needed fixing most', () => {
    expect(
      totalsLine({
        sessions: 12,
        seconds: 14 * 3600 + 600,
        fixes: [
          { title: 'TrackIR', group: 'apps', count: 6 },
          { title: 'Monitor layout', group: 'displays', count: 4 },
        ],
        notReady: 0,
      })
    ).toBe('12 sessions, 14 h; TrackIR needed starting 6 times');
  });
  it('one session, nothing fixed, and none at all', () => {
    expect(totalsLine({ sessions: 1, seconds: 2520, fixes: [], notReady: 0 })).toBe(
      '1 session, 42 min'
    );
    expect(totalsLine({ sessions: 0, seconds: 0, fixes: [], notReady: 0 })).toBe('No sessions yet');
  });
  it('words the fix by what it was', () => {
    expect(fixTotalText({ title: 'Monitor layout', group: 'displays', count: 4 })).toBe(
      'Monitor layout needed applying 4 times'
    );
    expect(fixTotalText({ title: 'DCS options', group: 'files', count: 2 })).toBe(
      'DCS options needed restoring twice'
    );
    expect(fixTotalText({ title: 'Headset', group: 'audio', count: 1 })).toBe(
      'Headset needed setting once'
    );
    expect(fixTotalText({ title: 'SRS check', group: 'other', count: 3 })).toBe(
      'SRS check needed running 3 times'
    );
    expect(fixTotalText({ title: 'Wheel', group: 'devices', count: 3 })).toBe(
      'Wheel needed fixing 3 times'
    );
    expect([timesText(1), timesText(2), timesText(7)]).toEqual(['once', 'twice', '7 times']);
  });
});

describe('Stand down by itself, in words', () => {
  it('counts down in whole seconds and minutes, and never says zero', () => {
    expect(countdownTitle(60)).toBe('Stand down in 1 minute');
    expect(countdownTitle(59.2)).toBe('Stand down in 1 minute');
    expect(countdownTitle(42)).toBe('Stand down in 42 seconds');
    expect(countdownTitle(0.4)).toBe('Stand down in 1 second');
    expect(countdownTitle(0)).toBe('Stand down is about to start');
    expect(countdownTitle(-3)).toBe('Stand down is about to start');
  });

  it('counts down as a clock where there is little room, in step with the heading', () => {
    expect(countdownShort(300)).toBe('Stand down in 5:00');
    expect(countdownShort(244.2)).toBe('Stand down in 4:05');
    expect(countdownShort(60)).toBe('Stand down in 1:00');
    expect(countdownShort(59.2)).toBe('Stand down in 1:00');
    expect(countdownShort(42)).toBe('Stand down in 0:42');
    expect(countdownShort(0)).toBe('Stand down in 0:00');
    expect(countdownShort(-3)).toBe('Stand down in 0:00');
  });

  it('a clock that is a moment behind never shows more than the countdown is long', () => {
    const at = '2026-11-12T18:01:00.000Z';
    const start = Date.parse('2026-11-12T18:00:00.000Z');
    // Read 0.9 seconds before the countdown started: one minute, not "1 minute 1 second".
    expect(countdownLeft(at, start - 900, 60)).toBe(60);
    expect(countdownTitle(countdownLeft(at, start - 900, 60))).toBe('Stand down in 1 minute');
    expect(countdownLeft(at, start + 18_000, 60)).toBe(42);
    expect(countdownLeft(at, start + 61_000, 60)).toBe(0);
    // A session from before the length was sent along is counted as it is.
    expect(countdownLeft(at, start + 18_000)).toBe(42);
  });

  it('names a step that did not work, once', () => {
    expect(
      problemText({
        title: 'TrackIR',
        message: 'TrackIR5.exe is still running: it did not close when asked.',
      })
    ).toBe('TrackIR5.exe is still running: it did not close when asked.');
    expect(problemText({ title: 'Tidy up', message: 'after.cmd ended with code 3' })).toBe(
      'Tidy up: after.cmd ended with code 3'
    );
    expect(problemText({ title: 'Tidy up', message: '  ' })).toBe('Tidy up did not work.');
  });

  it('says "Stood down" only when every step worked', () => {
    const done = { finished: true, headline: 'Closed 2 apps', failed: 0, problems: [] };
    expect(stoodDownText(done)).toEqual({
      ok: true,
      title: 'Stood down',
      lines: ['Closed 2 apps'],
    });
    expect(stoodDownLine(done)).toBe('Stood down: Closed 2 apps');

    const one = {
      finished: true,
      headline: 'Closed 1 app · 1 step needs attention',
      failed: 1,
      problems: ['coach.exe is still running: it did not close when asked.'],
    };
    expect(stoodDownText(one)).toEqual({
      ok: false,
      title: 'Stand down ran, but 1 step needs attention',
      lines: ['coach.exe is still running: it did not close when asked.'],
    });
    expect(stoodDownLine(one)).toBe(
      'Stand down ran, but 1 step needs attention: coach.exe is still running: it did not close when asked.'
    );

    const two = { ...one, failed: 2, problems: ['A stayed open.', 'B stayed open.'] };
    expect(stoodDownText(two).title).toBe('Stand down ran, but 2 steps need attention');
    expect(stoodDownLine(two)).toBe(
      'Stand down ran, but 2 steps need attention: A stayed open. B stayed open.'
    );
  });

  it('a Stand down that could not run says so, with the reason when there is one', () => {
    const failed = {
      finished: false,
      headline: '',
      failed: 0,
      problems: ['The setup could not be read.'],
    };
    expect(stoodDownText(failed)).toEqual({
      ok: false,
      title: 'Stand down did not finish',
      lines: ['The setup could not be read.'],
    });
    expect(stoodDownLine(failed)).toBe('Stand down did not finish: The setup could not be read.');
    expect(stoodDownLine({ ...failed, problems: [] })).toBe('Stand down did not finish');
  });

  it('says why it is not going to run this time', () => {
    expect(standDownHeldText('cancelled')).toBe('Stand down was cancelled. Nothing was closed.');
    expect(standDownHeldText('quickExit')).toBe(
      'It closed within two minutes of starting, so Stand down did not start by itself.'
    );
  });

  it('says it in one short line where there is little room, and never that it ran', () => {
    expect(standDownHeldText('cancelled', true)).toBe(
      'Stand down was cancelled. Nothing was closed.'
    );
    expect(standDownHeldText('quickExit', true)).toBe(
      'It closed too soon: Stand down did not start.'
    );
  });
});
