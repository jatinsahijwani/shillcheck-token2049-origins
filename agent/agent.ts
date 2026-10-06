import { defineAgent } from 'eve';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createScriptedModel } from './lib/scripted-model';
const provider = createOpenAICompatible({name:'zai',baseURL:process.env.ZAI_BASE_URL!,apiKey:process.env.ZAI_API_KEY!});
const model = process.env.SHILLCHECK_SCRIPTED_MODEL === 'true' ? createScriptedModel() : provider.chatModel(process.env.ZAI_MODEL!);
// Explicit window: eve cannot look up AI Gateway metadata for a custom provider. Compaction thresholds depend on it.
const modelContextWindowTokens = Number(process.env.ZAI_CONTEXT_TOKENS) || 128000;
export default defineAgent({model,modelContextWindowTokens,defaultTools:false});
