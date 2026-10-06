import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { rerankForAgent } from '../../src/agent-tools.mjs';

export default defineTool({
  description:
    'Re-rank an existing report after a follow-up such as "drop anyone above $5K" or "focus on Asia". ' +
    'New constraints are MERGED with the stored ones, so earlier constraints stay. Uses stored data only (no new X or CoinGecko reads). ' +
    'Pass only what the follow-up changes. Returns a new report_id and a compact numeric summary.',
  inputSchema: z.object({
    report_id: z.string().min(1).max(40),
    max_fee_usd: z.number().positive().optional(),
    exclude_handles: z.array(z.string().min(1).max(60)).max(10).optional(),
    region: z.string().max(60).optional(),
    budget_usd: z.number().positive().optional(),
  }),
  async execute(input, ctx) {
    return rerankForAgent(input, ctx.session?.id ?? null);
  },
});
