import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { vetForAgent } from '../../src/agent-tools.mjs';

export default defineTool({
  description:
    'Vet up to 10 crypto KOLs (X handles). Fetches real data, runs the scoring rules and stores the full report. ' +
    'Returns only a report_id and a compact numeric summary. The report text is attached to your reply by the marker, never by you.',
  inputSchema: z.object({
    handles: z.array(z.string().min(1).max(60)).min(1).max(10),
    budget_usd: z.number().positive().optional(),
    goal: z.string().max(200).optional(),
    niche: z.string().max(100).optional(),
    region: z.string().max(60).optional(),
    cpm_usd: z.number().positive().optional(),
    quoted_fees: z.record(z.string(), z.number().positive()).optional(),
  }),
  async execute(input, ctx) {
    return vetForAgent(input, ctx.session?.id ?? null);
  },
});
