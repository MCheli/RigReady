/**
 * Curated lists of the actions that matter most, in priority tiers. An item is
 * satisfied when any action whose English name matches one of its patterns is bound
 * on a controller. Works without any AI key: these lists are shipped.
 */

export interface ImportantItem {
  id: string;
  title: string;
  /** One line on why it matters, shown to someone who does not know the aircraft. */
  why: string;
  /** Matched against the action's name. */
  patterns: RegExp[];
}

export interface ImportantTier {
  tier: number;
  title: string;
  items: ImportantItem[];
}

const item = (id: string, title: string, why: string, ...patterns: RegExp[]): ImportantItem => ({
  id,
  title,
  why,
  patterns,
});

const FA18C: ImportantTier[] = [
  {
    tier: 1,
    title: 'Fly and fight (HOTAS essentials)',
    items: [
      item('pitch', 'Pitch', 'Stick fore and aft.', /^Pitch$/),
      item('roll', 'Roll', 'Stick left and right.', /^Roll$/),
      item('rudder', 'Rudder', 'Pedals or stick twist.', /^Rudder$/),
      item(
        'thrust',
        'Throttle',
        'Both engines, or left and right separately.',
        /^Thrust( Left| Right)?$/
      ),
      item(
        'wheel-brakes',
        'Wheel brakes',
        'Toe brakes or a brake button, to stop on the runway and hold on the catapult.',
        /^Wheel Brake( Left| Right)?( - ON\/OFF)?$/
      ),
      item(
        'trim',
        'Trim',
        'The trim hat on the stick; needed on every carrier launch.',
        /^Trimmer Switch - /
      ),
      item(
        'trigger',
        'Gun trigger',
        'Fires the gun and air-to-air missiles.',
        /^Gun Trigger - SECOND DETENT/
      ),
      item(
        'pickle',
        'Weapon release',
        'Drops bombs and fires air-to-ground weapons.',
        /^Weapon Release Button$/
      ),
      item(
        'sensor-control',
        'Sensor Control Switch',
        'Chooses which display the TDC controls and commands radar modes: the most used switch on the stick.',
        /^Sensor Control Switch - /
      ),
      item(
        'weapon-select',
        'Weapon select',
        'Sparrow, Sidewinder, AMRAAM or gun.',
        /^Select (Sparrow|Gun|AMRAAM|Sidewinder)$/
      ),
      item(
        'tdc',
        'Throttle Designator Controller (TDC)',
        'Moves the cursor on the radar and targeting pod, and designates.',
        /^Throttle Designator Controller - /
      ),
      item(
        'undesignate',
        'Undesignate / nose wheel steering',
        'Drops a lock in the air; steers the nose wheel on the ground.',
        /^Undesignate\/Nose Wheel Steer Switch$/
      ),
    ],
  },
  {
    tier: 2,
    title: 'Sensors and defence',
    items: [
      item(
        'cage',
        'Cage/Uncage',
        'Uncages Sidewinder and Maverick seekers, toggles HUD cage.',
        /^Cage\/Uncage Button$/
      ),
      item('dispense', 'Countermeasures', 'Chaff and flares.', /^Dispense Switch - /),
      item(
        'speed-brake',
        'Speed brake',
        'Slows down for the break and for formation.',
        /^Speed Brake Switch - /
      ),
      item(
        'raid',
        'RAID / FLIR field of view',
        'Zooms the targeting pod and HARM display.',
        /^RAID\/FLIR FOV Select Button$/
      ),
      item(
        'radar-elevation',
        'Radar elevation',
        'Tilts the radar antenna up and down.',
        /^Radar Elevation Control/
      ),
    ],
  },
  {
    tier: 3,
    title: 'Communications',
    items: [
      item(
        'comm1',
        'COMM 1',
        'Talks on radio 1 and opens the radio menu.',
        /^COMM Switch - COMM 1/
      ),
      item('comm2', 'COMM 2', 'Talks on radio 2.', /^COMM Switch - COMM 2/),
    ],
  },
  {
    tier: 4,
    title: 'Systems',
    items: [
      item(
        'paddle',
        'Autopilot / NWS disengage (paddle)',
        'Disengages the autopilot and nose wheel steering.',
        /^Autopilot\/Nosewheel Steering Disengage/
      ),
      item(
        'atc',
        'Automatic throttle (ATC)',
        'Engages auto-throttle for approach and cruise.',
        /^ATC Engage\/Disengage Switch$/
      ),
      item('gear', 'Landing gear', 'Gear up and down.', /^Landing Gear Control Handle/),
      item('flaps', 'Flaps', 'AUTO, HALF and FULL.', /^FLAP Switch/),
      item('hook', 'Arresting hook', 'Needed for every carrier landing.', /^Arresting Hook Handle/),
      item('launch-bar', 'Launch bar', 'Connects to the catapult.', /^Launch Bar Control Switch/),
      item('master-arm', 'Master Arm', 'Arms the weapons.', /^Master Arm Switch/),
      item(
        'master-mode',
        'Master mode A/A and A/G',
        'Switches between air-to-air and air-to-ground.',
        /^Master Mode Button - /
      ),
      item(
        'exterior-lights',
        'Exterior lights switch',
        'The throttle switch that turns every exterior light on or off.',
        /^Exterior Lights Switch/
      ),
    ],
  },
  {
    tier: 5,
    title: 'View',
    items: [
      item(
        'view-center',
        'Centre the view',
        'Recentres the view when not using head tracking.',
        /^View Center$/
      ),
      item(
        'zoom',
        'Zoom',
        'Zooms the cockpit view in and out.',
        /^Zoom (in|out)( slow)?$/,
        /^Zoom View$/
      ),
    ],
  },
];

const UH1H: ImportantTier[] = [
  {
    tier: 1,
    title: 'Flight controls',
    items: [
      item('cyclic-pitch', 'Cyclic pitch', 'Stick fore and aft.', /^Flight Control Cyclic Pitch$/),
      item('cyclic-roll', 'Cyclic roll', 'Stick left and right.', /^Flight Control Cyclic Roll$/),
      item('pedals', 'Anti-torque pedals', 'Rudder pedals.', /^Flight Control Rudder$/),
      item(
        'collective',
        'Collective',
        'The lever that makes the helicopter climb; usually the throttle axis.',
        /^Flight Control Collective$/
      ),
      item(
        'trimmer',
        'Force trim',
        'Holds the cyclic where it is; used constantly in the Huey.',
        /^Pilot Trimmer$/,
        /^Force Trim Switch$/
      ),
    ],
  },
  {
    tier: 2,
    title: 'Weapons',
    items: [
      item(
        'fire',
        'Weapon release',
        'Fires rockets and guns.',
        /^Pilot weapon release\/Machinegun fire$/
      ),
      item(
        'armament',
        'Armament Off/Safe/Armed',
        'Arms the weapons.',
        /^Armament Off\/Safe\/Armed/
      ),
      item('flare', 'Flares', 'Dispenses flares.', /Flare Dispense/i),
    ],
  },
  {
    tier: 3,
    title: 'Communications',
    items: [
      item(
        'radio',
        'Radio trigger',
        'Talks on the selected radio and opens the radio menu.',
        /^Pilot's radio trigger RADIO/
      ),
      item('ics', 'Intercom trigger', 'Talks to the crew.', /^Pilot's radio trigger ICS/),
    ],
  },
  {
    tier: 4,
    title: 'Systems',
    items: [
      item(
        'throttle',
        'Throttle twist grip',
        'Engine throttle on the collective.',
        /^Throttle$/,
        /^Throttle (Up|Down)$/
      ),
      item(
        'governor-rpm',
        'Governor RPM',
        'Increases and decreases rotor RPM.',
        /^(Increase|Decrease) Turbine RPM$/
      ),
      item('start', 'Engine start', 'The starter trigger on the collective.', /^Start-up engine$/),
      item(
        'landing-light',
        'Landing and search lights',
        'For night landings.',
        /^Landing Light Switch$/,
        /^Search light On$/
      ),
    ],
  },
  {
    tier: 5,
    title: 'View',
    items: [
      item(
        'view-center',
        'Centre the view',
        'Recentres the view when not using head tracking.',
        /^Center View$/,
        /^View Center$/
      ),
      item('zoom', 'Zoom', 'Zooms the cockpit view in and out.', /^Zoom (in|out)( slow)?$/),
    ],
  },
];

/** For aircraft without a curated list: what every aircraft needs. */
const GENERIC: ImportantTier[] = [
  {
    tier: 1,
    title: 'Flight controls',
    items: [
      item('pitch', 'Pitch', 'Stick fore and aft.', /\bPitch$/),
      item('roll', 'Roll', 'Stick left and right.', /\bRoll$/),
      item('rudder', 'Rudder', 'Pedals or stick twist.', /\bRudder$/),
      item(
        'thrust',
        'Throttle',
        'Engine power, or collective in a helicopter.',
        /^Thrust/,
        /\bThrottle$/,
        /Collective$/
      ),
      item('trim', 'Trim', 'Trim up, down, left and right.', /\bTrim/i),
      item('wheel-brakes', 'Wheel brakes', 'To stop on the runway.', /^Wheel Brake/i),
    ],
  },
  {
    tier: 2,
    title: 'Systems',
    items: [
      item('gear', 'Landing gear', 'Gear up and down.', /Landing Gear/i, /^Gear/i),
      item('flaps', 'Flaps', 'Flaps up and down.', /\bFlaps?\b/i),
    ],
  },
  {
    tier: 3,
    title: 'Communications',
    items: [
      item(
        'comms',
        'Radio',
        'Opens the radio menu or keys the radio.',
        /Communication menu/i,
        /\bPTT\b/,
        /\bCOMM\b/,
        /radio trigger/i
      ),
    ],
  },
  {
    tier: 4,
    title: 'View',
    items: [
      item(
        'view-center',
        'Centre the view',
        'Recentres the view when not using head tracking.',
        /^View Center$/,
        /^Center View$/
      ),
      item('zoom', 'Zoom', 'Zooms the cockpit view in and out.', /^Zoom (in|out)/i),
    ],
  },
];

const CURATED: Record<string, ImportantTier[]> = {
  'FA-18C_hornet': FA18C,
  'UH-1H': UH1H,
};

/** The priority list for an aircraft: curated for the F/A-18C and UH-1H, generic otherwise. */
export function importantActions(aircraftId: string): { curated: boolean; tiers: ImportantTier[] } {
  const tiers = CURATED[aircraftId];
  return tiers ? { curated: true, tiers } : { curated: false, tiers: GENERIC };
}
