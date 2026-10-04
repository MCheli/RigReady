import { DeviceLayoutSchema, layoutMatches, type DeviceLayout } from '../layout';
import { LayoutBuilder } from './builder';

/**
 * The layouts RigReady ships: hand-arranged starting points for devices whose shape is
 * well known. They are drawn here from scratch (no vendor artwork, no third-party
 * templates) and are CC0. Where a button's place is known from how devices of this model
 * are bound it is placed there; where it is not, the layout says so in its notes and the
 * user checks it by pressing the button and dragging the card.
 */

const WINWING = '4098';
const ASSUMED =
  'The places of some buttons are assumed. Press a button to see which card lights up, and drag it where it belongs in the layout editor.';

function mfd(): LayoutBuilder {
  const b = new LayoutBuilder(
    'WinWing MFD1 button frame',
    WINWING,
    ['BEE0', 'BEE1', 'BEE2'],
    1000,
    900,
    'Twenty buttons around the screen and a rocker in each corner, numbered as the frame reports them. Each label is on its button.'
  );
  // One card per control, and the card is the button: the frame is drawn by its own keys,
  // five along each edge of the screen and a rocker (up, down) in each corner.
  const edge = 24;
  const gap = 8;
  const side = 160;
  const band = 118;
  const screen = { x: edge + side + gap, y: edge + band + gap, w: 616, h: 600 };
  b.rect(12, 12, 976, 876, 44, 'body').rect(screen.x, screen.y, screen.w, screen.h, 12, 'screen');
  const far = { x: screen.x + screen.w + gap, y: screen.y + screen.h + gap };
  const across = (screen.w - 4 * gap) / 5;
  const down = (screen.h - 4 * gap) / 5;
  const top = [42, 40, 38, 36, 34];
  const bottom = [12, 14, 16, 18, 20];
  const left = [1, 3, 5, 7, 9];
  const right = [31, 29, 27, 25, 23];
  for (let i = 0; i < 5; i++) {
    const x = Math.round((screen.x + i * (across + gap)) * 10) / 10;
    const y = Math.round((screen.y + i * (down + gap)) * 10) / 10;
    b.button(top[i]!, x, edge, across, band, `OSB ${i + 1}`);
    b.button(bottom[i]!, x, far.y, across, band, `OSB ${15 - i}`);
    b.button(left[i]!, edge, y, side, down, `OSB ${20 - i}`);
    b.button(right[i]!, far.x, y, side, down, `OSB ${6 + i}`);
  }
  const rockers: [string, number, number, number, number][] = [
    ['GAIN', edge, edge, 43, 44],
    ['SYM', far.x, edge, 33, 32],
    ['BRT', edge, far.y, 10, 11],
    ['CON', far.x, far.y, 22, 21],
  ];
  const half = (band - 6) / 2;
  for (const [name, x, y, up, low] of rockers) {
    b.button(up, x, y, side, half, `${name} ▲`).button(
      low,
      x,
      y + half + 6,
      side,
      half,
      `${name} ▼`
    );
  }
  // The knob is not on the bezel; it is shown on the screen it belongs to.
  b.text(500, 330, 'MFD', 30, 'line');
  b.axis('SLIDER1', 344, 392, 312, 58, 'Knob');
  b.button(49, 344, 456, 153, 56, 'Knob ◄').button(50, 503, 456, 153, 56, 'Knob ►');
  return b;
}

function tpr(): LayoutBuilder {
  const b = new LayoutBuilder(
    'Thrustmaster TPR pedals',
    '044F',
    ['B68F'],
    1000,
    560,
    'Two toe brakes and the rudder axis.'
  );
  b.rect(150, 40, 260, 330, 28, 'body').rect(590, 40, 260, 330, 28, 'body');
  b.rect(190, 70, 180, 20, 6, 'panel').rect(630, 70, 180, 20, 6, 'panel');
  b.text(280, 130, 'LEFT', 22).text(720, 130, 'RIGHT', 22);
  b.line([120, 430, 880, 430], 'line').line([120, 420, 120, 440], 'line');
  b.line([880, 420, 880, 440], 'line').line([280, 370, 280, 430], 'line');
  b.line([720, 370, 720, 430], 'line');
  b.axis('Y', 165, 160, 230, 78, 'Left toe brake');
  b.axis('X', 605, 160, 230, 78, 'Right toe brake');
  b.axis('Z', 350, 452, 300, 78, 'Rudder');
  return b;
}

function stick(): LayoutBuilder {
  const b = new LayoutBuilder(
    'WinWing Orion 2 stick with F-16 grip',
    WINWING,
    ['BEA8'],
    1000,
    960,
    ASSUMED
  );
  // The grip from behind: a wide head with the hats, the trigger at the front, the base below.
  b.line(
    [
      430, 96, 470, 62, 560, 58, 598, 100, 600, 196, 570, 244, 556, 300, 552, 520, 588, 640, 588,
      706, 412, 706, 412, 640, 448, 520, 444, 300, 430, 244, 402, 200, 404, 130,
    ],
    'body',
    true
  );
  b.line([430, 244, 400, 264, 406, 304, 444, 300], 'line');
  b.ellipse(545, 100, 17, 17, 'panel').ellipse(500, 128, 13, 13, 'panel');
  b.ellipse(562, 160, 15, 15, 'panel').ellipse(548, 214, 15, 15, 'panel');
  b.ellipse(452, 160, 13, 13, 'panel');
  b.rect(340, 706, 320, 80, 14, 'panel');

  b.button(20, 20, 60, 290, 58, 'Weapon release', { x: 500, y: 128 });
  b.group('Mini-stick', 20, 128, 306, 196);
  b.axis('RX', 28, 152, 290, 52, 'Left / right', { x: 452, y: 160 });
  b.axis('RY', 28, 208, 290, 52, 'Up / down');
  b.button(26, 28, 264, 290, 52, 'Press');
  b.button(4, 20, 336, 290, 58, 'Trigger · first detent', { x: 416, y: 270 });
  b.button(5, 20, 400, 290, 58, 'Trigger · second detent', { x: 412, y: 286 });
  b.button(6, 20, 464, 290, 58, 'Side button', { x: 447, y: 392 });
  b.button(8, 20, 528, 290, 58, 'Paddle', { x: 452, y: 580 });
  b.axis('SLIDER1', 20, 596, 290, 60, 'Lever');
  b.axis('RZ', 20, 662, 290, 60, 'Twist');

  b.cross('TRIM hat', 'hat:1', 668, 60, 312, 196, { x: 545, y: 100 });
  b.cross('4-way 37–40', { U: 37, R: 38, D: 39, L: 40 }, 668, 266, 312, 196, { x: 562, y: 160 });
  b.cross('4-way 10–13', { U: 13, R: 10, D: 11, L: 12 }, 668, 472, 312, 196, { x: 548, y: 214 });

  b.group('Stick', 334, 798, 332, 140);
  b.axis('X', 342, 822, 316, 52, 'Roll');
  b.axis('Y', 342, 878, 316, 52, 'Pitch');
  b.rest('Other grip and base buttons', 954, 42);
  return b;
}

function throttle(): LayoutBuilder {
  const b = new LayoutBuilder(
    'WinWing Orion throttle with F-15EX handles',
    WINWING,
    ['BD26'],
    1000,
    720,
    ASSUMED
  );
  b.rect(372, 50, 112, 340, 34, 'body').rect(516, 50, 112, 340, 34, 'body');
  b.text(428, 96, 'L', 26).text(572, 96, 'R', 26);
  b.rect(336, 380, 328, 86, 14, 'panel');
  b.axis('RY', 20, 50, 300, 60, 'Left throttle', { x: 428, y: 200 });
  let y = b.stack('LEFT DETENTS', 20, 122, 300, [
    [31, 'IDLE'],
    [2, 'OFF'],
  ]);
  y = b.stack('3-WAY 3–5', 20, y + 10, 300, [[3], [4], [5]]);
  b.stack('4-WAY 6–9', 20, y + 10, 300, [[6], [7], [8], [9]]);
  b.axis('RX', 680, 50, 300, 60, 'Right throttle', { x: 572, y: 200 });
  y = b.stack('RIGHT DETENTS', 680, 122, 300, [
    [30, 'IDLE'],
    [1, 'OFF'],
  ]);
  b.group('Mini-stick', 680, y + 10, 300, 196);
  b.axis('X', 688, y + 34, 284, 52, 'Left / right', { x: 600, y: 300 });
  b.axis('Y', 688, y + 90, 284, 52, 'Up / down');
  b.button(35, 688, y + 146, 284, 52, 'Press');
  b.stack('3-WAY 22–24', 680, y + 216, 300, [[22], [23], [24]]);
  b.group('Base axes', 334, 478, 332, 196);
  b.axis('Z', 342, 502, 316, 52);
  b.axis('RZ', 342, 558, 316, 52);
  b.axis('SLIDER1', 342, 614, 316, 52);
  b.rest('Other handle and base buttons', 690, 62);
  return b;
}

function virpil(): LayoutBuilder {
  const b = new LayoutBuilder('Virpil Control Panel #1', '3344', ['C259'], 1000, 572, ASSUMED);
  b.rect(12, 10, 976, 552, 16, 'body');
  b.group('Buttons 1–12', 26, 22, 948, 146);
  b.row([1, 2, 3, 4, 5, 6], 34, 46, 150, 54, 6.4);
  b.row([7, 8, 9, 10, 11, 12], 34, 106, 150, 54, 6.4);
  // The switch cards are narrow, so they are tall: three rows of text fit at a size that reads.
  const tall = 58;
  for (let i = 0; i < 8; i++) {
    const n = 13 + i * 2;
    b.stack(`${n} · ${n + 1}`, 26 + i * 119, 180, 112, [[n], [n + 1]], tall);
  }
  b.stack('29 · 30', 26, 340, 150, [[29], [30]], tall);
  b.stack('31 · 32', 184, 340, 150, [[31], [32]], tall);
  [33, 36, 39].forEach((push, i) => {
    b.stack(
      `ENCODER ${i + 1}`,
      342 + i * 158,
      340,
      150,
      [
        [push + 1, '◄ turn'],
        [push, 'Push'],
        [push + 2, 'Turn ►'],
      ],
      tall
    );
  });
  b.group('Knobs', 816, 340, 158, 150);
  b.axis('SLIDER1', 822, 364, 146, 56);
  b.axis('SLIDER2', 822, 426, 146, 56);
  return b;
}

function ufc(): LayoutBuilder {
  const b = new LayoutBuilder(
    'WinWing UFC1 with HUD1 panel',
    WINWING,
    ['BEDE'],
    1000,
    1000,
    'The up-front controller above, the HUD control panel below, arranged as on the F/A-18C. Buttons the device reports beyond these are added below when something is bound to them.'
  );
  b.rect(12, 12, 976, 596, 18, 'body');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'ENT'];
  keys.forEach((key, i) => {
    b.button(2 + i, 34 + (i % 3) * 100, 40 + Math.floor(i / 3) * 66, 94, 60, key);
  });
  b.rect(346, 40, 336, 60, 8, 'screen').text(514, 78, 'SCRATCHPAD', 16);
  b.button(1, 346, 112, 108, 58, 'I/P').button(19, 460, 112, 108, 58, 'EMCON');
  b.group('ADF', 346, 182, 336, 92);
  b.row([39, 40, 41], 352, 206, 104, 60, 6, ['1', 'OFF', '2']);
  for (let i = 0; i < 5; i++) b.button(14 + i, 702, 40 + i * 60, 264, 54, `OPTION ${i + 1}`);
  const functions = ['A/P', 'IFF', 'TCN', 'ILS', 'D/L', 'BCN', 'ON/OFF'];
  b.row([20, 21, 22, 23, 24, 25, 26], 34, 352, 127.4, 58, 6.4, functions);
  b.group('COMM 1', 28, 426, 312, 168);
  b.axis('RX', 36, 450, 296, 62, 'Volume');
  b.row([27, 29, 28], 36, 518, 94.6, 66, 6, ['◄ CH', 'PULL', 'CH ►']);
  b.group('UFC', 352, 426, 296, 100);
  b.axis('RZ', 360, 450, 280, 66, 'Brightness');
  b.group('COMM 2', 660, 426, 312, 168);
  b.axis('RY', 668, 450, 296, 62, 'Volume');
  b.row([30, 32, 31], 668, 518, 94.6, 66, 6, ['◄ CH', 'PULL', 'CH ►']);

  b.rect(12, 624, 976, 364, 18, 'body');
  const x = (i: number): number => 28 + i * 158;
  b.stack('SYM REJECT', x(0), 640, 150, [
    [65, 'NORM'],
    [66, 'REJ 1'],
    [67, 'REJ 2'],
  ]);
  b.stack('SYM BRT', x(1), 640, 150, [
    [68, 'DAY'],
    [69, 'NIGHT'],
  ]);
  b.stack('VIDEO', x(2), 640, 150, [
    [70, 'W/B'],
    [71, 'VID'],
    [72, 'OFF'],
  ]);
  b.stack('ALT', x(3), 640, 150, [
    [73, 'BARO'],
    [74, 'RDR'],
  ]);
  b.stack('ATT', x(4), 640, 150, [
    [75, 'INS'],
    [76, 'AUTO'],
    [77, 'STBY'],
  ]);
  b.stack('HDG', x(5), 640, 150, [
    [80, '◄'],
    [78, '►'],
  ]);
  b.stack('CRS', x(5), 774, 150, [
    [83, '◄'],
    [81, '►'],
  ]);
  b.group('HUD knobs', 28, 826, 782, 150);
  b.axis('X', 36, 850, 380, 56, 'HUD brightness');
  b.axis('Y', 422, 850, 380, 56, 'Black level');
  b.axis('Z', 36, 912, 380, 56, 'Balance');
  b.axis('SLIDER2', 422, 912, 380, 56, 'AOA indexer');
  return b;
}

function icp(): LayoutBuilder {
  const b = new LayoutBuilder('WinWing ICP', WINWING, ['BF06'], 1000, 700, ASSUMED);
  b.rect(12, 12, 976, 520, 18, 'body');
  b.row([1, 2, 3, 4, 5, 6], 34, 36, 150, 58, 6.4, ['COM 1', 'COM 2', 'IFF', 'LIST', 'A-A', 'A-G']);
  const keys = ['1', '2', '3', 'RCL', '4', '5', '6', 'ENTR', '7', '8', '9', '0'];
  keys.forEach((key, i) => {
    b.button(7 + i, 34 + (i % 4) * 126, 112 + Math.floor(i / 4) * 66, 120, 60, key);
  });
  b.stack('ROCKER', 546, 106, 130, [
    [19, '▲'],
    [20, '▼'],
  ]);
  b.cross('DCS switch', { U: 21, R: 22, D: 23, L: 24 }, 684, 106, 290, 196);
  b.stack('DRIFT C/O', 546, 250, 130, [[25], [26], [27]]);
  b.group('Thumbwheels', 28, 318, 510, 150);
  b.axis('X', 36, 342, 244, 56).axis('Y', 286, 342, 244, 56);
  b.axis('RX', 36, 404, 244, 56).axis('RY', 286, 404, 244, 56);
  b.rest('Other buttons', 548, 34);
  return b;
}

function startup(): LayoutBuilder {
  const b = new LayoutBuilder(
    'WinWing F-18 startup panel',
    WINWING,
    ['BE03'],
    1000,
    830,
    'Switches grouped as they are named on the panel, one card per switch position.'
  );
  b.rect(8, 8, 984, 814, 16, 'body');
  const x = (i: number): number => 22 + i * 160;
  const w = 152;
  let y = 20;
  b.stack('FIRE TEST', x(0), y, w, [
    [1, 'TEST A'],
    [2, 'OFF'],
    [3, 'TEST B'],
  ]);
  [4, 9, 15, 18].forEach((first, i) => {
    b.stack(`GND PWR ${i + 1}`, x(1 + i), y, w, [
      [first, 'A ON'],
      [first + 1, 'AUTO'],
      [first + 2, 'B ON'],
    ]);
  });
  b.stack('EXT PWR', x(5), y, w, [
    [23, 'RESET'],
    [24, 'NORM'],
    [25, 'OFF'],
  ]);
  y = 204;
  b.stack('BATT', x(0), y, w, [
    [12, 'ON'],
    [13, 'OFF'],
    [14, 'ORIDE'],
  ]);
  b.stack('L GEN', x(1), y, w, [
    [7, 'NORM'],
    [8, 'OFF'],
  ]);
  b.stack('R GEN', x(2), y, w, [
    [21, 'NORM'],
    [22, 'OFF'],
  ]);
  b.stack('GEN TIE', x(3), y, w, [
    [34, 'NORM'],
    [35, 'RESET'],
  ]);
  b.stack('ENG ANTI ICE', x(4), y, w, [
    [28, 'ON'],
    [29, 'OFF'],
    [30, 'TEST'],
  ]);
  b.stack('PITOT', x(5), y, w, [
    [26, 'ON'],
    [27, 'AUTO'],
  ]);
  y = 388;
  b.stack('ENG CRANK', x(0), y, w, [
    [40, 'L'],
    [41, 'OFF'],
    [42, 'R'],
  ]);
  b.stack('APU', x(1), y, w, [
    [38, 'ON'],
    [39, 'OFF'],
  ]);
  b.stack('BLEED AIR', x(2), y, w, [
    [54, 'OFF'],
    [55, 'L OFF'],
    [56, 'NORM'],
    [57, 'R OFF'],
  ]);
  b.stack('PROBE', x(3), y, w, [
    [43, 'EXTEND'],
    [44, 'RETRACT'],
    [45, 'EMERG'],
  ]);
  b.stack('FUEL DUMP', x(4), y, w, [
    [52, 'ON'],
    [53, 'OFF'],
  ]);
  b.stack('STROBE', x(5), y, w, [
    [31, 'BRT'],
    [32, 'OFF'],
    [33, 'DIM'],
  ]);
  y = 622;
  b.stack('EXT WING', x(0), y, w, [
    [46, 'ORIDE'],
    [47, 'NORM'],
    [48, 'STOP'],
  ]);
  b.stack('EXT CTR', x(1), y, w, [
    [49, 'ORIDE'],
    [50, 'NORM'],
    [51, 'STOP'],
  ]);
  b.stack('INT WING', x(2), y, w, [
    [36, 'INHIBIT'],
    [37, 'NORM'],
  ]);
  b.group('EXT LIGHTS', x(3), y, 472, 150);
  b.axis('RX', x(3) + 8, y + 24, 456, 56, 'Formation');
  b.axis('RY', x(3) + 8, y + 86, 456, 56, 'Position');
  return b;
}

function takeoff(): LayoutBuilder {
  const b = new LayoutBuilder(
    'WinWing F-18 takeoff panel 2',
    WINWING,
    ['BF05'],
    1000,
    700,
    'Switches grouped as they are named on the panel, one card per switch position.'
  );
  b.rect(8, 8, 984, 690, 16, 'body');
  const x = (i: number): number => 22 + i * 160;
  const w = 152;
  let y = 20;
  b.stack('EMERG JETT', x(0), y, w, [[1, 'Push']]);
  b.stack('MASTER CAUTION', x(0), y + 88, w, [[2, 'Push']]);
  b.stack('LAUNCH BAR', x(1), y, w, [
    [4, 'EXTEND'],
    [3, 'RETRACT'],
  ]);
  b.stack('FLAP', x(2), y, w, [
    [5, 'AUTO'],
    [6, 'HALF'],
    [7, 'FULL'],
  ]);
  b.stack('LDG / TAXI LIGHT', x(3), y, w, [
    [8, 'ON'],
    [9, 'OFF'],
  ]);
  b.stack('ANTI SKID', x(4), y, w, [
    [10, 'ON'],
    [11, 'OFF'],
  ]);
  b.stack('HOOK BYPASS', x(5), y, w, [
    [12, 'FIELD'],
    [13, 'CARRIER'],
  ]);
  y = 204;
  b.stack('SEL JETT', x(0), y, w, [
    [17, 'L FUS MSL'],
    [18, 'SAFE'],
    [19, 'R FUS MSL'],
    [20, 'RACK/LCHR'],
    [21, 'STORES'],
  ]);
  b.stack('STATION JETT', x(1), y, w, [
    [23, 'CTR'],
    [24, 'LI'],
    [25, 'RI'],
    [26, 'LO'],
    [27, 'RO'],
  ]);
  b.stack('WING FOLD', x(2), y, w, [
    [28, 'FOLD'],
    [29, 'HOLD'],
    [30, 'SPREAD'],
    [31, 'PULL'],
  ]);
  b.stack('PARK BRAKE', x(3), y, w, [
    [38, 'STOW'],
    [39, 'PULL'],
    [40, 'CCW'],
    [41, 'CW'],
  ]);
  b.stack('HOOK', x(4), y, w, [[32, 'UP'], [33], [34, 'DOWN']]);
  b.stack('LDG GEAR', x(5), y, w, [[35, 'UP'], [36], [37, 'DOWN']]);
  b.stack('JETT', x(4), 388, w, [[22, 'Push']]);
  b.stack('3-WAY 14–16', x(5), 388, w, [[14], [15], [16]]);
  b.rest('Other buttons', 574, 64);
  return b;
}

function fanatec(): LayoutBuilder {
  // A Podium DD1 or DD2, and the ClubSport V2.5 a direct-drive base reports itself as in
  // compatibility mode: one driver, the same axes and button numbers.
  const b = new LayoutBuilder(
    'Fanatec wheel base (Podium, ClubSport)',
    '0EB7',
    ['0006', '0007', '0004'],
    1000,
    872,
    'Which buttons a wheel has depends on the rim that is mounted; the paddles, the pedals, ' +
      'the handbrake and a shifter plugged into the base are named the way the Fanatec driver ' +
      `usually reports them. ${ASSUMED}`
  );
  // The rim around the hub, a paddle and a button cluster either side of it.
  b.ellipse(500, 318, 218, 218, 'body').ellipse(500, 318, 190, 190, 'screen');
  b.line([500, 100, 500, 126], 'accent');
  b.axis('X', 350, 20, 300, 62, 'Steering');
  b.cross('D-pad', 'hat:1', 344, 216, 312, 204);
  // (A control is named with its frame: "Left side Paddle", "Shifter".)
  b.group('Left side', 14, 142, 262, 276);
  b.group('Right side', 724, 142, 262, 276);
  b.button(6, 22, 166, 246, 56, 'Paddle');
  b.button(5, 732, 166, 246, 56, 'Paddle');
  [1, 2, 3, 4].forEach((n, i) => {
    b.button(n, 22 + (i % 2) * 126, 228 + Math.floor(i / 2) * 62, 120, 56);
  });
  [7, 8, 9, 10, 11, 12].forEach((n, i) => {
    b.button(n, 732 + (i % 2) * 126, 228 + Math.floor(i / 2) * 62, 120, 56);
  });
  // A shifter on the base's own port shows up as buttons of the base, one per gear.
  b.group('Shifter', 14, 560, 972, 92);
  [13, 14, 15, 16, 17, 18, 19, 20].forEach((n, i) => {
    b.button(n, 22 + i * 120.5, 584, 114.5, 60);
  });
  b.group('Axes: pedals, handbrake', 14, 668, 972, 162);
  const axes: [string, string?][] = [
    ['Z', 'Throttle pedal'],
    ['RZ', 'Brake pedal'],
    ['Y', 'Clutch pedal'],
    ['SLIDER1', 'Handbrake'],
    ['RX'],
    ['RY'],
    ['SLIDER2'],
  ];
  axes.forEach(([name, label], i) => {
    b.axis(name, 22 + (i % 4) * 240, 692 + Math.floor(i / 4) * 66, 234, 60, label);
  });
  return b;
}

const BUILDERS = [mfd, stick, throttle, tpr, virpil, ufc, icp, startup, takeoff, fanatec];

export interface BuiltinLayouts {
  layouts: DeviceLayout[];
  /** A shipped layout that did not pass the schema: a bug, reported and skipped. */
  broken: { name: string; reason: string }[];
}

let cached: BuiltinLayouts | undefined;

/** The shipped layouts, validated like any imported file. */
export function builtinLayouts(): BuiltinLayouts {
  if (cached) return cached;
  const layouts: DeviceLayout[] = [];
  const broken: BuiltinLayouts['broken'] = [];
  for (const make of BUILDERS) {
    const raw = make().build();
    const parsed = DeviceLayoutSchema.safeParse(raw);
    if (parsed.success) layouts.push(parsed.data);
    else broken.push({ name: raw.name, reason: parsed.error.message });
  }
  cached = { layouts, broken };
  return cached;
}

export function builtinLayoutFor(
  vendorId: string | undefined,
  productId: string | undefined
): DeviceLayout | undefined {
  return builtinLayouts().layouts.find((layout) => layoutMatches(layout, vendorId, productId));
}
