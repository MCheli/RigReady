import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { aiAssistContract } from './contract';
import { listenForPresses } from './core/inputs';
import { AiAssist } from './core/service';

let stopListening: (() => void) | undefined;

export default defineFeatureMain({
  id: 'ai-assist',
  setup(ctx) {
    const ai = new AiAssist({ ports: ctx.ports, log: ctx.log, bindings: ctx.bindings });
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
    stopListening?.();
    stopListening = undefined;
  },
});
