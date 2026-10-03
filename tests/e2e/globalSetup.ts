import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Electron downloads its binary on first use. Do that once here, before any worker
 * starts, so parallel tests cannot race on the download.
 */
export default function globalSetup(): void {
  const electronDir = path.resolve(__dirname, '..', '..', 'node_modules', 'electron');
  if (existsSync(path.join(electronDir, 'dist', 'electron.exe'))) return;
  execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' });
}
