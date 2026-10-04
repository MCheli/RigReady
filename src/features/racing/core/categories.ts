/**
 * What part of driving an action belongs to, in words every racing game's reader uses
 * for the outermost category of a binding. Decided from the plain name of the action.
 */

export type RacingCategory =
  'Driving' | 'Car adjustments' | 'Pit & session' | 'View' | 'Radio & chat' | 'Other';

/** First match wins: "Brake bias up" is an adjustment before it is a brake. */
const RULES: [RacingCategory, RegExp][] = [
  ['Radio & chat', /\b(chat|radio|voice|push to talk|mic|microphone|spotter)\b/],
  [
    'Pit & session',
    /\b(pit (menu|request|stop|crew|lane)|pit$|black box|tyres?|tires?|refuel|fast repair|session|restart|pause|replay|time (accel|scale)|vehicle selector|recover|rewind|slow motion|screenshot|ai control)\b/,
  ],
  [
    'View',
    /\b(look|glance|camera|cam|view|seat|mirror|recenter|zoom|head|vr|fov|free ?look|overlay|hud|mfd|dash(board)?( page)?|delta|ui|apps?|radar|racing line)\b/,
  ],
  [
    'Car adjustments',
    /\b(bias|balance|traction|abs|tc\d?|motor map|engine (map|brake|braking|mode)|turbo|boost|mgu-?[kh]|anti-?roll|arb|differential|diff|wing|fuel mix(ture)?|launch control|regen|deploy|brake migration|increment|decrement|weight jacker|low range|locker|esc|range box|gearbox mode|two-step)\b/,
  ],
  [
    'Driving',
    /\b(steer(ing)?|throttle|accelerat\w*|brakes?|clutch|shift\w*|gear|neutral|reverse|handbrake|parking ?brake|ignition|starter|start engine|engine|horn|headlights?|lights?|wipers?|limiter|drs|kers|push to pass|p2p|overtake|signal|hazard|indicator|nitrous|flash|tear off|hand-up|tow)\b/,
  ],
];

export function racingCategory(label: string): RacingCategory {
  const name = label.toLowerCase();
  for (const [category, pattern] of RULES) if (pattern.test(name)) return category;
  return 'Other';
}
