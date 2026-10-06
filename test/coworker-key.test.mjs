import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {keyFilePath,usesKeyFile,readKeyFile,runtimeCliAuth} from '../src/coworker-key.mjs';
import {runtimeReceipt} from '../sokosumi-runtime.mjs';
const tmp=()=>mkdtempSync(join(tmpdir(),'ckey-'));
test('key file mode is off unless the file exists',()=>{
 assert.equal(usesKeyFile({}),false);assert.equal(usesKeyFile({COWORKER_API_KEY_FILE:'/nonexistent/key'}),false);
 assert.deepEqual(runtimeCliAuth({}),{args:[],input:undefined});
});
test('key file is validated and handed to the CLI over stdin, never as an argument',()=>{
 const dir=tmp();
 try{
  const path=join(dir,'key');writeFileSync(path,'coworker_abc123_DEF\n',{mode:0o600});
  assert.equal(keyFilePath({COWORKER_API_KEY_FILE:path}),path);
  assert.equal(readKeyFile(path),'coworker_abc123_DEF');
  assert.deepEqual(runtimeCliAuth({COWORKER_API_KEY_FILE:path}),{args:['--api-key-stdin'],input:'coworker_abc123_DEF'});
  writeFileSync(path,'not-a-coworker-key');assert.throws(()=>readKeyFile(path),/coworker_\* key/);
  writeFileSync(path,'coworker_ok\nextra line');assert.throws(()=>readKeyFile(path));
 }finally{rmSync(dir,{recursive:true})}
});
test('runtime receipt passes the key on stdin when a key file is used',()=>{
 let seen;
 runtimeReceipt('t1','cw',(cmd,args,opts)=>{seen={args,opts};return '{"settled":true}'},{args:['--api-key-stdin'],input:'coworker_k'});
 assert.deepEqual(seen.args,['--preprod','runtime','receipt','t1','--coworker-id','cw','--api-key-stdin','--json']);assert.equal(seen.opts.input,'coworker_k');
 assert.ok(!seen.args.includes('coworker_k'),'secret never in argv');
 runtimeReceipt('t1','cw',(cmd,args,opts)=>{seen={args,opts};return '{}'});
 assert.ok(!seen.args.includes('--api-key-stdin'));assert.equal('input' in seen.opts,false);
});
