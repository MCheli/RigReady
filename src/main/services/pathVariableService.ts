/**
 * Path Variable Service
 * Resolves path variables like {DCS_USER}, {APPDATA}, etc. to actual paths.
 * Also tokenizes absolute paths back to variable format for portability.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { PathVariableName, PathVariableMap } from '../../shared/pathVariableTypes';

class PathVariableService {
  private variables: PathVariableMap;

  constructor() {
    this.variables = this.resolveAll();
  }

  private resolveAll(): PathVariableMap {
    const userProfile = os.homedir();

    return {
      DCS_USER: this.findDCSSavedGames(),
      DCS_INSTALL: this.findDCSInstall(),
      APPDATA: process.env.APPDATA || path.join(userProfile, 'AppData', 'Roaming'),
      LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(userProfile, 'AppData', 'Local'),
      USERPROFILE: userProfile,
      DOCUMENTS: path.join(userProfile, 'Documents'),
      SAVED_GAMES: path.join(userProfile, 'Saved Games'),
      STEAM: this.findSteamPath(),
      PROGRAM_FILES: process.env['ProgramFiles'] || 'C:\\Program Files',
      PROGRAM_FILES_X86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    };
  }

  private findDCSSavedGames(): string | null {
    const userProfile = os.homedir();
    const candidates = [
      path.join(userProfile, 'Saved Games', 'DCS'),
      path.join(userProfile, 'Saved Games', 'DCS.openbeta'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private findDCSInstall(): string | null {
    const candidates = [
      'C:\\Program Files\\Eagle Dynamics\\DCS World',
      'C:\\Program Files\\Eagle Dynamics\\DCS World OpenBeta',
      'D:\\DCS World',
      'E:\\DCS World',
    ];

    // Also check Steam paths
    const steamPath = this.findSteamPath();
    if (steamPath) {
      candidates.push(path.join(steamPath, 'steamapps', 'common', 'DCSWorld'));
    }

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private findSteamPath(): string | null {
    const candidates = [
      'C:\\Program Files (x86)\\Steam',
      'D:\\Steam',
      'E:\\Steam',
      'D:\\SteamLibrary',
      'E:\\SteamLibrary',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Get the resolved map of all path variables.
   */
  getVariables(): PathVariableMap {
    return { ...this.variables };
  }

  /**
   * Resolve a single variable name to its path.
   */
  resolve(name: PathVariableName): string | null {
    return this.variables[name];
  }

  /**
   * Expand a path containing {VARIABLE} tokens to an absolute path.
   */
  expandPath(tokenizedPath: string): string {
    return tokenizedPath.replace(/\{(\w+)\}/g, (_match, varName: string) => {
      const value = this.variables[varName as PathVariableName];
      return value ?? `{${varName}}`;
    });
  }

  /**
   * Convert an absolute path to a tokenized path for portability.
   * Replaces known absolute paths with {VARIABLE} tokens.
   * Longer matches are preferred (more specific).
   */
  tokenizePath(absolutePath: string): string {
    const normalized = absolutePath.replace(/\//g, '\\');

    // Sort variables by path length descending so longer paths match first
    const entries = Object.entries(this.variables)
      .filter(([, v]) => v !== null)
      .sort(([, a], [, b]) => (b as string).length - (a as string).length);

    for (const [name, value] of entries) {
      const normalizedValue = (value as string).replace(/\//g, '\\');
      if (normalized.toLowerCase().startsWith(normalizedValue.toLowerCase())) {
        return `{${name}}` + normalized.substring(normalizedValue.length);
      }
    }

    return absolutePath;
  }

  /**
   * Refresh all variable resolutions (e.g., after settings change).
   */
  refresh(): void {
    this.variables = this.resolveAll();
  }
}

export const pathVariableService = new PathVariableService();
