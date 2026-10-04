/**
 * Fuzzy matching for the command palette. The letters of what was typed must appear in the
 * text in the same order ("mr" finds "Make ready"); among all the ways they can be found,
 * the one that keeps them together and at the starts of words counts. Pure: no DOM.
 *
 * The scoring is the one of the fzy matcher: about one point for a letter that follows the
 * letter before it, a little less for a letter at the start of a word, nothing for a letter
 * somewhere inside a word, and a small cost for every letter skipped.
 */

export interface FuzzyMatch {
  score: number;
  /** Where in the text each typed letter was found, ascending. */
  positions: number[];
}

const GAP_LEADING = -0.005;
const GAP_TRAILING = -0.005;
const GAP_INNER = -0.01;
const CONSECUTIVE = 1.0;
const AT_START = 0.9;
const AT_WORD = 0.8;
const AT_CAPITAL = 0.7;
const AT_DOT = 0.6;
/** The whole text typed out. */
const EXACT = 2;
/** The text starts with what was typed. */
const PREFIX = 0.5;

/**
 * A letter inside a word that follows nothing counts for nothing, so a match made only of
 * such letters says little. Matches below this average per typed letter are dropped: "ae"
 * does not find "Make ready", "mr" does.
 */
const FLOOR_PER_LETTER = 0.3;

/** Lower case, without accents, so "Señal" is found by "senal". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** What a letter at each place is worth for where it stands: after a space, a slash, a capital. */
function placeBonuses(text: string): number[] {
  const bonuses: number[] = [];
  let before = '/';
  for (const char of text) {
    let bonus = 0;
    if (/[\p{L}\p{N}]/u.test(char)) {
      if (before === '/' || before === '\\') bonus = AT_START;
      else if (/[\s\-_:·,()+&]/.test(before)) bonus = AT_WORD;
      else if (before === '.') bonus = AT_DOT;
      else if (/\p{Ll}/u.test(before) && /\p{Lu}/u.test(char)) bonus = AT_CAPITAL;
      // A digit after letters starts something too: the 18 of "F/A-18C", the 2 of "MFD2".
      else if (/\p{N}/u.test(char) && /\p{L}/u.test(before)) bonus = AT_CAPITAL;
    }
    bonuses.push(bonus);
    before = char;
  }
  return bonuses;
}

/**
 * Finds `needle` in `text`. Undefined when its letters are not all there in order, or when
 * they are scattered so thinly that the match means nothing.
 */
export function fuzzyMatch(needle: string, text: string): FuzzyMatch | undefined {
  const wanted = [...fold(needle)].filter((c) => c.trim() !== '');
  const original = [...text];
  // Folding keeps the number of letters for everything a command is called; when it does
  // not (a ligature), match on the folded text and give up on the positions lining up.
  const folded = original.map((c) => fold(c)[0] ?? c);
  const n = wanted.length;
  const m = folded.length;
  if (n === 0 || n > m) return undefined;

  const bonuses = placeBonuses(original.join(''));
  // ending[i][j]: the best score with letter i found exactly at place j.
  // upTo[i][j]: the best score with letters 0..i found somewhere in places 0..j.
  const ending: number[][] = [];
  const upTo: number[][] = [];
  for (let i = 0; i < n; i++) {
    const endingRow = new Array<number>(m).fill(-Infinity);
    const upToRow = new Array<number>(m).fill(-Infinity);
    const gap = i === n - 1 ? GAP_TRAILING : GAP_INNER;
    let best = -Infinity;
    for (let j = 0; j < m; j++) {
      if (wanted[i] === folded[j]) {
        let score = -Infinity;
        if (i === 0) score = j * GAP_LEADING + bonuses[j]!;
        else if (j > 0) {
          score = Math.max(
            upTo[i - 1]![j - 1]! + bonuses[j]!,
            // Following the letter before it is worth more than any place bonus.
            ending[i - 1]![j - 1]! + CONSECUTIVE
          );
        }
        endingRow[j] = score;
        best = Math.max(score, best + gap);
      } else {
        best = best + gap;
      }
      upToRow[j] = best;
    }
    ending.push(endingRow);
    upTo.push(upToRow);
  }

  let score = upTo[n - 1]![m - 1]!;
  if (score === -Infinity) return undefined;

  // Walk back to where each letter was found.
  const positions = new Array<number>(n).fill(0);
  let mustFollow = false;
  for (let i = n - 1, j = m - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      const here = ending[i]![j]!;
      if (here !== -Infinity && (mustFollow || here === upTo[i]![j]!)) {
        // This letter's score came from following the one before: that one is right before it.
        mustFollow = i > 0 && j > 0 && here === ending[i - 1]![j - 1]! + CONSECUTIVE;
        positions[i] = j--;
        break;
      }
    }
  }

  if (score / n < FLOOR_PER_LETTER) return undefined;
  const typed = wanted.join('');
  const whole = folded.filter((c) => c.trim() !== '').join('');
  if (typed === whole) score += EXACT;
  else if (whole.startsWith(typed)) score += PREFIX;
  return { score, positions };
}

/** The text in pieces, so the letters that were found can be drawn differently. */
export function highlight(text: string, positions: number[]): { text: string; hit: boolean }[] {
  const hits = new Set(positions);
  const pieces: { text: string; hit: boolean }[] = [];
  [...text].forEach((char, index) => {
    const hit = hits.has(index);
    const last = pieces[pieces.length - 1];
    if (last && last.hit === hit) last.text += char;
    else pieces.push({ text: char, hit });
  });
  return pieces;
}

/**
 * Finds `needle` as the start of a word of `text`, letter after letter: "mon" is found in
 * "Identify monitors" and not in "common controls". For the words a command is also found
 * by (its keywords, its heading, its hint), where a loose match would be noise.
 */
export function wordMatch(needle: string, text: string): FuzzyMatch | undefined {
  const found = fuzzyMatch(needle, text);
  if (!found) return undefined;
  const { positions } = found;
  const together = positions.every((p, i) => i === 0 || p === positions[i - 1]! + 1);
  if (!together) return undefined;
  const first = positions[0]!;
  const before = first === 0 ? '' : ([...text][first - 1] ?? '');
  return before === '' || !/[\p{L}\p{N}]/u.test(before) ? found : undefined;
}

/** The parts of a command that can be searched, each worth less than its title. */
export interface Searchable {
  title: string;
  group?: string;
  hint?: string;
  keywords?: string[];
}

const WEIGHT_KEYWORD = 0.85;
const WEIGHT_GROUP = 0.7;
const WEIGHT_HINT = 0.6;
/** The words typed stand in the title as they were typed, spaces and all. */
const PHRASE = 1;

/**
 * How well a command answers what was typed. All of it is tried against the title as one
 * word first ("make ready", "makeready"); otherwise every word typed must be found
 * somewhere, in any order: loosely in the title, or as the start of a word of a keyword,
 * the heading or the hint ("monitors flying" finds "Apply layout: Flying" under Monitors).
 * Positions are places in the title.
 */
export function matchCommand(query: string, command: Searchable): FuzzyMatch | undefined {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;

  const asOne = fuzzyMatch(words.join(''), command.title);

  let total = 0;
  const positions = new Set<number>();
  let everyWord = true;
  for (const word of words) {
    const inTitle = fuzzyMatch(word, command.title);
    let best = inTitle?.score ?? -Infinity;
    let fromTitle = inTitle !== undefined;
    const elsewhere: [string | undefined, number][] = [
      ...(command.keywords ?? []).map((k): [string, number] => [k, WEIGHT_KEYWORD]),
      [command.group, WEIGHT_GROUP],
      [command.hint, WEIGHT_HINT],
    ];
    for (const [text, weight] of elsewhere) {
      if (!text) continue;
      const found = wordMatch(word, text);
      // Never more than its letters are worth: a word typed out in full that is a keyword
      // must not beat the same word at the start of another command's title.
      const worth = found ? Math.min(found.score, [...word].length) * weight : -Infinity;
      if (worth > best) {
        best = worth;
        fromTitle = false;
      }
    }
    if (best === -Infinity) {
      everyWord = false;
      break;
    }
    total += best;
    if (fromTitle) for (const p of inTitle!.positions) positions.add(p);
  }

  const byWords: FuzzyMatch | undefined = everyWord
    ? { score: total, positions: [...positions].sort((a, b) => a - b) }
    : undefined;
  const best = asOne && (!byWords || asOne.score >= byWords.score) ? asOne : byWords;
  // Several words typed that stand in the title just like that: "back up" means "Back up
  // now" rather than "Backups".
  if (best && words.length > 1 && fold(command.title).includes(fold(words.join(' ')))) {
    return { ...best, score: best.score + PHRASE };
  }
  return best;
}
