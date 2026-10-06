import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {quickCheck,planTask,chatEnv,chatSpendToday} from '../src/chat/tools.mjs';
import {renderQuick,quickFacts} from '../src/chat/quick.mjs';
import {expandChatMarkers} from '../src/chat/markers.mjs';
import {createChatServer,createRateLimiter,lastUserText} from '../src/chat/responses-server.mjs';
import {createEveBrain} from '../src/chat/eve-brain.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
import {loadReport} from '../src/store.mjs';
const NOW=Date.parse('2026-10-06T07:00:00Z');
const tmp=()=>mkdtempSync(join(tmpdir(),'chat-'));
// Real pipeline code on fixtures, with a disk cache in a temp dir so planTask can see what is cached.
function envFor(root,extra={}){return {SHILLCHECK_DATA_DIR:join(root,'reports'),SHILLCHECK_CACHE_DIR:join(root,'cache'),X_BEARER_TOKEN:'t',COINGECKO_API_KEY:'k',COINGECKO_RATE_PER_MIN:'100000',X_LIVE_ALLOWED:'false',...extra}}
function counting(inner){const calls=[];const f=async url=>{calls.push(String(url));return inner(url)};f.calls=calls;return f}
const SECRET='s'.repeat(32);

// ---- quick check ------------------------------------------------------------------------------------
test('quick check: cache-first, live X off in chat by default, verdicts and fee comparison',async()=>{
 const root=tmp();
 try{
  const warm=counting(createMockFetch({now:NOW}));
  // warm the cache with live reads allowed once, as the owner would
  await quickCheck({handle:'demo_alpha'},'s1',{env:envFor(root,{CHAT_X_LIVE:'true'}),fetchImpl:warm,now:NOW});
  assert.ok(warm.calls.some(u=>u.includes('api.x.com')),'live reads happened because the owner enabled them');
  const off=counting(createMockFetch({now:NOW}));
  const fair=await quickCheck({handle:'demo_alpha',fee_usd:3000},'s2',{env:envFor(root),fetchImpl:off,now:NOW});
  assert.equal(off.calls.filter(u=>u.includes('api.x.com')).length,0,'served from cache, no X call');
  assert.equal(fair.verdict,'Hire');assert.equal(fair.asked_fee_usd,3000);assert.ok(fair.fair_price_usd>3000);assert.ok(fair.fee_vs_fair<1);
  const md=expandChatMarkers(`Here you go:\n[[SHILLCHECK_QUICK:${fair.quick_id}:fee=3000]]`,{dir:join(root,'reports')});
  assert.match(md,/Yes, \$3,000 is fair for @demo_alpha/);assert.match(md,/within the estimated fair price/);assert.match(md,/Fair price \(estimate\)/);assert.match(md,/cached X read/);
  assert.doesNotMatch(md,/\[\[SHILLCHECK/);
  // a fee far above fair price becomes Negotiate with the rule stated
  const high=await quickCheck({handle:'demo_alpha',fee_usd:100000},'s2',{env:envFor(root),fetchImpl:off,now:NOW});
  assert.equal(high.verdict,'Negotiate');
  assert.match(expandChatMarkers(`[[SHILLCHECK_QUICK:${high.quick_id}:fee=100000]]`,{dir:join(root,'reports')}),/Only at a lower price than \$100,000/);
  // facts for the model contain numbers and rule text only, never post text
  assert.doesNotMatch(JSON.stringify(fair),/Partnered|Sponsored|gm builders/);
 }finally{rmSync(root,{recursive:true})}
});
test('quick check: Avoid, not found, invalid, and uncached handles never spend when live reads are off',async()=>{
 const root=tmp();
 try{
  const f=counting(createMockFetch({now:NOW}));
  await quickCheck({handle:'demo_pumper'},'s',{env:envFor(root,{CHAT_X_LIVE:'true'}),fetchImpl:f,now:NOW});
  const pumper=await quickCheck({handle:'demo_pumper',fee_usd:5000},'s',{env:envFor(root),fetchImpl:f,now:NOW});
  assert.equal(pumper.verdict,'Avoid');
  assert.match(expandChatMarkers(`[[SHILLCHECK_QUICK:${pumper.quick_id}:fee=5000]]`,{dir:join(root,'reports')}),/Not at \$5,000: @demo_pumper is rated Avoid/);
  assert.doesNotMatch(expandChatMarkers(`[[SHILLCHECK_QUICK:${pumper.quick_id}:fee=5000]]`,{dir:join(root,'reports')}),/puts them at Negotiate/);
  const before=f.calls.length;
  const cold=await quickCheck({handle:'demo_ghost'},'s',{env:envFor(root),fetchImpl:f,now:NOW});
  assert.equal(f.calls.filter(u=>u.includes('api.x.com')).length,f.calls.slice(0,before).filter(u=>u.includes('api.x.com')).length,'no new X call on a miss');
  assert.equal(cold.status,'error');
  assert.match(expandChatMarkers(`[[SHILLCHECK_QUICK:${cold.quick_id}]]`,{dir:join(root,'reports')}),/not in my cache and live X reads are off/);
  assert.equal((await quickCheck({handle:'not a handle!!'},'s',{env:envFor(root),fetchImpl:f,now:NOW})).status,'invalid');
  const missing=await quickCheck({handle:'demo_nobody'},'s',{env:envFor(root,{CHAT_X_LIVE:'true'}),fetchImpl:f,now:NOW});
  assert.match(expandChatMarkers(`[[SHILLCHECK_QUICK:${missing.quick_id}]]`,{dir:join(root,'reports')}),/could not find that handle/);
 }finally{rmSync(root,{recursive:true})}
});
test('chat live-read budget: daily cap blocks live reads once chat spend reaches it',()=>{
 const root=tmp();
 try{
  const dir=join(root,'reports');
  assert.equal(chatEnv(envFor(root,{CHAT_X_LIVE:'true'}),dir).X_LIVE_ALLOWED,'true');
  assert.equal(chatEnv(envFor(root),dir).X_LIVE_ALLOWED,'false','off unless CHAT_X_LIVE=true');
 }finally{rmSync(root,{recursive:true})}
});
test('chat spend today counts only chat reports from today',async()=>{
 const root=tmp();
 try{
  const {mkdirSync}=await import('node:fs');
  const dir=join(root,'reports');mkdirSync(dir,{recursive:true});
  const put=(id,over)=>writeFileSync(join(dir,`${id}.json`),JSON.stringify({id,createdAt:new Date().toISOString(),sessionId:'chat:x',usage:{estXCostUsd:1.5},...over}));
  put('rpt_000000000001',{});put('rpt_000000000002',{sessionId:'wrun_task'});put('rpt_000000000003',{createdAt:new Date(Date.now()-3*86400000).toISOString()});
  assert.equal(chatSpendToday(dir),1.5);
  assert.equal(chatEnv({CHAT_X_LIVE:'true',CHAT_X_DAILY_USD:'1'},dir).X_LIVE_ALLOWED,'false','cap reached');
  assert.equal(chatEnv({CHAT_X_LIVE:'true',CHAT_X_DAILY_USD:'5'},dir).X_LIVE_ALLOWED,'true');
 }finally{rmSync(root,{recursive:true})}
});
test('plan task: ready-to-paste text, cached vs uncached, cost note',async()=>{
 const root=tmp();
 try{
  await quickCheck({handle:'demo_alpha'},'s',{env:envFor(root,{CHAT_X_LIVE:'true'}),fetchImpl:createMockFetch({now:NOW}),now:NOW});
  const plan=planTask({handles:['@demo_alpha','demo_pumper','x.com/demo_ghost','bad handle!!'],budget_usd:10000,goal:'a DeFi launch',region:'Asia'},{env:envFor(root)});
  assert.equal(plan.task_text,'Vet @demo_alpha @demo_pumper @demo_ghost for a DeFi launch. Budget $10,000, Asia.');
  assert.deepEqual(plan.cached_handles,['demo_alpha']);assert.deepEqual(plan.uncached_handles,['demo_pumper','demo_ghost']);
  assert.equal(plan.invalid_inputs.length,1);assert.equal(plan.est_live_cost_usd_if_uncached,1.4);assert.equal(plan.how_to.length,3);
  assert.equal(planTask({handles:['a1'],goal:'our Asia launch',region:'asia'},{env:envFor(root)}).task_text,'Vet @a1 for our Asia launch.','region already in the goal is not repeated');
  assert.equal(planTask({handles:Array.from({length:12},(_,i)=>`h${i}`)},{env:envFor(root)}).dropped_beyond_limit,2);
 }finally{rmSync(root,{recursive:true})}
});
test('markers: unknown or malicious ids are never read as files',()=>{
 const dir=tmp();
 try{
  assert.equal(expandChatMarkers('[[SHILLCHECK_QUICK:rpt_000000000000]]',{dir}),'[result unavailable]');
  assert.equal(expandChatMarkers('[[SHILLCHECK_QUICK:../../etc/passwd]]',{dir}),'[result unavailable]');
  assert.equal(expandChatMarkers('no marker here',{dir}),'no marker here');
 }finally{rmSync(dir,{recursive:true})}
});
// ---- Responses endpoint ------------------------------------------------------------------------------
async function start(over={}){
 const calls=[];
 const brain=over.brain??(async(key,text,ctx)=>{calls.push({key,text,user:ctx.userId});return `echo: ${text}`});
 const chat=createChatServer({secret:SECRET,brain,log:{error(){}},keepaliveMs:30,...over.opts});
 const server=createServer(chat.handler);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}/c/${SECRET}`;
 return {base,calls,chat,close:()=>server.close()};
}
const post=(base,body,headers={})=>fetch(`${base}/responses`,{method:'POST',headers:{'content-type':'application/json','x-sokosumi-user-id':'user_1',...headers},body:JSON.stringify(body)});
async function events(res){
 const text=await res.text();const out=[];
 for(const block of text.split('\n\n')){const ev=/^event: (.+)$/m.exec(block),data=/^data: (.+)$/m.exec(block);if(ev&&data)out.push({event:ev[1],data:JSON.parse(data[1])})}
 return {out,text};
}
const input=t=>[{role:'user',content:[{type:'input_text',text:t}]}];
test('input extraction handles strings, parts and the latest user turn',()=>{
 assert.equal(lastUserText('hi'),'hi');
 assert.equal(lastUserText(input('hello')),'hello');
 assert.equal(lastUserText([{role:'user',content:'a'},{role:'assistant',content:'b'},{role:'user',content:[{type:'input_text',text:'c'},{type:'input_text',text:'d'}]}]),'c\nd');
 assert.equal(lastUserText([{role:'assistant',content:'x'}]),'');assert.equal(lastUserText(null),'');
});
test('streams the Responses events Core needs: created, text deltas, completed',async()=>{
 const s=await start();
 try{
  const res=await post(s.base,{input:input('is @x worth $3K?'),stream:true});
  assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/event-stream/);
  const {out}=await events(res);
  assert.equal(out[0].event,'response.created');assert.match(out[0].data.response.id,/^resp_/);assert.equal(out[0].data.type,'response.created');
  const deltas=out.filter(e=>e.event==='response.output_text.delta').map(e=>e.data.delta).join('');
  assert.equal(deltas,'echo: is @x worth $3K?');
  const done=out.at(-1);assert.equal(done.event,'response.completed');assert.equal(done.data.response.id,out[0].data.response.id);assert.equal(done.data.response.output[0].content[0].text,'echo: is @x worth $3K?');
  assert.equal(s.calls[0].user,'user_1');
 }finally{s.close()}
});
test('long answers are split into several deltas; non-stream requests get one JSON object',async()=>{
 const long='word '.repeat(200).trim();
 const s=await start({brain:async()=>long});
 try{
  const {out}=await events(await post(s.base,{input:input('hi'),stream:true}));
  const deltas=out.filter(e=>e.event==='response.output_text.delta');assert.ok(deltas.length>3);assert.equal(deltas.map(d=>d.data.delta).join(''),long);
  const json=await (await post(s.base,{input:input('hi'),stream:false})).json();
  assert.equal(json.status,'completed');assert.equal(json.output_text,long);
 }finally{s.close()}
});
test('conversation continuity via previous_response_id; another user cannot reuse it',async()=>{
 const s=await start();
 try{
  const first=(await events(await post(s.base,{input:input('one'),stream:true}))).out[0].data.response.id;
  await events(await post(s.base,{input:input('two'),stream:true,previous_response_id:first}));
  assert.equal(s.calls[0].key,s.calls[1].key,'same conversation key');
  await events(await post(s.base,{input:input('three'),stream:true,previous_response_id:first},{'x-sokosumi-user-id':'user_2'}));
  assert.notEqual(s.calls[2].key,s.calls[0].key,'a different user gets a new conversation');
  const created=(await events(await post(s.base,{input:input('four'),stream:true,conversation:s.calls[0].key}))).out[0].data.response.conversation.id;
  assert.equal(created,s.calls[0].key);
 }finally{s.close()}
});
test('secret path, methods, headers, body size and bad JSON are enforced',async()=>{
 const s=await start();
 try{
  const root=s.base.split('/c/')[0];
  assert.equal((await fetch(`${root}/c/wrong-secret-wrong-secret-1234/responses`,{method:'POST',body:'{}'})).status,404);
  assert.equal((await fetch(`${root}/responses`,{method:'POST',body:'{}'})).status,404);
  assert.equal((await fetch(`${root}/`)).status,404);
  assert.equal((await fetch(`${s.base}/health`)).status,200);
  assert.equal((await fetch(`${s.base}/responses`)).status,404,'GET without id');
  assert.equal((await post(s.base,{input:input('x')},{'x-sokosumi-user-id':''})).status,400);
  assert.equal((await post(s.base,{input:input('x')},{'x-sokosumi-user-id':'a b;c'})).status,400);
  assert.equal((await post(s.base,{input:[]})).status,400);
  assert.equal((await fetch(`${s.base}/responses`,{method:'POST',headers:{'x-sokosumi-user-id':'u'},body:'not json'})).status,400);
  assert.equal((await post(s.base,{input:input('x'.repeat(70000))})).status,413);
  assert.equal(s.calls.length,0,'nothing reached the brain');
 }finally{s.close()}
});
test('rate limits answer politely instead of failing, and the brain is not called',async()=>{
 const s=await start({opts:{limiter:createRateLimiter({perUserPerMin:2,perUserPerDay:100,globalPerMin:100})}});
 try{
  for(let i=0;i<2;i++)await events(await post(s.base,{input:input('hi')}));
  const {out}=await events(await post(s.base,{input:input('again'),stream:true}));
  assert.match(out.find(e=>e.event==='response.completed').data.response.output_text,/sending messages quickly/);
  assert.equal(s.calls.length,2);
  await events(await post(s.base,{input:input('other user')},{'x-sokosumi-user-id':'user_9'}));assert.equal(s.calls.length,3);
 }finally{s.close()}
});
test('limiter windows: per-minute, per-day, global',()=>{
 let t=0;const l=createRateLimiter({perUserPerMin:2,perUserPerDay:3,globalPerMin:4,now:()=>t});
 assert.equal(l.check('a'),null);assert.equal(l.check('a'),null);assert.equal(l.check('a'),'minute');
 t=61000;assert.equal(l.check('a'),null);assert.equal(l.check('a'),'day');
 t=62000;assert.equal(l.check('b'),null);assert.equal(l.check('c'),null);assert.equal(l.check('d'),null);assert.equal(l.check('e'),'busy');
});
test('brain timeout and brain errors become friendly answers, never raw errors',async()=>{
 const slow=await start({brain:()=>new Promise(()=>{}),opts:{brainTimeoutMs:60}});
 try{assert.match((await events(await post(slow.base,{input:input('hi'),stream:true}))).out.at(-1).data.response.output_text,/taking longer than expected/)}finally{slow.close()}
 const broken=await start({brain:async()=>{throw new Error('stack trace with secret')}});
 try{const {text}=await events(await post(broken.base,{input:input('hi'),stream:true}));assert.match(text,/Something went wrong on my side/);assert.doesNotMatch(text,/secret|stack/)}finally{broken.close()}
});
test('concurrency cap answers busy; late responses can be fetched by id',async()=>{
 let release;const gate=new Promise(r=>release=r);
 const s=await start({brain:async()=>{await gate;return 'done'},opts:{maxConcurrent:1}});
 try{
  const first=post(s.base,{input:input('slow'),stream:false});
  await new Promise(r=>setTimeout(r,40));
  const busy=await (await post(s.base,{input:input('second'),stream:false},{'x-sokosumi-user-id':'user_2'})).json();
  assert.match(busy.output_text,/handling a lot of chats/);
  release();const done=await (await first).json();assert.equal(done.output_text,'done');
  const got=await (await fetch(`${s.base}/responses/${done.id}`)).json();
  assert.equal(got.status,'completed');assert.equal(got.output[0].content[0].text,'done');
  assert.equal((await fetch(`${s.base}/responses/resp_unknown`)).status,404);
 }finally{s.close()}
});
test('keepalive comments flow while the brain works',async()=>{
 const s=await start({brain:async()=>{await new Promise(r=>setTimeout(r,120));return 'ok'}});
 try{const {text}=await events(await post(s.base,{input:input('hi'),stream:true}));assert.match(text,/: keepalive/)}finally{s.close()}
});
test('server refuses a short secret',()=>{assert.throws(()=>createChatServer({secret:'short',brain:async()=>''}),/at least 24/)});
// ---- eve brain ---------------------------------------------------------------------------------------
function fakeEve(answer=(text)=>`reply to ${text}`){
 let created=0;const sent=[];
 const clientImpl={sessions:{
  async create(){const id=`wrun_${++created}`;return {session:{state:{sessionId:id},send:async t=>{sent.push([id,t]);return {result:async()=>({status:'completed',inputRequests:[],message:answer(t)})}}}}},
  attach(id){return {state:{sessionId:id},send:async t=>{sent.push([id,t]);return {result:async()=>({status:'completed',inputRequests:[],message:answer(t)})}}}},
 }};
 return {clientImpl,sent,get created(){return created}};
}
test('eve brain: one session per conversation, persisted across restarts, markers expanded by the system',async()=>{
 const root=tmp();
 try{
  const env=envFor(root,{CHAT_X_LIVE:'true'});
  const q=await quickCheck({handle:'demo_alpha',fee_usd:3000},'s',{env,fetchImpl:createMockFetch({now:NOW}),now:NOW});
  const eve=fakeEve(()=>`Quick check:\n[[SHILLCHECK_QUICK:${q.quick_id}:fee=3000]]`);
  const stateDir=join(root,'chat'),dataDir=join(root,'reports');
  const brain=createEveBrain({host:'x',dataDir,stateDir,clientImpl:eve.clientImpl});
  const a=await brain('conv_a','is @demo_alpha worth $3K?');
  assert.match(a,/Yes, \$3,000 is fair/);assert.doesNotMatch(a,/SHILLCHECK_QUICK/);
  await brain('conv_a','why?');await brain('conv_b','hello');
  assert.equal(eve.created,2);assert.deepEqual(eve.sent.map(s=>s[0]),['wrun_1','wrun_1','wrun_2']);
  const again=fakeEve();const restarted=createEveBrain({host:'x',dataDir,stateDir,clientImpl:again.clientImpl});
  await restarted('conv_a','still there?');assert.equal(again.created,0,'session mapping survived a restart');assert.equal(again.sent[0][0],'wrun_1');
 }finally{rmSync(root,{recursive:true})}
});
test('eve brain: turns in one conversation run in order; failed or empty turns throw',async()=>{
 const root=tmp();
 try{
  const order=[];let release;const gate=new Promise(r=>release=r);
  const clientImpl={sessions:{create:async()=>({session:{state:{sessionId:'w1'},send:async t=>{order.push(`start ${t}`);if(t==='first')await gate;order.push(`end ${t}`);return {result:async()=>({status:'completed',inputRequests:[],message:t})}}}}),attach:()=>null}};
  const brain=createEveBrain({host:'x',dataDir:root,stateDir:join(root,'c'),clientImpl});
  const p1=brain('c','first'),p2=brain('c','second');
  await new Promise(r=>setTimeout(r,30));assert.deepEqual(order,['start first']);release();await Promise.all([p1,p2]);
  assert.deepEqual(order,['start first','end first','start second','end second']);
  const bad=createEveBrain({host:'x',dataDir:root,stateDir:join(root,'d'),clientImpl:fakeEve(()=>'  ').clientImpl});
  await assert.rejects(()=>bad('c','x'),/did not return an answer/);
 }finally{rmSync(root,{recursive:true})}
});
test('quick facts for the model: numeric fields only',async()=>{
 const root=tmp();
 try{
  const q=await quickCheck({handle:'demo_pumper',fee_usd:2000},'s',{env:envFor(root,{CHAT_X_LIVE:'true'}),fetchImpl:createMockFetch({now:NOW}),now:NOW});
  assert.equal(q.verdict,'Avoid');assert.ok(q.bot_share_pct>=40);assert.ok(q.median_30d_pct<=-50);assert.equal(typeof q.followers,'number');
  const report=loadReport(join(root,'reports'),q.quick_id);
  assert.match(renderQuick(report,{askedFee:2000}),/Past promotions: \d+ priced at 30 days/);
  assert.doesNotMatch(JSON.stringify(quickFacts(report,2000)),/https?:\/\//);
 }finally{rmSync(root,{recursive:true})}
});
