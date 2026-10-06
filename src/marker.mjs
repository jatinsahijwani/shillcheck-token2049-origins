import {loadReport,reportsSince,REPORT_ID_RE} from './store.mjs';
export const MARKER_RE=/\[\[SHILLCHECK_REPORT:([^\]\s]+)\]\]/g;
// Replace [[SHILLCHECK_REPORT:<id>]] with the stored markdown. This runs before the result is saved or hashed,
// so the paid bytes are final. If the model forgot the marker and exactly one report was created during this call, append it.
export function expandReportMarker(message,{dir,sessionId,sinceMs}){
 let found=false;
 const expanded=message.replace(MARKER_RE,(whole,id)=>{
  found=true;
  const report=REPORT_ID_RE.test(id)?loadReport(dir,id):null;
  return report?report.markdown.trimEnd():`[Report ${id} could not be loaded]`;
 });
 if(found)return expanded;
 const created=reportsSince(dir,sinceMs,sessionId);
 if(created.length!==1)return message;
 const report=loadReport(dir,created[0].id);
 return report?`${message.trimEnd()}\n\n${report.markdown.trimEnd()}\n`:message;
}
