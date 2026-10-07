import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseFollowUp,parseRequest} from '../src/parse-input.mjs';
import {answerWithoutModel,followUpWithoutModel,USAGE} from '../src/fallback.mjs';
import {chatFallback} from '../src/chat/fallback.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
const NOW=Date.parse('2026-10-06T07:00:00Z');
const env=()=>({SHILLCHECK_MOCK:'true',X_BEARER_TOKEN:'t',COINGECKO_API_KEY:'k',COINGECKO_RATE_PER_MIN:'100000',SHILLCHECK_DATA_DIR:join(mkdtempSync(join(tmpdir(),'fb-')),'reports')});
test('follow-up comments are read with simple rules',()=>{
 assert.deepEqual(parseFollowUp('drop anyone above $5K, focus on Asia'),{max_fee_usd:5000,region:'asia'});
 assert.deepEqual(parseFollowUp('Remove @bob and exclude @carol please'),{exclude_handles:['bob','carol']});
 assert.deepEqual(parseFollowUp('set budget to $12,500 and CPM $20'),{budget_usd:12500,cpm_usd:20});
 assert.equal(parseFollowUp('thanks, looks great'),null);
 assert.equal(parseRequest('x @a, region oceania').region,'oceania');
});
test('no model: a Task still returns the full deterministic report with an honest assumptions note',async()=>{
 const e=env();
 const out=await answerWithoutModel('Vet @demo_alpha @demo_pumper @demo_ghost for a DeFi launch in Asia. Budget $20K.',{env:e,fetchImpl:createMockFetch({now:NOW}),now:NOW});
 assert.match(out,/^Assumptions: the language model is unavailable right now/);assert.match(out,/3 handles, budget \$20,000, region asia/);
 assert.match(out,/# ShillCheck report rpt_[0-9a-f]{12}/);assert.match(out,/## Budget split/);assert.match(out,/\*\*Hire\*\*|Hire/);
 assert.equal((await answerWithoutModel('hello there',{env:e})).startsWith(USAGE),true);
});
test('no model: a follow-up re-ranks the stored report; unreadable follow-ups get guidance, not silence',async()=>{
 const e=env();
 const first=await answerWithoutModel('Vet @demo_alpha @demo_pumper @demo_ghost budget $20K',{env:e,fetchImpl:createMockFetch({now:NOW}),now:NOW});
 const reply=followUpWithoutModel({comment:'drop anyone above $2K, focus on Asia',previousResult:first,env:e});
 assert.match(reply,/Re-ranked using simple rules/);assert.match(reply,/Active constraints:\*\* budget \$20,000; fee cap \$2,000 per KOL; region focus: asia/);assert.match(reply,/Dropped @demo_alpha/);
 assert.match(followUpWithoutModel({comment:'hmm interesting',previousResult:first,env:e}),/could not read that change/);
 assert.match(followUpWithoutModel({comment:'drop anyone above $2K',previousResult:'no report here',env:e}),/could not read that change/);
});
test('no model: chat gives a quick verdict for one handle, Task text for several, help otherwise',async()=>{
 const e={...env(),CHAT_X_LIVE:'true'};
 const hello=await chatFallback('hi there',{env:e});assert.match(hello,/language model is unavailable/);
 const one=await chatFallback('is @demo_alpha worth $3K?',{env:e});
 // quickCheck uses the real fetch unless mocked at the env level: the mock env serves fixtures through createDeps
 assert.ok(typeof one==='string'&&one.length>0);
 const many=await chatFallback('vet @demo_alpha @demo_pumper, budget $10k',{env:e});
 assert.match(many,/Vet @demo_alpha @demo_pumper\. Budget \$10,000\./);assert.match(many,/Create a Task/);
 assert.match(await chatFallback('check @!!',{env:e}),/language model is unavailable/);
 assert.match(one,/Yes, \$3,000 is fair for @demo_alpha|Only at a lower price|Not at/);
});
