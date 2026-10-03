import type { RigError } from '../core/result';
import {
  createClient,
  type Bridge,
  type ChannelMap,
  type Contract,
  type EventMap,
} from '../shared/ipc';

/**
 * The typed client for a feature contract:
 *
 *   const api = useClient(devicesContract);
 *   const result = await api.list();          // Result<DeviceInfo[]>
 *   const off = api.on('changed', (p) => {}); // off() unsubscribes
 */
export function useClient<C extends ChannelMap, E extends EventMap>(contract: Contract<C, E>) {
  return createClient(contract, bridge);
}

/**
 * Inputs are copied to plain data before they cross to main: Vue's reactive proxies
 * cannot be sent over IPC. A failure to send becomes an error result like any other.
 */
const bridge: Bridge = {
  async invoke(channel, input) {
    try {
      const plain = input === undefined ? undefined : JSON.parse(JSON.stringify(input));
      return await window.rigready.invoke(channel, plain);
    } catch (e) {
      return {
        ok: false,
        error: {
          code: 'ipc.send',
          message: 'The request could not be sent.',
          detail: e instanceof Error ? e.message : String(e),
        },
      };
    }
  },
  on: (channel, listener) => window.rigready.on(channel, listener),
};

/** One line for the user from an error result. */
export function errorText(error: RigError): string {
  return error.detail ? `${error.message} (${error.detail})` : error.message;
}
