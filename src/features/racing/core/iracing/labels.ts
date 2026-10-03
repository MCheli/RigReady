/**
 * Plain-language names for iRacing's binding action ids. The list of ids comes from the
 * file itself (367 on the owner's rig); the common ones have a hand-written label and
 * the rest are spelled out from their id ("BrakeBiasInc" -> "Brake bias up").
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
  BlackBoxToggle: 'Black box on/off',
  BlackBoxNext: 'Next black box',
  BlackBoxPrev: 'Previous black box',
  BlackBoxInc: 'Black box value up',
  BlackBoxDec: 'Black box value down',
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

const WORDS: Record<string, string> = {
  Inc: 'up',
  Dec: 'down',
  Level: '(axis)',
  Rpy: 'Replay',
  Cam: 'Camera',
  DCam: 'Driver camera',
  MGUK: 'MGU-K',
  ABS: 'ABS',
  DRS: 'DRS',
  FFB: 'force feedback',
  TChat: 'Text chat',
  VChat: 'Voice chat',
  SPCC: 'Spotter',
  LFE: 'LFE',
  FOV: 'field of view',
  UI: 'UI',
  RPM: 'RPM',
  FF: 'fast forward',
  Rew: 'rewind',
  Drv: 'driver',
  Q: 'queue',
  RF: 'right front',
  Hys: 'Hybrid',
  irsdk: 'telemetry',
  Irsdk: 'Telemetry',
};

/** "BrakeBiasFineInc" -> "Brake bias fine up". */
function spellOut(id: string): string {
  const tokens = id.match(
    /DCam|MGUK|TChat|VChat|SPCC|LFE|FOV|ABS|DRS|FFB|RPM|UI(?=[A-Z]|$)|RF(?=[A-Z])|irsdk|Irsdk|[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g
  ) ?? [id];
  const words = tokens.map((t, i) => {
    const mapped = WORDS[t];
    if (mapped) return mapped;
    return i === 0 ? t : /^[A-Z][a-z]/.test(t) ? t.toLowerCase() : t;
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
  if (
    /^(Throttle|Brake|Clutch|Steer|Shift|Gear|Ignition|Starter|PitSpeedLimiter|RevLimiter|PushToPass|DRS|Handbrake|Reset|Look|HeadlightFlash|ClutchLaunchAssist|TearOffVisor|.*Wipers|HandUpWarning|TellTaleReset)/.test(
      id
    )
  ) {
    return 'Driving';
  }
  if (
    /(Inc|Dec|Level|Toggle)$/.test(id) &&
    !/^(Cam|DCam|Rpy|Scale|BlackBox|Toggle|VChat|SPCC|LFE|TrueForce|Master)/.test(id)
  ) {
    return 'In-car adjustments';
  }
  if (/^(Cam|DCam|Rpy|NextRpy|PrevRpy|Focus|Group|NextDriving|PrevDriving|Recenter)/.test(id)) {
    return 'Cameras and replay';
  }
  return 'Interface and chat';
}

const VK: Record<number, string> = {
  8: 'Backspace',
  9: 'Tab',
  12: 'Num 5',
  13: 'Enter',
  19: 'Pause',
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
};

/**
 * Key names for iRacing's key codes. Letters, digits, arrows and the editing keys are
 * Windows virtual-key codes; F1 to F12 appear as 197 to 208. Modifier bits are read as
 * Shift 0x03, Ctrl 0x0C, Alt 0x30 (inferred from iRacing's documented defaults such as
 * Ctrl+Alt+Shift+S for a screenshot). Anything else is shown as its number.
 */
export function iracingKeyLabel(keyCode: number, modifiers: number): string {
  let key: string;
  if ((keyCode >= 48 && keyCode <= 57) || (keyCode >= 65 && keyCode <= 90)) {
    key = String.fromCharCode(keyCode);
  } else if (keyCode >= 197 && keyCode <= 208) {
    key = `F${keyCode - 196}`;
  } else {
    key = VK[keyCode] ?? `Key ${keyCode}`;
  }
  const parts: string[] = [];
  if (modifiers & 0x0c) parts.push('Ctrl');
  if (modifiers & 0x30) parts.push('Alt');
  if (modifiers & 0x03) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
