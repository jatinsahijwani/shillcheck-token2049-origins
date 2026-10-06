import {mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync,renameSync} from 'node:fs';
import {join} from 'node:path';
export const REPORT_ID_RE=/^rpt_[0-9a-f]{12}$/;
const write=(path,text)=>{writeFileSync(path+'.tmp',text,{mode:0o600});renameSync(path+'.tmp',path)};
// <id>.json holds params, constraints and analyses. <id>.md is the rendered report, byte-identical to report.markdown.
export function saveReport(dir,report){
 if(!REPORT_ID_RE.test(report.id))throw new Error('Invalid report id');
 mkdirSync(dir,{recursive:true,mode:0o700});
 const {markdown,...rest}=report;
 write(join(dir,`${report.id}.md`),markdown);
 write(join(dir,`${report.id}.json`),JSON.stringify(rest,null,1));
}
export function loadReport(dir,id){
 if(!REPORT_ID_RE.test(String(id)))return null;
 const json=join(dir,`${id}.json`);
 if(!existsSync(json))return null;
 const report=JSON.parse(readFileSync(json,'utf8'));
 const md=join(dir,`${id}.md`);
 report.markdown=existsSync(md)?readFileSync(md,'utf8'):'';
 return report;
}
export function reportsSince(dir,sinceMs,sessionId){
 if(!existsSync(dir))return [];
 return readdirSync(dir).filter(f=>/^rpt_[0-9a-f]{12}\.json$/.test(f)).map(f=>{try{return JSON.parse(readFileSync(join(dir,f),'utf8'))}catch{return null}})
  .filter(r=>r&&Date.parse(r.createdAt)>=sinceMs&&(!sessionId||r.sessionId===sessionId));
}
