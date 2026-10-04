import { defineCommands, type PaletteCommand } from '../../shared/feature';
import { dcsBindingsContract } from './contract';

/**
 * DCS bindings for the command palette: the page's tabs under their own names, and one
 * command per aircraft that opens the page on that aircraft. Aircraft with bindings of the
 * owner's own come first; the ones that only have DCS's defaults are still found by name.
 */

const PAGE = '/configure/dcs-bindings';
const GROUP = 'DCS bindings';

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const tab = (id: string, title: string, icon: string, keywords: string[]): PaletteCommand => ({
  id: `dcs-bindings.tab.${id}`,
  title: `DCS bindings: ${title}`,
  icon,
  keywords,
  to: `${PAGE}/${id}`,
});

export default defineCommands({
  feature: 'dcs-bindings',
  commands: [
    tab('devices', 'Devices', 'mdi-controller', ['what each control does']),
    tab('actions', 'Actions', 'mdi-format-list-text', ['search', 'bind', 'unbound']),
    tab('problems', 'Problems', 'mdi-alert-outline', ['conflicts', 'duplicates', 'defaults']),
    tab('device-ids', 'Device IDs', 'mdi-identifier', ['guid', 'migration', 'windows changed']),
    tab('copy', 'Copy', 'mdi-content-copy', ['between aircraft', 'common controls']),
    tab('snapshots', 'Snapshots', 'mdi-camera-outline', ['restore', 'compare']),
  ],
  async list(shell) {
    const overview = await shell.client(dcsBindingsContract).overview();
    if (!overview.ok) throw new Error(overview.error.message);
    // No DCS on this PC: the page says so; there is no aircraft to open.
    if (!overview.value.found) return [];
    return [...overview.value.aircraft]
      .sort(
        (a, b) => Number(b.userFiles > 0) - Number(a.userFiles > 0) || a.name.localeCompare(b.name)
      )
      .map((aircraft): PaletteCommand => ({
        id: `dcs-bindings.aircraft.${aircraft.id}`,
        title: `Bindings: ${aircraft.name}`,
        hint:
          aircraft.userFiles > 0 ? count(aircraft.userFiles, 'binding file') : 'DCS defaults only',
        icon: 'mdi-airplane',
        keywords: ['dcs', 'aircraft', aircraft.id],
        group: GROUP,
        to: `${PAGE}?aircraft=${encodeURIComponent(aircraft.id)}`,
      }));
  },
});
