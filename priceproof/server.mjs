import '../src/refuse-mock.mjs';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createStandardApi} from '../src/standard-api.mjs';
import {loadRegistration} from '../src/registration.mjs';
import {createCache} from '../src/cache.mjs';
import {createCoinGecko} from '../src/coingecko.mjs';
import {createDefiLlama} from '../src/defillama.mjs';
import {createBudget} from '../src/http.mjs';
import {cacheDir,limits,repoRoot} from '../src/config.mjs';
import {SCHEMA,validate,execute} from './compute.mjs';
const port=Number(process.env.PRICEPROOF_PORT||21960);
const token=process.env.PRICEPROOF_MPS_TOKEN;
if(!token)throw new Error('PRICEPROOF_MPS_TOKEN is not set (see infra/priceproof-setup.mjs key-selling)');
const cache=createCache({dir:cacheDir()});
const cap=limits();
const deps={cg:createCoinGecko({apiKey:process.env.COINGECKO_API_KEY,cache,budget:createBudget({max:400,label:'CoinGecko'}),ratePerMin:cap.coingeckoRatePerMin}),llama:createDefiLlama({cache})};
const mps=async(path,body)=>{
 const response=await fetch(`${process.env.MPS_URL}/api/v1${path}`,{method:body?'POST':'GET',redirect:'error',headers:{token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 if(!response.ok)throw new Error(`Payment service HTTP ${response.status}`);
 return data.data;
};
const api=createStandardApi({
 name:'PriceProof',jobsDir:join(repoRoot,'.local','priceproof-jobs'),schema:SCHEMA,validate,
 execute:(input)=>execute({...deps,now:Date.now()})(input),
 registration:()=>loadRegistration(join(repoRoot,'docs','priceproof-registration-state.json')),
 mps,priceAtomic:process.env.PRICEPROOF_PRICE_ATOMIC||'250000',
});
api.listen({port});
