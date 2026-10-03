import type { CheckContext } from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { ok, type Result } from '../../../core/result';
import type { StreamDeckBackups } from './backups';
import { DOWNLOAD_URL, detectStreamDeck, streamDeckPaths } from './detect';
import { findings } from './health';
import { readInventory } from './inventory';
import type { Backup, ElgatoBackup, Finding, Inventory, StreamDeckStatus } from './model';

export interface StreamDeckOverview {
  status: StreamDeckStatus;
  inventory: Inventory;
  findings: Finding[];
  backups: Backup[];
  damagedBackups: number;
  elgatoBackups: ElgatoBackup[];
  downloadUrl: string;
}

export async function overview(
  ctx: CheckContext,
  games: GameRegistry,
  backups: StreamDeckBackups
): Promise<Result<StreamDeckOverview>> {
  const status = await detectStreamDeck(ctx.ports);
  if (!status.ok) return status;
  const paths = await streamDeckPaths(ctx.ports);
  const inventory = await readInventory(ctx.ports.files, paths, status.value.devices);
  if (!inventory.ok) return inventory;
  const list = await backups.list();
  if (!list.ok) return list;
  const elgato = await backups.elgatoBackups();
  if (!elgato.ok) return elgato;
  return ok({
    status: status.value,
    inventory: inventory.value,
    findings: await findings(
      {
        status: status.value,
        inventory: inventory.value,
        backups: list.value.backups,
        now: ctx.ports.clock.now(),
      },
      ctx,
      games
    ),
    backups: list.value.backups,
    damagedBackups: list.value.damaged,
    elgatoBackups: elgato.value,
    downloadUrl: DOWNLOAD_URL,
  });
}
