import { describe, expect, it } from 'vitest';
import type { PickerInfo } from '../contract';
import {
  GONE,
  applyChoice,
  choiceKey,
  chosenOf,
  filledKeys,
  followedBy,
  follows,
  formRows,
  isMissing,
  mergeFollowed,
  pickerItems,
  pickerNote,
  pickerOf,
  pickerRequired,
  requiredKeys,
  selectedKey,
  titleFromChoice,
  titleFromType,
} from './pickerForm';

/** CFG-PROFILE-019: a field chosen by name from a list, in place of a typed id. */

const FLYING = [{ id: 'A', x: 0, y: 0 }];
const RACING = [{ id: 'B', x: 0, y: 0 }];

const layouts: PickerInfo = {
  list: 'displays.layouts',
  param: 'layoutId',
  label: 'Layout',
  fills: ['layoutName', 'displays'],
  empty: 'You have no saved layout yet.',
  unpicked: 'No saved layout is chosen: this setup keeps the arrangement it was made with.',
  choices: [
    {
      value: 'flying',
      label: 'Flying',
      detail: '4 monitors, 3 on',
      fill: { layoutName: 'Flying', displays: FLYING },
    },
    {
      value: 'racing',
      label: 'Racing',
      detail: '4 monitors, 1 on',
      fill: { layoutName: 'Racing', displays: RACING },
    },
  ],
};

const pads: PickerInfo = {
  list: 'virtual-controller.profiles',
  param: 'profile',
  label: 'Virtual controller',
  fills: ['profileName'],
  empty: 'You have no virtual controller of your own yet.',
  choices: [
    {
      value: 'my-stick',
      label: 'My stick',
      detail: 'Xbox 360 controller · 8 inputs · id my-stick',
      fill: { profileName: 'My stick' },
    },
    {
      value: 'my-stick-2',
      label: 'My stick',
      detail: 'Xbox 360 controller · 12 inputs · id my-stick-2',
      fill: { profileName: 'My stick' },
      current: true,
    },
  ],
};

const LAYOUT_SCHEMA = {
  type: 'object',
  properties: {
    layoutId: { type: 'string' },
    layoutName: { type: 'string' },
    displays: { type: 'array', items: { type: 'object' } },
  },
  required: ['displays'],
};

describe('a field chosen from a list', () => {
  it('finds the list of a field, and the fields the list fills in by itself', () => {
    expect(pickerOf([layouts, pads], 'profile')).toBe(pads);
    expect(pickerOf([layouts], 'displays')).toBeUndefined();
    expect(pickerOf(undefined, 'layoutId')).toBeUndefined();
    expect([...filledKeys([layouts, pads])]).toEqual(['layoutName', 'displays', 'profileName']);
    expect(filledKeys(undefined).size).toBe(0);
  });

  it('shows each choice by name, and marks the one in use now', () => {
    expect(pickerItems(pads, {})).toEqual([
      {
        value: 'my-stick',
        title: 'My stick',
        subtitle: 'Xbox 360 controller · 8 inputs · id my-stick',
      },
      {
        value: 'my-stick-2',
        title: 'My stick (in use now)',
        subtitle: 'Xbox 360 controller · 12 inputs · id my-stick-2',
      },
    ]);
  });

  it('tells two of the same name apart with the list closed, by the line under it', () => {
    expect(pickerNote(pads, { profile: 'my-stick' })).toEqual({
      text: 'Xbox 360 controller · 8 inputs · id my-stick',
      tone: 'muted',
    });
    expect(pickerNote(pads, { profile: 'my-stick-2' })?.text).toContain('id my-stick-2');
  });

  it('choosing fills in everything, and a second choice leaves nothing of the first', () => {
    const first = applyChoice({ note: 'kept' }, layouts, 'flying');
    expect(first).toEqual({
      note: 'kept',
      layoutId: 'flying',
      layoutName: 'Flying',
      displays: FLYING,
    });
    expect(chosenOf(layouts, first)?.label).toBe('Flying');
    expect(applyChoice(first, layouts, 'racing')).toEqual({
      note: 'kept',
      layoutId: 'racing',
      layoutName: 'Racing',
      displays: RACING,
    });
    // A choice that fills nothing still clears what the last one filled.
    const bare: PickerInfo = { ...layouts, choices: [{ value: 'bare', label: 'Bare' }] };
    expect(applyChoice(first, bare, 'bare')).toEqual({ note: 'kept', layoutId: 'bare' });
  });

  it('clearing takes the field out, and keeps only what the type cannot do without', () => {
    const chosen = applyChoice({}, layouts, 'flying');
    expect(applyChoice(chosen, layouts, null)).toEqual({});
    expect(applyChoice(chosen, layouts, '')).toEqual({});
    expect(applyChoice(chosen, layouts, undefined, requiredKeys(LAYOUT_SCHEMA))).toEqual({
      displays: FLYING,
    });
  });

  it('keeps what the setup uses in the list when it is gone, says so, and never changes it', () => {
    const params = { layoutId: 'old', layoutName: 'Old desk', displays: FLYING };
    expect(isMissing(layouts, params)).toBe(true);
    expect(pickerItems(layouts, params)[0]).toEqual({
      value: 'old',
      title: 'Old desk (no longer in the list)',
    });
    expect(pickerItems(layouts, params)).toHaveLength(3);
    expect(pickerNote(layouts, params)).toEqual({ text: GONE, tone: 'warn' });
    // Choosing the row that is gone again changes nothing.
    expect(applyChoice(params, layouts, 'old')).toEqual(params);
    // With no name remembered, the id is all there is to show.
    expect(pickerItems(pads, { profile: 'gone-pad' })[0]?.title).toBe(
      'gone-pad (no longer in the list)'
    );
    expect(isMissing(layouts, { layoutId: 'flying' })).toBe(false);
    expect(isMissing(layouts, {})).toBe(false);
  });

  it('a list that could not be read says that, and does not claim the saved one is gone', () => {
    const unread: PickerInfo = { ...pads, choices: [], problem: 'The list could not be read.' };
    const params = { profile: 'my-stick', profileName: 'My stick' };
    expect(pickerNote(unread, params)).toEqual({
      text: 'The list could not be read.',
      tone: 'bad',
    });
    expect(pickerItems(unread, params)).toEqual([{ value: 'my-stick', title: 'My stick' }]);
  });

  it('says why a list is empty, and what a setup without a choice does', () => {
    const none: PickerInfo = { ...layouts, choices: [] };
    expect(pickerNote(none, {})).toEqual({ text: 'You have no saved layout yet.', tone: 'muted' });
    expect(pickerItems(none, {})).toEqual([]);
    // A setup made from the rig with an arrangement that was never saved as a layout.
    expect(pickerNote(layouts, { displays: FLYING })).toEqual({
      text: layouts.unpicked,
      tone: 'muted',
    });
    expect(pickerNote(layouts, {})).toBeUndefined();
    // A choice with nothing more to say has no line.
    const plain: PickerInfo = { ...layouts, choices: [{ value: 'x', label: 'X' }] };
    expect(pickerNote(plain, { layoutId: 'x' })).toBeUndefined();
  });

  it('uses the default of the field when the setup names nothing', () => {
    const games: PickerInfo = {
      list: 'games',
      param: 'game',
      label: 'Game',
      fills: [],
      empty: 'RigReady knows no games yet.',
      choices: [
        { value: 'dcs', label: 'DCS World' },
        { value: 'iracing', label: 'iRacing' },
      ],
    };
    expect(chosenOf(games, {}, 'dcs')?.label).toBe('DCS World');
    expect(chosenOf(games, { game: 'iracing' }, 'dcs')?.label).toBe('iRacing');
    expect(chosenOf(games, {})).toBeUndefined();
    expect(isMissing(games, {}, 'gone')).toBe(true);
    expect(chosenOf(games, { game: 7 })).toBeUndefined();
  });

  it('must be answered when its field is required, or when what it fills is and is empty', () => {
    const required = requiredKeys(LAYOUT_SCHEMA);
    expect([...required]).toEqual(['displays']);
    expect(pickerRequired(layouts, required, {})).toBe(true);
    expect(pickerRequired(layouts, required, { displays: FLYING })).toBe(false);
    expect(pickerRequired(pads, new Set(['profile']), { profile: 'my-stick' })).toBe(true);
    expect(pickerRequired(pads, new Set(), {})).toBe(false);
  });
});

describe('two choices with the same value', () => {
  // The id of a backup is the moment it was made: two games, one moment, one id.
  const SAME = '2026-11-12T19-00-00-000Z';
  const sets: PickerInfo = {
    list: 'racing.bindingSets',
    param: 'backupId',
    label: 'Saved bindings',
    fills: ['name', 'game'],
    empty: 'You have no saved bindings yet.',
    choices: [
      {
        value: SAME,
        label: 'League night',
        detail: 'iRacing, saved 12 November 2026, 19:00',
        fill: { name: 'League night', game: 'iracing' },
      },
      {
        value: SAME,
        label: 'League night',
        detail: 'Le Mans Ultimate, saved 12 November 2026, 19:00',
        fill: { name: 'League night', game: 'lmu' },
      },
      { value: 'other', label: 'GT3 rim', fill: { name: 'GT3 rim', game: 'iracing' } },
    ],
  };
  const [iracing, lmu, other] = sets.choices as [
    PickerInfo['choices'][number],
    PickerInfo['choices'][number],
    PickerInfo['choices'][number],
  ];

  it('are two rows of the list, and a row alone in its value is still called by it', () => {
    const rows = pickerItems(sets, {});
    expect(rows.map((row) => row.subtitle)).toEqual([iracing.detail, lmu.detail, undefined]);
    expect(new Set(rows.map((row) => row.value)).size).toBe(3);
    expect(rows[2]!.value).toBe('other');
    expect(choiceKey(sets, other)).toBe('other');
    expect(choiceKey(sets, iracing)).not.toBe(choiceKey(sets, lmu));
  });

  it('choosing one fills in its own game, and the row shown as chosen is that one', () => {
    const picked = applyChoice({}, sets, choiceKey(sets, lmu));
    expect(picked).toEqual({ backupId: SAME, name: 'League night', game: 'lmu' });
    expect(chosenOf(sets, picked)).toBe(lmu);
    expect(selectedKey(sets, picked)).toBe(choiceKey(sets, lmu));
    expect(pickerNote(sets, picked)?.text).toBe(lmu.detail);
    // And back to the other game's.
    const back = applyChoice(picked, sets, choiceKey(sets, iracing));
    expect(back).toEqual({ backupId: SAME, name: 'League night', game: 'iracing' });
    expect(selectedKey(sets, back)).toBe(choiceKey(sets, iracing));
    expect(isMissing(sets, back)).toBe(false);
  });

  it("a setup that names only the id and the game gets its own game's row", () => {
    // Renamed since: the name no longer matches, the game still does.
    expect(chosenOf(sets, { backupId: SAME, name: 'Old name', game: 'lmu' })).toBe(lmu);
    // Nothing to tell them apart by: the first, as a list of single values would give.
    expect(chosenOf(sets, { backupId: SAME })).toBe(iracing);
    expect(selectedKey(sets, { backupId: 'other' })).toBe('other');
    // Gone from the list: the row for it is called by the saved value, as before.
    expect(selectedKey(sets, { backupId: 'gone' })).toBe('gone');
    expect(pickerItems(sets, { backupId: 'gone', name: 'Wet set' })[0]).toEqual({
      value: 'gone',
      title: 'Wet set (no longer in the list)',
    });
    expect(selectedKey(sets, {})).toBeUndefined();
  });

  it('the form hands the chosen row to the list', () => {
    const schema = {
      type: 'object',
      properties: {
        backupId: { type: 'string' },
        name: { type: 'string' },
        game: { type: 'string' },
      },
      required: ['backupId', 'game'],
    };
    const rows = formRows(schema, { backupId: SAME, name: 'League night', game: 'lmu' }, [sets]);
    expect(rows.map((row) => row.field.key)).toEqual(['backupId']);
    expect(rows[0]!.pick!.selected).toBe(choiceKey(sets, lmu));
    expect(formRows(schema, {}, [sets])[0]!.pick!.selected).toBeUndefined();
  });
});

describe('the form of a type with a list', () => {
  it('asks for the list by name and never for what the list fills in', () => {
    const rows = formRows(LAYOUT_SCHEMA, {}, [layouts]);
    expect(rows.map((r) => r.field.key)).toEqual(['layoutId']);
    expect(rows[0]?.pick).toMatchObject({ info: layouts, required: true });
    expect(rows[0]?.pick?.items.map((i) => i.title)).toEqual(['Flying', 'Racing']);
    expect(rows[0]?.pick?.note).toBeUndefined();
    // Chosen: the line under the list says what it is.
    const chosen = formRows(LAYOUT_SCHEMA, applyChoice({}, layouts, 'racing'), [layouts]);
    expect(chosen[0]?.pick?.note).toEqual({ text: '4 monitors, 1 on', tone: 'muted' });
    expect(chosen[0]?.pick?.required).toBe(false);
  });

  it('without a list every field is asked for as it is', () => {
    const rows = formRows(LAYOUT_SCHEMA, {});
    expect(rows.map((r) => [r.field.key, r.field.kind])).toEqual([
      ['layoutId', 'text'],
      ['layoutName', 'text'],
      ['displays', 'json'],
    ]);
    expect(rows.every((r) => r.pick === undefined)).toBe(true);
    expect(formRows(undefined, {})).toEqual([]);
  });

  it('a fix that follows its check asks for none of the followed fields', () => {
    const followed = followedBy([layouts], [layouts])!;
    expect(formRows(LAYOUT_SCHEMA, {}, [layouts], followed)).toEqual([]);
  });
});

describe('a fix that picks from the same list as its check', () => {
  const followed = followedBy([layouts, pads], [layouts])!;

  it('follows every list both pick from for the same field, and no other', () => {
    expect(followed).toEqual({ label: 'layout', keys: ['layoutId', 'layoutName', 'displays'] });
    expect(followedBy([layouts], [pads])).toBeUndefined();
    expect(followedBy([layouts], undefined)).toBeUndefined();
    expect(followedBy(undefined, [layouts])).toBeUndefined();
    // The same list for another field is another question.
    expect(followedBy([layouts], [{ ...layouts, param: 'other' }])).toBeUndefined();
    expect(followedBy([layouts, pads], [pads, layouts])?.label).toBe(
      'layout and virtual controller'
    );
  });

  it('is following only while it says exactly what the check says', () => {
    const check = applyChoice({}, layouts, 'flying');
    expect(follows(check, mergeFollowed({ extra: 1 }, check, followed), followed)).toBe(true);
    expect(follows(check, applyChoice({}, layouts, 'racing'), followed)).toBe(false);
    expect(follows(check, {}, followed)).toBe(false);
    // Nothing chosen on either side is still the same.
    expect(follows({}, {}, followed)).toBe(true);
  });

  it('takes the followed fields from the check, as a copy, and drops what the check dropped', () => {
    const check = applyChoice({}, layouts, 'flying');
    const fix = mergeFollowed({ extra: 1, layoutName: 'Stale' }, check, followed);
    expect(fix).toEqual({ extra: 1, layoutId: 'flying', layoutName: 'Flying', displays: FLYING });
    expect(fix['displays']).not.toBe(check['displays']);
    expect(mergeFollowed(fix, { displays: RACING }, followed)).toEqual({
      extra: 1,
      displays: RACING,
    });
  });
});

describe('the name of a check that is chosen from a list', () => {
  const flying = applyChoice({}, layouts, 'flying');
  const racing = applyChoice({}, layouts, 'racing');
  const name = (title: string, before: Record<string, unknown>, after: Record<string, unknown>) =>
    titleFromChoice(title, 'Monitor layout', [layouts], before, after);

  it('a check not named yet takes the name of what was chosen', () => {
    expect(name('New check', {}, flying)).toBe('Monitor layout: Flying');
  });

  it('goes with a second choice, so the name never says one thing and the check another', () => {
    expect(name('Monitor layout: Flying', flying, racing)).toBe('Monitor layout: Racing');
  });

  it('never replaces a name the person typed', () => {
    expect(name('Screens for flying', flying, racing)).toBeUndefined();
    expect(name('Monitor layout: Flying', racing, flying)).toBeUndefined();
  });

  it('says nothing when nothing is chosen, or when no list of the type names anything', () => {
    expect(name('New check', {}, {})).toBeUndefined();
    expect(name('New check', {}, { layoutId: 'gone' })).toBeUndefined();
    expect(titleFromChoice('New check', 'Program running', undefined, {}, flying)).toBeUndefined();
    const plain = { ...layouts, fills: [] };
    expect(titleFromChoice('New check', 'Monitor layout', [plain], {}, flying)).toBeUndefined();
  });
});

describe('the name of a step that has not been given one', () => {
  it('follows the type while it is still the name of the type', () => {
    expect(titleFromType('Start the app', 'Start the app', 'Start a virtual controller')).toBe(
      'Start a virtual controller'
    );
  });

  it('never replaces a name the person typed, also one that begins with "New"', () => {
    expect(titleFromType('Start VoiceAttack', 'Start the app', 'Run a script')).toBeUndefined();
    expect(titleFromType('New headset profile', 'Start the app', 'Run a script')).toBeUndefined();
  });

  it('renames a step an earlier version left as "New start the app", and one with no name', () => {
    expect(titleFromType('New start the app', 'Start the app', 'Run a script')).toBe(
      'Run a script'
    );
    expect(titleFromType(' ', 'Start the app', 'Run a script')).toBe('Run a script');
  });

  it('keeps the name of a step whose type this version does not know', () => {
    expect(titleFromType('Old step', undefined, 'Run a script')).toBeUndefined();
  });
});
