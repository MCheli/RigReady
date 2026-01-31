/**
 * Process detection service for pre-flight checks
 * Detects running processes on Windows
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProcessInfo {
  name: string;
  pid: number;
  windowTitle?: string;
}

export interface ProcessCheckResult {
  processName: string;
  displayName: string;
  running: boolean;
  pid?: number;
}

// Common simulation software processes
export const KNOWN_PROCESSES: Record<string, string> = {
  // Head Tracking
  'TrackIR5.exe': 'TrackIR 5',
  'opentrack.exe': 'OpenTrack',
  'FaceTrackNoIR.exe': 'FaceTrackNoIR',
  'AITrack.exe': 'AITrack',

  // Controller Software
  'SimAppPro.exe': 'WinWing SimAppPro',
  'VPC_Joystick_Config.exe': 'Virpil Config',
  'TARGET.exe': 'Thrustmaster TARGET',
  'SST.exe': 'Saitek Smart Technology',
  'JoystickGremlin.exe': 'Joystick Gremlin',
  'vJoyConf.exe': 'vJoy Configure',

  // Stream Deck
  'StreamDeck.exe': 'Stream Deck',

  // VR Software
  'OculusClient.exe': 'Oculus',
  'vrserver.exe': 'SteamVR',
  'WindowsMR.exe': 'Windows Mixed Reality',

  // Voice Control
  'VoiceAttack.exe': 'VoiceAttack',
  'VAICOM.exe': 'VAICOM Pro',

  // Simulators
  'DCS.exe': 'DCS World',
  'fsx.exe': 'FSX',
  'FlightSimulator.exe': 'MSFS 2020',
  'Il-2.exe': 'IL-2 Sturmovik',
  'WarThunder.exe': 'War Thunder',
  'XPlane.exe': 'X-Plane',
  'Prepar3D.exe': 'Prepar3D',
  'iRacingUI.exe': 'iRacing',
  'AC2-Win64-Shipping.exe': 'Assetto Corsa Competizione',
  'acs.exe': 'Assetto Corsa',
};

export class ProcessService {
  /**
   * Get all running processes (Windows)
   */
  async getRunningProcesses(): Promise<ProcessInfo[]> {
    try {
      // Use tasklist to get process information
      const { stdout } = await execAsync('tasklist /FO CSV /NH', { maxBuffer: 10 * 1024 * 1024 });

      const processes: ProcessInfo[] = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        // Parse CSV format: "Image Name","PID","Session Name","Session#","Mem Usage"
        const match = line.match(/"([^"]+)","(\d+)"/);
        if (match) {
          processes.push({
            name: match[1],
            pid: parseInt(match[2], 10),
          });
        }
      }

      return processes;
    } catch (error) {
      console.error('Failed to get running processes:', error);
      return [];
    }
  }

  /**
   * Check if a specific process is running
   */
  async isProcessRunning(processName: string): Promise<ProcessCheckResult> {
    const displayName = KNOWN_PROCESSES[processName] || processName;

    try {
      const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${processName}" /FO CSV /NH`, {
        maxBuffer: 1024 * 1024,
      });

      // If process is found, output will contain the process name
      const running = stdout.toLowerCase().includes(processName.toLowerCase());
      let pid: number | undefined;

      if (running) {
        const match = stdout.match(/"[^"]+","(\d+)"/);
        if (match) {
          pid = parseInt(match[1], 10);
        }
      }

      return {
        processName,
        displayName,
        running,
        pid,
      };
    } catch (error) {
      console.error(`Failed to check process ${processName}:`, error);
      return {
        processName,
        displayName,
        running: false,
      };
    }
  }

  /**
   * Check multiple processes at once
   */
  async checkProcesses(processNames: string[]): Promise<ProcessCheckResult[]> {
    const results = await Promise.all(processNames.map((name) => this.isProcessRunning(name)));
    return results;
  }

  /**
   * Find running processes that match known simulation software
   */
  async findKnownProcesses(): Promise<ProcessCheckResult[]> {
    const allProcesses = await this.getRunningProcesses();
    const runningNames = new Set(allProcesses.map((p) => p.name.toLowerCase()));
    const results: ProcessCheckResult[] = [];

    for (const [processName, displayName] of Object.entries(KNOWN_PROCESSES)) {
      const running = runningNames.has(processName.toLowerCase());
      const process = running
        ? allProcesses.find((p) => p.name.toLowerCase() === processName.toLowerCase())
        : undefined;

      results.push({
        processName,
        displayName,
        running,
        pid: process?.pid,
      });
    }

    return results;
  }

  /**
   * Get only the running known processes
   */
  async getRunningKnownProcesses(): Promise<ProcessCheckResult[]> {
    const all = await this.findKnownProcesses();
    return all.filter((p) => p.running);
  }

  /**
   * Launch a process (for game launch functionality)
   */
  async launchProcess(executablePath: string, args: string[] = []): Promise<boolean> {
    try {
      const command =
        args.length > 0
          ? `"${executablePath}" ${args.map((a) => `"${a}"`).join(' ')}`
          : `"${executablePath}"`;

      // Use start to launch in background (use cmd.exe shell)
      await execAsync(`start "" ${command}`, { shell: 'cmd.exe' });
      return true;
    } catch (error) {
      console.error(`Failed to launch process: ${executablePath}`, error);
      return false;
    }
  }
}

// Singleton instance
export const processService = new ProcessService();
