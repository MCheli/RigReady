import type { Component } from 'vue';
import { RECENT_PRESSES } from '../../core/widgets';
import RecentPresses from './RecentPresses.vue';
import RecentPressesOptions from './RecentPressesOptions.vue';

/**
 * What each widget of the overlay is drawn with, by the id it has in `core/widgets.ts`.
 *
 *   view     What is drawn over the game. It fills the window it is given, gets the widget's
 *            options and its place on the screen (`options`, `at`), and fetches what it
 *            shows itself. The overlay window and the preview on the page both mount it, so
 *            the preview is the real thing. The preview alone also hands it `examples`
 *            while the overlay is off (the widget's `examples` in overlay:state): lines
 *            to draw in place of what it would fetch, each marked as an example.
 *   options  The controls for its options on the Overlay page. It gets the options in
 *            effect (`options`) and emits `change` with all of them whenever the user sets
 *            one; the page sends them and shows what the overlay answered.
 */
export interface WidgetParts {
  view: Component;
  options: Component;
}

export const WIDGET_PARTS: Record<string, WidgetParts> = {
  [RECENT_PRESSES]: { view: RecentPresses, options: RecentPressesOptions },
};
