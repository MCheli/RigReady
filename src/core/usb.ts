import type { DeviceInfo } from '../shared/models';

export interface UsbTreeNode {
  instanceId: string;
  name: string;
  /** Present when this node is itself an enumerated device (hub or peripheral). */
  device?: DeviceInfo;
  children: UsbTreeNode[];
}

/** Builds the USB topology (root hubs at the top) from each device's hub chain. */
export function buildUsbTree(devices: DeviceInfo[]): UsbTreeNode[] {
  const nodes = new Map<string, UsbTreeNode>();
  const hasParent = new Set<string>();

  const node = (instanceId: string, name: string): UsbTreeNode => {
    let existing = nodes.get(instanceId);
    if (!existing) {
      existing = { instanceId, name, children: [] };
      nodes.set(instanceId, existing);
    }
    return existing;
  };

  for (const device of devices) {
    const self = node(device.instanceId, device.name);
    self.device = device;
    let child = self;
    for (const hub of device.hubChain) {
      const parent = node(hub.instanceId, hub.name);
      if (!hasParent.has(child.instanceId)) {
        hasParent.add(child.instanceId);
        parent.children.push(child);
      }
      child = parent;
    }
  }
  const roots = [...nodes.values()].filter((candidate) => !hasParent.has(candidate.instanceId));
  const sort = (list: UsbTreeNode[]): void => {
    list.sort((a, b) => a.name.localeCompare(b.name) || a.instanceId.localeCompare(b.instanceId));
    list.forEach((child) => sort(child.children));
  };
  sort(roots);
  return roots;
}

/** Number of peripherals (non-hub devices) at or below a node. */
export function countPeripherals(node: UsbTreeNode): number {
  const own = node.device && !node.device.isHub ? 1 : 0;
  return own + node.children.reduce((sum, child) => sum + countPeripherals(child), 0);
}
