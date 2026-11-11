import { z } from 'zod';
import {
  GAMING_ARGS,
  parseGaming,
  readHidHide,
  type HidHideGamingDevice,
} from '../../../core/hidhide';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { InputDevice } from '../../../shared/models';

/**
 * Hiding the real controllers from games while the virtual one runs, so a game that reads
 * every controller does not see the stick twice (once real, once as a gamepad). Done with
 * HidHide's own command-line program (it needs no administrator rights), always as a
 * program and an argument list. What RigReady changed is written down first, so it is put
 * back at Stand down, when the virtual controller stops, and at the next start after a crash.
 */

export const HidingRecordSchema = z.object({
  cli: z.string().min(1),
  /** HID device instance paths RigReady put on the hidden list (they were not on it). */
  hidden: z.array(z.string()),
  /** The program RigReady put on the allow list, when it was not on it. */
  appAdded: z.string().optional(),
  /** Hiding was off and RigReady turned it on. */
  cloakTurnedOn: z.boolean(),
  /** The controllers, by name, for the words on screen. */
  names: z.array(z.string()),
});
export type HidingRecord = z.infer<typeof HidingRecordSchema>;

const VID_PID = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i;

/** The HID nodes on HidHide's list of game devices that belong to one controller. */
export function nodesOf(device: InputDevice, gaming: HidHideGamingDevice[]): string[] {
  if (device.usbInstanceId) {
    const usb = device.usbInstanceId.toUpperCase();
    return gaming
      .filter((g) => g.baseContainerDeviceInstancePath.toUpperCase() === usb)
      .map((g) => g.deviceInstancePath);
  }
  if (!device.vendorId || !device.productId) return [];
  // Without the USB path, every device of the model: identical twins are hidden together.
  return gaming
    .filter((g) => {
      const ids = VID_PID.exec(g.deviceInstancePath);
      return (
        ids !== null &&
        ids[1]!.toUpperCase() === device.vendorId.toUpperCase() &&
        ids[2]!.toUpperCase() === device.productId.toUpperCase()
      );
    })
    .map((g) => g.deviceInstancePath);
}

export interface HideOutcome {
  record: HidingRecord;
  /** Controllers that HidHide does not list, so they could not be hidden. */
  notFound: string[];
}

/** Hides these controllers. Refuses when HidHide is not there or cannot be asked. */
export async function hideControllers(
  ports: Ports,
  devices: InputDevice[]
): Promise<Result<HideOutcome>> {
  const info = await readHidHide(ports);
  if (!info.installed) {
    return err(
      'vc.hidhide',
      'HidHide is not installed, so the real controllers cannot be hidden.',
      'Install HidHide from its official page, or start the virtual controller without hiding.'
    );
  }
  if (info.error) return err('vc.hidhide', `HidHide could not be asked: ${info.error}`);
  if (info.inverse) {
    return err(
      'vc.hidhide',
      'HidHide is set to inverse mode, which RigReady does not change. Turn it off in HidHide, or start without hiding.'
    );
  }
  const reader = ports.pads.readerProgram();
  if (!reader) {
    return err(
      'vc.hidhide',
      'The program that reads the controllers for RigReady is not known, so hiding them would cut RigReady off too.'
    );
  }
  const listed = await ports.shell.run(info.cli, GAMING_ARGS, { timeoutMs: 5000 });
  if (!listed.ok) return listed;
  if (listed.value.code !== 0) {
    return err('vc.hidhide', `HidHideCLI exited with code ${listed.value.code}.`);
  }
  const gaming = parseGaming(listed.value.stdout);
  const already = new Set(info.hidden.map((h) => h.toUpperCase()));
  const hidden: string[] = [];
  const names: string[] = [];
  const notFound: string[] = [];
  for (const device of devices) {
    const nodes = nodesOf(device, gaming);
    if (nodes.length === 0) {
      notFound.push(device.name);
      continue;
    }
    names.push(device.name);
    for (const node of nodes) {
      if (!already.has(node.toUpperCase()) && !hidden.includes(node)) hidden.push(node);
    }
  }
  const appListed = info.apps.some((a) => a.toLowerCase() === reader.toLowerCase());
  const record: HidingRecord = {
    cli: info.cli,
    hidden,
    ...(appListed ? {} : { appAdded: reader }),
    cloakTurnedOn: !info.cloak,
    names,
  };
  const args = [
    ...hidden.flatMap((node) => ['--dev-hide', node]),
    ...(record.appAdded ? ['--app-reg', record.appAdded] : []),
    ...(record.cloakTurnedOn ? ['--cloak-on'] : []),
  ];
  if (args.length > 0) {
    // No --cancel: the CLI saves its changes when it exits.
    const changed = await ports.shell.run(info.cli, args, { timeoutMs: 10_000 });
    if (!changed.ok) return changed;
    if (changed.value.code !== 0) {
      return err('vc.hidhide', `HidHideCLI exited with code ${changed.value.code}.`);
    }
  }
  // Read back: only what HidHide now says counts.
  const after = await readHidHide(ports);
  if (!after.installed || after.error) {
    return err('vc.hidhide', 'HidHide could not be read back after the change.', record.cli);
  }
  const nowHidden = new Set(after.hidden.map((h) => h.toUpperCase()));
  const missing = hidden.filter((h) => !nowHidden.has(h.toUpperCase()));
  const readerAllowed = after.apps.some((a) => a.toLowerCase() === reader.toLowerCase());
  if (missing.length > 0 || !after.cloak || !readerAllowed) {
    // Whatever did take is put back before saying no.
    await restoreHiding(ports, record);
    return err(
      'vc.hidhide',
      'HidHide did not take the change, so nothing is hidden.',
      [
        missing.length > 0 ? `not hidden: ${missing.join(', ')}` : '',
        !after.cloak ? 'hiding is still off' : '',
        !readerAllowed ? 'the input reader is not on the allow list' : '',
      ]
        .filter(Boolean)
        .join('; ')
    );
  }
  return ok({ record, notFound });
}

/** Puts back what hideControllers changed, and only that. Resolves with what was done. */
export async function restoreHiding(ports: Ports, record: HidingRecord): Promise<Result<string>> {
  const args = [
    ...record.hidden.flatMap((node) => ['--dev-unhide', node]),
    ...(record.appAdded ? ['--app-unreg', record.appAdded] : []),
    ...(record.cloakTurnedOn ? ['--cloak-off'] : []),
  ];
  if (args.length === 0) return ok('Nothing was hidden.');
  const changed = await ports.shell.run(record.cli, args, { timeoutMs: 10_000 });
  if (!changed.ok) return changed;
  if (changed.value.code !== 0) {
    return err('vc.hidhide', `HidHideCLI exited with code ${changed.value.code}.`);
  }
  const after = await readHidHide(ports);
  if (!after.installed) return ok('HidHide is gone, so nothing is hidden any more.');
  if (after.error) return err('vc.hidhide', `HidHide could not be read back: ${after.error}`);
  const still = new Set(after.hidden.map((h) => h.toUpperCase()));
  const left = record.hidden.filter((h) => still.has(h.toUpperCase()));
  if (left.length > 0 || (record.cloakTurnedOn && after.cloak)) {
    return err(
      'vc.hidhide',
      'HidHide still hides what RigReady hid. Open HidHide and take them off its list.',
      left.join(', ')
    );
  }
  const what = record.names.length > 0 ? record.names.join(', ') : 'the controllers';
  return ok(`Showed ${what} to games again`);
}
