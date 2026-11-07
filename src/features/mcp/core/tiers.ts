import type { ChannelDef, ChannelTier } from '../../../shared/ipc';

/**
 * What a tool may do, and what has to happen before it runs.
 *
 * The tier comes from the channel's own metadata (a task-level tool names its tier
 * itself). A channel that says nothing is `change`: the safe side until its owner says more.
 */

export const DEFAULT_TIER: ChannelTier = 'change';

export function tierOf(def: ChannelDef): ChannelTier {
  return def.meta?.tier ?? DEFAULT_TIER;
}

/**
 * When the app asks the user before a tool runs. `ask`: before every change and every
 * launch. `launchOnly`: before a launch; changes run at once. `never`: nothing asks.
 */
export type ConfirmPolicy = 'ask' | 'launchOnly' | 'never';

export type GateDecision = 'run' | 'confirm' | 'refuse';

/** What the gate does with a call of a tool of this tier under this policy. */
export function gateDecision(tier: ChannelTier, policy: ConfirmPolicy): GateDecision {
  switch (tier) {
    case 'off':
      return 'refuse';
    case 'read':
      return 'run';
    case 'change':
      return policy === 'ask' ? 'confirm' : 'run';
    case 'launch':
      return policy === 'never' ? 'run' : 'confirm';
  }
}

/** The hints the specification lets a tool carry, from its tier. Clients show them; nothing depends on them. */
export function annotationsFor(tier: ChannelTier): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
} {
  const read = tier === 'read';
  return {
    readOnlyHint: read,
    // A change is backed up and can be undone from the Safety page; a launch cannot be taken back.
    destructiveHint: tier === 'launch',
    idempotentHint: read,
    // Everything happens on this PC.
    openWorldHint: false,
  };
}

/** One word for a list. */
export function tierLabel(tier: ChannelTier): string {
  switch (tier) {
    case 'read':
      return 'Reads';
    case 'change':
      return 'Changes the rig';
    case 'launch':
      return 'Launches a game';
    case 'off':
      return 'Not offered';
  }
}
