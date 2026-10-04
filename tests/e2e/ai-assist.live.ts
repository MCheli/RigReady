/**
 * LIVE smoke test of the AI binding help: ONE small real request to the Anthropic API,
 * built by the same code the app uses, to prove the request shape (structured output,
 * prompt caching, refusal fallback header) is accepted and the answer validates.
 *
 * Not part of `npm run check`, the e2e suite or CI (it is not a *.e2e.ts or *.test.ts file).
 * Costs a fraction of a cent. Run by hand:
 *
 *   PowerShell:  $env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User'); npx tsx tests/e2e/ai-assist.live.ts
 *
 * Prints the status, the token counts and the number of suggestions only. The key and the
 * answer are never printed or written anywhere.
 */
import { NodeHttp } from '../../src/platform/node';
import {
  messageBody,
  sendMessage,
  DEFAULT_MODEL,
} from '../../src/features/ai-assist/core/anthropic';
import type { Snapshot } from '../../src/features/ai-assist/core/snapshot';
import { contextText } from '../../src/features/ai-assist/core/snapshot';
import {
  SYSTEM_PROMPT,
  suggestionSchema,
  suggestionTask,
  validatePlan,
} from '../../src/features/ai-assist/core/suggest';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set; nothing was sent.');
  process.exit(2);
}

const snapshot: Snapshot = {
  aircraftId: 'FA-18C_hornet',
  aircraftName: 'F/A-18C',
  actions: [
    {
      id: 'axis:a2001cdnil',
      name: 'Pitch',
      category: ['Flight Control'],
      kind: 'axis',
      editable: true,
    },
    {
      id: 'axis:a2002cdnil',
      name: 'Roll',
      category: ['Flight Control'],
      kind: 'axis',
      editable: true,
    },
    {
      id: 'key:trigger',
      name: 'Gun Trigger - SECOND DETENT (Press to shoot)',
      category: ['Stick', 'HOTAS'],
      kind: 'button',
      editable: true,
    },
    {
      id: 'key:pickle',
      name: 'Weapon Release Button',
      category: ['Stick', 'HOTAS'],
      kind: 'button',
      editable: true,
    },
  ],
  bindings: {
    aircraft: { id: 'FA-18C_hornet', name: 'F/A-18C', hasUserBindings: false },
    devices: [],
  },
  controllers: [
    {
      ref: 'dev1',
      name: 'Generic Joystick',
      guid: '00000000-0000-0000-0000-000000000001',
      role: 'stick',
      connected: true,
      controls: { buttons: 8, hats: 1, axes: ['X', 'Y'] },
    },
  ],
};

const body = messageBody({
  model: process.env.RIGREADY_AI_MODEL ?? DEFAULT_MODEL,
  system: SYSTEM_PROMPT,
  context: contextText(snapshot),
  task: `${suggestionTask(snapshot)}\nKeep it to these four actions.`,
  schema: suggestionSchema(['dev1']),
  maxTokens: 4000,
});

async function main(): Promise<number> {
  const answer = await sendMessage(new NodeHttp(), key!, body, 120_000);
  if (!answer.ok) {
    console.log(
      `FAILED: ${answer.error.code}: ${answer.error.message} ${answer.error.detail ?? ''}`
    );
    return 1;
  }
  const plan = validatePlan(answer.value.text, snapshot);
  const u = answer.value.usage;
  console.log(`OK: model ${answer.value.model}`);
  console.log(
    `tokens: input ${u.input}, cache write ${u.cacheWrite}, cache read ${u.cacheRead}, output ${u.output}; approx $${answer.value.cost.toFixed(4)}`
  );
  console.log(
    plan.ok
      ? `answer validated: ${plan.value.suggestions.length} suggestions kept, ${plan.value.dropped.length} dropped`
      : `answer did NOT validate: ${plan.why}`
  );
  return plan.ok ? 0 : 1;
}

// exitCode, not exit(): exiting while fetch's sockets close trips a libuv assertion on Windows.
void main().then((code) => (process.exitCode = code));
