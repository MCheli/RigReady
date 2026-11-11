import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { aiAssistContract } from './contract';
import { allPathVariables } from '../../core/pathVariables';
import { Assistant } from './core/assistant';
import { AssistantDrafts } from './core/drafts';
import { listenForPresses } from './core/inputs';
import { findPrograms } from './core/programs';
import { assistantTools } from './core/tools';
import { plainLabels } from './core/pack';
import { AiAssist } from './core/service';
import { shippedPack } from './core/shipped';

let stopListening: (() => void) | undefined;
let stopWatchingSettings: (() => void) | undefined;

export default defineFeatureMain({
  id: 'ai-assist',
  setup(ctx) {
    const ai = new AiAssist({
      ports: ctx.ports,
      log: ctx.log,
      bindings: ctx.bindings,
      settings: ctx.settings,
      onProgress: (progress) => ctx.emit(aiAssistContract, 'sendProgress', progress),
    });
    const drafts = new AssistantDrafts({
      ports: ctx.ports,
      log: ctx.log,
      invoke: (channel, input) => ctx.invoke(channel, input),
      changed: () => ctx.emit(aiAssistContract, 'draftsChanged', {}),
    });
    const assistant = new Assistant({
      ports: ctx.ports,
      log: ctx.log,
      host: () => ctx.mcp.host(),
      target: () => ai.assistantTarget(),
    });
    // The three tools an assistant builds a ready check with, offered over MCP too.
    for (const tool of assistantTools()) ctx.mcp.registerTool(tool);
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
        setProvider: ({ provider }) => ai.setProvider(provider),
        setModel: ({ model }) => ai.setModel(model),
        setCompatible: (change) => ai.setCompatible(change),
        setKey: ({ key }) => ai.setKey(key),
        clearKey: () => ai.clearKey(),
        testKey: () => ai.testKey(),
        prepare: (input) => ai.prepare(input),
        send: ({ requestId }) => ai.send(requestId),
        cancel: ({ requestId }) => ai.cancel(requestId),
        reviewSuggestions: ({ roundId, selected }) => ai.reviewSuggestions(roundId, selected),
        applySuggestions: ({ roundId, selected }) => ai.applySuggestions(roundId, selected),
        deleteDraft: ({ aircraftId }) => ai.deleteDraft(aircraftId),
        assistantPrepare: (input) => assistant.prepare(input),
        assistantSend: ({ requestId }) => assistant.send(requestId, new AbortController().signal),
        assistantConversation: async ({ conversationId }) => assistant.conversation(conversationId),
        assistantForget: async ({ conversationId }) =>
          ok({ forgotten: assistant.forget(conversationId) }),
        findPrograms: async (input) =>
          findPrograms(
            ctx.ports,
            await allPathVariables({ ports: ctx.ports, log: ctx.log }, ctx.games),
            input
          ),
        proposeSetup: ({ by, ...input }) => drafts.proposeSetup(by, input),
        draftScript: ({ by, ...input }) => drafts.draftScript(by, input),
        drafts: () => drafts.drafts(),
        saveSetupDraft: ({ draftId }) => drafts.saveSetup(draftId),
        saveScriptDraft: ({ draftId }) => drafts.saveScript(draftId),
        discardDraft: async ({ draftId }) => ok({ discarded: drafts.discard(draftId) }),
        assistantScripts: async () => {
          const scripts = await drafts.scripts();
          return scripts.ok ? ok({ scripts: scripts.value }) : scripts;
        },
        approveScript: ({ file, sha256 }) => drafts.approveScript(file, sha256),
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
