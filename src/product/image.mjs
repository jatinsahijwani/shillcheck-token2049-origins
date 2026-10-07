import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
export const MAX_IMAGE_BYTES=5*1024*1024;
const privateIp=ip=>/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80)/i.test(ip);
// Fetches an image the user referenced and returns a data URL. https only, public hosts only, size and type limited, no redirects.
export async function fetchImageDataUrl(url,{fetchImpl=fetch,resolve=host=>lookup(host,{all:true})}={}){
 let u;try{u=new URL(url)}catch{throw new Error('image link is not a valid URL')}
 if(u.protocol!=='https:')throw new Error('image link must be https');
 const addrs=isIP(u.hostname)?[{address:u.hostname}]:await resolve(u.hostname);
 if(!addrs.length||addrs.some(a=>privateIp(a.address)))throw new Error('image host is not public');
 const response=await fetchImpl(u,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`image download returned HTTP ${response.status}`);
 const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
 if(!/^image\/(png|jpe?g|webp|gif)$/.test(type))throw new Error('link is not an image');
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>MAX_IMAGE_BYTES)throw new Error('image is larger than 5 MB');
 return `data:${type};base64,${bytes.toString('base64')}`;
}
