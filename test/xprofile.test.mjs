import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeps,vetKols} from '../src/pipeline.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
import {createCache} from '../src/cache.mjs';
import {handleCost,POST_COST,USER_COST} from '../src/x-client.mjs';
import {RULES} from '../src/config.mjs';
const NOW=Date.parse('2026-10-06T07:00:00Z');
const env={SHILLCHECK_MOCK:'true',X_BEARER_TOKEN:'t',COINGECKO_API_KEY:'k',COINGECKO_RATE_PER_MIN:'100000'};
const counting=inner=>{const calls=[];const f=async u=>{calls.push(new URL(String(u)));return inner(u)};f.calls=calls;return f};
const run=async(handles,fetchImpl,extra={})=>{const deps=createDeps({env,now:NOW,sleep:async()=>{},fetchImpl,...extra});return {deps,report:await vetKols({handles},{deps,dir:(await import('node:fs')).mkdtempSync(((await import('node:os')).tmpdir())+'/xp-')})}};
test('lean profile constants and the per-handle cost estimate',()=>{
 assert.equal(RULES.postsRead,30);assert.equal(RULES.originalPostsForAverages,30);assert.equal(RULES.replyPosts,2);assert.equal(RULES.repliesPerPost,15);
 assert.equal(Math.round(handleCost()*1000)/1000,0.31);assert.equal(USER_COST+RULES.postsRead*POST_COST,0.16);
});
test('timeline asks X for 30 posts, reply search for 15, and only for the two most recent promo posts',async()=>{
 const f=counting(createMockFetch({now:NOW}));
 const {report}=await run(['demo_pumper'],f);
 const timeline=f.calls.find(u=>/\/users\/\d+\/tweets$/.test(u.pathname));
 assert.equal(timeline.searchParams.get('max_results'),'30');
 const searches=f.calls.filter(u=>u.pathname==='/2/tweets/search/recent');
 assert.ok(searches.length>=1&&searches.length<=2,`searches ${searches.length}`);
 assert.ok(searches.every(u=>u.searchParams.get('max_results')==='15'));
 assert.equal(report.analyses[0].posts.n,30);
 assert.ok(report.usage.estXCostUsd<=0.31+1e-9,`cost ${report.usage.estXCostUsd}`);
 assert.equal(report.analyses[0].replies.status,'ok');
});
test('no recent promo post: no reply search is made and the report says why',async()=>{
 const f=counting(createMockFetch({now:NOW}));
 const later=createDeps({env,now:NOW+20*86400000,sleep:async()=>{},fetchImpl:f});
 const report=await vetKols({handles:['demo_alpha']},{deps:later,dir:(await import('node:fs')).mkdtempSync(((await import('node:os')).tmpdir())+'/xp-')});
 assert.equal(f.calls.filter(u=>u.pathname==='/2/tweets/search/recent').length,0);
 assert.match(report.markdown,/no promotion post within the 7-day search window/);
 assert.ok(report.usage.estXCostUsd<=0.16+1e-9,`cost ${report.usage.estXCostUsd}`);
});
test('a larger cached timeline (100 posts) is analysed as the latest 30 only, same as a fresh read',async()=>{
 const big=Array.from({length:100},(_,i)=>({id:String(9000+i),created_at:new Date(NOW-(i+1)*86400000).toISOString(),text:i>60?'$OLDCOIN pump':'plain post',entities:{},noteEntities:{},metrics:{impression_count:i<30?1000:5000000,like_count:1,retweet_count:0,reply_count:0,quote_count:0}}));
 const cache=createCache({});
 cache.set('x:user:cachedguy',{found:true,user:{id:'777',name:'c',created_at:'2020-01-01T00:00:00.000Z',location:'',public_metrics:{followers_count:1000},profile_image_url:'x'}});
 cache.set('x:tweets:777',big);
 const f=counting(createMockFetch({now:NOW}));
 const deps=createDeps({env:{...env,X_LIVE_ALLOWED:'false'},now:NOW,sleep:async()=>{},fetchImpl:f,cache});
 const report=await vetKols({handles:['cachedguy']},{deps,dir:(await import('node:fs')).mkdtempSync(((await import('node:os')).tmpdir())+'/xp-')});
 const k=report.analyses[0];
 assert.equal(k.status,'ok');assert.equal(k.posts.n,30);assert.equal(k.posts.medianViews,1000,'older, larger posts are ignored');
 assert.equal(k.promos.length,0,'promos beyond the latest 30 posts are not considered');
 assert.equal(f.calls.filter(u=>u.hostname==='api.x.com').length,0);
});
