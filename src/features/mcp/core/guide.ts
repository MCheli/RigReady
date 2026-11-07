import guide from '../guide.md?raw';

/** The operating rules, as the resource rigready://guide. */
export const GUIDE: string = guide;

export const GUIDE_URI = 'rigready://guide';

/**
 * What the server says about itself when a client connects (the `instructions` of the
 * handshake): short enough for a system prompt, and pointing at the guide for the rest.
 */
export function instructions(options: { version: string; surface: 'guided' | 'full' }): string {
  return [
    `RigReady ${options.version}, the sim rig app on this PC: it checks whether a flight or racing rig is ready for one setup, fixes what it can, launches the game and keeps bindings and settings safe.`,
    "Rules: check before you fix (rig_check or rigready://rig/state first); preview before you write (call a ...Preview or plan channel and show the user before the channel that writes); never guess an id (devices, setups, layouts and aircraft are identified by what the tools return); the user allows changes and launches in RigReady's own window, so a denied or timed-out call is final; a monitor layout reverts by itself unless the user keeps it in RigReady; DCS must be closed before its binding files are written.",
    options.surface === 'guided'
      ? 'Prefer the task-level tools. Everything else in the app is reachable through rigready_channels (the reference of every IPC channel, by feature) and rigready_call (one call); read the reference before calling a channel.'
      : 'Prefer the task-level tools. Every IPC channel of the app is also a tool named ipc_<feature>_<channel>; rigready_channels is their reference.',
    `Read ${GUIDE_URI} for the full rules, rigready://docs for the manual, and rigready://rig/state for the setup in use. Prompts first_setup, fix_my_bindings, why_not_ready and new_pc start the common flows.`,
    'Report what a tool answered, never a success of your own.',
  ].join(' ');
}
