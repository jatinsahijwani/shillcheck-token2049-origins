import {readFileSync} from 'node:fs';
// Reads the infra session's docs/registration-state.json (read-only) and fills the fields the payment code needs.
// The state file records one payment source and does not store its array index, so the index is the position in
// supportedPaymentSources: 0 for this single-source registration.
export function normalizeRegistration(raw){
 const sources=raw.registration?.supportedPaymentSources??raw.request?.supportedPaymentSources??[];
 return {...raw,
  supportedPaymentSourceIndex:Number.isInteger(raw.supportedPaymentSourceIndex)?raw.supportedPaymentSourceIndex:sources.length===1?0:undefined,
  sellerVkey:raw.sellerVkey??raw.registration?.SmartContractWallet?.walletVkey??raw.request?.sellingWalletVkey,
  agentIdentifier:raw.agentIdentifier??raw.registration?.agentIdentifier};
}
export const loadRegistration=(path='docs/registration-state.json')=>normalizeRegistration(JSON.parse(readFileSync(path,'utf8')));
