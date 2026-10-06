import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { quickCheck } from '../../../src/chat/tools.mjs';

export default defineTool({
  description:
    'Quick single-KOL check from cached data (live X only if the owner enabled it). Pass the handle and, if the user named a price, fee_usd. ' +
    'Returns a quick_id and numeric facts. To show the verdict block to the user, put [[SHILLCHECK_QUICK:<quick_id>]] (add :fee=<usd> if a fee was given) on its own line in your reply.',
  inputSchema: z.object({
    handle: z.string().min(1).max(60),
    fee_usd: z.number().positive().optional(),
    cpm_usd: z.number().positive().optional(),
  }),
  async execute(input, ctx) {
    return quickCheck(input, ctx.session?.id ?? 'unknown');
  },
});
