import {readFileSync,existsSync} from 'node:fs';
import {parseRequest,parseFollowUp} from './parse-input.mjs';
import {createDeps,vetKols,rerankReport,cleanHandles} from './pipeline.mjs';
import {renderCompact} from './report.mjs';
import {createMockFetch} from './mock-fetch.mjs';
import {dataDir,isMock,RULES} from './config.mjs';
export const USAGE=`Send up to ${RULES.maxHandles} X handles, optionally with a budget, goal, niche or region, for example: "Vet @alice @bob @carol for a DeFi launch in Asia. Budget $20K."`;
const usd=n=>`$${Math.round(n).toLocaleString('en-US')}`;
// When the language model is unavailable (provider outage, no credits, timeout) the analysis itself does not need it: it is
// deterministic code. These functions read the request with simple rules and return the same report, so a paid Task still delivers.
export async function answerWithoutModel(input,{env=process.env,fetchImpl,now=Date.now()}={}){
 const params=parseRequest(String(input));
 const {valid,dropped}=cleanHandles(params.handles);
 if(!valid.length)return `${USAGE}\n\n(The language model is unavailable right now, so this is the standard usage guide.)`;
 const deps=createDeps({env,now,fetchImpl:fetchImpl??(isMock(env)?createMockFetch({now}):fetch)});
 const report=await vetKols({...params,handles:valid},{deps,dir:dataDir(env),sessionId:'fallback'});
 const read=[`${valid.length} handle${valid.length===1?'':'s'}`];
 read.push(params.budget_usd?`budget ${usd(params.budget_usd)}`:'no budget (fair prices only)');
 if(params.region)read.push(`region ${params.region}`);
 if(params.cpm_usd)read.push(`CPM $${params.cpm_usd}`);
 const note=dropped?` Only the first ${RULES.maxHandles} handles were used.`:'';
 return `Assumptions: the language model is unavailable right now, so your request was read with simple rules (${read.join(', ')}).${note} The analysis below is computed by the same deterministic code as always.\n\n${report.markdown}`;
}
// Follow-up comment without the model: apply recognised constraints to the Task's stored report and reply compactly.
export function followUpWithoutModel({comment,previousResult,paid=false,env=process.env}){
 const update=parseFollowUp(comment);
 const id=/# ShillCheck report (rpt_[0-9a-f]{12})/.exec(String(previousResult??''))?.[1];
 if(!update||!id)return 'I could not read that change without the language model, which is unavailable right now. Try wording like "drop anyone above $5K", "focus on Asia" or "drop @handle".';
 const report=rerankReport({reportId:id,update,dir:dataDir(env),sessionId:'fallback'});
 return `Re-ranked using simple rules because the language model is unavailable; the numbers come from the same stored data.\n\n${renderCompact(report,{paid})}`;
}
export const previousResultOf=(taskId)=>{const f=`.local/${taskId}.txt`;return existsSync(f)?readFileSync(f,'utf8'):''};
