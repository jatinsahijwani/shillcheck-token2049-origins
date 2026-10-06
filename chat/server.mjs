import {createServer} from 'node:http';
import {join} from 'node:path';
import {createChatServer,createRateLimiter} from '../src/chat/responses-server.mjs';
import {createEveBrain} from '../src/chat/eve-brain.mjs';
import {dataDir,repoRoot} from '../src/config.mjs';
// Public-facing chat endpoint for Sokosumi. It listens on loopback only; Caddy exposes /c/* over HTTPS.
const port=Number(process.env.CHAT_PORT||21970);
const secret=process.env.CHAT_PATH_SECRET;
const brain=createEveBrain({host:process.env.CHAT_EVE_URL||'http://127.0.0.1:21971',dataDir:dataDir(),stateDir:join(repoRoot,'.local','chat')});
const {handler}=createChatServer({secret,brain,limiter:createRateLimiter({perUserPerMin:Number(process.env.CHAT_USER_PER_MIN)||10,perUserPerDay:Number(process.env.CHAT_USER_PER_DAY)||150,globalPerMin:Number(process.env.CHAT_GLOBAL_PER_MIN)||40})});
createServer(handler).listen(port,'127.0.0.1',()=>console.log('Chat endpoint running',port));
