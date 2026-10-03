import path from 'node:path';
import { globToRegExp } from './files/glob';
import { expandPath, type PathVariables } from './pathVariables';

/**
 * Files that hold credentials. RigReady never reads them into a backup, a snapshot,
 * a shared setup or an import, whatever folder is tracked. Each rule is either a
 * stored path (with path variables, globs allowed) or a file-name glob that applies
 * anywhere.
 */
export interface CredentialRule {
  /** "{APPDATA}/SimAppPro/config.json" */
  path?: string;
  /** "network.vault", "*.pem" */
  name?: string;
  /** Why, in words the user can read. */
  why: string;
}

export const CREDENTIAL_RULES: readonly CredentialRule[] = [
  {
    path: '{APPDATA}/SimAppPro/config.json',
    why: 'SimAppPro keeps your WinWing account name and password in it',
  },
  { name: 'network.vault', why: 'DCS keeps your saved login in it' },
  { name: 'steam_authdata.bin', why: 'DCS keeps your Steam sign-in in it' },
  { name: '*.vault', why: 'a credential vault' },
  { name: 'ssfn*', why: 'a Steam sign-in file' },
  { name: 'loginusers.vdf', why: 'Steam keeps your accounts in it' },
  { name: 'Login Data', why: 'a browser password store' },
  { name: 'Cookies', why: 'browser sign-in cookies' },
  { name: '*.pem', why: 'a private key or certificate' },
  { name: '*.pfx', why: 'a private key or certificate' },
  { name: '*.p12', why: 'a private key or certificate' },
  { name: '*.key', why: 'a private key' },
  { name: 'id_rsa*', why: 'a private key' },
  { name: 'id_ed25519*', why: 'a private key' },
  { name: '.git-credentials', why: 'saved passwords' },
  { name: '.npmrc', why: 'it can hold access tokens' },
  {
    path: '{PROGRAM_FILES}/mosquitto/**',
    why: 'the Fanatec message broker keeps its passwords here',
  },
];

/**
 * Why a file must never be copied, or undefined when it may be. `variables` resolves
 * the path rules for this PC; a rule whose variable is unknown here is skipped.
 */
export function credentialReason(
  absolutePath: string,
  variables: PathVariables,
  rules: readonly CredentialRule[] = CREDENTIAL_RULES
): string | undefined {
  const target = path.resolve(absolutePath);
  const name = path.basename(target);
  for (const rule of rules) {
    if (rule.name && globToRegExp(rule.name).test(name)) return rule.why;
    if (rule.path) {
      const star = rule.path.search(/[*?]/);
      const fixed = star < 0 ? rule.path : rule.path.slice(0, rule.path.lastIndexOf('/', star));
      const base = expandPath(fixed, variables);
      if (!base.ok) continue;
      if (star < 0) {
        if (base.value.toLowerCase() === target.toLowerCase()) return rule.why;
        continue;
      }
      const relative = path.relative(base.value, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      const pattern = rule.path.slice(fixed.length + 1);
      if (globToRegExp(pattern).test(relative.split(path.sep).join('/'))) return rule.why;
    }
  }
  return undefined;
}

/** Extensions of files that run something. Never shared, and flagged when restored. */
export const PROGRAM_EXTENSIONS: readonly string[] = [
  '.exe',
  '.bat',
  '.cmd',
  '.ps1',
  '.psm1',
  '.py',
  '.pyw',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.msi',
  '.dll',
  '.com',
  '.scr',
  '.lnk',
  '.jar',
  '.reg',
  '.hta',
  '.cpl',
];

export function isProgramFile(file: string): boolean {
  return PROGRAM_EXTENSIONS.includes(path.extname(file).toLowerCase());
}
