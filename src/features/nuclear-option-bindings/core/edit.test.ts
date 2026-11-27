import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearMapText, editMapText, type BindingEdit } from './edit';
import { parseControllerMap } from './rewired';

/**
 * The writer on fixtures/nuclear-option: one controller button bound, moved or cleared in
 * a saved map, written the way the game writes a binding the player made, with every other
 * character left as it was.
 */
const dir = path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'nuclear-option');
const fixture = (name: string): Promise<string> => fs.readFile(path.join(dir, name), 'utf8');

/** A button binding as the game writes one the player made. */
const made = (actionId: number, elementId: number): string =>
  `<ActionElementMap><actionCategoryId>-1</actionCategoryId><actionId>${actionId}</actionId><elementType>1</elementType><elementIdentifierId>${elementId}</elementIdentifierId><axisRange>1</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>0</modifierKey1><modifierKey2>0</modifierKey2><modifierKey3>0</modifierKey3><enabled>true</enabled></ActionElementMap>`;

function ok<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('changing one binding in a saved map', () => {
  it('binds an action that was not bound: one binding added at the end of the buttons, nothing else changed', async () => {
    const text = await fixture('stick.xml');
    // Toggle Navigation Lights (49) to button 12, which is element 43.
    const edited = ok(editMapText(text, { actionId: 49, button: 12 }));
    expect(edited).toMatchObject({ before: [], same: false, alsoOn: [] });
    expect(edited.text).toBe(text.replace('</buttonMaps>', `${made(49, 43)}</buttonMaps>`));
    expect(edited.text.length).toBe(text.length + made(49, 43).length);
  });

  it('moves an action to another button in place, and says what else is on that button', async () => {
    const text = await fixture('stick.xml');
    // Next Weapon (9) is on button 3 (element 34); move it to button 1, where Fire is.
    const edited = ok(editMapText(text, { actionId: 9, button: 1 }));
    expect(edited).toMatchObject({
      before: [{ kind: 'button', button: 3 }],
      same: false,
      alsoOn: ['Fire'],
    });
    const map = ok(parseControllerMap(edited.text));
    expect(map.buttonMaps.map((e) => [e.actionId, e.elementIdentifierId])).toEqual([
      [5, 32],
      [7, 33],
      [8, 36],
      [9, 32],
      [43, 35],
      [12, 50],
    ]);
    // Only that binding's text differs.
    const was = ok(parseControllerMap(text)).buttonMaps[3]!;
    expect(was).toMatchObject({ actionId: 9, elementIdentifierId: 34, actionCategoryId: 0 });
    expect(edited.text).toContain(made(9, 32));
    expect(edited.text.replace(made(9, 32), '')).toBe(
      text.replace(
        '<ActionElementMap><actionCategoryId>0</actionCategoryId><actionId>9</actionId><elementType>1</elementType><elementIdentifierId>34</elementIdentifierId><axisRange>1</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>0</modifierKey1><modifierKey2>0</modifierKey2><modifierKey3>0</modifierKey3><enabled>true</enabled></ActionElementMap>',
        ''
      )
    );
  });

  it('clears a binding by taking it out, and an emptied list is written as the game writes an empty one', async () => {
    const text = await fixture('stick.xml');
    const cleared = ok(editMapText(text, { actionId: 43, button: null }));
    expect(cleared).toMatchObject({ before: [{ kind: 'button', button: 4 }], same: false });
    expect(ok(parseControllerMap(cleared.text)).buttonMaps.map((e) => e.actionId)).toEqual([
      5, 7, 8, 9, 12,
    ]);

    // A map with one button binding: cleared, the list closes on itself; bound again, it opens.
    const one = text.replace(
      /<buttonMaps>.*<\/buttonMaps>/,
      `<buttonMaps>${made(5, 32)}</buttonMaps>`
    );
    const none = ok(editMapText(one, { actionId: 5, button: null }));
    expect(none.text).toBe(one.replace(/<buttonMaps>.*<\/buttonMaps>/, '<buttonMaps />'));
    const back = ok(editMapText(none.text, { actionId: 5, button: 1 }));
    expect(back.text).toBe(one);
    // The throttle's chat map has no bindings at all, written as two empty lists.
    const chat = await fixture('throttle-chat.xml');
    const added = ok(editMapText(chat, { actionId: 34, button: 2 }));
    expect(added.text).toBe(
      chat.replace('<buttonMaps />', `<buttonMaps>${made(34, 33)}</buttonMaps>`)
    );
  });

  it('changes nothing when the action is already there, or already unbound', async () => {
    const text = await fixture('stick.xml');
    // Target Select (7) is a binding the player made, on button 2.
    expect(ok(editMapText(text, { actionId: 7, button: 2 }))).toMatchObject({
      text,
      same: true,
      before: [{ kind: 'button', button: 2 }],
    });
    expect(ok(editMapText(text, { actionId: 49, button: null }))).toMatchObject({
      text,
      same: true,
      before: [],
    });
  });

  it('keeps the zero byte the game ends the value with', async () => {
    const text = `${await fixture('stick.xml')}\0`;
    const edited = ok(editMapText(text, { actionId: 49, button: 12 }));
    expect(edited.text.endsWith('</JoystickMap>\0')).toBe(true);
  });

  it('leaves alone a map it would not write back exactly, and a controller the game has a definition of its own for', async () => {
    const stick = await fixture('stick.xml');
    // Another action's number written another way: the parser reads it, and writing the map
    // again would change that binding's text though nobody asked.
    const padded = stick.replace('<actionId>5</actionId>', '<actionId>005</actionId>');
    expect(padded).not.toBe(stick);
    const form = editMapText(padded, { actionId: 49, button: 12 });
    expect(form.ok).toBe(false);
    if (!form.ok) {
      expect(form.error.code).toBe('nuclear-option.edit.form');
      expect(form.error.message).toContain('would not write back exactly');
    }
    // A gamepad Rewired knows: its buttons are numbered by Rewired's definition, not from 32.
    const known = stick
      .split('00000000-0000-0000-0000-000000000000')
      .join('d74a350e-fe8b-4e9e-bbcd-efff16d34115');
    expect(known).not.toBe(stick);
    const definition = editMapText(known, { actionId: 49, button: 12 });
    expect(definition.ok).toBe(false);
    if (!definition.ok) {
      expect(definition.error.code).toBe('nuclear-option.edit.definition');
      expect(definition.error.message).toContain('a definition of its own');
    }
  });

  it('clears a whole controller: what is left is the map as the game saves one with nothing bound', async () => {
    const throttle = await fixture('throttle.xml');
    const cleared = ok(clearMapText(throttle));
    expect(cleared.removed).toBe(8);
    expect(cleared.text).not.toContain('ActionElementMap');
    // The game's own empty map of the same controller (its Chat map) differs in the
    // category and the map's number only.
    const chat = await fixture('throttle-chat.xml');
    const sameButForIds = (text: string): string =>
      text
        .replace(/<sourceMapId>\d+<\/sourceMapId>/, '')
        .replace(/<categoryId>\d+<\/categoryId>/, '');
    expect(sameButForIds(cleared.text)).toBe(sameButForIds(chat));
    // A map with nothing bound is left as it is.
    expect(ok(clearMapText(chat))).toEqual({ text: chat, removed: 0 });
    expect(ok(clearMapText(cleared.text))).toEqual({ text: cleared.text, removed: 0 });
  });

  it('does not clear the keyboard, the mouse, a controller the game has a definition for, or a map it would not write back exactly', async () => {
    for (const name of ['keyboard.xml', 'mouse.xml']) {
      const refused = clearMapText(await fixture(name));
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe('nuclear-option.edit.kind');
    }
    const stick = await fixture('stick.xml');
    const known = clearMapText(
      stick
        .split('00000000-0000-0000-0000-000000000000')
        .join('d74a350e-fe8b-4e9e-bbcd-efff16d34115')
    );
    expect(known.ok).toBe(false);
    if (!known.ok) expect(known.error.code).toBe('nuclear-option.edit.definition');
    const padded = clearMapText(
      stick.replace('<actionId>5</actionId>', '<actionId>005</actionId>')
    );
    expect(padded.ok).toBe(false);
    if (!padded.ok) expect(padded.error.code).toBe('nuclear-option.edit.form');
    expect(clearMapText('not a map').ok).toBe(false);
  });

  describe('an axis of the controller on an axis action', () => {
    /** An axis binding as the game writes one the player made. */
    const axisMade = (actionId: number, index: number, invert: boolean): string =>
      `<ActionElementMap><actionCategoryId>-1</actionCategoryId><actionId>${actionId}</actionId><elementType>0</elementType><elementIdentifierId>${index}</elementIdentifierId><axisRange>0</axisRange><invert>${invert}</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>0</modifierKey1><modifierKey2>0</modifierKey2><modifierKey3>0</modifierKey3><enabled>true</enabled></ActionElementMap>`;

    it('binds an axis action that had none: one binding added at the end of the axes, nothing else changed', async () => {
      const text = await fixture('stick.xml');
      // Yaw Axis (2) on the controller's third axis (2), as it is.
      const edited = ok(editMapText(text, { actionId: 2, axis: { index: 2, invert: false } }));
      expect(edited).toMatchObject({ before: [], same: false, alsoOn: [] });
      expect(edited.text).toBe(text.replace('</axisMaps>', `${axisMade(2, 2, false)}</axisMaps>`));
    });

    it('moves an axis action to another axis in place, reversed or not, and says what else is on that axis', async () => {
      const text = await fixture('stick.xml');
      // Pitch Axis (0) is on axis 1, reversed; put it on axis 0, where Roll Axis is.
      const edited = ok(editMapText(text, { actionId: 0, axis: { index: 0, invert: false } }));
      expect(edited).toMatchObject({
        before: [{ kind: 'axis', index: 1, invert: true }],
        same: false,
        alsoOn: ['Roll Axis'],
      });
      const map = ok(parseControllerMap(edited.text));
      expect(map.axisMaps.map((e) => [e.actionId, e.elementIdentifierId, e.invert])).toEqual([
        [0, 0, false],
        [1, 0, false],
      ]);
      // The buttons are as they were, character for character.
      expect(edited.text.split('<axisMaps>')[0]).toBe(text.split('<axisMaps>')[0]);
      // Only reversing it is a change too; the same axis the same way is not.
      const reversed = ok(editMapText(text, { actionId: 0, axis: { index: 1, invert: false } }));
      expect(reversed.same).toBe(false);
      expect(reversed.text).toContain(axisMade(0, 1, false));
      const asItIs = ok(editMapText(text, { actionId: 0, axis: { index: 1, invert: true } }));
      expect(asItIs).toMatchObject({ same: true, text });
    });

    it('clears an axis binding, and the list that loses its last one is written as the game writes an empty one', async () => {
      const text = await fixture('stick.xml');
      const one = ok(editMapText(text, { actionId: 0, axis: null }));
      expect(one.before).toEqual([{ kind: 'axis', index: 1, invert: true }]);
      const none = ok(editMapText(one.text, { actionId: 1, axis: null }));
      expect(none.text).toContain('<axisMaps />');
      expect(ok(parseControllerMap(none.text)).axisMaps).toEqual([]);
      // And the first axis bound into an empty list opens it again.
      const back = ok(editMapText(none.text, { actionId: 1, axis: { index: 0, invert: false } }));
      expect(back.text).toContain(`<axisMaps>${axisMade(1, 0, false)}</axisMaps>`);
      expect(ok(editMapText(none.text, { actionId: 2, axis: null }))).toMatchObject({
        same: true,
        before: [],
      });
    });

    it('leaves alone an axis action bound to half an axis', async () => {
      const text = await fixture('stick.xml');
      const half = text.replace(
        '<actionId>0</actionId><elementType>0</elementType><elementIdentifierId>1</elementIdentifierId><axisRange>0</axisRange>',
        '<actionId>0</actionId><elementType>0</elementType><elementIdentifierId>1</elementIdentifierId><axisRange>1</axisRange>'
      );
      expect(half).not.toBe(text);
      const result = editMapText(half, { actionId: 0, axis: { index: 2, invert: false } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('does not understand');
    });
  });

  describe('a button on one side of an axis action', () => {
    it('binds each side on its own: the positive side as the game writes it, the negative with what tells it apart', async () => {
      const text = await fixture('stick.xml');
      // Zoom In (25, +) on button 20, element 51.
      const zoomIn = ok(editMapText(text, { actionId: 25, side: '+', button: 20 }));
      expect(zoomIn).toMatchObject({ before: [], same: false, alsoOn: [] });
      expect(zoomIn.text).toBe(text.replace('</buttonMaps>', `${made(25, 51)}</buttonMaps>`));
      // Zoom Out (25, -) on button 21: the same binding with axisContribution 1.
      const both = ok(editMapText(zoomIn.text, { actionId: 25, side: '-', button: 21 }));
      expect(both.before).toEqual([]);
      const out = made(25, 52).replace(
        '<axisContribution>0</axisContribution>',
        '<axisContribution>1</axisContribution>'
      );
      expect(both.text).toBe(zoomIn.text.replace('</buttonMaps>', `${out}</buttonMaps>`));
      // Moving one side leaves the other where it is.
      const moved = ok(editMapText(both.text, { actionId: 25, side: '+', button: 22 }));
      expect(moved.before).toEqual([{ kind: 'button', button: 20 }]);
      const sides = ok(parseControllerMap(moved.text))
        .buttonMaps.filter((e) => e.actionId === 25)
        .map((e) => [e.elementIdentifierId, e.axisContribution]);
      expect(sides).toEqual([
        [53, 0],
        [52, 1],
      ]);
      // A side put on the other side's button is told so by the other side's name.
      expect(ok(editMapText(both.text, { actionId: 25, side: '+', button: 21 })).alsoOn).toEqual([
        'Zoom Out',
      ]);
      // Clearing one side leaves the other.
      const cleared = ok(editMapText(both.text, { actionId: 25, side: '-', button: null }));
      expect(
        ok(parseControllerMap(cleared.text)).buttonMaps.filter((e) => e.actionId === 25)
      ).toHaveLength(1);
      expect(cleared.text).toBe(zoomIn.text);
    });

    it('changing or clearing the whole axis leaves the buttons on its sides as they are, character for character', async () => {
      const text = await fixture('stick.xml');
      const withSides = ok(
        editMapText(ok(editMapText(text, { actionId: 0, side: '+', button: 30 })).text, {
          actionId: 0,
          side: '-',
          button: 31,
        })
      ).text;
      const buttons = (document: string): string => document.split('<axisMaps')[0]!;
      const moved = ok(editMapText(withSides, { actionId: 0, axis: { index: 0, invert: false } }));
      expect(buttons(moved.text)).toBe(buttons(withSides));
      const cleared = ok(editMapText(withSides, { actionId: 0, axis: null }));
      expect(buttons(cleared.text)).toBe(buttons(withSides));
      expect(ok(parseControllerMap(cleared.text)).axisMaps.map((e) => e.actionId)).toEqual([1]);
    });

    it('leaves a side alone when half an axis drives the action, or when the side has a binding it does not understand', async () => {
      const text = await fixture('stick.xml');
      const half = text.replace(
        '<actionId>0</actionId><elementType>0</elementType><elementIdentifierId>1</elementIdentifierId><axisRange>0</axisRange>',
        '<actionId>0</actionId><elementType>0</elementType><elementIdentifierId>1</elementIdentifierId><axisRange>1</axisRange>'
      );
      expect(half).not.toBe(text);
      const onHalf = editMapText(half, { actionId: 0, side: '+', button: 30 });
      expect(onHalf.ok).toBe(false);
      if (!onHalf.ok) expect(onHalf.error.message).toContain('has half an axis bound here');
      // A side whose button is held with a modifier key.
      const sided = ok(editMapText(text, { actionId: 25, side: '+', button: 20 })).text;
      const odd = sided.replace(
        '<actionId>25</actionId><elementType>1</elementType><elementIdentifierId>51</elementIdentifierId><axisRange>1</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>0<',
        '<actionId>25</actionId><elementType>1</elementType><elementIdentifierId>51</elementIdentifierId><axisRange>1</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>1<'
      );
      expect(odd).not.toBe(sided);
      const onOdd = editMapText(odd, { actionId: 25, side: '+', button: 21 });
      expect(onOdd.ok).toBe(false);
      if (!onOdd.ok) expect(onOdd.error.message).toContain('does not understand');
      // The other side is not held up by it.
      expect(editMapText(odd, { actionId: 25, side: '-', button: 21 }).ok).toBe(true);
    });

    it('"already so" means every field as it would be written: a binding that differs in one is written again', async () => {
      const text = await fixture('stick.xml');
      // Fire (5) is the game's default on button 1 (category 0): asked for again, nothing to save.
      expect(ok(editMapText(text, { actionId: 5, button: 1 }))).toMatchObject({ same: true, text });
      // The same button, switched off in the saved map: asking for it is a change.
      const off = text.replace(
        '<actionId>5</actionId><elementType>1</elementType><elementIdentifierId>32</elementIdentifierId><axisRange>1</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>0</modifierKey1><modifierKey2>0</modifierKey2><modifierKey3>0</modifierKey3><enabled>true</enabled>',
        '<actionId>5</actionId><elementType>1</elementType><elementIdentifierId>32</elementIdentifierId><axisRange>1</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>0</modifierKey1><modifierKey2>0</modifierKey2><modifierKey3>0</modifierKey3><enabled>false</enabled>'
      );
      expect(off).not.toBe(text);
      expect(ok(editMapText(off, { actionId: 5, button: 1 })).same).toBe(false);
      // The game's real defaults have axisRange 0 on a button: still the same button.
      const real = text.replace(
        '<actionId>5</actionId><elementType>1</elementType><elementIdentifierId>32</elementIdentifierId><axisRange>1</axisRange>',
        '<actionId>5</actionId><elementType>1</elementType><elementIdentifierId>32</elementIdentifierId><axisRange>0</axisRange>'
      );
      expect(real).not.toBe(text);
      expect(ok(editMapText(real, { actionId: 5, button: 1 }))).toMatchObject({
        same: true,
        text: real,
      });
    });

    it('a side and the whole axis are bound side by side', async () => {
      const text = await fixture('stick.xml');
      // Pitch Axis is on an axis here; Pitch Up also goes on a button.
      const edited = ok(editMapText(text, { actionId: 0, side: '+', button: 30 }));
      expect(edited.text).toBe(text.replace('</buttonMaps>', `${made(0, 61)}</buttonMaps>`));
    });
  });

  describe('a key of the keyboard', () => {
    /** A key binding as the game wrote one the player made (Toggle Engine on F7, 27 Nov 2026). */
    const keyMade = (
      actionId: number,
      element: number,
      keyCode: number,
      mods: [number, number, number] = [0, 0, 0],
      contribution = 0
    ): string =>
      `<ActionElementMap><actionCategoryId>0</actionCategoryId><actionId>${actionId}</actionId><elementType>1</elementType><elementIdentifierId>${element}</elementIdentifierId><axisRange>0</axisRange><invert>false</invert><axisContribution>${contribution}</axisContribution><keyboardKeyCode>${keyCode}</keyboardKeyCode><modifierKey1>${mods[0]}</modifierKey1><modifierKey2>${mods[1]}</modifierKey2><modifierKey3>${mods[2]}</modifierKey3><enabled>true</enabled></ActionElementMap>`;
    const F7 = { element: 104, keyCode: 288, modifiers: [] };
    const G = { element: 7, modifiers: [] };
    const keysOf = (text: string, actionId: number): [number, number, number[]][] =>
      ok(parseControllerMap(text))
        .buttonMaps.filter((e) => e.actionId === actionId)
        .map((e) => [e.elementIdentifierId, e.axisContribution, e.modifierKeys]);

    it('binds an action that had no key exactly as the game wrote it: one binding at the end, nothing else changed', async () => {
      const text = await fixture('keyboard.xml');
      const edited = ok(editMapText(text, { actionId: 50, key: F7 }));
      expect(edited).toMatchObject({ before: [], same: false, alsoOn: [] });
      expect(edited.after).toEqual([{ kind: 'key', keyCode: 288, modifiers: [] }]);
      expect(edited.text).toBe(
        text.replace('</buttonMaps>', `${keyMade(50, 104, 288)}</buttonMaps>`)
      );
    });

    it('changes the key a row is on in place, with the modifier keys in the game’s order, and says what else that key with those modifiers does', async () => {
      const text = await fixture('keyboard.xml');
      // Toggle Gear (11) is on G. Ctrl + Shift + E is Eject; E alone is nothing.
      const toEject = ok(
        editMapText(text, {
          actionId: 11,
          replaces: G,
          key: { element: 5, keyCode: 101, modifiers: [3, 1] },
        })
      );
      expect(toEject).toMatchObject({
        before: [{ kind: 'key', keyCode: 103, modifiers: [] }],
        after: [{ kind: 'key', keyCode: 101, modifiers: [1, 3] }],
        same: false,
        alsoOn: ['Eject'],
      });
      expect(toEject.text).toBe(text.replace(keyMade(11, 7, 103), keyMade(11, 5, 101, [1, 3, 0])));
      const plain = ok(
        editMapText(text, {
          actionId: 11,
          replaces: G,
          key: { element: 5, keyCode: 101, modifiers: [] },
        })
      );
      expect(plain.alsoOn).toEqual([]);
      // The same key and modifiers it has is no change, whatever order they are given in.
      expect(
        ok(
          editMapText(text, {
            actionId: 16,
            replaces: { element: 5, modifiers: [1, 3] },
            key: { element: 5, keyCode: 101, modifiers: [3, 1] },
          })
        )
      ).toMatchObject({ same: true, text });
      // A clash is seen also when the saved map holds the modifier keys in another order.
      const reordered = text.replace(
        keyMade(16, 5, 101, [1, 3, 0]),
        keyMade(16, 5, 101, [3, 1, 0])
      );
      expect(reordered).not.toBe(text);
      expect(
        ok(
          editMapText(reordered, {
            actionId: 11,
            replaces: G,
            key: { element: 5, keyCode: 101, modifiers: [1, 3] },
          })
        ).alsoOn
      ).toEqual(['Eject']);
    });

    it('an action has up to two keys, as on the game’s screen: a bind adds one, a row changes or clears its own, and a third is refused', async () => {
      const text = await fixture('keyboard.xml');
      // Toggle Gear (11) is on G; F7 is added beside it.
      const two = ok(editMapText(text, { actionId: 11, key: F7 }));
      expect(two.before).toEqual([{ kind: 'key', keyCode: 103, modifiers: [] }]);
      expect(two.after).toEqual([
        { kind: 'key', keyCode: 103, modifiers: [] },
        { kind: 'key', keyCode: 288, modifiers: [] },
      ]);
      expect(two.text).toBe(text.replace('</buttonMaps>', `${keyMade(11, 104, 288)}</buttonMaps>`));
      // The key it already has, asked for again, is nothing to save.
      expect(ok(editMapText(two.text, { actionId: 11, key: F7 }))).toMatchObject({
        same: true,
        text: two.text,
      });
      // A third key is refused.
      const third = editMapText(two.text, {
        actionId: 11,
        key: { element: 8, keyCode: 104, modifiers: [] },
      });
      expect(third.ok).toBe(false);
      if (!third.ok) expect(third.error.message).toContain('already has two keys');
      // Change on the G row touches G only; F7 stays.
      const changed = ok(
        editMapText(two.text, {
          actionId: 11,
          replaces: G,
          key: { element: 8, keyCode: 104, modifiers: [] },
        })
      );
      expect(keysOf(changed.text, 11)).toEqual([
        [8, 0, [0, 0, 0]],
        [104, 0, [0, 0, 0]],
      ]);
      // Clear on the F7 row leaves G, and the map as it was before F7 was added.
      const cleared = ok(
        editMapText(two.text, {
          actionId: 11,
          replaces: { element: 104, modifiers: [] },
          key: null,
        })
      );
      expect(cleared.text).toBe(text);
      expect(cleared.after).toEqual([{ kind: 'key', keyCode: 103, modifiers: [] }]);
      // One row changed to the key the other row has: one binding of it is left, not two.
      const merged = ok(editMapText(two.text, { actionId: 11, replaces: G, key: F7 }));
      expect(keysOf(merged.text, 11)).toEqual([[104, 0, [0, 0, 0]]]);
      // With no row named, a clear takes both.
      const both = ok(editMapText(two.text, { actionId: 11, key: null }));
      expect(keysOf(both.text, 11)).toEqual([]);
      expect(both.after).toEqual([]);
      // A row whose key is no longer there is said so.
      const gone = editMapText(text, {
        actionId: 11,
        replaces: { element: 104, modifiers: [] },
        key: F7,
      });
      expect(gone.ok).toBe(false);
      if (!gone.ok) expect(gone.error.message).toContain('is no longer on that key');
    });

    it('binds each side of an axis action on its own, and clears one without the other', async () => {
      const text = await fixture('keyboard.xml');
      // Pitch Axis (0): the fixture has W on its negative side and S on its positive side.
      const up = ok(
        editMapText(text, {
          actionId: 0,
          side: '+',
          replaces: { element: 19, modifiers: [] },
          key: { element: 89, keyCode: 273, modifiers: [] },
        })
      );
      expect(up.before).toEqual([{ kind: 'key', keyCode: 115, modifiers: [] }]);
      expect(up.text).toBe(text.replace(keyMade(0, 19, 115), keyMade(0, 89, 273)));
      const cleared = ok(editMapText(text, { actionId: 0, side: '-', key: null }));
      expect(cleared.before).toEqual([{ kind: 'key', keyCode: 119, modifiers: [] }]);
      expect(cleared.text).toBe(text.replace(keyMade(0, 23, 119, [0, 0, 0], 1), ''));
      expect(ok(editMapText(text, { actionId: 50, key: null }))).toMatchObject({
        same: true,
        before: [],
      });
    });

    it('refuses a whole axis on a key, a button or an axis on the keyboard, and a key that is not one', async () => {
      const text = await fixture('keyboard.xml');
      const refused = (edit: BindingEdit): string => {
        const result = editMapText(text, edit);
        expect(result.ok, JSON.stringify(edit)).toBe(false);
        return result.ok ? '' : result.error.message;
      };
      expect(refused({ actionId: 0, key: F7 })).toContain(
        'Pitch Axis is an axis: bind a key to one of its sides (Pitch Up or Pitch Down)'
      );
      expect(refused({ actionId: 50, side: '+', key: F7 })).toContain('has no sides');
      expect(refused({ actionId: 50, axis: { index: 0, invert: false } })).toContain(
        'The keyboard has keys'
      );
      expect(refused({ actionId: 99, key: F7 })).toContain('does not know this action');
      expect(refused({ actionId: 50 })).toContain('Nothing was chosen');
      for (const key of [
        { element: 0, keyCode: 288, modifiers: [] },
        { element: 104, keyCode: 0, modifiers: [] },
        { element: 104, keyCode: 288, modifiers: [4] },
        { element: 104, keyCode: 288, modifiers: [1, 1] },
        { element: 104, keyCode: 288, modifiers: [1, 2, 3, 1] },
      ]) {
        expect(refused({ actionId: 50, key })).toContain('not a key RigReady can bind');
      }
    });
  });

  describe('a binding that takes its control over', () => {
    const element = (text: string, actionId: number): string => {
      const found = new RegExp(
        `<ActionElementMap><actionCategoryId>-?[0-9]+</actionCategoryId><actionId>${actionId}</actionId>.*?</ActionElementMap>`
      ).exec(text);
      if (!found) throw new Error(`no binding of action ${actionId}`);
      return found[0];
    };

    it('takes what else is on the button off it, and nothing more: the same text as the plain change without that binding', async () => {
      const text = await fixture('stick.xml');
      // Next Weapon (9) to button 1, where Fire (5) is.
      const plain = ok(editMapText(text, { actionId: 9, button: 1 }));
      const alone = ok(editMapText(text, { actionId: 9, button: 1, alone: true }));
      expect(alone).toMatchObject({
        before: [{ kind: 'button', button: 3 }],
        same: false,
        alsoOn: [],
        tookOff: ['Fire'],
      });
      expect(alone.text).toBe(plain.text.replace(element(plain.text, 5), ''));
      expect(ok(parseControllerMap(alone.text)).buttonMaps.some((e) => e.actionId === 5)).toBe(
        false
      );
      // A plain change says nothing of taking off.
      expect(plain.tookOff).toBeUndefined();
    });

    it('a binding already in place still frees its control, and is "the same" only when nothing else is on it', async () => {
      const text = await fixture('stick.xml');
      const there = ok(editMapText(text, { actionId: 5, button: 1, alone: true }));
      expect(there).toMatchObject({ same: true, tookOff: [] });
      expect(there.text).toBe(text);
      // With Next Weapon on the trigger too, Fire taking it over takes that off.
      const both = ok(editMapText(text, { actionId: 9, button: 1 }));
      const freed = ok(editMapText(both.text, { actionId: 5, button: 1, alone: true }));
      expect(freed).toMatchObject({ same: false, tookOff: ['Next Weapon'] });
      expect(freed.text).toBe(both.text.replace(element(both.text, 9), ''));
    });

    it('frees an axis the same way, half an axis that is on it too, and a clear frees nothing', async () => {
      const text = await fixture('throttle.xml');
      // Custom Axis 1 (38) to the game's axis 2, where Throttle Axis (4) is.
      const plain = ok(editMapText(text, { actionId: 38, axis: { index: 2, invert: false } }));
      expect(plain.alsoOn).toEqual(['Throttle Axis']);
      const alone = ok(
        editMapText(text, { actionId: 38, axis: { index: 2, invert: false }, alone: true })
      );
      expect(alone).toMatchObject({ same: false, alsoOn: [], tookOff: ['Throttle Axis'] });
      expect(alone.text).toBe(plain.text.replace(element(plain.text, 4), ''));
      // Axis 3 has the positive half on Apply Brakes: it goes like a whole one.
      const half = ok(
        editMapText(text, { actionId: 38, axis: { index: 3, invert: false }, alone: true })
      );
      expect(half.tookOff).toEqual(['Apply Brakes']);
      expect(ok(parseControllerMap(half.text)).axisMaps.map((e) => e.actionId)).toEqual([4, 38]);
      // The buttons are as they were.
      expect(ok(parseControllerMap(half.text)).buttonMaps).toEqual(
        ok(parseControllerMap(text)).buttonMaps
      );
      const cleared = ok(editMapText(text, { actionId: 11, button: null, alone: true }));
      expect(cleared.tookOff).toBeUndefined();
      expect(cleared.text).toBe(ok(editMapText(text, { actionId: 11, button: null })).text);
    });
  });

  it('refuses what it has not seen the game write: an axis, a key, an unknown action, a button out of range, a damaged map', async () => {
    const stick = await fixture('stick.xml');
    const refused = (text: string, edit: BindingEdit): string => {
      const result = editMapText(text, edit);
      expect(result.ok, JSON.stringify(edit)).toBe(false);
      return result.ok ? '' : result.error.message;
    };
    // A button on an axis action needs the side it is for; an axis does not go on a button
    // action, nor on one side of an axis action.
    expect(refused(stick, { actionId: 0, button: 3 })).toContain(
      'Pitch Axis is an axis: bind it to an axis of the controller, or bind a button to one of its sides (Pitch Up or Pitch Down)'
    );
    expect(refused(stick, { actionId: 49, side: '+', button: 3 })).toContain('has no sides');
    expect(refused(stick, { actionId: 49, axis: { index: 2, invert: false } })).toContain(
      'Toggle Navigation Lights is a button'
    );
    expect(refused(stick, { actionId: 2, side: '+', axis: { index: 2, invert: false } })).toContain(
      'not to one side of it'
    );
    expect(refused(stick, { actionId: 2, axis: { index: 32, invert: false } })).toContain(
      'from 0 to 31'
    );
    expect(refused(stick, { actionId: 2, axis: { index: 1.5, invert: false } })).toContain(
      'from 0 to 31'
    );
    expect(refused(stick, { actionId: 2 })).toContain('Nothing was chosen');
    expect(refused(stick, { actionId: 2, button: 3, axis: { index: 2, invert: false } })).toContain(
      'not both'
    );
    expect(refused(stick, { actionId: 99, button: 3 })).toContain('does not know this action');
    expect(refused(stick, { actionId: 49, button: 0 })).toContain('buttons 1 to 128');
    expect(refused(stick, { actionId: 49, button: 129 })).toContain('buttons 1 to 128');
    expect(refused(stick, { actionId: 49, button: 2.5 })).toContain('buttons 1 to 128');
    expect(refused(await fixture('keyboard.xml'), { actionId: 11, button: 3 })).toContain(
      'The keyboard has keys'
    );
    expect(refused(await fixture('mouse.xml'), { actionId: 26, button: 3 })).toContain(
      'Change a mouse button in the game'
    );
    expect(
      refused(stick, { actionId: 49, key: { element: 104, keyCode: 288, modifiers: [] } })
    ).toContain('A key is bound on the keyboard, not on a controller');
    expect(refused('not a map', { actionId: 49, button: 3 })).toContain('not a controller map');
    // An action bound here in a way this code never saw (a button with a modifier key).
    const odd = stick.replace(
      '<actionId>43</actionId><elementType>1</elementType><elementIdentifierId>35</elementIdentifierId><axisRange>1</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>0<',
      '<actionId>43</actionId><elementType>1</elementType><elementIdentifierId>35</elementIdentifierId><axisRange>1</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>1<'
    );
    expect(odd).not.toBe(stick);
    expect(refused(odd, { actionId: 43, button: 9 })).toContain('does not understand');
  });
});
