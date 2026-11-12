import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { HostedResult } from '../../../core/mcp';

/**
 * The reference tool as an assistant calls it, on every feature of the app: shortest first.
 * What a tool answers is read again with every later request of a conversation, so the
 * whole reference of a feature (tens of thousands of characters) is never the first answer.
 */

let app: WiredApp | undefined;

afterEach(async () => {
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
    app = undefined;
  }
});

const caller = () => ({
  id: 'builtin-assistant',
  name: 'Built-in assistant',
  signal: new AbortController().signal,
});

const textOf = (result: HostedResult): string => {
  if (!result.ok) throw new Error(`${result.error.code} ${result.error.message}`);
  return String(result.value);
};

describe('MCP-001 rigready_channels answers in three steps, each as short as it can be', () => {
  it('the features, then one feature in a line per channel, then one channel in full', async () => {
    app = await wiredApp('flying-all-good');
    const host = app.wiring.context.mcp.host()!;

    const features = textOf(await host.call(caller(), 'rigready_channels', {}));
    expect(features).toContain('**profiles**:');
    expect(features.length).toBeLessThan(6000);

    const feature = await host.call(caller(), 'rigready_channels', { feature: 'profiles' });
    const lines = textOf(feature);
    expect(feature.made).toMatchObject({ tier: 'read', summary: 'The channels of profiles' });
    expect(lines).toContain('- `profiles:list` (Reads): ');
    expect(lines).toContain('- `profiles:save` (Changes the rig): ');
    expect(lines).toContain('ask again with channel: "profiles:<name>"');
    // A line each: no JSON Schema, and a fraction of the 60,000 characters of the whole.
    expect(lines).not.toContain('"type":"object"');
    expect(lines).not.toContain('- Input:');
    expect(lines.length).toBeLessThan(6000);

    const one = await host.call(caller(), 'rigready_channels', { channel: 'profiles:get' });
    const detail = textOf(one);
    expect(one.made).toMatchObject({
      tier: 'read',
      summary: 'What profiles:get takes and answers',
    });
    expect(detail).toContain('## profiles:get');
    expect(detail).toContain('- Tier: Reads');
    expect(detail).toContain('- Input: `{');
    expect(detail).toContain('"required":["id"]');
    // The one channel only: no other channel's heading comes with it.
    expect(detail.match(/^## /gm)).toHaveLength(1);

    // A channel wins over a feature given with it: the narrower answer was asked for.
    const both = textOf(
      await host.call(caller(), 'rigready_channels', { feature: 'fly', channel: 'profiles:get' })
    );
    expect(both).toBe(detail);
  });

  it('a channel or feature that does not exist is answered with the nearest list to pick from', async () => {
    app = await wiredApp('flying-all-good');
    const host = app.wiring.context.mcp.host()!;

    const wrongChannel = await host.call(caller(), 'rigready_channels', {
      channel: 'profiles:nothing',
    });
    expect(wrongChannel.ok).toBe(false);
    if (wrongChannel.ok) return;
    expect(wrongChannel.error.code).toBe('mcp.channel');
    expect(wrongChannel.error.message).toBe('There is no channel "profiles:nothing".');
    expect(wrongChannel.error.detail).toContain('- `profiles:list` (Reads): ');

    const wrongFeature = await host.call(caller(), 'rigready_channels', {
      channel: 'nowhere:nothing',
    });
    expect(wrongFeature.ok).toBe(false);
    if (wrongFeature.ok) return;
    expect(wrongFeature.error.code).toBe('mcp.channel');
    expect(wrongFeature.error.detail).toContain('**profiles**:');

    const noFeature = await host.call(caller(), 'rigready_channels', { feature: 'nowhere' });
    expect(noFeature.ok).toBe(false);
    if (noFeature.ok) return;
    expect(noFeature.error.code).toBe('mcp.feature');
    expect(noFeature.error.detail).toContain('**profiles**:');
  });

  it('a channel that is not offered is not in the lines, only counted', async () => {
    app = await wiredApp('flying-all-good');
    const host = app.wiring.context.mcp.host()!;
    const lines = textOf(await host.call(caller(), 'rigready_channels', { feature: 'mcp' }));
    expect(lines).toMatch(/\d+ more are not offered to assistants\./);
    expect(lines).not.toContain('`mcp:pair`');
  });
});
