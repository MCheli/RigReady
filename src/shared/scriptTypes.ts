/**
 * Script Execution Types
 * Types for running user-defined scripts as part of profiles.
 */

export interface ScriptConfig {
  id: string;
  name: string;
  scriptPath: string;
  arguments: string[];
  workingDirectory?: string;
  timeout: number;
  runHidden: boolean;
  successExitCodes: number[];
  environmentVariables?: Record<string, string>;
}

export interface ScriptResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  duration: number;
}

export interface ScriptExecutionOptions {
  profileName?: string;
  gameName?: string;
  profileId?: string;
  environmentOverrides?: Record<string, string>;
}
