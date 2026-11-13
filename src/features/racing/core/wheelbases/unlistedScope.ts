/**
 * What a wheel base of a model RigReady does not know gets, and what it does not. Shown before
 * the user adds one ("My wheel is not listed") and on the Wheel page afterwards, in the same
 * words. Each line of the first list is something the code does for any controller; each line
 * of the second needs a maker's file format, software or USB ids, which RigReady has only for
 * the models in its table (./products.ts, ./brands.ts).
 *
 * Plain text and nothing else: the renderer imports this file too.
 */

/** What RigReady does for a wheel base whose model it does not know. */
export const UNLISTED_WORKS: readonly string[] = [
  'This page shows whether it is connected and how many controllers games see for it.',
  'A setup can check it: "Wheel base connected" fails when it is unplugged or games cannot see it.',
  'Its axes and buttons show in the input tester.',
  'The game pages (iRacing, Le Mans Ultimate, BeamNG.drive, Assetto Corsa) treat it like any controller.',
];

/** What needs a maker or a model RigReady knows, and so is not there for an unlisted base. */
export const UNLISTED_NOT_AVAILABLE: readonly string[] = [
  "The maker's software. RigReady does not know which program sets this model up, so it does not check or start one.",
  'The mode. RigReady cannot tell a PC mode from a console or compatibility mode on this model.',
  'Axis names. RigReady shows the names Windows gives (X axis, Y axis), not Wheel, Brake or Clutch.',
  "Profiles and settings files. RigReady does not know this maker's files, so it does not back them up or compare them.",
  'Rotation, tuning presets and recommended settings.',
  'Rim, pedals and shifter as parts of this wheel. They show on the Devices page as controllers.',
];
