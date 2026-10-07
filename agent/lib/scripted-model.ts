// Offline stand-in for the LLM, enabled only by SHILLCHECK_SCRIPTED_MODEL=true. It lets the eve tool wiring,
// session ids and marker expansion be tested without a Z.ai key. It never runs in production.
const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
function textOf(message: any): string {
  return (message?.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ');
}
function toolReportIds(prompt: any[]): string[] {
  const ids: string[] = [];
  for (const m of prompt) for (const p of m.content ?? []) {
    if (p.type !== 'tool-result') continue;
    const v = p.output?.value;
    const body = typeof v === 'string' ? v : JSON.stringify(v);
    const id = /rpt_[0-9a-f]{12}/.exec(body ?? '')?.[0];
    if (id) ids.push(id);
  }
  return ids;
}
function planChat(prompt: any[]) {
  const last = prompt[prompt.length - 1];
  const lastResult = [...prompt].reverse().flatMap((m: any) => m.content ?? []).find((p: any) => p.type === 'tool-result');
  const body = lastResult ? (typeof lastResult.output?.value === 'string' ? lastResult.output.value : JSON.stringify(lastResult.output?.value)) : '';
  if (last?.role === 'tool') {
    if (lastResult?.toolName === 'plan_task') {
      const t = /"task_text":"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] ?? '';
      return { text: `Here is the Task text:\n\n\`\`\`\n${JSON.parse(`"${t}"`)}\n\`\`\`` };
    }
    const id = /rpt_[0-9a-f]{12}/.exec(body)?.[0];
    const fee = /"asked_fee_usd":(\d+(?:\.\d+)?)/.exec(body)?.[1];
    return { text: `Quick check:\n[[SHILLCHECK_QUICK:${id}${fee ? `:fee=${fee}` : ''}]]` };
  }
  const user = textOf([...prompt].reverse().find((m) => m.role === 'user'));
  const handles = [...user.matchAll(/@([A-Za-z0-9_]{1,15})/g)].map((m) => m[1]);
  if (handles.length > 1) return { tool: { name: 'plan_task', input: { handles } } };
  if (handles.length === 1) {
    const fee = /\$\s*(\d+(?:\.\d+)?)\s*(k)?/i.exec(user);
    const input: any = { handle: handles[0] };
    if (fee) input.fee_usd = Number(fee[1]) * (fee[2] ? 1000 : 1);
    return { tool: { name: 'quick_check', input } };
  }
  return { text: 'Hi! I can check whether a crypto KOL on X is worth paying. Try: "is @name worth $3K?"' };
}
function plan(prompt: any[]) {
  if (process.env.SHILLCHECK_SCRIPTED_KIND === 'chat') return planChat(prompt);
  const last = prompt[prompt.length - 1];
  const ids = toolReportIds(prompt);
  if (last?.role === 'tool') return { text: `Assumptions: scripted model, defaults stated in the report.\n[[SHILLCHECK_REPORT:${ids[ids.length - 1]}]]` };
  const user = textOf([...prompt].reverse().find((m) => m.role === 'user'));
  const handles = [...user.matchAll(/@([A-Za-z0-9_]{1,15})/g)].map((m) => m[1]);
  const fee = /\$\s*(\d+(?:\.\d+)?)\s*k/i.exec(user);
  if (ids.length && /drop|above|focus|asia|exclude/i.test(user)) {
    const input: any = { report_id: ids[ids.length - 1] };
    if (fee) input.max_fee_usd = Number(fee[1]) * 1000;
    if (/asia/i.test(user)) input.region = 'asia';
    return { tool: { name: 'rerank_report', input } };
  }
  if (!handles.length) return { text: 'Send up to 10 X handles, optionally with a budget, goal, niche or region, for example "@alice @bob budget $10k, Asia DeFi launch".' };
  const input: any = { handles };
  const budget = /budget\s*\$?\s*(\d+(?:\.\d+)?)\s*(k)?/i.exec(user);
  if (budget) input.budget_usd = Number(budget[1]) * (budget[2] ? 1000 : 1);
  return { tool: { name: 'vet_kols', input } };
}
export function createScriptedModel(): any {
  const parts = (options: any) => {
    const step = plan(options.prompt);
    if ('tool' in step && step.tool) {
      return [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: `call_${Date.now()}`, toolName: step.tool.name, input: JSON.stringify(step.tool.input) },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
      ];
    }
    return [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: (step as any).text },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ];
  };
  return {
    specificationVersion: 'v4',
    provider: 'scripted',
    modelId: 'scripted',
    supportedUrls: {},
    async doGenerate(options: any) {
      const all = parts(options);
      const call = all.find((p: any) => p.type === 'tool-call');
      const text = all.filter((p: any) => p.type === 'text-delta').map((p: any) => p.delta).join('');
      return { content: call ? [call] : [{ type: 'text', text }], finishReason: (all.at(-1) as any).finishReason, usage, warnings: [] };
    },
    async doStream(options: any) {
      const all = parts(options);
      return { stream: new ReadableStream({ start(c) { for (const p of all) c.enqueue(p); c.close(); } }) };
    },
  };
}
