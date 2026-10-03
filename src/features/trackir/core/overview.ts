import type { Ports } from '../../../core/ports';
import { ok, type Result } from '../../../core/result';
import {
  DOWNLOAD_URL,
  detectTrackIr,
  readTrackIrProfiles,
  type TrackIrProfiles,
  type TrackIrStatus,
} from './trackir';

export async function trackIrOverview(
  ports: Ports
): Promise<Result<{ status: TrackIrStatus; profiles: TrackIrProfiles; downloadUrl: string }>> {
  const status = await detectTrackIr(ports);
  if (!status.ok) return status;
  const profiles = await readTrackIrProfiles(ports);
  if (!profiles.ok) return profiles;
  return ok({ status: status.value, profiles: profiles.value, downloadUrl: DOWNLOAD_URL });
}
