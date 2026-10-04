import { describe, expect, it } from 'vitest';
import type { UsbNode } from './model';
import { layoutUsbTree, pathTo, sortedChildren, USB_TREE } from './usbTree';

const node = (
  id: string,
  kind: UsbNode['kind'],
  parentId?: string,
  over: Partial<UsbNode> = {}
): UsbNode => ({
  id,
  ...(parentId ? { parentId } : {}),
  kind,
  name: id,
  depth: 0,
  isGameController: false,
  required: false,
  hidden: false,
  devicesBelow: kind === 'device' ? 1 : 0,
  ...(kind === 'device' ? { deviceKey: `key:${id}` } : {}),
  ...over,
});

/**
 * root
 *  ├─ keyboard            (port 1)
 *  ├─ hub A (port 2)
 *  │   ├─ stick           (port 1)
 *  │   └─ hub B (port 3)
 *  │       └─ pedals      (port 2)
 *  └─ hub C (port 4): empty
 */
const rig: UsbNode[] = [
  node('root', 'root', undefined, { devicesBelow: 3 }),
  node('hubC', 'hub', 'root', { port: 4, devicesBelow: 0 }),
  node('hubA', 'hub', 'root', { port: 2, devicesBelow: 2 }),
  node('keyboard', 'device', 'root', { port: 1 }),
  node('hubB', 'hub', 'hubA', { port: 3, devicesBelow: 1 }),
  node('stick', 'device', 'hubA', { port: 1 }),
  node('pedals', 'device', 'hubB', { port: 2 }),
];

describe('the USB tree as a drawing', () => {
  it('is drawn in rows of 30 with hubs 46 wide: the numbers below follow from these', () => {
    expect(USB_TREE).toEqual({
      rootIndent: 12,
      hubWidth: 46,
      gap: 22,
      rowHeight: 30,
      boxHeight: 24,
      rootGap: 14,
    });
  });

  it('orders each level: devices before hubs, then by port', () => {
    const children = sortedChildren(rig);
    expect(children.get('root')!.map((c) => c.id)).toEqual(['keyboard', 'hubA', 'hubC']);
    expect(children.get('hubA')!.map((c) => c.id)).toEqual(['stick', 'hubB']);
    expect(children.get('pedals')).toBeUndefined();
  });

  it('gives a controller and every device a row, and puts a hub on the row of its first device', () => {
    const drawing = layoutUsbTree(rig, { hideEmpty: true });
    const at = Object.fromEntries(drawing.boxes.map((b) => [b.node.id, [b.x, b.y, b.width]]));
    expect(at).toEqual({
      // The controller heads the tree...
      root: [0, 0, undefined],
      // ...what is plugged straight into it comes first...
      keyboard: [34, 30, undefined],
      // ...and each hub starts a column further right, on the row of its first device.
      hubA: [34, 60, 46],
      stick: [102, 60, undefined],
      hubB: [102, 90, 46],
      pedals: [170, 90, undefined],
    });
    // One controller and three devices make four rows: hubs take none.
    expect(drawing.height).toBe(4 * 30);
    expect(drawing.deepestX).toBe(170);
  });

  it('joins everything to what it is plugged into, with one line each', () => {
    const drawing = layoutUsbTree(rig, { hideEmpty: true });
    const link = (to: string): string => drawing.links.find((l) => l.to === to)!.d;
    // From under the controller's left end: down its trunk, round the corner, across.
    expect(link('keyboard')).toBe('M 12 27 V 39 Q 12 45 18 45 H 34');
    expect(link('hubA')).toBe('M 12 27 V 69 Q 12 75 18 75 H 34');
    // Straight across to what is on the hub's own row...
    expect(link('stick')).toBe('M 80 75 H 102');
    expect(link('pedals')).toBe('M 148 105 H 170');
    // ...and out of the hub, down its trunk and round the corner to the rest.
    expect(link('hubB')).toBe('M 80 75 H 91 V 99 Q 91 105 97 105 H 102');
    expect(drawing.links.map((l) => `${l.from}>${l.to}`)).toEqual([
      'root>keyboard',
      'hubA>stick',
      'hubB>pedals',
      'hubA>hubB',
      'root>hubA',
    ]);
    // Every box but the controller has exactly one line to it.
    expect(drawing.links).toHaveLength(drawing.boxes.length - 1);
  });

  it('leaves out empty hubs unless asked, and then gives each a row', () => {
    expect(layoutUsbTree(rig, { hideEmpty: true }).boxes.map((b) => b.node.id)).not.toContain(
      'hubC'
    );
    const all = layoutUsbTree(rig, { hideEmpty: false });
    const empty = all.boxes.find((b) => b.node.id === 'hubC')!;
    expect(empty).toMatchObject({ x: 34, y: 120, width: 46, end: true });
    // Of the rest, only the devices are ends of a branch.
    expect(all.boxes.filter((b) => b.end && b.node.id !== 'hubC').map((b) => b.node.id)).toEqual([
      'keyboard',
      'stick',
      'pedals',
    ]);
    expect(all.links.find((l) => l.to === 'hubC')!.d).toBe('M 12 27 V 129 Q 12 135 18 135 H 34');
    expect(all.height).toBe(5 * 30);
  });

  it('keeps a chain of hubs with one device at its end on one row', () => {
    const chain = [
      node('root', 'root', undefined, { devicesBelow: 1 }),
      node('hub1', 'hub', 'root', { port: 1, devicesBelow: 1 }),
      node('hub2', 'hub', 'hub1', { port: 1, devicesBelow: 1 }),
      node('wheel', 'device', 'hub2', { port: 3 }),
    ];
    const drawing = layoutUsbTree(chain, { hideEmpty: true });
    expect(drawing.boxes.map((b) => [b.node.id, b.x, b.y])).toEqual([
      ['root', 0, 0],
      ['hub1', 34, 30],
      ['hub2', 102, 30],
      ['wheel', 170, 30],
    ]);
    expect(drawing.height).toBe(60);
  });

  it('draws each USB controller as its own tree, one under the other', () => {
    const two = [
      ...rig,
      node('root2', 'root', undefined, { devicesBelow: 1 }),
      node('mouse', 'device', 'root2', { port: 1 }),
      node('bare', 'root'),
    ];
    const drawing = layoutUsbTree(two, { hideEmpty: true });
    const second = drawing.boxes.find((b) => b.node.id === 'root2')!;
    expect(second).toMatchObject({ x: 0, y: 4 * 30 + 14 });
    expect(drawing.boxes.find((b) => b.node.id === 'mouse')).toMatchObject({
      x: 34,
      y: second.y + 30,
    });
    // The line to the mouse starts under its own controller, not under the first.
    expect(drawing.links.find((l) => l.to === 'mouse')!.d).toBe(
      `M 12 ${second.y + 27} V ${second.y + 39} Q 12 ${second.y + 45} 18 ${second.y + 45} H 34`
    );
    // A controller with nothing on it still has its row.
    const bare = drawing.boxes.find((b) => b.node.id === 'bare')!;
    expect(bare.end).toBe(true);
    expect(second.end).toBe(false);
    expect(bare.y).toBe(second.y + 2 * 30 + 14);
    expect(drawing.height).toBe(bare.y + 30);
    expect(layoutUsbTree([], { hideEmpty: true })).toEqual({
      boxes: [],
      links: [],
      height: 0,
      deepestX: 0,
    });
  });

  it('follows another geometry when given one', () => {
    const drawing = layoutUsbTree(rig, {
      hideEmpty: true,
      geometry: { rootIndent: 10, hubWidth: 20, gap: 10, rowHeight: 20, boxHeight: 16, rootGap: 0 },
    });
    expect(drawing.boxes.find((b) => b.node.id === 'pedals')).toMatchObject({ x: 80, y: 60 });
    // A tight gap makes a tighter corner.
    expect(drawing.links.find((l) => l.to === 'hubA')!.d).toBe('M 10 18 V 47 Q 10 50 13 50 H 20');
  });
});

describe('the way to a device', () => {
  it('is the device and every hub above it, up to the controller', () => {
    expect([...pathTo(rig, 'key:pedals')]).toEqual(['pedals', 'hubB', 'hubA', 'root']);
    expect([...pathTo(rig, 'key:keyboard')]).toEqual(['keyboard', 'root']);
  });

  it('is nothing for no selection or a device that is gone', () => {
    expect(pathTo(rig, undefined).size).toBe(0);
    expect(pathTo(rig, 'key:unplugged').size).toBe(0);
  });
});
