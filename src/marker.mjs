import {loadReport,reportsSince,REPORT_ID_RE} from './store.mjs';
import {renderCompact} from './report.mjs';
export const MARKER_RE=/\[\[SHILLCHECK_REPORT:([^\]\s]+)\]\]/g;
// Replace [[SHILLCHECK_REPORT:<id>]] with the stored markdown. This runs before the result is saved or hashed,
// so the paid bytes are final. If the model forgot the marker and exactly one report was created during this call, append it.
// compact:true is for follow-up comments (short re-ranked summary); the paid result always uses the full report.
export function expandReportMarker(message,{dir,sessionId,sinceMs,compact=false,paid=false}){
 const text=r=>(compact?renderCompact(r,{paid}):r.markdown).trimEnd();
 let found=false;
 const expanded=message.replace(MARKER_RE,(whole,id)=>{
  found=true;
  const report=REPORT_ID_RE.test(id)?loadReport(dir,id):null;
  return report?text(report):`[Report ${id} could not be loaded]`;
 });
 if(found)return expanded;
 const created=reportsSince(dir,sinceMs,sessionId);
 if(created.length!==1)return message;
 const report=loadReport(dir,created[0].id);
 return report?`${message.trimEnd()}\n\n${text(report)}\n`:message;
}
