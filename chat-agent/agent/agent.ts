import { defineAgent } from 'eve';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createScriptedModel } from '../../agent/lib/scripted-model';
import { createFallbackModel } from '../../agent/lib/fallback-model';
const provider = createOpenAICompatible({name:'zai',baseURL:process.env.ZAI_BASE_URL!,apiKey:process.env.ZAI_API_KEY!});
// Chat prefers a faster model: CHAT_MODEL / CHAT_FALLBACK_MODELS, else the Task agent's settings.
const names = [process.env.CHAT_MODEL || process.env.ZAI_MODEL!, ...(process.env.CHAT_FALLBACK_MODELS ?? process.env.ZAI_FALLBACK_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
const model = process.env.SHILLCHECK_SCRIPTED_MODEL === 'true' ? createScriptedModel() : createFallbackModel(names.map((n) => provider.chatModel(n)));
export default defineAgent({model,modelContextWindowTokens:Number(process.env.ZAI_CONTEXT_TOKENS)||128000,defaultTools:false});
