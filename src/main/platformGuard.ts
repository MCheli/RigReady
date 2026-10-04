/**
 * RigReady is a Windows program: it reads devices, monitors, audio and the registry
 * through Windows itself. On anything else it refuses to start and says why, instead of
 * opening a window in which nothing works.
 */
export function unsupportedPlatformMessage(platform: string): string | undefined {
  if (platform === 'win32') return undefined;
  const names: Record<string, string> = { darwin: 'macOS', linux: 'Linux' };
  return (
    `RigReady only runs on Windows 10 and Windows 11. This computer runs ${names[platform] ?? platform}, ` +
    'so RigReady cannot start here.'
  );
}
