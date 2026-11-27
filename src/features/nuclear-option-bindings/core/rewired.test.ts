import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseControllerMap,
  parseHardwareIdentifier,
  parseSaveKey,
  serializeControllerMap,
  textOfBinary,
} from './rewired';

/**
 * The parser on fixtures/nuclear-option: made-up maps in the exact shape the game's
 * Rewired library saves them (docs/research/nuclear-option.md, section 4).
 */
const dir = path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'nuclear-option');
const fixture = (name: string): Promise<string> => fs.readFile(path.join(dir, name), 'utf8');
const FILES = [
  'stick.xml',
  'stick-older.xml',
  'throttle.xml',
  'throttle-chat.xml',
  'pedals.xml',
  'keyboard.xml',
  'keyboard-chat.xml',
  'mouse.xml',
];

describe('Rewired save data', () => {
  it('every fixture map is read and put together again character for character', async () => {
    for (const name of FILES) {
      const text = await fixture(name);
      for (const document of [text, `${text}\0`]) {
        const map = parseControllerMap(document);
        expect(map.ok, name).toBe(true);
        if (map.ok) expect(serializeControllerMap(map.value), name).toBe(document);
      }
    }
  });

  it('reads what a joystick map holds: the controller, the category and each binding', async () => {
    const map = parseControllerMap(await fixture('throttle.xml'));
    if (!map.ok) throw new Error(map.error.message);
    expect(map.value).toMatchObject({
      kind: 'JoystickMap',
      hardwareName: 'Throttle - HOTAS Warthog',
      categoryId: 0,
      layoutId: 0,
      hardwareGuid: '00000000-0000-0000-0000-000000000000',
    });
    expect(map.value.buttonMaps).toHaveLength(5);
    expect(map.value.buttonMaps[3]).toEqual({
      actionCategoryId: 0,
      actionId: 25,
      elementType: 1,
      elementIdentifierId: 39,
      axisRange: 1,
      invert: false,
      axisContribution: 1,
      keyboardKeyCode: 0,
      modifierKeys: [0, 0, 0],
      enabled: true,
    });
    expect(map.value.axisMaps.map((a) => [a.actionId, a.elementIdentifierId, a.invert])).toEqual([
      [4, 2, true],
      [38, 4, false],
      [6, 3, false],
    ]);
  });

  it('reads a keyboard map with its key codes and modifier keys, and lists written empty', async () => {
    const keyboard = parseControllerMap(await fixture('keyboard.xml'));
    if (!keyboard.ok) throw new Error(keyboard.error.message);
    expect(keyboard.value.kind).toBe('KeyboardMap');
    expect(keyboard.value.axisMaps).toEqual([]);
    expect(keyboard.value.buttonMaps.at(-1)).toMatchObject({
      actionId: 16,
      keyboardKeyCode: 101,
      modifierKeys: [1, 3, 0],
    });
    const empty = parseControllerMap(await fixture('throttle-chat.xml'));
    if (!empty.ok) throw new Error(empty.error.message);
    expect(empty.value).toMatchObject({ categoryId: 1, buttonMaps: [], axisMaps: [] });
  });

  it('a changed binding is written the way the game writes one, and nothing else moves', async () => {
    const text = await fixture('stick.xml');
    const map = parseControllerMap(text);
    if (!map.ok) throw new Error(map.error.message);
    map.value.buttonMaps[0]!.elementIdentifierId = 40;
    expect(serializeControllerMap(map.value)).toBe(
      text.replace(
        '<actionId>5</actionId><elementType>1</elementType><elementIdentifierId>32<',
        '<actionId>5</actionId><elementType>1</elementType><elementIdentifierId>40<'
      )
    );
  });

  it('refuses what is not a map, or holds a binding written another way, with the reason', async () => {
    const text = await fixture('stick.xml');
    for (const damaged of [
      '',
      'not xml at all',
      '<InputBehavior dataVersion="5" id="0"></InputBehavior>',
      text.replace('<actionId>5</actionId>', '<actionId>five</actionId>'),
      text.replace('<enabled>true</enabled></ActionElementMap>', '</ActionElementMap>'),
      text.slice(0, text.indexOf('</buttonMaps>')),
      text.replace('<invert>false</invert>', '<invert>maybe</invert>'),
    ]) {
      const map = parseControllerMap(damaged);
      expect(map.ok, damaged.slice(0, 40)).toBe(false);
      if (!map.ok) expect(map.error.message.length).toBeGreaterThan(10);
    }
    expect(parseControllerMap('x'.repeat(2_000_001)).ok).toBe(false);
  });

  it('takes a registry value name apart, and leaves the game’s other values alone', () => {
    const key = parseSaveKey(
      'RewiredSaveData|playerName=Player0|dataType=ControllerMap|kv=2|controllerMapType=JoystickMap|categoryId=0|layoutId=0|hardwareGuid=00000000-0000-0000-0000-000000000000|hardwareIdentifier=WindowsRawInputThrottle-HOTASWarthog10280404044f-0000-0000-0000-504944564944|duplicate=1_h1100000002'
    );
    expect(key?.dataType).toBe('ControllerMap');
    expect(key?.parts).toMatchObject({
      playerName: 'Player0',
      controllerMapType: 'JoystickMap',
      categoryId: '0',
      duplicate: '1',
    });
    expect(
      parseSaveKey(
        'RewiredSaveData|playerName=Player0|dataType=ControllerMap_KnownActionIds|kv=2|controllerMapType=KeyboardMap_h5'
      )?.dataType
    ).toBe('ControllerMap_KnownActionIds');
    expect(parseSaveKey('RewiredSaveData_ControllerAssignments_h496393421')?.dataType).toBe(
      'ControllerAssignments'
    );
    expect(parseSaveKey('UseTrackIR_h3800713042')).toBeUndefined();
    expect(parseSaveKey('Screenmanager Resolution Width_h182942802')).toBeUndefined();
  });

  it('reads the controller model out of Rewired’s hardware identifier', () => {
    expect(
      parseHardwareIdentifier(
        'WindowsRawInputThrottle-HOTASWarthog10280404044f-0000-0000-0000-504944564944'
      )
    ).toEqual({
      compactName: 'Throttle-HOTASWarthog',
      vendorId: '044F',
      productId: '0404',
      form: 'guid',
    });
    // The shorter form later game builds write: the name, then the product and vendor ids.
    expect(parseHardwareIdentifier('WindowsRawInputJoystick-HOTASWarthog0402044F')).toEqual({
      compactName: 'Joystick-HOTASWarthog',
      vendorId: '044F',
      productId: '0402',
      form: 'short',
    });
    expect(parseHardwareIdentifier('WindowsRawInputGRIP-F16BEA84098')).toMatchObject({
      compactName: 'GRIP-F16',
      productId: 'BEA8',
      vendorId: '4098',
    });
    // A name that ends in a digit: the decimal product id says where the name stops.
    expect(
      parseHardwareIdentifier('WindowsRawInputPanel#145690b27a044f-0000-0000-0000-504944564944')
    ).toEqual({ compactName: 'Panel#1', vendorId: '044F', productId: 'B27A', form: 'guid' });
    expect(
      parseHardwareIdentifier('WindowsRawInputStick999990402044f-0000-0000-0000-504944564944')
    ).toBeUndefined();
    expect(parseHardwareIdentifier('ae4830f9-63db-4d4c-90b3-1beb46ecaf49')).toBeUndefined();
  });

  it('decodes a PlayerPrefs string from the registry’s bytes', () => {
    expect(textOfBinary(Buffer.from('Pitch\0', 'utf8').toString('hex'))).toBe('Pitch\0');
    expect(textOfBinary('abc')).toBeUndefined();
    expect(textOfBinary('zz')).toBeUndefined();
  });
});
