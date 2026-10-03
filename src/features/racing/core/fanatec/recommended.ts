/**
 * Recommended wheel settings per game, with where each recommendation comes from. The
 * Fanatec forum is not machine-readable, so this table is maintained by hand from the
 * sources listed (docs/research/racing.md 5.4). Base values are set on the wheel and
 * cannot be read by RigReady; in-game values are compared where a file holds them.
 */

export const TUNING_PARAMETERS: { id: string; name: string; meaning: string }[] = [
  {
    id: 'SEN',
    name: 'Sensitivity',
    meaning: 'Steering rotation in degrees, or AUT to let the game set it',
  },
  { id: 'FF', name: 'Force feedback', meaning: 'Overall force strength, %' },
  { id: 'FFS', name: 'Force feedback scale', meaning: 'Linear (Lin) or peak (Pea) scaling' },
  { id: 'NDP', name: 'Natural damper', meaning: 'Resistance that grows with wheel speed' },
  { id: 'NFR', name: 'Natural friction', meaning: 'Constant resistance' },
  { id: 'NIN', name: 'Natural inertia', meaning: 'Simulated weight of the wheel' },
  { id: 'INT', name: 'Interpolation filter', meaning: 'Smooths the force signal' },
  { id: 'FEI', name: 'Force effect intensity', meaning: 'Sharpness of the forces' },
  { id: 'FOR', name: 'Force effect', meaning: "Strength of the game's constant force" },
  { id: 'SPR', name: 'Spring effect', meaning: "Strength of the game's spring effect" },
  { id: 'DPR', name: 'Damper effect', meaning: "Strength of the game's damper effect" },
  { id: 'BLI', name: 'Brake level indicator', meaning: 'Brake pressure at which the rim vibrates' },
  { id: 'SHO', name: 'Shock (vibration)', meaning: 'Strength of rim and pedal vibration' },
  { id: 'BRF', name: 'Brake force', meaning: 'Load-cell brake force' },
];

export interface Recommendation {
  /** "base": set on the wheel. "game": set in the game's own settings. */
  where: 'base' | 'game';
  /** A TUNING_PARAMETERS id for base values, a plain name for game values. */
  param: string;
  value: string;
  note?: string;
  /** For in-game values RigReady can read: which reading to compare with. */
  readable?: string;
  /** Concrete value the readable setting should have, for the comparison check. */
  expect?: string;
}

export interface GameRecommendation {
  game: 'iracing' | 'lmu' | 'beamng';
  name: string;
  source: { title: string; url: string; official: boolean };
  /** Other sources consulted. */
  also?: { title: string; url: string }[];
  retrieved: string;
  caveat?: string;
  rows: Recommendation[];
}

export const RECOMMENDATIONS: GameRecommendation[] = [
  {
    game: 'iracing',
    name: 'iRacing',
    source: {
      title: 'iRacing PC – Fanatec recommended settings (Fanatec forum)',
      url: 'https://forum.fanatec.com/discussion/653/iracing-pc-fanatec-recommended-settings',
      official: true,
    },
    retrieved: '2026-10-03',
    caveat:
      'The values were taken from the Podium DD1 entry of the forum post; the DD2 entry is in the same post. Check it on the page before relying on it.',
    rows: [
      { where: 'base', param: 'SEN', value: '1080' },
      { where: 'base', param: 'FF', value: '90' },
      { where: 'base', param: 'FFS', value: 'Lin' },
      { where: 'base', param: 'NDP', value: '16' },
      { where: 'base', param: 'NFR', value: '2' },
      { where: 'base', param: 'NIN', value: '8' },
      { where: 'base', param: 'INT', value: '3' },
      { where: 'base', param: 'FEI', value: '100' },
      { where: 'base', param: 'FOR', value: '100' },
      { where: 'base', param: 'SPR', value: '100' },
      { where: 'base', param: 'DPR', value: '100' },
      { where: 'base', param: 'BLI', value: 'Your choice' },
      { where: 'base', param: 'SHO', value: '100' },
      { where: 'base', param: 'BRF', value: 'Your choice' },
      { where: 'game', param: 'Use linear mode', value: 'On' },
      { where: 'game', param: 'Reduce force when parked', value: 'On' },
      {
        where: 'game',
        param: 'Strength',
        value: '6.0',
        note: 'Per car, with "Use custom controls for this car"',
      },
      { where: 'game', param: 'Wheel force', value: '20 Nm' },
      { where: 'game', param: 'Damping', value: '0 %' },
      { where: 'game', param: 'Min force', value: '0 %' },
    ],
  },
  {
    game: 'lmu',
    name: 'Le Mans Ultimate',
    source: {
      title: 'Fanatec settings for Le Mans Ultimate (Coach Dave Academy)',
      url: 'https://coachdaveacademy.com/tutorials/fanatec-settings-for-le-mans-ultimate/',
      official: false,
    },
    also: [
      {
        title: 'rFactor 2 PC – Fanatec recommended settings (same engine)',
        url: 'https://forum.fanatec.com/topic/546-rfactor-2-pc-fanatec-recommended-settings/p1',
      },
    ],
    retrieved: '2026-10-03',
    caveat: 'Fanatec publishes no recommendation for Le Mans Ultimate; these are community values.',
    rows: [
      {
        where: 'base',
        param: 'SEN',
        value: 'AUT',
        note: 'The game reads the rotation from the Fanatec driver',
      },
      { where: 'base', param: 'NDP', value: '5–10' },
      { where: 'base', param: 'INT', value: '1–2' },
      { where: 'base', param: 'FEI', value: '80–100' },
      { where: 'game', param: 'Force feedback strength', value: '85–90 %' },
      {
        where: 'game',
        param: 'Smoothing',
        value: '0',
        readable: 'Steering torque filter',
        expect: '0',
      },
      {
        where: 'game',
        param: 'Minimum torque',
        value: '0 %',
        readable: 'Steering torque minimum',
        expect: '0',
      },
      {
        where: 'game',
        param: 'Rotation from the wheel driver',
        value: 'On',
        readable: 'Steering Wheel Maximum Rotation From Driver',
        expect: 'On',
      },
    ],
  },
  {
    game: 'beamng',
    name: 'BeamNG.drive',
    source: {
      title: 'Finding the best settings for your Fanatec base (Fanatec)',
      url: 'https://www.fanatec.com/eu/hu/explorer/products/racing-wheels-wheel-bases/finding-the-best-settings-for-your-fanatec-base/',
      official: true,
    },
    retrieved: '2026-10-03',
    caveat: "BeamNG.drive is not in Fanatec's game list; this is Fanatec's general guide.",
    rows: [
      { where: 'base', param: 'SEN', value: 'AUT' },
      { where: 'base', param: 'FF', value: '100' },
      { where: 'base', param: 'FOR', value: '100' },
      { where: 'base', param: 'NDP', value: 'about 15' },
      { where: 'base', param: 'NFR', value: 'about 5' },
      { where: 'base', param: 'NIN', value: 'Off' },
      { where: 'base', param: 'INT', value: '2' },
      {
        where: 'game',
        param: 'Force feedback',
        value: 'On',
        readable: 'Force feedback',
        expect: 'On',
      },
      {
        where: 'game',
        param: 'Steering rotation',
        value: "The same as the base's SEN",
        readable: 'Steering rotation (degrees)',
        note: 'Compared with the SEN of your recorded preset',
      },
    ],
  },
];
