import {createDeps,rerankReport,summarize,vetKols} from './pipeline.mjs';
import {createMockFetch} from './mock-fetch.mjs';
import {dataDir,isMock} from './config.mjs';
// Entry points for the eve tools. They return an id plus numbers only: never tweet text, bios or raw API payloads.
export async function vetForAgent(input,sessionId){
 const now=Date.now();
 const deps=createDeps({now,fetchImpl:isMock()?createMockFetch({now}):fetch});
 const report=await vetKols(input,{deps,dir:dataDir(),sessionId});
 return summarize(report);
}
export async function rerankForAgent(input,sessionId){
 const report=rerankReport({reportId:input.report_id,update:input,dir:dataDir(),sessionId});
 return summarize(report);
}
