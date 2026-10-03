import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cleanTemp from '../cleanTemp';

/**
 * Removes temp folders that killed runs left behind. Electron downloads its binary on first use. Do that once here, before any worker
 * starts, so parallel tests cannot race on the download.
 */
export default async function globalSetup(): Promise<void> {
  await cleanTemp();
  const electronDir = path.resolve(__dirname, '..', '..', 'node_modules', 'electron');
  if (existsSync(path.join(electronDir, 'dist', 'electron.exe'))) return;
  execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' });
}
