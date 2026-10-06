import {execFileSync} from 'node:child_process';
import {dirname,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
let loaded;
export function sokosumiRoot(run=execFileSync){
 const skillsPath=run('sokosumi',['skills','path'],{encoding:'utf8',timeout:30000}).trim();
 if(!isAbsolute(skillsPath)||!skillsPath.endsWith('/skills'))throw new Error('sokosumi skills path returned an invalid package path');
 return join(dirname(skillsPath),'dist','src');
}
export async function loadSokosumiRuntime(){
 if(!loaded){const root=sokosumiRoot();
  loaded=Promise.all(['coworker/runtime-credentials.js','api/http-client.js','api/services/task-service.js'].map(p=>import(pathToFileURL(join(root,p)).href))).then(modules=>Object.assign({},...modules));
 }
 return loaded;
}

// Each Task belongs to the Personal Workspace (organizationId null) or an organization such as TOKEN2049.
// Runtime start/complete take exactly one selector, never both.
export function workspaceArgs(task){
 const org=task?.organizationId??task?.workspace?.organizationId??null;
 if(org===null||org===undefined)return ['--personal'];
 if(typeof org!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(org))throw new Error('Task has an unsupported organization id');
 return ['--organization-id',org];
}
export function runtimeArgs(command,task,coworkerId,extra=[]){
 return ['runtime',command,task.id,...workspaceArgs(task),'--coworker-id',coworkerId,...extra];
}
// `runtime receipt` accepts neither --personal nor --organization-id; the Task id selects the Task.
export function runtimeReceipt(taskId,coworkerId,run=execFileSync){
 return JSON.parse(run('sokosumi',['--preprod','runtime','receipt',taskId,'--coworker-id',coworkerId,'--json'],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));
}
