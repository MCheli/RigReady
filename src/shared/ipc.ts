import { z } from 'zod';
import { err, type Result, type RigError } from '../core/result';
import { channelName, eventName } from './channels';

export { channelName, eventName, CHANNEL_PATTERN, EVENT_PATTERN } from './channels';

/**
 * Typed IPC. A feature declares one contract (channel name -> zod input and output,
 * plus events). Main registers handlers from it, the renderer gets a typed client
 * from it, and nobody writes a channel string by hand.
 */

export interface ChannelDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  input: I;
  output: O;
}

export type ChannelMap = Record<string, ChannelDef>;
export type EventMap = Record<string, z.ZodType>;

export interface Contract<C extends ChannelMap = ChannelMap, E extends EventMap = EventMap> {
  feature: string;
  channels: C;
  events: E;
}

export function channel<I extends z.ZodType, O extends z.ZodType>(
  input: I,
  output: O
): ChannelDef<I, O> {
  return { input, output };
}

/** For channels that take no input. */
export const noInput = z.undefined().or(z.null()).optional();

export function defineContract<C extends ChannelMap, E extends EventMap = Record<string, never>>(
  feature: string,
  channels: C,
  events?: E
): Contract<C, E> {
  if (!/^[a-z][a-z0-9-]*$/.test(feature)) throw new Error(`Invalid feature id: ${feature}`);
  return { feature, channels, events: events ?? ({} as E) };
}

export type Handlers<C extends ChannelMap> = {
  [K in keyof C]: (input: z.output<C[K]['input']>) => Promise<Result<z.input<C[K]['output']>>>;
};

export type Client<C extends ChannelMap> = {
  [K in keyof C]: undefined extends z.input<C[K]['input']>
    ? (input?: z.input<C[K]['input']>) => Promise<Result<z.output<C[K]['output']>>>
    : (input: z.input<C[K]['input']>) => Promise<Result<z.output<C[K]['output']>>>;
};

export type EventPayload<E extends EventMap, K extends keyof E> = z.output<E[K]>;

/** What travels over the wire for every invoke. */
export type Envelope = Result<unknown, RigError>;

/**
 * Wraps a feature's handlers: validates input, runs the handler, validates output,
 * and turns any throw into an error envelope. Pure, so it is unit-testable without Electron.
 */
export function createInvoker<C extends ChannelMap>(
  contract: Contract<C, EventMap>,
  handlers: Handlers<C>,
  onError: (channel: string, error: unknown) => void = () => {}
): (key: string, rawInput: unknown) => Promise<Envelope> {
  return async (key, rawInput) => {
    const def = contract.channels[key];
    const handler = handlers[key as keyof C];
    const name = channelName(contract.feature, key);
    if (!def || !handler) return err('ipc.unknown', `Unknown channel ${name}.`);
    const input = def.input.safeParse(rawInput);
    if (!input.success) {
      return err('ipc.input', `Invalid request for ${name}.`, z.prettifyError(input.error));
    }
    try {
      const result = await handler(input.data as never);
      if (!result.ok) return result;
      const output = def.output.safeParse(result.value);
      if (!output.success) {
        onError(name, output.error);
        return err(
          'ipc.output',
          `${name} produced an invalid response.`,
          z.prettifyError(output.error)
        );
      }
      return { ok: true, value: output.data };
    } catch (e) {
      onError(name, e);
      return err(
        'ipc.handler',
        `${name} failed unexpectedly.`,
        e instanceof Error ? e.message : String(e)
      );
    }
  };
}

/** The surface the preload script exposes as window.rigready. */
export interface Bridge {
  invoke(channel: string, input: unknown): Promise<Envelope>;
  /** Subscribes to an event channel. Returns the unsubscribe function. */
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

export function createClient<C extends ChannelMap, E extends EventMap>(
  contract: Contract<C, E>,
  bridge: Bridge
): Client<C> & {
  on<K extends keyof E & string>(
    event: K,
    listener: (payload: EventPayload<E, K>) => void
  ): () => void;
} {
  const client: Record<string, unknown> = {};
  for (const key of Object.keys(contract.channels)) {
    client[key] = (input?: unknown) => bridge.invoke(channelName(contract.feature, key), input);
  }
  client['on'] = (event: string, listener: (payload: unknown) => void) => {
    const schema = contract.events[event];
    if (!schema) throw new Error(`Unknown event ${contract.feature}:${event}`);
    return bridge.on(eventName(contract.feature, event), (payload) => {
      const parsed = schema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    });
  };
  return client as never;
}
