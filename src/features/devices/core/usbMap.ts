import { buildUsbTree, countPeripherals, type UsbTreeNode } from '../../../core/usb';
import type { DeviceInfo } from '../../../shared/models';
import { HUB_DEPTH_MAX, HUB_DEPTH_WARN, locate, hubNames, portOf } from './identity';
import type { RigDevice, UsbController, UsbMap, UsbNode } from './model';

/** A USB host controller gives out at most 127 addresses (hubs count too). */
export const USB_ADDRESS_LIMIT = 127;
export const USB_ADDRESS_NEAR = 100;

/**
 * The USB tree as the map shows it: root hubs (one per host controller) with hubs and
 * devices below, each peripheral tied to its Devices entry, hub depth warnings, and per
 * controller the addresses used and what could be unplugged first.
 */
export function buildUsbMap(
  devices: DeviceInfo[],
  rig: RigDevice[],
  options: { required?: (device: DeviceInfo) => boolean; activeProfile?: string } = {}
): UsbMap {
  const byInstance = new Map(
    rig.filter((r) => r.instanceId).map((r) => [r.instanceId!.toUpperCase(), r])
  );
  const hubs = hubNames(devices);
  const nodes: UsbNode[] = [];
  const controllers: UsbController[] = [];

  const visit = (node: UsbTreeNode, parent: UsbTreeNode | undefined, depth: number): void => {
    const device = node.device;
    const isRoot = parent === undefined;
    const kind: UsbNode['kind'] = isRoot ? 'root' : device && !device.isHub ? 'device' : 'hub';
    const entry = byInstance.get(node.instanceId.toUpperCase());
    // Depth counts external hubs between the root hub and this node.
    const warning =
      kind === 'device' && depth >= HUB_DEPTH_MAX
        ? 'tooDeep'
        : kind === 'device' && depth >= HUB_DEPTH_WARN
          ? 'deep'
          : undefined;
    const port = isRoot ? undefined : portOf(node.instanceId);
    nodes.push({
      id: node.instanceId,
      ...(parent ? { parentId: parent.instanceId } : {}),
      kind,
      name:
        kind === 'device'
          ? (entry?.name ?? node.name.trim())
          : (hubs.get(node.instanceId.toUpperCase()) ?? node.name).trim(),
      ...(entry ? { deviceKey: entry.key } : {}),
      ...(port !== undefined ? { port } : {}),
      depth,
      isGameController: entry?.kind === 'controller',
      required: device && !device.isHub ? (options.required?.(device) ?? false) : false,
      hidden: entry?.hidden ?? false,
      ...(warning ? { warning } : {}),
      devicesBelow: countPeripherals(node),
    });
    for (const child of node.children) visit(child, node, isRoot ? 0 : depth + 1);
  };

  for (const root of buildUsbTree(devices)) {
    visit(root, undefined, 0);
    const below = (n: UsbTreeNode): UsbTreeNode[] => n.children.flatMap((c) => [c, ...below(c)]);
    const all = below(root).filter((n) => n.device);
    const peripherals = all.filter((n) => !n.device!.isHub);
    const hubCount = all.length - peripherals.length;
    const addresses = all.length;
    const deepest = Math.max(0, ...peripherals.map((n) => n.device!.hubChain.length - 1));
    const spare = peripherals
      .map((n) => n.device!)
      .filter((d) => !(options.required?.(d) ?? false))
      .map((d) => {
        const entry = byInstance.get(d.instanceId.toUpperCase());
        return {
          key: d.instanceId,
          name: entry?.name ?? d.name.trim(),
          location: locate(d, hubs).text,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    controllers.push({
      id: root.instanceId,
      name: root.name.trim(),
      hubs: hubCount,
      devices: peripherals.length,
      addresses,
      status:
        addresses > USB_ADDRESS_LIMIT ? 'over' : addresses >= USB_ADDRESS_NEAR ? 'near' : 'ok',
      deepest,
      spare,
    });
  }
  return {
    nodes,
    controllers,
    ...(options.activeProfile ? { activeProfile: options.activeProfile } : {}),
  };
}
