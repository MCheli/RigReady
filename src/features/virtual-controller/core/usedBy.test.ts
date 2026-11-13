import { describe, expect, it } from 'vitest';
import { ProfileSchema, type Profile } from '../../../core/profile/schema';
import { setupNames, setupsByPadProfile, withPadProfileName } from './usedBy';

const setup = (id: string, name: string, more: Record<string, unknown> = {}): Profile =>
  ProfileSchema.parse({
    id,
    name,
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
    ...more,
  });

const start = (profile: unknown, id = 'a1'): Record<string, unknown> => ({
  id,
  title: 'Virtual gamepad for the stick',
  type: 'virtual-controller.start',
  params: { profile },
});

describe('which setups use a virtual controller profile', () => {
  it('finds a start step before launch, after launch, at Stand down and as the fix of a check', () => {
    const by = setupsByPadProfile([
      setup('before', 'Before launch', { actions: { preLaunch: [start('stick')] } }),
      setup('after', 'After launch', { actions: { postLaunch: [start('stick')] } }),
      setup('down', 'At stand down', { actions: { standDown: [start('wheel')] } }),
      setup('check', 'As a fix', {
        checks: [
          {
            id: 'c1',
            type: 'virtual-controller.running',
            title: 'Virtual controller',
            remediation: { type: 'virtual-controller.start', params: { profile: 'wheel' } },
          },
        ],
      }),
    ]);
    // Sorted by name, so the rows and the delete prompt read the same every time.
    expect(by.get('stick')).toEqual([
      { id: 'after', name: 'After launch' },
      { id: 'before', name: 'Before launch' },
    ]);
    expect(by.get('wheel')).toEqual([
      { id: 'check', name: 'As a fix' },
      { id: 'down', name: 'At stand down' },
    ]);
    expect(by.get('nobody')).toBeUndefined();
  });

  it('names a setup once however many of its steps start the profile', () => {
    const by = setupsByPadProfile([
      setup('twice', 'Twice', {
        actions: { preLaunch: [start('stick', 'a1')], postLaunch: [start('stick', 'a2')] },
      }),
    ]);
    expect(by.get('stick')).toEqual([{ id: 'twice', name: 'Twice' }]);
  });

  it('leaves out other steps, and a start step that names no profile', () => {
    const by = setupsByPadProfile([
      setup('other', 'Other', {
        actions: {
          preLaunch: [
            { id: 'a1', title: 'A program', type: 'process.start', params: { profile: 'stick' } },
            start(undefined, 'a2'),
            start(7, 'a3'),
          ],
        },
      }),
      setup('plain', 'Plain'),
    ]);
    expect([...by.keys()]).toEqual([]);
  });

  it('gives a setup the new name of a renamed profile wherever it keeps the old one, and nothing else', () => {
    const named = (profile: string, profileName: string, id: string): Record<string, unknown> => ({
      ...start(profile, id),
      params: { profile, profileName, hideControllers: true },
    });
    const before = setup('both', 'Both', {
      actions: {
        preLaunch: [named('stick', 'Old stick', 'a1'), start('stick', 'a2')],
        postLaunch: [named('wheel', 'Old stick', 'a3')],
        standDown: [
          { id: 'a4', title: 'A program', type: 'process.start', params: { profile: 'stick' } },
        ],
      },
      checks: [
        {
          id: 'c1',
          type: 'virtual-controller.running',
          title: 'Virtual controller',
          remediation: {
            type: 'virtual-controller.start',
            params: { profile: 'stick', profileName: 'Old stick' },
          },
        },
        { id: 'c2', type: 'virtual-controller.driver', title: 'Driver' },
      ],
    });
    const after = withPadProfileName(before, 'stick', 'New stick')!;
    // The step and the fix that kept the old name say the new one; what else they hold stays.
    expect(after.actions!.preLaunch[0]!.params).toEqual({
      profile: 'stick',
      profileName: 'New stick',
      hideControllers: true,
    });
    expect(after.checks[0]!.remediation!.params).toEqual({
      profile: 'stick',
      profileName: 'New stick',
    });
    // A step that kept no name, another profile's step and another kind of step are as they were.
    expect(after.actions!.preLaunch[1]).toEqual(before.actions!.preLaunch[1]);
    expect(after.actions!.postLaunch).toEqual(before.actions!.postLaunch);
    expect(after.actions!.standDown).toEqual(before.actions!.standDown);
    expect(after.checks[1]).toEqual(before.checks[1]);
    expect({ ...after, actions: before.actions, checks: before.checks }).toEqual(before);

    // Nothing to change: no new setup, so no file is written.
    expect(withPadProfileName(after, 'stick', 'New stick')).toBeUndefined();
    expect(withPadProfileName(before, 'nobody', 'New stick')).toBeUndefined();
    expect(withPadProfileName(setup('plain', 'Plain'), 'stick', 'New stick')).toBeUndefined();
  });

  it('puts setup names in a sentence', () => {
    const refs = [
      { id: 'a', name: 'ACE COMBAT 8' },
      { id: 'b', name: 'Elite' },
      { id: 'c', name: 'Star Wars: Squadrons' },
    ];
    expect(setupNames([])).toBe('');
    expect(setupNames(refs.slice(0, 1))).toBe('"ACE COMBAT 8"');
    expect(setupNames(refs.slice(0, 2))).toBe('"ACE COMBAT 8" and "Elite"');
    expect(setupNames(refs)).toBe('"ACE COMBAT 8", "Elite" and "Star Wars: Squadrons"');
  });
});
