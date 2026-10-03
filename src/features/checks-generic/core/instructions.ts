import { z } from 'zod';
import type { RemediationDefinition } from '../../../core/checks/registry';
import { err } from '../../../core/result';

export const INSTRUCTIONS = 'instructions.show';

export const InstructionsParamsSchema = z.object({
  /**
   * What to do, in a small Markdown subset: paragraphs, "- " lists, "1. " steps, **bold**,
   * `code` and [links](https://...). No HTML is ever rendered.
   */
  text: z.string().min(1).max(10_000),
});
export type InstructionsParams = z.infer<typeof InstructionsParamsSchema>;

/**
 * A fix that only says what to do. Make ready lists it under "Needs you" and never runs
 * it or reports it as fixed.
 */
export const instructionsRemediation: RemediationDefinition<InstructionsParams> = {
  type: INSTRUCTIONS,
  label: 'Show instructions',
  order: 900,
  kind: 'instructions',
  params: InstructionsParamsSchema,
  describe: () => 'Show instructions',
  instructions: (params) => params.text,
  async run() {
    return err('instructions.only', 'This fix only shows instructions; you do the steps.');
  },
};
