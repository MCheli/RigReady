import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNEL_PATTERN, EVENT_PATTERN } from '../shared/channels';

/**
 * The whole bridge: one generic invoke and one generic subscribe. Typing comes from
 * the feature contracts on the renderer side (createClient), not from this file.
 */
contextBridge.exposeInMainWorld('rigready', {
  invoke(channel: string, input: unknown): Promise<unknown> {
    if (!CHANNEL_PATTERN.test(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'ipc.channel', message: `Invalid channel ${channel}` },
      });
    }
    return ipcRenderer.invoke(channel, input);
  },
  on(channel: string, listener: (payload: unknown) => void): () => void {
    if (!EVENT_PATTERN.test(channel)) throw new Error(`Invalid event channel ${channel}`);
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
});
