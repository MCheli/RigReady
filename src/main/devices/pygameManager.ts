import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

export interface PygameDevice {
  index: number;
  name: string;
  guid: string;
  numAxes: number;
  numButtons: number;
  numHats: number;
}

export interface PygameInputState {
  index: number;
  name: string;
  axes: number[];
  buttons: boolean[];
  hats: [number, number][];
  timestamp: number;
}

interface PygameMessage {
  type: string;
  [key: string]: any;
}

export class PygameManager {
  private process: ChildProcess | null = null;
  private devices: PygameDevice[] = [];
  private inputCallback: ((states: PygameInputState[]) => void) | null = null;
  private deviceCallback: ((devices: PygameDevice[]) => void) | null = null;
  private isReady: boolean = false;
  private pythonPath: string;
  private scriptPath: string;

  constructor() {
    // Find Python executable
    const resourcesPath = path.join(__dirname, '../../../resources/python');
    const devResourcesPath = path.join(process.cwd(), 'resources/python');

    if (fs.existsSync(path.join(resourcesPath, 'python.exe'))) {
      this.pythonPath = path.join(resourcesPath, 'python.exe');
    } else if (fs.existsSync(path.join(devResourcesPath, 'python.exe'))) {
      this.pythonPath = path.join(devResourcesPath, 'python.exe');
    } else {
      // Fallback to system Python
      this.pythonPath = 'python';
    }

    // Find input_server.py
    const scriptInDist = path.join(__dirname, '../../../python/input_server.py');
    const scriptInSrc = path.join(process.cwd(), 'python/input_server.py');

    if (fs.existsSync(scriptInDist)) {
      this.scriptPath = scriptInDist;
    } else if (fs.existsSync(scriptInSrc)) {
      this.scriptPath = scriptInSrc;
    } else {
      this.scriptPath = '';
    }

    console.log(`PygameManager: Python path: ${this.pythonPath}`);
    console.log(`PygameManager: Script path: ${this.scriptPath}`);
  }

  /**
   * Check if Python and pygame are available
   */
  isAvailable(): boolean {
    if (!this.scriptPath) {
      console.log('PygameManager: input_server.py not found');
      return false;
    }

    // Check if Python exists (for embedded)
    if (this.pythonPath !== 'python' && !fs.existsSync(this.pythonPath)) {
      console.log('PygameManager: Embedded Python not found');
      return false;
    }

    return true;
  }

  /**
   * Start the pygame input server
   */
  async start(): Promise<boolean> {
    if (this.process) {
      console.log('PygameManager: Already running');
      return true;
    }

    if (!this.isAvailable()) {
      console.error('PygameManager: Python/pygame not available. Run: npm run setup:python');
      return false;
    }

    return new Promise((resolve) => {
      try {
        console.log(`PygameManager: Starting ${this.pythonPath} ${this.scriptPath}`);

        this.process = spawn(this.pythonPath, [this.scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        // Handle stdout (JSON messages)
        if (this.process.stdout) {
          const rl = readline.createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity,
          });

          rl.on('line', (line) => {
            this.handleMessage(line);
          });
        }

        // Handle stderr (debug/error output)
        if (this.process.stderr) {
          this.process.stderr.on('data', (data) => {
            console.error(`PygameManager stderr: ${data.toString().trim()}`);
          });
        }

        // Handle process exit
        this.process.on('exit', (code) => {
          console.log(`PygameManager: Process exited with code ${code}`);
          this.process = null;
          this.isReady = false;
        });

        this.process.on('error', (err) => {
          console.error('PygameManager: Process error:', err);
          this.process = null;
          this.isReady = false;
          resolve(false);
        });

        // Wait for ready message with timeout
        const timeout = setTimeout(() => {
          if (!this.isReady) {
            console.error('PygameManager: Timeout waiting for ready');
            this.stop();
            resolve(false);
          }
        }, 5000);

        // Listen for ready
        const checkReady = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkReady);
            clearTimeout(timeout);
            resolve(true);
          }
        }, 100);
      } catch (error) {
        console.error('PygameManager: Failed to start:', error);
        resolve(false);
      }
    });
  }

  /**
   * Stop the pygame input server
   */
  stop(): void {
    if (this.process) {
      try {
        this.sendCommand({ command: 'stop' });

        // Give it a moment to clean up, then force kill
        setTimeout(() => {
          if (this.process) {
            this.process.kill();
            this.process = null;
          }
        }, 500);
      } catch {
        if (this.process) {
          this.process.kill();
          this.process = null;
        }
      }
    }
    this.isReady = false;
    this.inputCallback = null;
    this.deviceCallback = null;
  }

  /**
   * Send a command to the Python process
   */
  private sendCommand(cmd: object): void {
    if (this.process && this.process.stdin) {
      try {
        this.process.stdin.write(JSON.stringify(cmd) + '\n');
      } catch (e) {
        console.error('PygameManager: Failed to send command:', e);
      }
    }
  }

  /**
   * Handle incoming messages from Python
   */
  private handleMessage(line: string): void {
    try {
      const msg: PygameMessage = JSON.parse(line);

      switch (msg.type) {
        case 'ready':
          console.log(`PygameManager: Ready - pygame ${msg.version}, ${msg.deviceCount} devices`);
          this.devices = msg.devices || [];
          this.isReady = true;
          if (this.deviceCallback) {
            this.deviceCallback(this.devices);
          }
          break;

        case 'devices':
          this.devices = msg.devices || [];
          console.log(`PygameManager: ${this.devices.length} devices enumerated`);
          if (this.deviceCallback) {
            this.deviceCallback(this.devices);
          }
          break;

        case 'deviceConnected':
        case 'deviceDisconnected':
        case 'devicesChanged':
          this.devices = msg.devices || [];
          console.log(`PygameManager: Device change - now ${this.devices.length} devices`);
          if (this.deviceCallback) {
            this.deviceCallback(this.devices);
          }
          break;

        case 'inputStates':
          if (this.inputCallback && msg.states) {
            this.inputCallback(msg.states);
          }
          break;

        case 'pong':
          // Heartbeat response
          break;

        case 'shutdown':
          console.log('PygameManager: Python process shutdown');
          break;

        default:
          console.log('PygameManager: Unknown message type:', msg.type);
      }
    } catch (e) {
      console.error('PygameManager: Failed to parse message:', line, e);
    }
  }

  /**
   * Get list of connected devices
   */
  getDevices(): PygameDevice[] {
    return this.devices;
  }

  /**
   * Request device re-enumeration
   */
  enumerate(): void {
    this.sendCommand({ command: 'enumerate' });
  }

  /**
   * Start monitoring inputs
   */
  startMonitoring(callback: (states: PygameInputState[]) => void): void {
    this.inputCallback = callback;
  }

  /**
   * Stop monitoring inputs
   */
  stopMonitoring(): void {
    this.inputCallback = null;
  }

  /**
   * Set callback for device changes
   */
  onDeviceChange(callback: (devices: PygameDevice[]) => void): void {
    this.deviceCallback = callback;
  }

  /**
   * Check if the manager is ready
   */
  getIsReady(): boolean {
    return this.isReady;
  }
}
