import { z } from 'zod';

/** WinWing features that only work while SimAppPro runs (docs/research/hardware-and-tools.md 1c). */
export const RUNTIME_FEATURES = ['backlight', 'displays', 'vibration'] as const;
export const RuntimeFeatureSchema = z.enum(RUNTIME_FEATURES);
export type RuntimeFeature = z.infer<typeof RuntimeFeatureSchema>;

export const RUNTIME_FEATURE_LABELS: Record<RuntimeFeature, string> = {
  backlight: 'Backlight and lamp sync',
  displays: 'UFC / ICP displays',
  vibration: 'Vibration',
};

/** In a sentence: "needed for UFC/ICP displays and backlight sync". */
const PHRASES: Record<RuntimeFeature, string> = {
  backlight: 'backlight sync',
  displays: 'UFC/ICP displays',
  vibration: 'vibration',
};
export function runtimeFeaturePhrase(features: RuntimeFeature[]): string {
  const parts = features.map((f) => PHRASES[f]);
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** What a setup keeps in profile.extensions['dcs-setup']. */
export const DcsProfileExtensionSchema = z.object({
  winwingRuntime: z.array(RuntimeFeatureSchema).default([]),
});
