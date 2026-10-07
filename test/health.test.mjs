import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide,summarize,FAILS_BEFORE_RESTART,MAX_RESTARTS_PER_HOUR} from '../src/health.mjs';
const ok=()=>({ok:true,detail:'ok'});
const bad=(restart,extra={})=>({ok:false,detail:'down',restart,...extra});
test('all healthy: no actions',()=>{
 const r=decide({results:{a:ok(),b:ok()}});assert.equal(r.ok,true);assert.deepEqual(r.actions,[]);assert.deepEqual(r.state.fails,{a:0,b:0});
});
test('a process pm2 reports as down is restarted immediately',()=>{
 const r=decide({results:{'process:worker':bad('shillcheck-worker',{immediate:true})}});
 assert.deepEqual(r.actions.map(a=>[a.action,a.restart]),[['restart','shillcheck-worker']]);
});
test('a failing health check restarts only after consecutive failures, and recovery resets the counter',()=>{
 let state;
 let r=decide({results:{eve:bad('shillcheck-eve')},prev:state});assert.deepEqual(r.actions,[]);state=r.state;
 r=decide({results:{eve:ok()},prev:state});assert.equal(r.state.fails.eve,0);state=r.state;
 r=decide({results:{eve:bad('shillcheck-eve')},prev:state});assert.deepEqual(r.actions,[],'counter restarted at 1');state=r.state;
 r=decide({results:{eve:bad('shillcheck-eve')},prev:state});assert.equal(r.actions.length,1);assert.equal(FAILS_BEFORE_RESTART,2);
});
test('report-only checks (no restart target) never restart',()=>{
 let state;for(let i=0;i<5;i++){const r=decide({results:{gemini:{ok:false,detail:'HTTP 500'}},prev:state});assert.deepEqual(r.actions,[]);state=r.state}
});
test('crash loops are capped per hour, then allowed again',()=>{
 let state,t=1000000;
 for(let i=0;i<MAX_RESTARTS_PER_HOUR;i++){const r=decide({results:{p:bad('x',{immediate:true})},prev:state,now:t+i*1000});assert.equal(r.actions[0].action,'restart');state=r.state}
 let r=decide({results:{p:bad('x',{immediate:true})},prev:state,now:t+10000});assert.equal(r.actions[0].action,'skipped');state=r.state;
 r=decide({results:{p:bad('x',{immediate:true})},prev:state,now:t+3700000});assert.equal(r.actions[0].action,'restart');
});
test('summary lists each check and an overall verdict',()=>{
 const results={a:ok(),b:bad('x')};const d=decide({results});
 const s=summarize({results,actions:d.actions,ok:d.ok,now:Date.parse('2026-10-07T00:00:00Z')});
 assert.equal(s.overall,'degraded');assert.equal(s.ts,'2026-10-07T00:00:00.000Z');assert.deepEqual(Object.keys(s.checks),['a','b']);
});
