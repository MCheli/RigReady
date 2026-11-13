<!--
Thanks for contributing. CONTRIBUTING.md has the rules. Keep the pull request to one change.
A security problem is reported privately instead (SECURITY.md), not in a pull request.
Fill in each section; delete these comments as you go.
-->

## Summary

<!-- One or two sentences: what changes, and for whom. -->

## The problem

<!--
What was wrong or missing, and how someone runs into it.
Link the issue if there is one ("Fixes #123").
For hardware or a game, name the device, the game and its version.
-->

## The solution

<!--
How this change solves it, and why this way.
Name any shared code you touched (src/core, src/shared, src/renderer).
-->

## Considered but not implemented

<!--
Other ways to solve the same problem and why you did not take them,
and follow-up work this change leaves for later. Write "Nothing" if there is none.
-->

## Testing

<!--
The tests you added or changed, and what you ran.
For anything on screen, attach the screenshot the scenario run produced.
If you tried it on real hardware or in a game, say which, and what you saw.
-->

## For the reviewer

<!-- What you would like checked, what you are unsure about. -->

## Checklist

- [ ] `npm run check` passes
- [ ] `npm run test:e2e` passes, or the scenarios you ran are named above
- [ ] The requirement's entry in `docs/requirements/ledger.yaml` and its evidence are in this pull request
- [ ] The manual page under `docs/manual/` is updated if what the app does changed
- [ ] Files outside RigReady's data folder are changed only through `FileStore`, and programs are started with an argument array
- [ ] No keys, tokens, serial numbers, device ids or personal paths in the code, tests, screenshots or logs

## AI assistance

<!--
Fill this in for every pull request. Write "None" if no AI tool was used.
You must be able to explain every change, whoever or whatever wrote it.
-->

- **Tool or harness:** <!-- for example Claude Code, GitHub Copilot, Cursor, ChatGPT -->
- **Model:** <!-- for example Claude Opus 5.5, GPT-5 -->
- **How it was used:** <!-- which parts it wrote, which you wrote or changed yourself, and what you checked by hand -->
