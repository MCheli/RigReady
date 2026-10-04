import type { UsbNode } from './model';

/**
 * The USB map as a drawing: each USB controller of the computer heads its own tree, hubs
 * branch off to the right, and every device is at the end of its branch. A hub sits on the
 * row of its first device, so reading along a row is the way to that device, and nothing
 * but controllers and devices takes up a row: the whole rig fits a screen or two. Pure
 * geometry; the page draws it.
 */

export interface TreeGeometry {
  /** How far in from the left the trunk of a controller's tree runs. */
  rootIndent: number;
  /** Width of a hub: its port number and a hub mark. */
  hubWidth: number;
  /** Room between a hub and what is plugged into it, in which the lines run. */
  gap: number;
  rowHeight: number;
  /** Height of what is drawn in a row; the rest of the row is room above and below it. */
  boxHeight: number;
  /** Extra room between one controller's tree and the next. */
  rootGap: number;
}

export const USB_TREE: TreeGeometry = {
  rootIndent: 12,
  hubWidth: 46,
  gap: 22,
  rowHeight: 30,
  boxHeight: 24,
  rootGap: 14,
};

export interface TreeBox {
  node: UsbNode;
  x: number;
  y: number;
  /** Only a hub has a width of its own; a controller and a device take what their name needs. */
  width: number | undefined;
  /** Nothing is drawn behind it: a device, an empty hub, a controller with nothing on it. */
  end: boolean;
}

export interface TreeLink {
  from: string;
  to: string;
  /** An SVG path from the parent to the child's left edge. */
  d: string;
}

export interface UsbTreeDrawing {
  boxes: TreeBox[];
  links: TreeLink[];
  height: number;
  /** Where the deepest branch ends: the room device names need starts here at the latest. */
  deepestX: number;
}

/** Devices before hubs on each level, then by port, then by name: the order of the drawing. */
export function sortedChildren(nodes: UsbNode[]): Map<string, UsbNode[]> {
  const out = new Map<string, UsbNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = out.get(node.parentId) ?? [];
    list.push(node);
    out.set(node.parentId, list);
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        (a.kind === 'device' ? 0 : 1) - (b.kind === 'device' ? 0 : 1) ||
        (a.port ?? 99) - (b.port ?? 99) ||
        a.name.localeCompare(b.name)
    );
  }
  return out;
}

const n = (value: number): string => String(Math.round(value * 10) / 10);

export function layoutUsbTree(
  nodes: UsbNode[],
  options: { hideEmpty: boolean; geometry?: TreeGeometry }
): UsbTreeDrawing {
  const g = options.geometry ?? USB_TREE;
  const childrenOf = sortedChildren(nodes);
  const shown = (node: UsbNode): UsbNode[] =>
    (childrenOf.get(node.id) ?? []).filter(
      (c) => !options.hideEmpty || c.kind === 'device' || c.devicesBelow > 0
    );

  const boxes: TreeBox[] = [];
  const links: TreeLink[] = [];
  let y = 0;
  let deepestX = 0;
  const half = g.rowHeight / 2;

  /** Down a trunk at `trunk` from `fromY`, round the corner, across to the child. */
  const elbow = (trunk: number, fromY: number, child: TreeBox): string => {
    const toY = child.y + half;
    const r = Math.max(0, Math.min(6, g.gap / 2 - 2, toY - fromY));
    return `V ${n(toY - r)} Q ${n(trunk)} ${n(toY)} ${n(trunk + r)} ${n(toY)} H ${n(child.x)}`;
  };

  const place = (node: UsbNode, x: number): TreeBox => {
    const kids = node.kind === 'hub' ? shown(node) : [];
    const box: TreeBox = {
      node,
      x,
      y,
      width: node.kind === 'hub' ? g.hubWidth : undefined,
      end: kids.length === 0,
    };
    boxes.push(box);
    deepestX = Math.max(deepestX, x);
    if (kids.length === 0) {
      // The end of a branch takes a row of its own.
      y += g.rowHeight;
      return box;
    }
    const from = x + g.hubWidth;
    const fromY = box.y + half;
    const trunk = from + g.gap / 2;
    for (const kid of kids) {
      const child = place(kid, from + g.gap);
      links.push({
        from: node.id,
        to: kid.id,
        d:
          child.y === box.y
            ? `M ${n(from)} ${n(fromY)} H ${n(child.x)}`
            : `M ${n(from)} ${n(fromY)} H ${n(trunk)} ${elbow(trunk, fromY, child)}`,
      });
    }
    return box;
  };

  nodes
    .filter((node) => node.kind === 'root')
    .forEach((root, i) => {
      if (i > 0) y += g.rootGap;
      // A controller has a row to itself; its tree hangs from a trunk under its left end.
      const kids = shown(root);
      const box: TreeBox = { node: root, x: 0, y, width: undefined, end: kids.length === 0 };
      boxes.push(box);
      y += g.rowHeight;
      const fromY = box.y + g.rowHeight - (g.rowHeight - g.boxHeight) / 2;
      for (const kid of kids) {
        const child = place(kid, g.rootIndent + g.gap);
        links.push({
          from: root.id,
          to: kid.id,
          d: `M ${n(g.rootIndent)} ${n(fromY)} ${elbow(g.rootIndent, fromY, child)}`,
        });
      }
    });
  return { boxes, links, height: y, deepestX };
}

/** The node with this device key and everything above it: the way from the computer to it. */
export function pathTo(nodes: UsbNode[], deviceKey: string | undefined): Set<string> {
  const path = new Set<string>();
  if (deviceKey === undefined) return path;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let node = nodes.find((candidate) => candidate.deviceKey === deviceKey);
  while (node && !path.has(node.id)) {
    path.add(node.id);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return path;
}
