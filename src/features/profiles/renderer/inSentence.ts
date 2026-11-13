/**
 * A label set inside a sentence: "fix: start TrackIR". Only an ordinary first word loses its
 * capital (one capital, then small letters: "Start", "Switch"); a name or an abbreviation keeps
 * its own ("DCS", "TrackIR", "iRacing"), and so does every word after the first. Lowering the
 * whole label turned "Switch iRacing’s control profile" into "switch iracing’s control profile".
 * Pure, so the rule is tested without a window.
 */
export function inSentence(label: string): string {
  // The first word, up to the first space, punctuation after it allowed ("Start:").
  const first = /^\S*/.exec(label)?.[0] ?? '';
  return /^\p{Lu}\p{Ll}*[.,:;!?’']*$/u.test(first)
    ? label.charAt(0).toLowerCase() + label.slice(1)
    : label;
}
