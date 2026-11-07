import { CHANNEL_PATTERN } from '../../../shared/channels';

/**
 * How the tools an assistant sees are named.
 *
 * - A channel tool is `ipc_<feature>_<key>`: `ipc_fly_check` for `fly:check`,
 *   `ipc_dcs-bindings_plan` for `dcs-bindings:plan`. The prefix says "this is a raw channel
 *   of the app", the feature keeps its dashes, and the first underscore after the prefix
 *   is the only one the feature id cannot hold, so the name reads back without ambiguity.
 * - A task-level tool is lower-case words joined by underscores (`rig_make_ready`) and never
 *   starts with `ipc_`.
 *
 * Both fit what the specification allows (letters, digits, `_`, `-` and `.`; at most 128
 * characters) and what Claude Code makes of them (`mcp__rigready__<name>`).
 */

export const CHANNEL_TOOL_PREFIX = 'ipc_';

export function channelToolName(feature: string, key: string): string {
  return `${CHANNEL_TOOL_PREFIX}${feature}_${key}`;
}

/** The channel a channel tool stands for, or undefined for any other name. */
export function channelOfToolName(name: string): { feature: string; key: string } | undefined {
  if (!name.startsWith(CHANNEL_TOOL_PREFIX)) return undefined;
  const rest = name.slice(CHANNEL_TOOL_PREFIX.length);
  const at = rest.indexOf('_');
  if (at <= 0 || at === rest.length - 1) return undefined;
  const feature = rest.slice(0, at);
  const key = rest.slice(at + 1);
  return CHANNEL_PATTERN.test(`${feature}:${key}`) ? { feature, key } : undefined;
}

/** What the specification allows a tool to be called. */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
