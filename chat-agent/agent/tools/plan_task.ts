import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { planTask } from '../../../src/chat/tools.mjs';

export default defineTool({
  description:
    'For several KOLs (2 to 10 handles) turn the request into a ready-to-paste Task text and say which handles are already cached (free) or would need live X reads (costly). ' +
    'Use this when the user wants to vet more than one KOL or wants a full report.',
  inputSchema: z.object({
    handles: z.array(z.string().min(1).max(60)).min(1).max(10),
    budget_usd: z.number().positive().optional(),
    goal: z.string().max(120).optional(),
    region: z.string().max(40).optional(),
  }),
  async execute(input) {
    return planTask(input);
  },
});
