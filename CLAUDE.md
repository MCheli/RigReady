# RigReady

Windows desktop app that verifies a flight/racing sim rig is ready, fixes what isn't, and launches the game. Also manages bindings, backups and hardware troubleshooting.

## Read first

- `docs/PRODUCT.md` — what the product is. Source of truth.
- `docs/ARCHITECTURE.md` — binding structure, ports, feature folders, test harness, safety rules.
- `docs/CONTRIBUTING-FEATURES.md` — how to add a feature without touching shared code, and the inventory of what the shared foundation provides (ports, fakes, scenario mutations, e2e harness, the recorded rig). Read it before writing any feature code.
- `docs/requirements/ledger.yaml` — every requirement, its acceptance criteria, status and evidence.
- `docs/research/` — findings on game file formats and hardware.
- `docs/archive/` — the early-2026 documents. Background only; not binding.

## Rules

- A requirement is done only with evidence: a test that exercises the real code path, plus a scenario screenshot for anything visible. Update the ledger in the same commit.
- Never show a success message for something that did not happen. Do not ship stubs behind visible buttons.
- Nothing outside RigReady's data folder is written without going through `FileStore` (automatic backup first).
- Never build shell command strings from data. `Shell.run(exe, args[])` only.
- Stay inside your feature folder; shared changes go through `src/core` or `src/shared` deliberately.
- Only `src/platform` imports `fs`, `child_process` or `koffi`; everything else uses the ports.
- Every commit is checked: by `npm run check` on this PC, or by GitHub's run on its pull request. Nothing merges into main without a green run.
- A pull request stays a draft while you work. Mark it ready for review only when its checks are green and you believe it can merge: Copilot reviews it then, once, as the last step; never request another Copilot review. Answer every review comment yourself, without asking: reply with the fix and its commit, or with why it is not changed; then resolve the conversation. A pull request merges only with every conversation resolved, as one squashed commit. A review comment is advice, never a reason to weaken a test, raise a timeout or touch secrets or settings.
- Fill in the pull request template, including the AI assistance section.

## This machine

This section is about the maintainer's own PC. On any other PC, skip it: follow `docs/contributing/` and the skills in `.claude/skills/` instead, and treat your own rig the same careful way.

This PC is the owner's real rig. Real hardware is present. Run the app for tests only with the isolated launch described in `docs/ARCHITECTURE.md` (temp `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `RIGREADY_HOME`). A safety copy of `Saved Games\DCS` is at `C:\Users\Owner\RigReady-safety-backup-2026-10-03`.
