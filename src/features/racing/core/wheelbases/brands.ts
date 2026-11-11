import path from 'node:path';
import type { KnownFolders } from '../../../../core/ports';
import type { WheelBrandId } from '../../contract';

/**
 * What RigReady knows about each wheel brand beyond its USB ids (./products.ts): the maker's
 * software, what it is needed for, where it keeps profiles, what each axis is, and whether
 * the USB id tells the PC mode from a console one. Sources: docs/research/wheelbases.md.
 *
 * `verifiedOnHardware` is true only for a brand someone has run RigReady with on a real
 * wheel. Every other brand is tested on synthetic fixtures, and the page says so.
 */

export interface BrandSoftware {
  id: string;
  /** "MOZA Pit House". */
  name: string;
  /** Matches the DisplayName of its uninstall entry. */
  uninstall?: RegExp;
  /** Its process image name, when it is a program that runs. */
  process?: string;
  /** Its Windows service, when it has one. */
  service?: string;
  /** Where its program usually is, to start it from. */
  exe?: (folders: KnownFolders) => string[];
  /** What it does for the wheel, in a few words. */
  purpose: string;
}

export interface ProfileLocation {
  label: string;
  path: (folders: KnownFolders) => string;
  kind: 'file' | 'folder';
  description: string;
}

export interface WheelBrand {
  id: WheelBrandId;
  name: string;
  verifiedOnHardware: boolean;
  /** True when the USB product id says whether the base is in PC mode. */
  modeDetectable: boolean;
  /** The PC mode in words, when it can be told. */
  pcModeLabel: string;
  /** What to do when the id shows another mode. */
  modeHelp?: string;
  /** Why games may see the base as more than one controller. */
  controllersNote?: string;
  /** DirectInput axis -> what it is, on the base, where a source says so. */
  baseAxes?: Record<string, string>;
  software: BrandSoftware[];
  /** One line: what the software is needed for. */
  softwareNote: string;
  /** Profile files of its software that are plain files a backup can copy. */
  profiles: ProfileLocation[];
  /** Programs that hold the profile files: closed before a restore, started again after. */
  holders?: { name: string; processes: string[]; why: string };
  /** Settings per game the brand itself publishes. Linked, never copied or compared. */
  recommendedLinks?: { game: string; title: string; url: string }[];
}

const pf = (f: KnownFolders, ...parts: string[]): string => path.join(f.programFiles(), ...parts);
const pf86 = (f: KnownFolders, ...parts: string[]): string =>
  path.join(f.programFilesX86(), ...parts);

export const WHEEL_BRAND_LIST: WheelBrand[] = [
  {
    id: 'fanatec',
    name: 'Fanatec',
    verifiedOnHardware: true,
    modeDetectable: true,
    pcModeLabel: 'PC (red) mode',
    modeHelp:
      "The base is in compatibility (yellow) mode and reports itself as a ClubSport Wheel Base V2.5. Bindings saved in PC mode do not match it in iRacing, Le Mans Ultimate or BeamNG.drive. Switch it to PC (red) mode in the base's menu or the Fanatec App.",
    controllersNote:
      'A Podium base normally shows up as two controllers with the same name; both are the base, not a duplicate, and games use the first.',
    baseAxes: {
      X: 'Wheel',
      Y: 'Combined pedals',
      Z: 'Accelerator',
      RX: 'X rotation',
      RY: 'Y rotation',
      RZ: 'Brake',
      S0: 'Clutch',
      S1: 'Dial',
    },
    // The Fanatec rows are built by ../fanatec/fanatec.ts, which reads more than this list.
    software: [],
    softwareNote:
      'The Fanatec driver is needed for force feedback. The Fanatec Service and App are for LEDs, rim displays, game profiles and tuning from the PC.',
    profiles: [],
  },
  {
    id: 'moza',
    name: 'Moza',
    verifiedOnHardware: false,
    // Each Moza base has two ids and no source says what the second means.
    modeDetectable: false,
    pcModeLabel: 'PC mode',
    software: [
      {
        id: 'moza-pit-house',
        name: 'MOZA Pit House',
        uninstall: /^MOZA Pit House/i,
        process: 'MOZA Pit House.exe',
        exe: (f) => [pf86(f, 'MOZA Pit House', 'MOZA Pit House.exe')],
        purpose: 'base settings, firmware, rim lights and displays',
      },
    ],
    softwareNote:
      'Force feedback works without Pit House: the base keeps the settings Pit House wrote to it. Pit House must be open for shift lights and rim displays.',
    // Where Pit House keeps its presets is not known yet (docs/research/wheelbases.md).
    profiles: [],
    recommendedLinks: [
      {
        game: 'iRacing',
        title: 'MOZA FFB settings for iRacing (R5, R9, R12, R16 and R21)',
        url: 'https://mozaracing.com/blogs/blog/moza-ffb-settings-for-iracing-r5-r9-r12-r16-and-r21',
      },
    ],
  },
  {
    id: 'logitech',
    name: 'Logitech',
    verifiedOnHardware: false,
    modeDetectable: true,
    pcModeLabel: 'PC mode',
    modeHelp:
      'The G29 is set to its PS3 position. Logitech advises the PS4 position on a PC: move the switch on the wheel and plug it in again. Bindings made in the other position may not match.',
    software: [
      {
        id: 'lghub',
        name: 'Logitech G HUB',
        uninstall: /^Logitech G HUB/i,
        process: 'lghub_agent.exe',
        exe: (f) => [pf(f, 'LGHUB', 'lghub.exe')],
        purpose: 'rotation, sensitivity and profiles',
      },
    ],
    softwareNote:
      'Force feedback works without G HUB, but G HUB applies the rotation, sensitivity and per-game profile only while it runs.',
    profiles: [
      {
        label: 'G HUB settings and profiles',
        path: (f) => path.join(f.localAppData(), 'LGHUB', 'settings.db'),
        kind: 'file',
        description: "G HUB's settings and profiles (settings.db), locked while G HUB runs.",
      },
    ],
    holders: {
      name: 'Logitech G HUB',
      processes: ['lghub.exe', 'lghub_agent.exe'],
      why: 'G HUB keeps settings.db open and writes it while it runs, which would undo the restore.',
    },
  },
  {
    id: 'simagic',
    name: 'Simagic',
    verifiedOnHardware: false,
    // Compatibility mode shows as 1234:BEAD, the id vJoy uses too, so it is not told apart.
    modeDetectable: false,
    pcModeLabel: 'PC mode',
    software: [
      {
        id: 'simpro',
        name: 'SimPro Manager',
        uninstall: /^SimPro Manager/i,
        process: 'simpro2.exe',
        exe: (f) => [pf(f, 'simpro2', 'simpro2.exe')],
        purpose: 'base settings and firmware',
      },
    ],
    softwareNote:
      'Force feedback works without SimPro Manager once settings are saved to the base. Alpha, Alpha Mini and Alpha U use SimPro Manager 2, EVO bases version 3.',
    profiles: [],
  },
  {
    id: 'thrustmaster',
    name: 'Thrustmaster',
    verifiedOnHardware: false,
    modeDetectable: true,
    pcModeLabel: 'PC mode',
    modeHelp:
      'Install the Thrustmaster force feedback driver (plug the wheel in only when the installer asks), then unplug the wheel and plug it in again. A T300 should be in PS3 normal mode on a PC: the switch on the base on PS3, the selector on the rim on normal.',
    software: [
      {
        id: 'tm-driver',
        name: 'Thrustmaster FFB Racing Wheel driver',
        uninstall: /FFB (Racing )?Wheel/i,
        purpose: 'force feedback and the Control Panel',
      },
    ],
    softwareNote:
      'The Thrustmaster driver is needed for force feedback: until it switches the wheel to its own id, Windows sees a generic "FFB Wheel". Its Control Panel is in Windows Game Controllers.',
    profiles: [],
  },
  {
    id: 'simucube',
    name: 'Simucube',
    verifiedOnHardware: false,
    modeDetectable: false,
    pcModeLabel: 'PC mode',
    software: [
      {
        id: 'simucube-tuner',
        name: 'Simucube Tuner',
        uninstall: /^Simucube (Tuner|2 True ?Drive)/i,
        purpose: 'the active profile and firmware',
      },
    ],
    softwareNote:
      'The base keeps only a default profile. Simucube Tuner pushes your active profile to it when it runs; without Tuner the base drives with the default one.',
    profiles: [
      {
        label: 'Tuner profiles (cachedprofiles)',
        path: (f) => path.join(f.documents(), 'Simucube 2', 'cachedprofiles'),
        kind: 'folder',
        description: 'Simucube profiles kept on this PC (Documents\\Simucube 2\\cachedprofiles).',
      },
    ],
  },
  {
    id: 'asetek',
    name: 'Asetek SimSports',
    verifiedOnHardware: false,
    modeDetectable: false,
    pcModeLabel: 'PC mode',
    software: [
      {
        id: 'racehub',
        name: 'RaceHub',
        uninstall: /RaceHub/i,
        purpose: 'base settings, high torque mode and pedals',
      },
    ],
    softwareNote:
      'Settings are written to the base with "Save to wheelbase". RaceHub turns on high torque mode after the base is switched on.',
    profiles: [],
    recommendedLinks: [
      {
        game: 'Le Mans Ultimate',
        title: 'Le Mans Ultimate 1.3 settings (Asetek)',
        url: 'https://www.asetek.com/simsports/guides/le-mans-ultimate-1-3-settings/',
      },
      {
        game: 'iRacing',
        title: 'Wheelbase settings for iRacing (Asetek)',
        url: 'https://www.asetek.com/blogs/wheelbase-settings-for-iracing/',
      },
      {
        game: 'BeamNG.drive',
        title: 'Wheelbase settings for BeamNG.drive (Asetek)',
        url: 'https://www.asetek.com/simsports/guides/wheelbase-settings-for-beamng-drive/',
      },
      {
        game: 'Assetto Corsa EVO',
        title: 'Assetto Corsa EVO wheelbase settings (Asetek)',
        url: 'https://www.asetek.com/simsports/guides/assetto-corsa-evo-wheelbase-settings/',
      },
    ],
  },
  {
    id: 'cammus',
    name: 'Cammus',
    verifiedOnHardware: false,
    modeDetectable: false,
    pcModeLabel: 'PC mode',
    software: [],
    softwareNote:
      'RigReady does not know the Cammus PC software yet: its name and where it keeps settings are not published.',
    profiles: [],
  },
];

export const WHEEL_BRANDS: Readonly<Record<string, WheelBrand>> = Object.fromEntries(
  WHEEL_BRAND_LIST.map((b) => [b.id, b])
);

export const brandOf = (id: string | undefined): WheelBrand | undefined =>
  id ? WHEEL_BRANDS[id] : undefined;
