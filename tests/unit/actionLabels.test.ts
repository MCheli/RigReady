import { afterEach, describe, expect, it } from 'vitest';
import { BindingRegistry } from '../../src/core/bindings';
import { wiredApp, type WiredApp } from '../helpers';

let app: WiredApp;
afterEach(() => app?.cleanup());

interface Command {
  name: string;
  plain?: string;
}

describe('plain-language action labels across features', () => {
  it("the bindings pages get the shipped F/A-18C labels with DCS's own name kept beside them", async () => {
    app = await wiredApp('dcs-bindings-hornet');
    const view = await app.invoke<{ commands: Command[] }>('dcs-bindings:aircraft', {
      id: 'FA-18C_hornet',
    });
    const byName = new Map(view.commands.map((c) => [c.name, c]));
    expect(byName.get('Trimmer Switch - PUSH(DESCEND)')).toMatchObject({
      name: 'Trimmer Switch - PUSH(DESCEND)',
      plain: 'Trim nose down',
    });
    expect(byName.get('Wheel Brake Left')?.plain).toBe('Left toe brake');
    // Most actions have no label of their own and keep DCS's name alone.
    const labelled = view.commands.filter((c) => c.plain !== undefined);
    expect(labelled.length).toBeGreaterThan(40);
    expect(labelled.length).toBeLessThan(view.commands.length);
    expect(labelled.every((c) => c.plain !== c.name && c.name.length > 0)).toBe(true);
  });

  it('any feature reads the same labels through core, for the Hornet and the Huey; an unknown aircraft has none', async () => {
    app = await wiredApp('dcs-bindings-hornet', { files: [] });
    const { bindings } = app.wiring.context;
    const hornet = await bindings.labels('dcs', 'FA-18C_hornet');
    expect(hornet['Trimmer Switch - PUSH(DESCEND)']).toBe('Trim nose down');
    expect(Object.keys(await bindings.labels('dcs', 'UH-1H')).length).toBeGreaterThan(20);
    expect(await bindings.labels('dcs', 'Su-27')).toEqual({});
    expect(await bindings.labels('msfs2024', 'FA-18C_hornet')).toEqual({});
  });

  it('the first source to name an action wins, a failing source is ignored, and an id registers once', async () => {
    const registry = new BindingRegistry();
    registry.registerLabels({ id: 'a', game: 'dcs', labels: async () => ({ Pitch: 'Nose' }) });
    registry.registerLabels({
      id: 'b',
      game: 'dcs',
      labels: async () => ({ Pitch: 'Other', Roll: 'Bank' }),
    });
    registry.registerLabels({
      id: 'c',
      game: 'dcs',
      labels: async () => {
        throw new Error('broken label file');
      },
    });
    expect(await registry.labels('dcs', 'x')).toEqual({ Pitch: 'Nose', Roll: 'Bank' });
    expect(() =>
      registry.registerLabels({ id: 'a', game: 'dcs', labels: async () => ({}) })
    ).toThrow('registered twice');
  });
});
