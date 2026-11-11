/**
 * The rules a script an assistant drafted is held to before the user sees it. This is the
 * one shipped file that names the ways a program asks Windows for elevation, so that a
 * draft asking for it is refused: tests/unit/noAdmin.test.ts and shellAudit.test.ts allow
 * it by name for that reason, and assistant.test.ts proves a draft that asks is refused.
 */

/**
 * What a script may not do: ask Windows for administrator rights. A draft that does is
 * refused outright; RigReady runs everything as the user and nothing else.
 */
const ELEVATION: [RegExp, string][] = [
  [/-verb\s+['"]?runas/i, 'Start-Process -Verb RunAs'],
  [/\brunas(\.exe)?\s/i, 'runas'],
  [/\b(g?sudo)(\.exe)?\s/i, 'sudo'],
  [/\/rl\s+highest/i, 'a scheduled task with highest privileges'],
  [/set-executionpolicy/i, 'Set-ExecutionPolicy'],
  [/\bbcdedit\b|\breg(\.exe)?\s+add\s+['"]?hklm/i, 'a change to the machine for every user'],
];

/** Worth the user's second look, but allowed. */
const NOTEWORTHY: [RegExp, string][] = [
  [
    /invoke-webrequest|invoke-restmethod|downloadstring|downloadfile|\bcurl(\.exe)?\s|\bwget\s|bitsadmin/i,
    'It reaches the internet.',
  ],
  [/invoke-expression|\biex\b/i, 'It runs text as code (Invoke-Expression).'],
  [/remove-item|\bdel\s|\berase\s|\brmdir\s|\brd\s/i, 'It deletes files or folders.'],
  [/stop-process|taskkill/i, 'It closes programs.'],
  [/set-itemproperty|new-itemproperty|\breg(\.exe)?\s+(add|delete)/i, 'It changes the registry.'],
];

export function elevationIn(content: string): string | undefined {
  return ELEVATION.find(([pattern]) => pattern.test(content))?.[1];
}

export function warningsFor(content: string): string[] {
  return NOTEWORTHY.filter(([pattern]) => pattern.test(content)).map(([, text]) => text);
}
