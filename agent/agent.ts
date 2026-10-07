import { defineAgent } from 'eve';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createScriptedModel } from './lib/scripted-model';
import { createFallbackModel } from './lib/fallback-model';
const provider = createOpenAICompatible({name:'zai',baseURL:process.env.ZAI_BASE_URL!,apiKey:process.env.ZAI_API_KEY!});
// ZAI_MODEL is the primary; ZAI_FALLBACK_MODELS is an optional comma-separated list tried in order when it is overloaded.
const names = [process.env.ZAI_MODEL!, ...(process.env.ZAI_FALLBACK_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
const model = process.env.SHILLCHECK_SCRIPTED_MODEL === 'true' ? createScriptedModel() : createFallbackModel(names.map((n) => provider.chatModel(n)));
// Explicit window: eve cannot look up AI Gateway metadata for a custom provider. Compaction thresholds depend on it.
const modelContextWindowTokens = Number(process.env.ZAI_CONTEXT_TOKENS) || 128000;
export default defineAgent({model,modelContextWindowTokens,defaultTools:false});
