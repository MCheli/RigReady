/** What the tray shows. Pure, so it is unit-tested without Electron. */

export interface TrayStatus {
  /** The setup shown on the Fly screen. Undefined when there are no setups yet. */
  profileId?: string;
  profileName?: string;
  /** From the last checklist run. Undefined until checks have run. */
  ready?: boolean;
  failed?: number;
  warnings?: number;
  fixable?: number;
}

export interface TrayMenuItem {
  id: 'open' | 'status' | 'makeReady' | 'quit' | 'separator';
  label: string;
  enabled: boolean;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function trayStatusLine(status: TrayStatus): string {
  if (!status.profileName) return 'No setup yet';
  if (status.ready === undefined) return `${status.profileName}: not checked yet`;
  if (!status.ready)
    return `${status.profileName}: Not ready (${plural(status.failed ?? 0, 'problem')})`;
  if ((status.warnings ?? 0) > 0) {
    return `${status.profileName}: Ready (${plural(status.warnings ?? 0, 'warning')})`;
  }
  return `${status.profileName}: Ready`;
}

export function trayTooltip(status: TrayStatus): string {
  return `RigReady - ${trayStatusLine(status)}`;
}

export function trayMenu(status: TrayStatus, busy = false): TrayMenuItem[] {
  return [
    { id: 'open', label: 'Open RigReady', enabled: true },
    { id: 'separator', label: '', enabled: false },
    { id: 'status', label: trayStatusLine(status), enabled: false },
    {
      id: 'makeReady',
      label: busy ? 'Making ready...' : 'Make ready',
      enabled: !busy && status.profileId !== undefined,
    },
    { id: 'separator', label: '', enabled: false },
    { id: 'quit', label: 'Quit', enabled: true },
  ];
}

/** Picks tray status out of an IPC answer from the fly feature, when it is one. */
export function statusFromFlyResponse(
  channel: string,
  value: unknown,
  current: TrayStatus
): TrayStatus | undefined {
  const record = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  if (channel === 'fly:state') {
    const state = record(value);
    const profiles = Array.isArray(state?.['profiles']) ? (state['profiles'] as unknown[]) : [];
    const activeId =
      typeof state?.['activeProfileId'] === 'string' ? state['activeProfileId'] : undefined;
    const active = profiles.map(record).find((p) => p?.['id'] === activeId);
    if (!active) return {};
    const name = typeof active['name'] === 'string' ? active['name'] : activeId!;
    // Keep the last result while the same setup stays selected.
    return current.profileId === activeId
      ? { ...current, profileName: name }
      : { profileId: activeId!, profileName: name };
  }
  if (channel === 'fly:check' || channel === 'fly:makeReady' || channel === 'fly:standDown') {
    const report = channel === 'fly:check' ? record(value) : record(record(value)?.['report']);
    if (!report || typeof report['ready'] !== 'boolean') return undefined;
    const profileId = typeof report['profileId'] === 'string' ? report['profileId'] : undefined;
    const number = (key: string): number => (typeof report[key] === 'number' ? report[key] : 0);
    return {
      ...(profileId === current.profileId ? current : {}),
      ...(profileId ? { profileId } : {}),
      ...(profileId === current.profileId && current.profileName
        ? { profileName: current.profileName }
        : profileId
          ? { profileName: profileId }
          : {}),
      ready: report['ready'],
      failed: number('failed'),
      warnings: number('warnings'),
      fixable: number('fixable'),
    };
  }
  return undefined;
}
