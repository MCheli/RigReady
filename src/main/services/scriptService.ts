/**
 * Script Execution Service
 * Runs user-defined scripts (PowerShell, batch, etc.) with timeout, environment injection,
 * and stdout/stderr capture.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import type { ScriptConfig, ScriptResult, ScriptExecutionOptions } from '../../shared/scriptTypes';

class ScriptService {
  /**
   * Execute a script with the given configuration.
   */
  async execute(config: ScriptConfig, options?: ScriptExecutionOptions): Promise<ScriptResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        RIGREADY_PROFILE_NAME: options?.profileName || '',
        RIGREADY_GAME_NAME: options?.gameName || '',
        RIGREADY_PROFILE_ID: options?.profileId || '',
        ...config.environmentVariables,
        ...options?.environmentOverrides,
      };

      const ext = path.extname(config.scriptPath).toLowerCase();
      let command: string;
      let args: string[];

      // Determine how to run the script based on extension
      if (ext === '.ps1') {
        command = 'powershell';
        args = [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          config.scriptPath,
          ...config.arguments,
        ];
      } else if (ext === '.bat' || ext === '.cmd') {
        command = 'cmd.exe';
        args = ['/c', config.scriptPath, ...config.arguments];
      } else if (ext === '.py') {
        command = 'python';
        args = [config.scriptPath, ...config.arguments];
      } else {
        // Default: run directly
        command = config.scriptPath;
        args = config.arguments;
      }

      const spawnOptions: Record<string, unknown> = {
        env,
        cwd: config.workingDirectory || path.dirname(config.scriptPath),
        shell: false,
        windowsHide: config.runHidden,
      };

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(command, args, spawnOptions);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, config.timeout * 1000);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Limit capture to 1MB
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.substring(0, 1024 * 1024) + '\n... (truncated)';
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 1024 * 1024) {
          stderr = stderr.substring(0, 1024 * 1024) + '\n... (truncated)';
        }
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;
        const successCodes = config.successExitCodes.length > 0 ? config.successExitCodes : [0];
        const success = !timedOut && exitCode !== null && successCodes.includes(exitCode);

        resolve({
          success,
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut,
          duration,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exitCode: null,
          stdout: '',
          stderr: err.message,
          timedOut: false,
          duration: Date.now() - startTime,
        });
      });
    });
  }
}

export const scriptService = new ScriptService();
