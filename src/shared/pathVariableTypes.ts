/**
 * Path Variable Types
 * Types for the path variable resolution system that enables portable profiles.
 */

export type PathVariableName =
  | 'DCS_USER'
  | 'DCS_INSTALL'
  | 'APPDATA'
  | 'LOCALAPPDATA'
  | 'USERPROFILE'
  | 'DOCUMENTS'
  | 'SAVED_GAMES'
  | 'STEAM'
  | 'PROGRAM_FILES'
  | 'PROGRAM_FILES_X86';

export interface PathVariable {
  name: PathVariableName;
  displayName: string;
  description: string;
  resolvedValue: string | null;
}

export type PathVariableMap = Record<PathVariableName, string | null>;
