import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const MAX_BODY=65536,MAX_TEXT=2000,BRAIN_TIMEOUT_MS=80000,KEEPALIVE_MS=10000;
export function createRateLimiter({perUserPerMin=10,perUserPerDay=150,globalPerMin=40,now=Date.now}={}){
 const users=new Map();let global=[];
 const trim=(arr,ms)=>{const t=now()-ms;while(arr.length&&arr[0]<t)arr.shift();return arr};
 return {
  check(userId){
   global=trim(global,60000);
   const u=users.get(userId)??{min:[],day:[]};users.set(userId,u);
   trim(u.min,60000);trim(u.day,86400000);
   if(global.length>=globalPerMin)return 'busy';
   if(u.min.length>=perUserPerMin)return 'minute';
   if(u.day.length>=perUserPerDay)return 'day';
   const t=now();global.push(t);u.min.push(t);u.day.push(t);
   return null;
  },
 };
}
const sameSecret=(a,b)=>{const x=createHash('sha256').update(a).digest(),y=createHash('sha256').update(b).digest();return timingSafeEqual(x,y)};
const rid=p=>`${p}_${randomBytes(12).toString('hex')}`;
// Text of the latest user turn from an OpenAI-Responses style `input` (string, or an array of messages with string or part content).
export function lastUserText(input){
 if(typeof input==='string')return input;
 if(!Array.isArray(input))return '';
 for(let i=input.length-1;i>=0;i--){
  const item=input[i];
  if(!item||typeof item!=='object'||(item.role&&item.role!=='user'))continue;
  if(typeof item.content==='string')return item.content;
  if(Array.isArray(item.content)){
   const text=item.content.filter(p=>p&&typeof p.text==='string'&&(p.type==='input_text'||p.type==='text'||!p.type)).map(p=>p.text).join('\n');
   if(text)return text;
  }
 }
 return '';
}
const sse=(res,event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify({type:event,...data})}\n\n`);
const chunks=text=>text.match(/[\s\S]{1,160}(?:\s|$)|[\s\S]+/g)??[text];
const message=(id,text)=>({id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]});
// OpenAI-Responses compatible endpoint that Sokosumi Core calls for Coworker chat: POST {baseURL}/responses (SSE) and
// GET {baseURL}/responses/{id}. Core sends no credential, so the base URL carries a secret path segment, and every
// request is rate limited. `brain` is injected: (conversationKey, text, ctx) => Promise<string>.
export function createChatServer({secret,brain,statusProvider,limiter=createRateLimiter(),now=Date.now,log=console,brainTimeoutMs=BRAIN_TIMEOUT_MS,keepaliveMs=KEEPALIVE_MS,maxConcurrent=4}){
 if(!secret||secret.length<24)throw new Error('CHAT_PATH_SECRET must be at least 24 characters');
 const responses=new Map(),conversations=new Map();
 let active=0;
 const remember=(id,rec)=>{responses.set(id,rec);if(responses.size>500)responses.delete(responses.keys().next().value)};
 const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))};
 const friendly={minute:'You are sending messages quickly. Please wait a minute and ask again.',day:'You have reached the daily message limit for this chat. Please try again tomorrow or create a Task for bigger jobs.',busy:'I am handling a lot of chats right now. Please try again in a minute.'};
 function conversationFor(body,userId){
  let key=null;
  if(typeof body.conversation==='string'&&body.conversation.length<=100)key=body.conversation;
  else if(typeof body.previous_response_id==='string'&&responses.has(body.previous_response_id))key=responses.get(body.previous_response_id).conversationKey;
  const known=key?conversations.get(key):null;
  if(known&&known.userId===userId)return key;
  const fresh=`conv_${randomBytes(12).toString('hex')}`;
  conversations.set(fresh,{userId,created:now()});
  return fresh;
 }
 async function handler(req,res){
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   const prefix=`/c/${secret}`;
   const [head,tail]=[url.pathname.slice(0,prefix.length),url.pathname.slice(prefix.length)];
   if(!url.pathname.startsWith('/c/')||!sameSecret(head,prefix)||(tail!==''&&!tail.startsWith('/')))return json(res,404,{error:'not found'});
   if(req.method==='GET'&&tail==='/health')return json(res,200,{status:'ok'});
   if(req.method==='GET'&&tail==='/status'&&statusProvider){const s=statusProvider();return s?json(res,200,s):json(res,404,{error:'no status yet'})}
   const get=tail.match(/^\/responses\/([A-Za-z0-9_-]{1,80})$/);
   if(req.method==='GET'&&get){
    const rec=responses.get(get[1]);
    return rec?json(res,200,{id:get[1],object:'response',status:rec.status,output:rec.text===null?[]:[message(`msg_${get[1]}`,rec.text)],output_text:rec.text??''}):json(res,404,{error:{message:'response not found'}});
   }
   if(req.method!=='POST'||tail!=='/responses')return json(res,404,{error:'not found'});
   const userId=String(req.headers['x-sokosumi-user-id']??'').slice(0,100);
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(userId))return json(res,400,{error:{message:'missing or invalid X-Sokosumi-User-Id'}});
   let bytes=0,raw='';
   for await(const part of req){bytes+=part.length;if(bytes>MAX_BODY)return json(res,413,{error:{message:'request too large'}});raw+=part}
   let body;try{body=JSON.parse(raw)}catch{return json(res,400,{error:{message:'body must be JSON'}})}
   const text=lastUserText(body.input).trim();
   if(!text)return json(res,400,{error:{message:'input has no user text'}});
   const responseId=rid('resp'),streaming=body.stream!==false;
   const conversationKey=conversationFor(body,userId);
   const limited=limiter.check(userId);
   const clipped=text.length>MAX_TEXT?`${text.slice(0,MAX_TEXT)} [message shortened]`:text;
   const respObj=status=>({id:responseId,object:'response',status,conversation:{id:conversationKey}});
   if(streaming){
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});
    sse(res,'response.created',{response:respObj('in_progress')});
   }
   remember(responseId,{conversationKey,status:'in_progress',text:null});
   let answer,failed=false;
   if(limited)answer=friendly[limited];
   else if(active>=maxConcurrent)answer=friendly.busy;
   else{
    active++;
    const timer=streaming?setInterval(()=>res.write(': keepalive\n\n'),keepaliveMs):null;
    try{answer=await Promise.race([brain(conversationKey,clipped,{userId}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),brainTimeoutMs))])}
    catch(error){failed=true;log.error('chat brain failed',error?.message?.slice(0,120));answer=error?.message==='timeout'?'That is taking longer than expected. Please ask again in a moment, or create a Task for a full report.':'I could not answer that one. I can check whether a KOL on X is worth paying, for example: "is @name worth $3K?"'}
    finally{active--;if(timer)clearInterval(timer)}
   }
   answer=String(answer??'').trim()||'I could not produce an answer. Please rephrase.';
   remember(responseId,{conversationKey,status:failed?'failed':'completed',text:answer});
   if(streaming){
    const itemId=`msg_${responseId}`;
    sse(res,'response.output_item.added',{output_index:0,item:{id:itemId,type:'message',role:'assistant',status:'in_progress',content:[]}});
    for(const piece of chunks(answer))sse(res,'response.output_text.delta',{item_id:itemId,output_index:0,content_index:0,delta:piece});
    sse(res,'response.output_text.done',{item_id:itemId,output_index:0,content_index:0,text:answer});
    sse(res,'response.completed',{response:{...respObj('completed'),output:[message(itemId,answer)],output_text:answer}});
    res.end();
   }else json(res,200,{...respObj('completed'),output:[message(`msg_${responseId}`,answer)],output_text:answer});
  }catch(error){
   log.error('chat handler error',String(error?.message).slice(0,120));
   if(!res.headersSent)json(res,500,{error:{message:'internal error'}});else res.end();
  }
 }
 return {handler,conversations,responses};
}
