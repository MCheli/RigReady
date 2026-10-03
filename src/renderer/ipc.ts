import type { RigError } from '../core/result';
import { createClient, type ChannelMap, type Contract, type EventMap } from '../shared/ipc';

/**
 * The typed client for a feature contract:
 *
 *   const api = useClient(devicesContract);
 *   const result = await api.list();          // Result<DeviceInfo[]>
 *   const off = api.on('changed', (p) => {}); // off() unsubscribes
 */
export function useClient<C extends ChannelMap, E extends EventMap>(contract: Contract<C, E>) {
  return createClient(contract, window.rigready);
}

/** One line for the user from an error result. */
export function errorText(error: RigError): string {
  return error.detail ? `${error.message} (${error.detail})` : error.message;
}
