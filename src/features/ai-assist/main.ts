import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { aiAssistContract } from './contract';
import { listenForPresses } from './core/inputs';
import { plainLabels } from './core/pack';
import { AiAssist } from './core/service';
import { shippedPack } from './core/shipped';

let stopListening: (() => void) | undefined;
let stopWatchingSettings: (() => void) | undefined;

export default defineFeatureMain({
  id: 'ai-assist',
  setup(ctx) {
    const ai = new AiAssist({ ports: ctx.ports, log: ctx.log, bindings: ctx.bindings });
    // The shipped guides' plain-language action names, for every page that lists actions.
    ctx.bindings.registerLabels({
      id: 'ai-assist',
      game: 'dcs',
      labels: async (aircraftId) => plainLabels(shippedPack(aircraftId)),
    });
    // The key is stored and removed on the Settings page; this feature's own section and
    // pages follow it through an event instead of asking again on a timer.
    stopWatchingSettings = ctx.settings.onChange(() =>
      ctx.emit(aiAssistContract, 'settingsChanged', {})
    );
    return [
      bind(aiAssistContract, {
        aircraft: () => ai.aircraft(),
        guide: ({ aircraftId }) => ai.guide(aircraftId),
        setProgress: ({ aircraftId, itemId, state, current }) =>
          ai.setProgress(aircraftId, itemId, state, current),
        setCurrent: ({ aircraftId, itemId }) => ai.setCurrent(aircraftId, itemId),
        resetProgress: ({ aircraftId }) => ai.resetProgress(aircraftId),
        stage: ({ aircraftId, ...change }) => ai.stage(aircraftId, change),
        unstage: ({ aircraftId, id }) => ai.unstage(aircraftId, id),
        reviewStaged: ({ aircraftId }) => ai.reviewStaged(aircraftId),
        applyStaged: ({ aircraftId }) => ai.applyStaged(aircraftId),
        undo: ({ groupId }) => ai.undo(groupId),
        async listenStart() {
          const started = await ctx.ports.input.start();
          if (!started.ok) return started;
          stopListening?.();
          stopListening = listenForPresses(ctx.ports.input, (press) =>
            ctx.emit(aiAssistContract, 'pressed', press)
          );
          return ok({ listening: true });
        },
        async listenStop() {
          stopListening?.();
          stopListening = undefined;
          return ok({ listening: false });
        },
        status: () => ai.status(),
        setModel: ({ model }) => ai.setModel(model),
        testKey: () => ai.testKey(),
        prepare: (input) => ai.prepare(input),
        send: ({ requestId }) => ai.send(requestId),
        reviewSuggestions: ({ roundId, selected }) => ai.reviewSuggestions(roundId, selected),
        applySuggestions: ({ roundId, selected }) => ai.applySuggestions(roundId, selected),
        deleteDraft: ({ aircraftId }) => ai.deleteDraft(aircraftId),
      }),
    ];
  },
  dispose() {
    stopWatchingSettings?.();
    stopWatchingSettings = undefined;
    stopListening?.();
    stopListening = undefined;
  },
});
