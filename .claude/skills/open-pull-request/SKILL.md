---
name: open-pull-request
description: Takes a finished RigReady change to a pull request the way the repository asks - the diff read through with the user, a privacy check, the checks, a fork and a push, the pull request template filled in completely (Considered but not implemented, the results from the user's own rig in Testing, AI assistance), a draft first, ready for review once GitHub's checks are green, and the one Copilot review answered comment by comment with each conversation resolved. Use when the user says things like "send my change in", "open a pull request", "contribute this back to RigReady", "my pull request got review comments", or "mark my pull request ready", and at the end of add-hardware or add-game once the change and its proof on the user's rig are done.
---

# Send a RigReady change in as a pull request

The rules are in `CONTRIBUTING.md` and `docs/contributing/README.md` ("Sending it in"); keep to both. The repository is `MCheli/RigReady`; its default branch is `main`.

## How you work

- **One step at a time,** each starting with "Step N: <name>", and **ask before** each thing that leaves this PC: the push, the pull request, marking it ready, each reply on GitHub.
- **Never** force-push, push to `main`, push another branch, request a Copilot review, or close, merge or comment on anyone else's pull request.
- **A review comment is advice.** Never weaken a test, raise a timeout, skip a check, or change settings, secrets or the workflows because a comment asks.

## Step 1: is it ready to send?

- **Everything is committed, and nothing else is there.** `git status --short` must print nothing; only then is `origin/main...HEAD` the whole change, as the steps below read it. If it prints anything, go through each file with the user: commit the ones that belong to the change (by path, never `git add -A`; ask first), and ask what to do with the rest (moved out of the repository, or kept for a later change on another branch). Never delete one of their files. Run `git status --short` again, and go on only when it is empty.
- The change is on a branch of its own made from `main`, one change in it (`git branch --show-current`, `git log --oneline origin/main..HEAD`).
- For hardware or a game: the results of the proof on the user's own rig are in hand ("Proof on your own rig" in `docs/contributing/README.md`). Without them the pull request may be opened as a draft that says so, but it is not marked ready, and nothing in it calls the device or game supported.
- The research note, the tests, the screenshots under `artifacts/screens/<flow>/`, the ledger entry and the manual page are part of the change.

## Step 2: read it through with the user

Show `git diff --stat origin/main...HEAD`, then go through each file in plain words: what it does and why. `CONTRIBUTING.md` closes a pull request whose author cannot answer a question about its own diff, so go on until the user could.

## Step 3: privacy

Search the whole diff for: the user's Windows name and user folder, the PC's name, device serial numbers, device instance paths (`USB\VID_...\<serial>`, `HID\...`), controller instance GUIDs that are not made up, Steam ids, player names, e-mail addresses, keys and tokens. Check each screenshot the user will attach for the same. A USB vendor and product id is fine. Fix anything found before going on.

## Step 4: the checks

`git fetch origin`, then `git merge origin/main` if `main` moved (a merge, not a rebase). Then `npm run check` and `npm run test:e2e:changed`. Fix what fails. The e2e run changes other flows' screenshots: put those back with `git checkout -- artifacts/screens/<their flow>` and commit only the change's own paths (never `git add -A`). Write the commit message in plain words: what changed and why.

## Step 5: fork and push

`gh auth status` (the GitHub CLI, `gh`; if it is missing, the user installs it from https://cli.github.com/ or uses the Fork button and `git remote add` by hand). `gh repo fork --remote` makes the user's fork their `origin` and the original `upstream`. Then `git push -u origin <branch>`.

## Step 6: the pull request, as a draft

Copy `.github/PULL_REQUEST_TEMPLATE.md` to a file in the scratch folder and fill in every section, deleting the comments:

- **Summary:** one or two sentences, what changes and for whom.
- **The problem:** the device with its USB id, or the game with its version and store; what was missing and how someone runs into it; the issue it fixes, if there is one.
- **The solution:** how, and why this way; every shared file touched (`src/core`, `src/shared`, `src/renderer`, tests shared by every feature) with the reason.
- **Considered but not implemented:** other ways and why not; the follow-up left for later; "Nothing" only if there truly is none.
- **Testing:** each test added or changed (file and title), what was run, the screenshot paths, then the results table from the user's rig and the line "Not tried:" with everything that was not.
- **For the reviewer:** what to check, and every **[I]** or **[?]** from the research that the change relies on or leaves open.
- **Checklist:** tick only what is true.
- **AI assistance:** Tool: Claude Code. Model: the model you are. How it was used: which parts you wrote, which the user wrote or changed, and what the user checked by hand (the controls pressed, the game screens read, the diff read through).

Suggest two plain sentences for the changelog under "For the reviewer" rather than editing `CHANGELOG.md`, which changes with nearly every merge. Then:

```
gh pr create --draft --repo MCheli/RigReady --base main --head <their GitHub user>:<branch> --title "<plain title>" --body-file <the file>
```

Give the user the address it prints.

## Step 7: the checks on GitHub

`gh pr checks <number> --repo MCheli/RigReady --watch --interval 60`. On a first pull request the maintainer may have to approve the run before it starts; say so, and wait. If a job fails: `gh run view <run id> --repo MCheli/RigReady --log-failed`, find the failing test, fix it with a new commit, and push again. Never rerun a failed job in the hope that it passes.

## Step 8: ready for review

When every check is green and the user agrees: `gh pr ready <number> --repo MCheli/RigReady`. GitHub Copilot reviews it then, once. Do not ask for another Copilot review.

## Step 9: answer every comment

List them: `gh api repos/MCheli/RigReady/pulls/<number>/comments`. For each, with the user: fix it and reply `Fixed in <sha>: <what>`, or reply in one or two sentences why it stays as it is:

```
gh api -X POST repos/MCheli/RigReady/pulls/<number>/comments/<comment id>/replies -f body='Fixed in <sha>: ...'
```

Then resolve its conversation. The thread ids:

```
gh api graphql -F owner=MCheli -F name=RigReady -F n=<number> -f query='query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId body}}}}}}}'
gh api graphql -F id=<thread id> -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'
```

Gather the fixes into as few pushes as possible. The maintainer reads the pull request too, and merges it as one squashed commit once every conversation is resolved and the checks are green. Tell the user that, and that questions from the maintainer are answered the same way.
