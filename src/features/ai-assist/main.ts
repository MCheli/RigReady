import { bind, defineFeatureMain } from '../../core/feature';
import { ok, type Result } from '../../core/result';
import { aiAssistContract } from './contract';
import { allPathVariables } from '../../core/pathVariables';
import { Assistant } from './core/assistant';
import { AssistantDrafts } from './core/drafts';
import { listenForPresses } from './core/inputs';
import { findPrograms } from './core/programs';
import { loggedHttp } from './core/providerLog';
import { assistantTools } from './core/tools';
import { plainLabels } from './core/pack';
import { AiAssist } from './core/service';
import { shippedPack } from './core/shipped';

let stopListening: (() => void) | undefined;
let stopWatchingSettings: (() => void) | undefined;

export default defineFeatureMain({
  id: 'ai-assist',
  setup(ctx) {
    // Every request to a provider goes through this: one that fails leaves a line in the log.
    const ports = { ...ctx.ports, http: loggedHttp(ctx.ports.http, ctx.log) };
    const ai = new AiAssist({
      ports,
      log: ctx.log,
      bindings: ctx.bindings,
      settings: ctx.settings,
      onProgress: (progress) => ctx.emit(aiAssistContract, 'sendProgress', progress),
      onCounted: (month) => ctx.emit(aiAssistContract, 'monthChanged', month),
    });
    const drafts = new AssistantDrafts({
      ports: ctx.ports,
      log: ctx.log,
      invoke: (channel, input) => ctx.invoke(channel, input),
      changed: () => ctx.emit(aiAssistContract, 'draftsChanged', {}),
    });
    const assistant = new Assistant({
      ports,
      log: ctx.log,
      host: () => ctx.mcp.host(),
      target: () => ai.assistantTarget(),
      ceiling: () => ai.questionCeiling(),
      month: (next) => ai.monthBudget(next),
      counted: (provider, usage) => ai.countRequest(provider, usage),
      progress: (progress) => ctx.emit(aiAssistContract, 'assistantProgress', progress),
    });
    // The provider, model, key or ceiling changed: the pages that show them ask again, and a
    // request that was shown for the old ones is built again instead of failing on Send.
    const changed = async <T>(result: Promise<Result<T>>): Promise<Result<T>> => {
      const done = await result;
      if (done.ok) ctx.emit(aiAssistContract, 'settingsChanged', {});
      return done;
    };
    // The tools an assistant reads a setup and builds a ready check with, offered over MCP too.
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
        setProvider: ({ provider }) => changed(ai.setProvider(provider)),
        setModel: ({ model }) => changed(ai.setModel(model)),
        setCompatible: (change) => changed(ai.setCompatible(change)),
        setKey: ({ key }) => changed(ai.setKey(key)),
        clearKey: () => changed(ai.clearKey()),
        setQuestionCeiling: ({ dollars, acknowledged }) =>
          changed(ai.setQuestionCeiling(dollars, acknowledged)),
        setMonthlyBudget: ({ dollars, acknowledged }) =>
          changed(ai.setMonthlyBudget(dollars, acknowledged)),
        setPrices: (price) => changed(ai.setPrices(price)),
        resetPrices: () => changed(ai.resetPrices()),
        testKey: () => ai.testKey(),
        prepare: (input) => ai.prepare(input),
        send: ({ requestId }) => ai.send(requestId),
        cancel: ({ requestId }) => ai.cancel(requestId),
        reviewSuggestions: ({ roundId, selected }) => ai.reviewSuggestions(roundId, selected),
        applySuggestions: ({ roundId, selected }) => ai.applySuggestions(roundId, selected),
        deleteDraft: ({ aircraftId }) => ai.deleteDraft(aircraftId),
        importGuide: ({ aircraftId }) => ai.importGuide(aircraftId),
        startOwnGuide: ({ aircraftId }) => ai.startOwnGuide(aircraftId),
        openGuideFile: ({ aircraftId }) => ai.openGuideFile(aircraftId),
        assistantPrepare: (input) => assistant.prepare(input),
        assistantSend: ({ requestId, pastCeiling }) => assistant.send(requestId, { pastCeiling }),
        assistantResume: ({ conversationId }) => assistant.resume(conversationId),
        assistantDiscard: async ({ requestId }) => ok({ discarded: assistant.discard(requestId) }),
        assistantStop: async ({ conversationId }) =>
          ok({ stopped: assistant.stop(conversationId) }),
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
