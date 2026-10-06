import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from 'eve/client';
import {expandChatMarkers} from './markers.mjs';
// Chat brain backed by the chat eve agent. One eve session per chat conversation (persisted so a restart keeps context);
// turns in the same conversation are serialised. Markers are expanded here, never by the model.
export function createEveBrain({host,dataDir,stateDir,clientImpl,turnTimeoutMs=70000}){
 const client=clientImpl??new Client({host});
 mkdirSync(stateDir,{recursive:true,mode:0o700});
 const file=join(stateDir,'sessions.json');
 const sessions=new Map(existsSync(file)?Object.entries(JSON.parse(readFileSync(file,'utf8'))):[]);
 const persist=()=>{const tmp=`${file}.tmp`;writeFileSync(tmp,JSON.stringify(Object.fromEntries(sessions)),{mode:0o600});renameSync(tmp,file)};
 const queues=new Map();
 async function turn(conversationKey,text){
  let sessionId=sessions.get(conversationKey);
  let session;
  if(sessionId){try{session=client.sessions.attach(sessionId)}catch{session=null}}
  if(!session){const created=await client.sessions.create();session=created.session;sessionId=session.state.sessionId;sessions.set(conversationKey,sessionId);persist()}
  let timer;
  const result=await Promise.race([(async()=>(await session.send(text)).result())(),new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error('timeout')),turnTimeoutMs)})]).finally(()=>clearTimeout(timer));
  if(result.status==='failed'||result.inputRequests?.length||!result.message?.trim())throw new Error('chat turn did not return an answer');
  return expandChatMarkers(result.message,{dir:dataDir});
 }
 return (conversationKey,text)=>{
  const run=(queues.get(conversationKey)??Promise.resolve()).catch(()=>{}).then(()=>turn(conversationKey,text));
  queues.set(conversationKey,run);
  return run;
 };
}
