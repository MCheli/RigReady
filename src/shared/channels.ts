/** Channel naming. Kept free of imports so the sandboxed preload can use it. */

export const channelName = (feature: string, key: string): string => `${feature}:${key}`;
export const eventName = (feature: string, key: string): string => `${feature}:event:${key}`;

/** Names the preload will pass through. Main still only answers registered channels. */
export const CHANNEL_PATTERN = /^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9]*$/;
export const EVENT_PATTERN = /^[a-z][a-z0-9-]*:event:[A-Za-z][A-Za-z0-9]*$/;
