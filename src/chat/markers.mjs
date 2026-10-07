import {loadReport,REPORT_ID_RE} from '../store.mjs';
import {renderQuick} from './quick.mjs';
export const QUICK_MARKER_RE=/\[\[SHILLCHECK_QUICK:([^\]\s:]+)(?::fee=(\d+(?:\.\d+)?))?\]\]/g;
// Replace [[SHILLCHECK_QUICK:<report id>(:fee=<usd>)]] with the deterministic verdict block rendered from the stored report.
export function expandChatMarkers(message,{dir}){
 return message.replace(QUICK_MARKER_RE,(whole,id,fee)=>{
  const report=REPORT_ID_RE.test(id)?loadReport(dir,id):null;
  if(!report||!report.analyses?.length)return '[result unavailable, please ask again]';
  return renderQuick(report,{askedFee:fee?Number(fee):null}).trimEnd();
 });
}
