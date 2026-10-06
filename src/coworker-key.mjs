import {existsSync,readFileSync} from 'node:fs';
import {loadSokosumiRuntime} from '../sokosumi-runtime.mjs';
// Where the Coworker runtime key comes from. On a host with an OS credential vault (the Mac) it is the vault, as before.
// On a headless server (AWS) COWORKER_API_KEY_FILE points at a 600 file; the key is then handed to the CLI over stdin
// (--api-key-stdin) and to the HTTP client directly, so no secret service is needed.
export const keyFilePath=(env=process.env)=>env.COWORKER_API_KEY_FILE&&existsSync(env.COWORKER_API_KEY_FILE)?env.COWORKER_API_KEY_FILE:null;
export const usesKeyFile=(env=process.env)=>keyFilePath(env)!==null;
export function readKeyFile(path){
 const text=readFileSync(path,'utf8').trim();
 if(!/^coworker_[A-Za-z0-9_-]+$/.test(text))throw new Error('Coworker key file must contain one coworker_* key');
 return text;
}
export async function readCoworkerKey(coworkerId,env=process.env){
 const file=keyFilePath(env);
 if(file)return readKeyFile(file);
 const {readRuntimeCredential}=await loadSokosumiRuntime();
 return readRuntimeCredential(coworkerId);
}
// Extra execFileSync options and args for a `sokosumi runtime ...` call.
export function runtimeCliAuth(env=process.env){
 const file=keyFilePath(env);
 return file?{args:['--api-key-stdin'],input:readKeyFile(file)}:{args:[],input:undefined};
}
