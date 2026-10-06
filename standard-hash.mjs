import {createHash} from 'node:crypto';
export const sha256=text=>createHash('sha256').update(text,'utf8').digest('hex');
// Input schema permits one string field. JSON.stringify is canonical for this fixed shape.
export const inputHash=(input,nonce)=>sha256(`${nonce};${JSON.stringify({prompt:input.prompt})}`);
export const resultHash=(result,nonce)=>sha256(`${nonce};${result}`);
// MIP-004 input hash for any input object: canonical JSON (keys sorted, no whitespace), prefixed by the purchaser nonce.
export const canonicalJson=value=>{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
 return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
};
export const inputHashFor=(inputData,nonce)=>sha256(`${nonce};${canonicalJson(inputData)}`);
