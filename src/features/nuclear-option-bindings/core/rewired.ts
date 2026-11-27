import { err, ok, type Result } from '../../../core/result';

/**
 * What the Rewired input library saves for Nuclear Option, taken apart: the names of the
 * registry values it writes, and the XML document that holds the bindings of one
 * controller in one map category. Pure text in, data out; nothing here reads the registry.
 *
 * The format and every claim about it: docs/research/nuclear-option.md, section 4.
 */

/** The parts of a `RewiredSaveData|name=value|...` key, without Unity's `_h<number>` suffix. */
export interface SaveKey {
  dataType: string;
  /** Every `name=value` part after the first, as written. */
  parts: Record<string, string>;
}

const PREFIX = 'RewiredSaveData';

/** A registry value name as Rewired's key; undefined for a value that is not Rewired's. */
export function parseSaveKey(valueName: string): SaveKey | undefined {
  const key = valueName.replace(/_h\d+$/, '');
  if (key !== PREFIX && !key.startsWith(`${PREFIX}|`) && !key.startsWith(`${PREFIX}_`)) {
    return undefined;
  }
  const parts: Record<string, string> = {};
  for (const piece of key.split('|').slice(1)) {
    const at = piece.indexOf('=');
    if (at > 0) parts[piece.slice(0, at)] = piece.slice(at + 1);
  }
  const dataType = parts.dataType ?? key.slice(PREFIX.length + 1);
  return dataType ? { dataType, parts } : undefined;
}

/** A controller as Rewired names one it has no definition of its own for. */
export interface HardwareIdentity {
  /** The product name with its spaces removed, as Rewired writes it. */
  compactName: string;
  /** Four upper-case hex digits each. */
  vendorId: string;
  productId: string;
  /**
   * Which of the two ways the identifier is written: with the product GUID (game builds
   * up to early 2026) or short (later builds). A later build saves under the short one and
   * can leave the older values behind.
   */
  form: 'guid' | 'short';
}

const PRODUCT_GUID = /([0-9a-f]{4})([0-9a-f]{4})-0000-0000-0000-504944564944$/i;

const SHORT = /^WindowsRawInput(.*)([0-9A-F]{4})([0-9A-F]{4})$/;

/**
 * Two forms, both seen in one registry key:
 * `WindowsRawInput<name><product id in decimal><pid><vid>-0000-0000-0000-504944564944`, where
 * the decimal number must be the hex product id (which tells where a name that ends in
 * digits stops), and the later `WindowsRawInput<name><PID><VID>` in upper-case hex.
 */
export function parseHardwareIdentifier(identifier: string): HardwareIdentity | undefined {
  const guid = PRODUCT_GUID.exec(identifier);
  if (!guid) {
    const short = SHORT.exec(identifier);
    if (!short) return undefined;
    return { compactName: short[1]!, productId: short[2]!, vendorId: short[3]!, form: 'short' };
  }
  if (!identifier.startsWith('WindowsRawInput')) return undefined;
  const productId = guid[1]!.toUpperCase();
  const vendorId = guid[2]!.toUpperCase();
  const before = identifier.slice('WindowsRawInput'.length, guid.index);
  const decimal = String(Number.parseInt(productId, 16));
  if (!before.endsWith(decimal)) return undefined;
  return {
    compactName: before.slice(0, before.length - decimal.length),
    vendorId,
    productId,
    form: 'guid',
  };
}

/** One binding: an action on one element of the controller. */
export interface ElementMap {
  actionCategoryId: number;
  actionId: number;
  /** 0 an axis, 1 a button. */
  elementType: number;
  elementIdentifierId: number;
  /** 0 the whole axis, 1 its positive half, 2 its negative half. */
  axisRange: number;
  invert: boolean;
  /** 0 the action's positive side, 1 its negative side. */
  axisContribution: number;
  /** Unity's KeyCode on the keyboard; 0 elsewhere. */
  keyboardKeyCode: number;
  modifierKeys: [number, number, number];
  enabled: boolean;
}

export type MapKind = 'JoystickMap' | 'KeyboardMap' | 'MouseMap';

export interface ControllerMap {
  kind: MapKind;
  /** The product name with its spaces, on a joystick map; empty when the file has none. */
  hardwareName: string;
  categoryId: number;
  layoutId: number;
  hardwareGuid: string;
  buttonMaps: ElementMap[];
  axisMaps: ElementMap[];
  /** The pieces around the bindings, kept so the document can be put together again. */
  source: MapSource;
}

/** How a list of bindings was written: with elements, as an empty pair, or self-closed. */
type ListForm = 'absent' | 'self-closed' | 'open';

interface MapSource {
  /** Everything before the first list of bindings. */
  head: string;
  /** Everything after the last list of bindings. */
  tail: string;
  /** The text between the two lists, when both are there. */
  between: string;
  buttons: ListForm;
  axes: ListForm;
  /** The value ended with the zero byte Unity writes after a string. */
  terminated: boolean;
}

const FIELDS = [
  'actionCategoryId',
  'actionId',
  'elementType',
  'elementIdentifierId',
  'axisRange',
  'invert',
  'axisContribution',
  'keyboardKeyCode',
  'modifierKey1',
  'modifierKey2',
  'modifierKey3',
  'enabled',
] as const;

const ELEMENT = new RegExp(
  `^<ActionElementMap>${FIELDS.map((f) => `<${f}>([^<]*)</${f}>`).join('')}</ActionElementMap>`
);

const INTEGER = /^-?\d{1,9}$/;

function elementFrom(values: string[]): ElementMap | undefined {
  const numbers: number[] = [];
  const flags: boolean[] = [];
  for (const [index, field] of FIELDS.entries()) {
    const text = values[index]!;
    if (field === 'invert' || field === 'enabled') {
      if (text !== 'true' && text !== 'false') return undefined;
      flags.push(text === 'true');
    } else {
      if (!INTEGER.test(text)) return undefined;
      numbers.push(Number(text));
    }
  }
  const [actionCategoryId, actionId, elementType, elementIdentifierId, axisRange] = numbers;
  const [axisContribution, keyboardKeyCode, m1, m2, m3] = numbers.slice(5);
  return {
    actionCategoryId: actionCategoryId!,
    actionId: actionId!,
    elementType: elementType!,
    elementIdentifierId: elementIdentifierId!,
    axisRange: axisRange!,
    invert: flags[0]!,
    axisContribution: axisContribution!,
    keyboardKeyCode: keyboardKeyCode!,
    modifierKeys: [m1!, m2!, m3!],
    enabled: flags[1]!,
  };
}

function elementText(e: ElementMap): string {
  const values = [
    e.actionCategoryId,
    e.actionId,
    e.elementType,
    e.elementIdentifierId,
    e.axisRange,
    e.invert,
    e.axisContribution,
    e.keyboardKeyCode,
    ...e.modifierKeys,
    e.enabled,
  ];
  return `<ActionElementMap>${FIELDS.map((f, i) => `<${f}>${String(values[i])}</${f}>`).join('')}</ActionElementMap>`;
}

interface ListAt {
  form: ListForm;
  /** Where the list starts and ends in the document; both the same when it is absent. */
  start: number;
  end: number;
  elements: ElementMap[];
}

function readList(text: string, tag: 'buttonMaps' | 'axisMaps', from: number): Result<ListAt> {
  const selfClosed = `<${tag} />`;
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const atSelf = text.indexOf(selfClosed, from);
  const atOpen = text.indexOf(open, from);
  if (atOpen < 0 && atSelf < 0) return ok({ form: 'absent', start: from, end: from, elements: [] });
  if (atOpen < 0 || (atSelf >= 0 && atSelf < atOpen)) {
    return ok({
      form: 'self-closed',
      start: atSelf,
      end: atSelf + selfClosed.length,
      elements: [],
    });
  }
  const elements: ElementMap[] = [];
  let at = atOpen + open.length;
  while (!text.startsWith(close, at)) {
    const match = ELEMENT.exec(text.slice(at, at + 2000));
    if (!match) {
      return err(
        'nuclear-option.map',
        `A binding in ${tag} is not written the way Rewired writes one.`,
        text.slice(at, at + 80)
      );
    }
    const element = elementFrom(match.slice(1));
    if (!element) {
      return err('nuclear-option.map', `A binding in ${tag} holds a value that is not a number.`);
    }
    elements.push(element);
    at += match[0].length;
  }
  return ok({ form: 'open', start: atOpen, end: at + close.length, elements });
}

const ROOT = /<(JoystickMap|KeyboardMap|MouseMap)\b([^>]*)>/;

function tagText(text: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text);
  return match?.[1];
}

const unescapeXml = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** The largest document read: a real map with every action bound is about 30 KB. */
const MAX_LENGTH = 2_000_000;

/**
 * One saved controller map. Never throws: a document that is not one, or that holds a
 * binding written another way, is refused with the reason.
 */
export function parseControllerMap(document: string): Result<ControllerMap> {
  if (document.length > MAX_LENGTH) {
    return err('nuclear-option.map', 'The saved map is larger than any the game writes.');
  }
  const terminated = document.endsWith('\0');
  const text = terminated ? document.slice(0, -1) : document;
  const root = ROOT.exec(text);
  if (!root) return err('nuclear-option.map', 'This is not a controller map saved by Rewired.');
  const kind = root[1] as MapKind;

  const buttons = readList(text, 'buttonMaps', root.index);
  if (!buttons.ok) return buttons;
  const axes = readList(text, 'axisMaps', buttons.value.end);
  if (!axes.ok) return axes;

  const firstStart = buttons.value.form === 'absent' ? axes.value.start : buttons.value.start;
  const head = text.slice(0, firstStart);
  const lastEnd = axes.value.form === 'absent' ? buttons.value.end : axes.value.end;
  const between =
    buttons.value.form !== 'absent' && axes.value.form !== 'absent'
      ? text.slice(buttons.value.end, axes.value.start)
      : '';

  const number = (tag: string): number => {
    const value = tagText(head, tag);
    return value !== undefined && INTEGER.test(value) ? Number(value) : 0;
  };
  const name = /\bhardwareName="([^"]*)"/.exec(root[2]!);
  return ok({
    kind,
    hardwareName: name ? unescapeXml(name[1]!) : '',
    categoryId: number('categoryId'),
    layoutId: number('layoutId'),
    hardwareGuid: tagText(head, 'hardwareGuid') ?? '',
    buttonMaps: buttons.value.elements,
    axisMaps: axes.value.elements,
    source: {
      head,
      tail: text.slice(lastEnd),
      between,
      buttons: buttons.value.form,
      axes: axes.value.form,
      terminated,
    },
  });
}

function listText(tag: string, form: ListForm, elements: ElementMap[]): string {
  if (form === 'absent') return '';
  if (form === 'self-closed' && elements.length === 0) return `<${tag} />`;
  return `<${tag}>${elements.map(elementText).join('')}</${tag}>`;
}

/** The document a parsed map came from, character for character when nothing was changed. */
export function serializeControllerMap(map: ControllerMap): string {
  const s = map.source;
  return (
    s.head +
    listText('buttonMaps', s.buttons, map.buttonMaps) +
    s.between +
    listText('axisMaps', s.axes, map.axisMaps) +
    s.tail +
    (s.terminated ? '\0' : '')
  );
}

/**
 * The text of a PlayerPrefs string as the registry port gives it (REG_BINARY as hex):
 * UTF-8, whatever the XML declaration inside says, with the zero byte Unity ends it with.
 */
export function textOfBinary(hex: string): string | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return undefined;
  return Buffer.from(hex, 'hex').toString('utf8');
}
