import { deviceKind, KIND_ICON, KIND_NAME, type DeviceKind } from './deviceKind';

/**
 * The words of the quiet suggestion: what gave the other setup away, and how much of this
 * setup's gear is not here. No engine code: the screen imports this.
 */
export interface SuggestionWords {
  /** The picture for the device that gave it away. */
  icon: string;
  /** "Wheel connected: switch to iRacing?" */
  title: string;
  /** "FANATEC Podium Wheel Base DD2 is here, and 11 devices this setup needs are not." */
  sub: string;
}

export function suggestionWords(suggestion: {
  name: string;
  device: string;
  /** What the user said the device is, when they said: it comes before what the name says. */
  kind?: DeviceKind | undefined;
  missing: number;
}): SuggestionWords {
  const kind = suggestion.kind ?? deviceKind(suggestion.device);
  // A device nobody knows the kind of is called by its own name.
  const subject = kind === 'other' ? suggestion.device : KIND_NAME[kind];
  const rest =
    suggestion.missing === 1
      ? '1 device this setup needs is not'
      : `${suggestion.missing} devices this setup needs are not`;
  return {
    icon: KIND_ICON[kind],
    title: `${subject} connected: switch to ${suggestion.name}?`,
    sub: `${suggestion.device} is here, and ${rest}.`,
  };
}
