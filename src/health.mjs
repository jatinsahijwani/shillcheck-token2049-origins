// Decision logic for the 5-minute health check. Pure so it can be tested: given this run's check results and the previous
// state, say which pm2 processes to restart. Rules: a process that pm2 reports as not online is restarted at once; a
// process whose own health check fails is restarted after FAILS_BEFORE_RESTART consecutive runs; no process is
// restarted more than MAX_RESTARTS_PER_HOUR times (a crash loop needs a human); checks with restart:null only report.
export const FAILS_BEFORE_RESTART=2;
export const MAX_RESTARTS_PER_HOUR=3;
export function decide({results,prev={fails:{},restarts:{}},now=Date.now()}){
 const fails={},restarts={},actions=[];
 for(const [name,r] of Object.entries(prev.restarts??{}))restarts[name]=(r??[]).filter(t=>now-t<3600000);
 for(const [name,r] of Object.entries(results)){
  fails[name]=r.ok?0:(prev.fails?.[name]??0)+1;
  if(r.ok||!r.restart)continue;
  const due=r.immediate||fails[name]>=FAILS_BEFORE_RESTART;
  if(!due)continue;
  const history=restarts[r.restart]??[];
  if(history.length>=MAX_RESTARTS_PER_HOUR){actions.push({check:name,restart:r.restart,action:'skipped',reason:`already restarted ${history.length} times in the last hour`});continue}
  history.push(now);restarts[r.restart]=history;
  actions.push({check:name,restart:r.restart,action:'restart',reason:r.detail});
 }
 const ok=Object.values(results).every(r=>r.ok);
 return {state:{fails,restarts},actions,ok};
}
export const FAIL_FIELDS=['ok','detail'];
export function summarize({results,actions,ok,now=Date.now()}){
 return {ts:new Date(now).toISOString(),overall:ok?'ok':'degraded',checks:Object.fromEntries(Object.entries(results).map(([k,r])=>[k,{ok:r.ok,detail:r.detail}])),actions};
}
