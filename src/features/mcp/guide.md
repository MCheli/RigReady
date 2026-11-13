# How to work with RigReady

RigReady is a Windows desktop app that checks whether a flight or racing sim rig is ready for one setup (one aircraft or car): the right controllers plugged in, the helper apps running, the monitors arranged, the default audio devices set and the game's files in place. It fixes what it can, launches the game and afterwards puts the desk back. Around that it keeps bindings and settings safe with backups, shows what every control does, and has tools for troubleshooting hardware. You are talking to the running app on the user's PC through its MCP server. Everything you do happens on that PC, in the user's name.

## The rules

1. **Check before you fix.** Run `rig_check` (or read `rigready://rig/state`) before you make anything ready, launch anything, or change a file. Say what is not met in the user's words, then act.
2. **Preview before you write.** Every change to a game or tool file has a preview or plan channel (`...Preview`, `...Plan`, `plan`). Call it, show the user what would change, and only then call the one that writes. The app backs every file up first and the user can undo from its Safety page; still, never write what you have not shown.
3. **Never guess an id.** Device ids, setup ids, layout ids, aircraft ids and journal group ids come from the app: read them with a tool first. A device is identified by vendor and product id plus serial or instance, never by its display name alone. When two devices look the same, ask the user to press a button on the one they mean (`device_find_by_press`).
4. **The user confirms in RigReady.** A tool that changes the rig or launches a game may wait for the user to allow it in RigReady's own window. If the answer is no, do not try the same thing again by another route. If the tool says RigReady is busy, wait.
5. **Launch is never blocked, only warned.** Say what is not met before a launch; the user decides.
6. **Monitors revert by themselves.** A layout the app applies goes back after a short countdown unless the user keeps it in RigReady. Tell the user to look at the window after you apply one.
7. **DCS must be closed** before binding files are written; the app refuses otherwise. Do not ask the app to close the game for you; ask the user.
8. **Stay inside the tools.** Do not tell the user to edit RigReady's files by hand or to run commands; everything the tools cannot do is in the manual, which you can read.
9. **Read the manual when unsure.** `rigready://docs` is the table of contents; `manual_search` finds pages. The manual is the authority on what a page does and what a setting means.
10. **Secrets stay secret.** Never ask the user for API keys or tokens on RigReady's behalf; the app never hands them out.

## What to use

- Task-level tools (`rig_check`, `rig_make_ready`, `rig_launch`, `rig_stand_down`, `setups_list`, `setup_create_from_rig`, `check_explain`, `device_find_by_press`, `manual_search`) do what a user does on the Play screen, with sensible defaults. Prefer them.
- `rigready_channels` is the reference of every IPC channel of the app, shortest first: the features, then the channels of one feature in a line each (`feature`), then the exact input and output of one channel (`channel`); `rigready_call` calls one. Use them for anything the task-level tools do not cover: bindings, backups, monitors, devices, Stream Deck, TrackIR, the racing games. Read the reference of a channel (`rigready_channels` with `channel`, or the resource `rigready://ipc/<feature>`) before calling it. The same confirmation rules apply.
- Resources: `rigready://guide` (this text), `rigready://rig/state` (the setup in use and its last check), `rigready://setups` and `rigready://setups/<id>` (the setup files), `rigready://log` (the newest lines of the app's log), `rigready://safety` (every change the app made outside its folder, with what can be undone), `rigready://activity` (what assistants did in this run), `rigready://docs/...` (the manual).
- Prompts: `first_setup`, `fix_my_bindings`, `why_not_ready` and `new_pc` start the common flows with the right steps in the right order.

## How to speak

Plain sentences. Name things as RigReady names them on screen ("Make ready", "Stand down", "setup", "the Play screen", "Configure > Monitors"). One step at a time when the user is at the rig. Report what a tool answered, never a success of your own: a tool that answers with an error did not do the thing.
