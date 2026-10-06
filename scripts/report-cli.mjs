// Runs the full pipeline without the model, for hand-checking: npm run report -- "@a @b budget $10k asia"
import {writeFileSync} from 'node:fs';
import {createDeps,vetKols} from '../src/pipeline.mjs';
import {parseRequest} from '../src/parse-input.mjs';
import {createMockFetch} from '../src/mock-fetch.mjs';
import {dataDir,isMock} from '../src/config.mjs';
const text=process.argv.slice(2).join(' ').trim();
if(!text){console.error('Usage: npm run report -- "@handle1 @handle2 budget $10k asia"');process.exit(1)}
const now=Date.now();
const deps=createDeps({now,fetchImpl:isMock()?createMockFetch({now}):fetch});
const report=await vetKols(parseRequest(text),{deps,dir:dataDir()});
console.log(report.markdown);
const u=report.usage;console.error(`\nX reads: ${u.xUsersRead} users + ${u.xPostsRead} posts = est. $${u.estXCostUsd} (uncached; $0.01/user, $0.005/post) · runtime ${Math.round((Date.now()-now)/1000)}s`);
console.error(`Saved ${dataDir()}/${report.id}.{json,md} · X calls ${report.usage.xCalls}, CoinGecko calls ${report.usage.coinGeckoCalls}`);
