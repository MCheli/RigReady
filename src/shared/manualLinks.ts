/**
 * Which page of the manual explains which screen of the app, and the address it has on the
 * website. The manual is docs/manual/<section>/<page>.md, published at
 * https://rigready.io/docs/<section>/<page>/ (site/lib/manual.mjs); a section's index.md is
 * /docs/<section>/. One place for the whole map, so the help button, the command palette
 * and the links of the error notices all say the same thing.
 *
 * tests/unit/manualLinks.test.ts fails when a route of the app has no entry here, when an
 * entry is for a route that no longer exists, or when a page named here is not in
 * docs/manual.
 */

/** The website the manual is published on. */
export const MANUAL_SITE = 'https://rigready.io';

/** A page of the manual: its file under docs/manual, without ".md" ("hardware/devices"). */
export type ManualPage = string;

/** The manual's front page. */
export const MANUAL_HOME: ManualPage = 'index';

/**
 * The troubleshooting pages that an error notice or an empty state links to, by what went
 * wrong.
 */
export const TROUBLESHOOTING = {
  controllersNotRead: 'troubleshooting/controllers-not-read',
  deviceNotFound: 'troubleshooting/device-not-found',
  layoutReverted: 'troubleshooting/monitor-layout-reverted',
  dcsFilesRefused: 'troubleshooting/dcs-files-refused',
  setupFileUnreadable: 'troubleshooting/setup-file-cannot-be-read',
  startWithWindowsOff: 'troubleshooting/start-with-windows-off',
  dataFileDamaged: 'troubleshooting/app-will-not-start-or-data-folder',
} as const satisfies Record<string, ManualPage>;

export type TroubleshootingTopic = keyof typeof TROUBLESHOOTING;

/**
 * The manual page of one route. `page` is the page for the route as a whole; `variants`
 * gives another page for some values of one route parameter or query parameter (a tab of
 * the page, or the game a page is about).
 */
export interface ManualLink {
  page: ManualPage;
  variants?: {
    from: 'param' | 'query';
    name: string;
    pages: Record<string, ManualPage>;
  };
}

/**
 * Every route of the app, as its feature declares it (children joined to their parent), to
 * the page of the manual about it.
 */
export const MANUAL_LINKS: Record<string, ManualLink> = {
  // Play
  '/fly': { page: 'play/index' },
  '/fly/compact': { page: 'play/compact-view' },

  // Setups
  '/configure/profiles': { page: 'setups/index' },
  '/configure/profiles/capture': { page: 'setups/capture' },
  '/configure/profiles/:id': { page: 'setups/editor' },
  '/configure/backups': {
    page: 'protect/backups',
    variants: {
      from: 'query',
      name: 'tab',
      pages: {
        tracked: 'protect/tracked-files',
        snapshots: 'protect/snapshots',
        changes: 'protect/what-changed',
      },
    },
  },
  '/configure/backups/restore/:id': { page: 'protect/restore' },
  '/configure/share': { page: 'protect/sharing' },

  // Games
  '/configure/games': { page: 'games/index' },
  '/configure/games/:id': {
    page: 'games/other-games',
    variants: {
      from: 'param',
      name: 'id',
      pages: {
        dcs: 'dcs/index',
        iracing: 'games/iracing',
        lmu: 'games/le-mans-ultimate',
        beamng: 'games/beamng',
        'assetto-corsa': 'games/assetto-corsa',
        'assetto-corsa-evo': 'games/assetto-corsa-evo-and-rally',
        'assetto-corsa-rally': 'games/assetto-corsa-evo-and-rally',
        msfs2024: 'games/msfs-2024',
      },
    },
  },
  '/configure/dcs': { page: 'dcs/index' },
  '/configure/dcs/screens': { page: 'dcs/screens' },
  '/configure/dcs/export': { page: 'dcs/export-lua' },
  '/configure/dcs/simapppro': { page: 'dcs/simapppro' },
  '/configure/racing': { page: 'games/index' },
  '/configure/racing/iracing': { page: 'games/iracing' },
  '/configure/racing/lmu': { page: 'games/le-mans-ultimate' },
  '/configure/racing/beamng': { page: 'games/beamng' },
  '/configure/racing/assetto-corsa': { page: 'games/assetto-corsa' },

  // Controls
  '/configure/dcs-bindings/:tab?': {
    page: 'dcs/bindings',
    variants: {
      from: 'param',
      name: 'tab',
      pages: {
        problems: 'dcs/binding-problems',
        'device-ids': 'dcs/device-ids',
        copy: 'dcs/copy-and-snapshots',
        snapshots: 'dcs/copy-and-snapshots',
      },
    },
  },
  '/configure/ai-assist/:tab?': { page: 'dcs/binding-guide-and-ai' },
  '/configure/cheat-sheets': { page: 'dcs/cheat-sheets' },
  '/configure/cheat-sheets/quick': { page: 'dcs/cheat-sheets' },
  '/configure/cheat-sheets/learn': { page: 'dcs/trainer' },
  '/configure/overlay': { page: 'play/overlay' },
  // The overlay's own window over the game: it has no help button, the page is the same.
  '/overlay/:widget': { page: 'play/overlay' },

  // Hardware
  '/configure/devices': { page: 'hardware/devices' },
  '/configure/devices/test': { page: 'hardware/input-tester' },
  '/configure/devices/health': { page: 'hardware/health-check' },
  '/configure/devices/usb': { page: 'hardware/usb-map' },
  '/configure/displays': { page: 'monitors-and-audio/layouts' },
  '/configure/audio': { page: 'monitors-and-audio/audio' },
  '/configure/racing/wheel': { page: 'games/wheel' },
  '/configure/stream-deck': { page: 'hardware/stream-deck' },
  '/configure/stream-deck/setup': { page: 'hardware/stream-deck' },
  '/configure/trackir': { page: 'hardware/trackir' },
  '/configure/virtual-controller': { page: 'hardware/virtual-controller' },
  '/configure/virtual-controller/edit': { page: 'hardware/virtual-controller' },

  // RigReady
  '/configure/settings': { page: 'app/settings' },
  '/configure/safety': { page: 'protect/safety-page' },
  '/configure/diagnostics': { page: 'app/diagnostics' },
};

/**
 * The public address of a manual page. "hardware/devices" is
 * https://rigready.io/docs/hardware/devices/, a section's "index" is the section, and the
 * manual's own "index" is https://rigready.io/docs/. The same rule as site/lib/manual.mjs.
 */
export function manualUrl(page: ManualPage = MANUAL_HOME, anchor?: string): string {
  const kept = page.split('/').filter((part) => part !== '' && part !== 'index');
  const path = kept.length ? `/docs/${kept.join('/')}/` : '/docs/';
  return `${MANUAL_SITE}${path}${anchor ? `#${anchor}` : ''}`;
}

/** Where the app is: the route record shown (its declared path), and what it was given. */
export interface ShownRoute {
  /** The declared path of the route shown ("/configure/games/:id"), not the address. */
  matched: string | undefined;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

const valueOf = (value: unknown): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first : undefined;
};

/** The manual page for the screen shown: its tab's own page where it has one. */
export function manualPageFor(shown: ShownRoute): ManualPage {
  const link = shown.matched ? MANUAL_LINKS[shown.matched] : undefined;
  if (!link) return MANUAL_HOME;
  const variants = link.variants;
  if (!variants) return link.page;
  const source = variants.from === 'param' ? shown.params : shown.query;
  const value = valueOf(source?.[variants.name]);
  return (value && variants.pages[value]) || link.page;
}

/**
 * The troubleshooting page for a notice the app shows at the start (src/core/dataHealth.ts
 * and the settings file): setup files have a page of their own, every other damaged data
 * file the page about RigReady's data folder.
 */
export function noticeManualPage(notice: string): ManualPage {
  return /setup files? could not be read/i.test(notice)
    ? TROUBLESHOOTING.setupFileUnreadable
    : TROUBLESHOOTING.dataFileDamaged;
}
