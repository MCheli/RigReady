---
title: Troubleshooting
description: How to read a failing check, what to do about the problems a sim user can run into with RigReady, and how to send a useful problem report.
order: 110
---

Most trouble shows up on the Play screen as a failing check, and most failing checks say in their own words what is wrong and offer the fix next to it. This section is for the rest: the problems that come from the PC, from Windows, from a game being open, or from a damaged file.

Each page names the symptom as RigReady shows it, the cause, and what to do. Short answers to common questions, such as whether RigReady needs administrator rights or works without DCS, are on [Questions and answers](faq.md).

## Reading a failing check

Every check on the [Play screen](../play/index.md) has a summary line and, when you open it, details in plain words. A **red** item is required and not met: the rig is **Not ready**. A **yellow** item is optional and not met: the rig is **Ready**, with a warning. A check that could not be run at all, for example because the controllers could not be read, says so rather than pretending to fail.

Next to a failing item there is its fix, when RigReady has one (start the app, apply the layout, restore the file), and a re-check. **Re-check all** runs every check again. Items RigReady cannot fix by itself are listed under **Needs you** ([After the fixes](../play/make-ready-and-launch.md#after-the-fixes)), with what to do. Launch is never blocked by a failing check; it only asks first. See [Checks and fixes](../setups/checks.md) for every kind of check.

![A rig with problems](../../../artifacts/screens/a11y-fly-not-ready/01-not-ready.png)

## Reporting a problem

When a page here does not solve it, open **Configure > Diagnostics**, press **Copy diagnostics**, and paste the result into a report on the project's issues page (the **Report a problem** link in the About panel). The report has personal details removed; read it first if you like. Say what you did, what you expected, and what happened instead. See [diagnostics](../app/diagnostics.md).
