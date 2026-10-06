import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFallbackModel} from '../agent/lib/fallback-model.ts';
const model=(name,impl)=>({specificationVersion:'v4',provider:'p',modelId:name,supportedUrls:{},doGenerate:impl,doStream:impl});
const err=status=>Object.assign(new Error('x'),{statusCode:status});
test('falls through overloaded models in order',async()=>{
 const calls=[];
 const m=createFallbackModel([model('a',async()=>{calls.push('a');throw err(503)}),model('b',async()=>{calls.push('b');throw err(429)}),model('c',async()=>{calls.push('c');return {ok:'c'}})]);
 assert.deepEqual(await m.doStream({}),{ok:'c'});assert.deepEqual(calls,['a','b','c']);
 assert.equal(m.modelId,'a');
});
test('does not fall through on client errors or abort',async()=>{
 let b=0;
 const m=createFallbackModel([model('a',async()=>{throw err(400)}),model('b',async()=>{b++;return {}})]);
 await assert.rejects(()=>m.doGenerate({}),e=>e.statusCode===400);assert.equal(b,0);
 const ac=new AbortController();ac.abort();
 await assert.rejects(()=>createFallbackModel([model('a',async()=>{throw new Error('aborted')}),model('b',async()=>({}))]).doGenerate({abortSignal:ac.signal}));
});
test('throws the last error when every model fails',async()=>{
 const m=createFallbackModel([model('a',async()=>{throw err(503)}),model('b',async()=>{throw err(500)})]);
 await assert.rejects(()=>m.doStream({}),e=>e.statusCode===500);
});
