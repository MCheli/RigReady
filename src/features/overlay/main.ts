import { bind, defineFeatureMain } from '../../core/feature';
import { overlayContract } from './contract';
import { OverlayService } from './core/service';

let service: OverlayService | undefined;

/**
 * The in-game overlay: small windows over whatever is on the screen. Everything it does is
 * in core/service.ts; here it is given the app and its channels.
 */
export default defineFeatureMain({
  id: 'overlay',
  setup(ctx) {
    const overlay = new OverlayService(
      { ...ctx, log: ctx.log.child('overlay') },
      {
        changed: (state) => ctx.emit(overlayContract, 'changed', state),
        presses: (rows) => ctx.emit(overlayContract, 'presses', { rows }),
      }
    );
    service = overlay;
    return [
      bind(overlayContract, {
        state: () => overlay.state(),
        set: ({ on }) => overlay.setOn(on),
        setupDefault: (setup) => overlay.setupDefault(setup),
        options: ({ widget, options }) => overlay.setOptions(widget, options),
        place: ({ widget, screen, at }) =>
          overlay.place(widget, { ...(screen !== undefined ? { screen } : {}), at }),
        move: ({ widget, moving }) => overlay.move(widget, moving),
        aircraft: ({ aircraftId }) => overlay.chooseAircraft(aircraftId),
        current: async () => overlay.current(),
        recent: async () => overlay.recent(),
      }),
    ];
  },
  // Left on, the overlay is up again as soon as RigReady runs.
  start: () => service?.start(),
  async dispose() {
    await service?.dispose();
    service = undefined;
  },
});
