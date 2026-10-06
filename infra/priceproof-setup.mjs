// PriceProof on-chain setup. PREPARED, NOT RUN. Every subcommand that writes is guarded by a state file so it cannot
// run twice, and uncertain writes stop and ask for inspection instead of retrying (same rules as infra/payment-registration.mjs).
//
// Usage (repo root):
//   node --env-file=.env --env-file=.local/mps.env infra/priceproof-setup.mjs <command>
//
// Commands, in order:
//   plan            print what each step does; no network
//   wallet          create a SEPARATE selling wallet in MPS, store its mnemonic privately, attach it to the payment source
//   fund-check      Blockfrost balances of the PriceProof selling wallet and the purchasing wallet; exits 1 if too low
//   register        register PriceProof (Standard, Preprod) with its own selling wallet and apiBaseUrl on PRICEPROOF_PORT
//   status          refresh registration state and write docs/priceproof-registration-state.json (agentIdentifier)
//   key-selling     scoped ReadAndPay key for the PriceProof service (its selling wallet only) -> .local/priceproof-runtime.env
//   key-purchasing  scoped canPay key for ShillCheck purchases (purchasing wallet only) -> .local/priceproof-purchase.env
import fs from 'node:fs';
const USDM='16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d';
const statePath='docs/priceproof-state.json';
const regStatePath='docs/priceproof-registration-state.json';
const payment=fs.existsSync('docs/payment-state.json')?JSON.parse(fs.readFileSync('docs/payment-state.json','utf8')):{};
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{};
const save=()=>{fs.writeFileSync(statePath,JSON.stringify(state,null,2))};
const base=`${process.env.MPS_URL}/api/v1`;
const port=Number(process.env.PRICEPROOF_PORT||21960);
const apiBaseUrl=`http://127.0.0.1:${port}`;
const admin={token:process.env.ADMIN_KEY,'content-type':'application/json'};
async function request(path,{method,body,token}={}){
 const headers=token?{token,'content-type':'application/json'}:admin;
 const r=await fetch(base+path,{headers,method:method??(body?'POST':'GET'),body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 const j=await r.json();
 if(!r.ok||(j.status!=='success'&&j.status!=='Success'))throw Error(`${r.status}: ${JSON.stringify(j.error??j.message??{})}`);
 return j.data;
}
const need=(cond,msg)=>{if(!cond)throw Error(msg)};
const cmd=process.argv[2];
if(cmd==='plan'||!cmd){
 console.log(`PriceProof setup plan (nothing is executed by this command)
1 wallet          POST /wallet (admin) -> mnemonic saved to .local/priceproof-wallet.secret (600), then PATCH /payment-source-extended AddSellingWallets
2 fund-check      needs ~10 test ADA on the PriceProof selling wallet (registration + fees) and ~20 ADA + ~10 tUSDM on the purchasing wallet
3 register        POST /registry, apiBaseUrl ${apiBaseUrl}, pricing ${process.env.PRICEPROOF_PRICING==='fixed'?'Fixed 0.25 tUSDM':'Dynamic (service quotes 0.25 tUSDM)'}
4 status          wait for RegistrationConfirmed (about 1-3 minutes), writes the agent identifier
5 key-selling     scoped key for the PriceProof service
6 key-purchasing  scoped canPay key for ShillCheck's purchasing wallet`);
 process.exit(0);
}
if(cmd==='wallet'){
 if(state.sellingWalletId){console.log('PriceProof selling wallet already attached',state.sellingWalletId);process.exit(0)}
 need(!state.walletWritePending,'Previous wallet write is uncertain: inspect GET /wallet/list and .local/priceproof-wallet.secret before retrying');
 if(!fs.existsSync('.local/priceproof-wallet.secret')){
  state.walletWritePending=true;save();
  const w=await request('/wallet',{body:{network:'Preprod'}});
  // Persist the mnemonic BEFORE anything else: MPS does not store a wallet created this way.
  fs.writeFileSync('.local/priceproof-wallet.secret',JSON.stringify({walletMnemonic:w.walletMnemonic}),{mode:0o600});
  state.sellerAddress=w.walletAddress;state.walletVkey=w.walletVkey;state.walletCreated=true;save();
 }
 const secret=JSON.parse(fs.readFileSync('.local/priceproof-wallet.secret','utf8'));
 need(state.walletVkey,'wallet vkey missing from state');
 state.attachPending=true;save();
 await request('/payment-source-extended',{method:'PATCH',body:{id:payment.sourceId,AddSellingWallets:[{walletMnemonic:secret.walletMnemonic,note:'PriceProof selling wallet'}]}});
 const list=await request(`/wallet/list?walletType=Selling&paymentSourceId=${payment.sourceId}&walletVkey=${state.walletVkey}`);
 const w=list.Wallets.find(x=>x.walletVkey===state.walletVkey);
 need(w,'attached wallet not found in /wallet/list');
 Object.assign(state,{sellingWalletId:w.id,sourceId:payment.sourceId,walletWritePending:false,attachPending:false});save();
 console.log('PriceProof selling wallet attached. Fund this address with test ADA:',state.sellerAddress);
}else if(cmd==='fund-check'){
 async function balance(address){
  const r=await fetch('https://cardano-preprod.blockfrost.io/api/v0/addresses/'+address,{headers:{project_id:process.env.BLOCKFROST_API_KEY_PREPROD},signal:AbortSignal.timeout(30000)});
  if(r.status===404)return {ada:0,tusdm:0};
  need(r.ok,`Blockfrost ${r.status}`);
  const j=await r.json();
  return {ada:Number(j.amount.find(x=>x.unit==='lovelace')?.quantity||0)/1e6,tusdm:Number(j.amount.find(x=>x.unit===USDM)?.quantity||0)/1e6};
 }
 need(state.sellerAddress,'run `wallet` first');
 const list=await request(`/wallet/list?walletType=Purchasing&paymentSourceId=${payment.sourceId}`);
 const purchasing=list.Wallets[0];need(purchasing,'no purchasing wallet in MPS');
 const [seller,buyer]=await Promise.all([balance(state.sellerAddress),balance(purchasing.walletAddress)]);
 console.log(JSON.stringify({priceproofSelling:{address:state.sellerAddress,...seller,needs:'>= 10 ADA'},purchasing:{id:purchasing.id,address:purchasing.walletAddress,...buyer,needs:'>= 20 ADA and >= 10 tUSDM'}},null,1));
 process.exit(seller.ada>=10&&buyer.ada>=20&&buyer.tusdm>=10?0:1);
}else if(cmd==='register'){
 if(state.registrationId){console.log('Registration already saved',state.registrationId);process.exit(0)}
 need(!state.registrationWritePending,'Previous registration write is uncertain: inspect GET /registry before retrying');
 need(state.sellingWalletId&&state.walletVkey,'run `wallet` first');
 const source=(await request('/payment-source?take=100')).PaymentSources.find(s=>s.id===payment.sourceId);
 need(source,'dedicated payment source not found');
 const fixed=process.env.PRICEPROOF_PRICING==='fixed';
 const body={network:'Preprod',type:'Standard',sellingWalletVkey:state.walletVkey,
  supportedPaymentSources:[{chain:'Cardano',network:'Preprod',paymentSourceType:'Web3CardanoV2',address:source.smartContractAddress,pricing:fixed?{pricingType:'Fixed',fixed:[{asset:USDM,amount:'250000',decimals:6}]}:{pricingType:'Dynamic'}}],
  ExampleOutputs:[],Tags:['prices','coingecko','verification','deterministic'],name:'PriceProof',
  description:'Deterministic historical price lookups (price at date, +7d, +30d, % change) with source URLs. No AI. Up to 40 lookups per job.',
  Capability:{name:'deterministic-price-lookup',version:'1'},Author:{name:'Jatin Sahijwani'},apiBaseUrl};
 state.registrationWritePending=true;state.request=body;save();
 const r=await request('/registry',{body});
 Object.assign(state,{registrationId:r.id,registrationWritePending:false,registration:r});save();
 console.log('PriceProof registration submitted',r.id,'-> run `status` until RegistrationConfirmed');
}else if(cmd==='status'){
 need(state.registrationId,'run `register` first');
 const r=await request('/registry?network=Preprod&filterPaymentSourceType=Web3CardanoV2&limit=100');
 const found=(r.Assets||[]).find(a=>a.id===state.registrationId);
 need(found,'registration not visible yet');
 state.registration=found;state.registrationState=found.state;state.agentIdentifier=found.agentIdentifier;save();
 // Same shape as docs/registration-state.json so src/registration.mjs can read it.
 fs.writeFileSync(regStatePath,JSON.stringify({provenance:'VERIFIED',sourceId:payment.sourceId,walletId:state.sellingWalletId,registrationId:state.registrationId,registration:found,request:state.request,agentIdentifier:found.agentIdentifier,registrationState:found.state},null,2));
 console.log(JSON.stringify({state:found.state,agentIdentifier:found.agentIdentifier,tx:found.CurrentTransaction?.txHash,error:found.error}));
}else if(cmd==='key-selling'||cmd==='key-purchasing'){
 const selling=cmd==='key-selling';
 const out=selling?'.local/priceproof-runtime.env':'.local/priceproof-purchase.env';
 const field=selling?'PRICEPROOF_MPS_TOKEN':'PRICEPROOF_PURCHASE_TOKEN';
 const flag=selling?'selling':'purchasing';
 if(state[`${flag}KeyId`]){console.log('Key already created',state[`${flag}KeyId`]);process.exit(0)}
 need(!state[`${flag}KeyPending`],'Previous key write uncertain: inspect GET /api-key before retrying');
 let walletId=state.sellingWalletId;
 if(!selling){
  const list=await request(`/wallet/list?walletType=Purchasing&paymentSourceId=${payment.sourceId}`);
  need(list.Wallets.length===1,'expected exactly one purchasing wallet');walletId=list.Wallets[0].id;
 }
 need(walletId,'wallet id unknown');
 state[`${flag}KeyPending`]=true;save();
 const key=await request('/api-key',{body:{usageLimited:'false',UsageCredits:[],NetworkLimit:['Preprod'],ChainIdLimit:[],canRead:true,canPay:true,canAdmin:false,walletScopeEnabled:true,WalletScopeHotWalletIds:[walletId],x402WalletScopeEnabled:true,X402WalletScopeEvmWalletIds:[]}});
 state[`${flag}KeyId`]=key.id;state[`${flag}KeyPending`]=false;save();
 need(typeof key.token==='string'&&!key.token.startsWith('*****'),'token was not revealed; key id saved for a supported token update');
 fs.writeFileSync(out,`${field}=${key.token}\n`,{mode:0o600});
 console.log(`${flag} key created`,key.id,JSON.stringify({canRead:key.canRead,canPay:key.canPay,canAdmin:key.canAdmin,NetworkLimit:key.NetworkLimit,walletScopeEnabled:key.walletScopeEnabled,WalletScopeHotWalletIds:key.WalletScopeHotWalletIds}));
}else{
 console.error('Unknown command. Run with `plan`.');process.exit(1);
}
