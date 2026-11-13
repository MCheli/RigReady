/**
 * Plain-language names for iRacing's action ids and key codes. The ids come from the file
 * itself (367 on the recorded rig); the common ones have a hand-written name and the rest
 * are spelled out from their id ("BrakeBiasInc" -> "Brake bias up").
 *
 * The racing feature names the same actions for cheat sheets with a table this one started
 * from, and a feature may not import another, so the table is here a second time. This copy
 * has later corrections (short forms written out, brake bias under the adjustments); the two
 * belong in one place in core. names.test.ts holds the names users see.
 */

const LABELS: Record<string, string> = {
  Throttle: 'Throttle',
  Brake: 'Brake',
  Clutch: 'Clutch',
  SteerLeft: 'Steer left',
  SteerRight: 'Steer right',
  ShiftUp: 'Shift up',
  ShiftDown: 'Shift down',
  GearReverse: 'Reverse gear',
  GearNeutral: 'Neutral',
  Ignition: 'Ignition',
  Starter: 'Starter',
  TellTaleReset: 'Reset tell-tale',
  PitSpeedLimiter: 'Pit speed limiter',
  RevLimiter: 'Rev limiter',
  PushToPass: 'Push to pass',
  DRS: 'DRS',
  TractionControlArm: 'Arm traction control',
  Handbrake: 'Handbrake',
  Reset: 'Reset car',
  LookLeft: 'Look left',
  LookRight: 'Look right',
  LookUp: 'Look up',
  LookDown: 'Look down',
  HandUpWarning: 'Hand-up warning',
  TearOffVisor: 'Tear off visor',
  ToggleWindshieldWipers: 'Wipers on/off',
  TriggerWindshieldWipers: 'Wipe once',
  ClutchLaunchAssist: 'Launch control',
  HeadlightFlash: 'Flash headlights',
  AutoFFB: 'Auto force feedback strength',
  IncFFB: 'Force feedback stronger',
  DecFFB: 'Force feedback weaker',
  TChatInitiate: 'Text chat',
  TChatReply: 'Reply in chat',
  TChatToggle: 'Show chat',
  NextDrivingCam: 'Next camera',
  PrevDrivingCam: 'Previous camera',
  Pause: 'Pause',
  RecenterHeadMountedDisplay: 'Recenter VR view',
  RecenterTiltAxis: 'Recenter head tracking',
  ToggleVirtualMirror: 'Virtual mirror',
  ToggleDrivingLine: 'Racing line',
  ToggleRadar: 'Car radar',
  ToggleUIVisible: 'Hide or show the UI',
  ToggleRefCar: 'Reference car',
  ReloadCarTexture: 'Reload car paint',
  SplitsDeltaNext: 'Next delta mode',
  SplitsDeltaPrev: 'Previous delta mode',
  DashBoxToggle: 'Dash box',
  // iRacing's "Next Black Box" and "Previous Black Box", unassigned by default, are
  // BlackBoxShowNext and BlackBoxShowPrev. The arrows and Space work inside the box shown:
  // BlackBoxNext is Down, "select next control" (docs/research/iracing-bindings.md).
  BlackBoxShowNext: 'Next black box',
  BlackBoxShowPrev: 'Previous black box',
  BlackBoxToggle: 'Black box toggle control',
  BlackBoxNext: 'Black box next control',
  BlackBoxPrev: 'Black box previous control',
  BlackBoxInc: 'Black box value up',
  BlackBoxDec: 'Black box value down',
  PitSummaryToggle: 'Pit summary on/off',
  ToggleUIVisibleDrive: 'Hide or show the driving UI',
  TriggerScreenshotCapture: 'Screenshot',
  TriggerGiantScreenshotCapture: 'High-resolution screenshot',
  ToggleVideoCapture: 'Record video',
  ReportLatency: 'Report latency',
  IrsdkDriverMarker: 'Telemetry marker',
  ToggleirsdkDiskLogging: 'Telemetry logging',
  VChatPushToTalk: 'Push to talk',
  LowFuelAccept: 'Accept low fuel warning',
  FCYToggle: 'Full-course yellow mode',
  InLapToggle: 'In-lap mode',
};

/** Short forms in the ids, written out. Lower case unless the word is always in capitals. */
const WORDS: Record<string, string> = {
  Inc: 'up',
  Dec: 'down',
  Rpy: 'replay',
  Cam: 'camera',
  DCam: 'driver camera',
  MGUK: 'MGU-K',
  ABS: 'ABS',
  DRS: 'DRS',
  FFB: 'force feedback',
  TChat: 'text chat',
  VChat: 'voice chat',
  SPCC: 'spotter',
  LFE: 'LFE',
  FOV: 'field of view',
  UI: 'UI',
  RPM: 'RPM',
  IR: 'IR',
  FF: 'fast forward',
  Rew: 'rewind',
  Adv: 'advance',
  Drv: 'driver',
  Q: 'queue',
  // The tape over the grille for qualifying, not a queue.
  QTape: 'qualifying tape',
  RF: 'right front',
  Hys: 'hybrid',
  irsdk: 'telemetry',
  Irsdk: 'telemetry',
  Prev: 'previous',
  Anounce: 'announce',
  Cust: 'custom',
  Sect: 'sector',
  Pct: 'percent',
  Lat: 'latitude',
  Long: 'longitude',
  Alt: 'altitude',
  Pos: 'position',
  Ctrl: 'control',
  Mult: 'multiplier',
  Accel: 'acceleration',
};

/** "BrakeBiasFineInc" -> "Brake bias fine up". */
function spellOut(id: string): string {
  const tokens = id.match(
    /DCam|MGUK|TChat|VChat|SPCC|LFE|FOV|ABS|DRS|FFB|RPM|QTape|UI(?=[A-Z]|$)|RF(?=[A-Z])|irsdk|Irsdk|[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g
  ) ?? [id];
  const words = tokens.map((t, i) => {
    // "...Level" at the end is the axis form of an adjustment; "BoostLevelInc" is not.
    if (t === 'Level' && i === tokens.length - 1 && i > 0) return '(axis)';
    const mapped = WORDS[t];
    if (mapped) return mapped;
    return /^[A-Z][a-z]/.test(t) ? t.toLowerCase() : t;
  });
  const text = words.join(' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function iracingActionLabel(id: string): string {
  const label = LABELS[id];
  if (label) return label;
  // "Throttle2", "ShiftUp2": the secondary binding of an action.
  const secondary = /^(.*\D)2$/.exec(id);
  if (secondary && LABELS[secondary[1]!]) return `${LABELS[secondary[1]!]} (second binding)`;
  const gear = /^Gear(\d+)$/.exec(id);
  if (gear) return `Gear ${gear[1]}`;
  const chat = /^AutoChat(\d+)$/.exec(id);
  if (chat) return `Chat macro ${chat[1]}`;
  const box = /^BlackBoxF(\d+)$/.exec(id);
  if (box) return `Black box ${box[1]}`;
  return spellOut(id);
}

/** Which part of the car or app an action belongs to, for grouping the list. */
export function iracingActionGroup(
  id: string
): 'Driving' | 'In-car adjustments' | 'Cameras and replay' | 'Interface and chat' {
  // The controls themselves. "BrakeBiasInc" and "ThrottleShapeLevel" are adjustments.
  if (
    /^((Throttle|Brake|Clutch|ShiftUp|ShiftDown)2?|Steer(Left|Right)|Gear\w+|Ignition|Starter|PitSpeedLimiter|RevLimiter|PushToPass|DRS|Handbrake|Reset|Look\w+|HeadlightFlash|ClutchLaunchAssist|TearOffVisor|\w+Wipers|HandUpWarning|TellTaleReset|Hys\w+Hold)$/.test(
      id
    )
  ) {
    return 'Driving';
  }
  if (
    (/(Inc|Dec|Level|Toggle)$/.test(id) &&
      !/^(Cam|DCam|Rpy|Scale|BlackBox|DashBox|Toggle|TChat|VChat|SPCC|LFE|TrueForce|Master)/.test(
        id
      )) ||
    id === 'TractionControlArm' ||
    id === 'LowFuelAccept'
  ) {
    return 'In-car adjustments';
  }
  if (/^(Cam|DCam|Rpy|NextRpy|PrevRpy|Focus|Group|NextDriving|PrevDriving|Recenter)/.test(id)) {
    return 'Cameras and replay';
  }
  return 'Interface and chat';
}

/**
 * iRacing's own key codes, as its program lists them (docs/research/racing.md 2.4). Letters,
 * digits, arrows and the editing keys are Windows virtual-key codes; punctuation is 96 to 127,
 * the number pad 176 to 190 (and 12 for its 5), F1 to F16 197 to 212.
 */
const KEYS: Record<number, string> = {
  8: 'Backspace',
  9: 'Tab',
  12: 'Num 5',
  13: 'Enter',
  16: 'Left Shift',
  17: 'Left Ctrl',
  18: 'Left Alt',
  19: 'Pause',
  20: 'Caps Lock',
  27: 'Esc',
  32: 'Space',
  33: 'Page Up',
  34: 'Page Down',
  35: 'End',
  36: 'Home',
  37: 'Left',
  38: 'Up',
  39: 'Right',
  40: 'Down',
  44: 'Print Screen',
  45: 'Insert',
  46: 'Delete',
  91: 'Left Win',
  92: 'Right Win',
  93: 'Menu',
  176: 'Num 9',
  177: 'Num 3',
  178: 'Num 1',
  179: 'Num 7',
  180: 'Num 4',
  181: 'Num 8',
  182: 'Num 6',
  183: 'Num 2',
  184: 'Num 0',
  185: 'Num .',
  186: 'Num /',
  187: 'Num *',
  188: 'Num -',
  189: 'Num +',
  190: 'Num Enter',
  191: 'Back Tab',
  192: 'Right Shift',
  193: 'Right Ctrl',
  194: 'Right Alt',
  195: 'Num Lock',
  196: 'Scroll Lock',
  213: 'Browser Back',
  214: 'Browser Forward',
  215: 'Browser Refresh',
  216: 'Browser Stop',
  217: 'Browser Search',
  224: 'Browser Favorites',
  225: 'Browser Home',
  226: 'Volume Mute',
  227: 'Volume Down',
  228: 'Volume Up',
  229: 'Next Track',
  230: 'Previous Track',
  231: 'Media Stop',
  232: 'Play/Pause',
  233: 'Mail',
  240: 'Media Select',
  241: 'App 1',
  242: 'App 2',
};

/** Codes 96 to 127: the punctuation keys, in iRacing's order. */
const PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
/** Codes 128 to 172: the letters and signs of other keyboard layouts, in iRacing's order. */
const OTHER_LAYOUTS = '¡¢£¤¥¦§¨ªº²³´µ¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖÙÚÛÜÝßÿ';

/** The name of a key code iRacing's own table has; undefined for any other number. */
function tableName(keyCode: number): string | undefined {
  if (!Number.isInteger(keyCode)) return undefined;
  if ((keyCode >= 48 && keyCode <= 57) || (keyCode >= 65 && keyCode <= 90)) {
    return String.fromCharCode(keyCode);
  }
  if (keyCode >= 197 && keyCode <= 212) return `F${keyCode - 196}`;
  return (
    KEYS[keyCode] ??
    (keyCode >= 96 ? PUNCTUATION[keyCode - 96] : undefined) ??
    (keyCode >= 128 ? OTHER_LAYOUTS[keyCode - 128] : undefined)
  );
}

// A code iRacing's own table does not have is shown as its number.
const keyName = (keyCode: number): string => tableName(keyCode) ?? `Key ${keyCode}`;

/** Whether iRacing's own table has this key code. Nothing else is ever written as a key. */
export const iracingKeyKnown = (keyCode: number): boolean => tableName(keyCode) !== undefined;

/** iRacing's code for a punctuation key, by the character the key types without Shift. */
export function iracingPunctuationCode(character: string): number | undefined {
  const at = character.length === 1 ? PUNCTUATION.indexOf(character) : -1;
  return at < 0 ? undefined : 96 + at;
}

/**
 * The key of an iRacing keyboard binding, with its modifiers. Each modifier has two bits:
 * Shift 0x03, Ctrl 0x0C, Alt 0x30 (checked against the shortcuts iRacing publishes: Alt+L,
 * Ctrl+R, Ctrl+PageUp and Shift with a bracket are stored that way).
 */
export function iracingKeyLabel(keyCode: number, modifiers: number): string {
  const parts: string[] = [];
  if (modifiers & 0x0c) parts.push('Ctrl');
  if (modifiers & 0x30) parts.push('Alt');
  if (modifiers & 0x03) parts.push('Shift');
  parts.push(keyName(keyCode));
  return parts.join('+');
}

/**
 * A binding as it reads inside a sentence: "Button 5 on Button Box", "Ctrl+R on the
 * keyboard", "Not bound".
 */
export function inWords(
  binding: { kind: string; input: string; deviceName: string } | undefined
): string {
  if (!binding) return 'Not bound';
  if (binding.kind === 'key') return `${binding.input} on the keyboard`;
  return binding.deviceName ? `${binding.input} on ${binding.deviceName}` : binding.input;
}

/** "A", "A and B", "A, B and C". */
export const listed = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Every car a change to a set reaches, in words, so the page never claims less than it
 * changes: "all cars", "mx5 mx52016", or for a control profile that several cars use,
 * "cadillacctsvr and bmwm4gt3, which share the profile “Test Profile CTSV”".
 */
export function setScope(set: {
  general: boolean;
  name: string;
  profile?: string | undefined;
  sharedWith?: string[] | undefined;
}): string {
  if (set.general) return 'all cars';
  const others = set.sharedWith ?? [];
  if (others.length === 0) return set.name;
  return `${listed([set.name, ...others])}, which share the profile “${set.profile ?? ''}”`;
}
