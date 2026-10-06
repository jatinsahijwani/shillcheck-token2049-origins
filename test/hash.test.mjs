import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJson,inputHash,inputHashFor,resultHash} from '../standard-hash.mjs';
// Vectors computed independently with: printf '<nonce>;<canonical json>' | shasum -a 256
test('MIP-004 canonical input hash matches the existing {prompt} vector',()=>{
 assert.equal(inputHashFor({prompt:'Cardano payments'},'aabbccddeeff0011'),inputHash({prompt:'Cardano payments'},'aabbccddeeff0011'));
 assert.equal(inputHashFor({prompt:'Cardano payments'},'aabbccddeeff0011'),'25f3afe66b39b0582711c9faf53930c7b6a6feffd10294750ec77be47fd63080');
});
test('PriceProof input vector (string field holding JSON, escaped quotes)',()=>{
 const lookups=JSON.stringify([{coin_id:'bitcoin',date:'2026-01-01'}]);
 assert.equal(inputHashFor({lookups},'aabbccddeeff0011'),'6f6054425122e292198da90975ccdcdf93679220a3862cea162d7c5547e91e98');
});
test('canonical JSON sorts keys and is order independent',()=>{
 assert.equal(canonicalJson({lookups:'x',a:1}),'{"a":1,"lookups":"x"}');
 assert.equal(inputHashFor({lookups:'x',a:1},'aabbccddeeff0011'),'5694c154dfd65e61d028418055b6ed57c82dc11f9760b133f4dd1aadf7f7b9e6');
 assert.equal(inputHashFor({a:1,lookups:'x'},'aabbccddeeff0011'),inputHashFor({lookups:'x',a:1},'aabbccddeeff0011'));
 assert.equal(canonicalJson({b:[{z:1,y:2}],a:null}),'{"a":null,"b":[{"y":2,"z":1}]}');
});
test('result hash is nonce-prefixed raw bytes (existing vector)',()=>{
 assert.equal(resultHash('Line 1\nLine 2','aabbccddeeff0011'),'6fa3bfa69364318f78619b87652c725d705c90f18f8bdcb5d7041c17b73ea57a');
});
