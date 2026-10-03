# RigReady

Windows desktop app that verifies a flight/racing sim rig is ready, fixes what isn't, and launches the game. Also manages bindings, backups and hardware troubleshooting.

## Read first

- `docs/PRODUCT.md` — what the product is. Source of truth.
- `docs/ARCHITECTURE.md` — binding structure, ports, feature folders, test harness, safety rules.
- `docs/requirements/ledger.yaml` — every requirement, its acceptance criteria, status and evidence.
- `docs/research/` — findings on game file formats and hardware.
- `docs/archive/` — the early-2026 documents. Background only; not binding.

## Rules

- A requirement is done only with evidence: a test that exercises the real code path, plus a scenario screenshot for anything visible. Update the ledger in the same commit.
- Never show a success message for something that did not happen. Do not ship stubs behind visible buttons.
- Nothing outside RigReady's data folder is written without going through `FileStore` (automatic backup first).
- Never build shell command strings from data. `Shell.run(exe, args[])` only.
- Stay inside your feature folder; shared changes go through `src/core` or `src/shared` deliberately.
- `npm run check` must pass before every commit.

## This machine

This PC is the owner's real rig. Real hardware is present. Run the app for tests only with the isolated launch described in `docs/ARCHITECTURE.md` (temp `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `RIGREADY_HOME`). A safety copy of `Saved Games\DCS` is at `C:\Users\Owner\RigReady-safety-backup-2026-10-03`.
