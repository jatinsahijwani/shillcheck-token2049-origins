export function sellerTokenNet(utxos,address,unit){
 const sum=entries=>entries.filter(x=>x.address===address).reduce((total,x)=>total+x.amount.filter(a=>a.unit===unit).reduce((n,a)=>n+BigInt(a.quantity),0n),0n);
 return sum(utxos.outputs)-sum(utxos.inputs);
}
export async function verifySettlement({core,taskId,payment,sellerAddress,unit,cliReceipt,fetchImpl=fetch}){
 const raw=await core.get(`/v1/tasks/${encodeURIComponent(taskId)}/receipt`);
 const receipt=raw.data;
 if(!receipt?.settled||!receipt.txHash)return {verified:false,receipt};
 if(receipt.blockchainIdentifier!==payment.blockchainIdentifier)throw new Error('Core receipt payment identifier mismatch');
 const tx=[payment.CurrentTransaction,...(payment.TransactionHistory||[])].find(t=>t?.status==='Confirmed'&&['Withdrawn','DisputedWithdrawn'].includes(t.newOnChainState)&&t.txHash===receipt.txHash);
 if(!tx)return {verified:false,receipt,reason:'Matching MPS withdrawal transaction not confirmed'};
 const response=await fetchImpl(`https://cardano-preprod.blockfrost.io/api/v0/txs/${receipt.txHash}/utxos`,{headers:{project_id:process.env.BLOCKFROST_API_KEY_PREPROD},signal:AbortSignal.timeout(30000)});
 if(!response.ok)return {verified:false,receipt,blockfrostStatus:response.status};
 // The seller wallet already holds tUSDM, so only this transaction's input/output delta counts, never a balance.
 const net=sellerTokenNet(await response.json(),sellerAddress,unit);
 let cli={status:'skipped'};
 if(cliReceipt){
  try{const c=await cliReceipt(taskId);cli={status:c?.settled===true&&c.txHash===receipt.txHash?'match':'mismatch',settled:c?.settled===true,txHash:c?.txHash??null}}
  catch(error){cli={status:'unavailable',error:String(error.message).slice(0,120)}}
 }
 return {verified:net>0n&&cli.status!=='mismatch',receipt,txHash:receipt.txHash,netAtomicUnits:net.toString(),cliReceipt:cli,method:'Matched Core/MPS withdrawal hash, `sokosumi runtime receipt`, and the Blockfrost transaction input/output delta at the dedicated seller address'};
}
