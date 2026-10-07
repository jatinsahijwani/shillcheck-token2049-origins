// Free text -> structured params, for the CLI only. The agent passes structured tool arguments instead.
const toNumber=(n,suffix)=>Number(n.replace(/,/g,''))*({k:1e3,m:1e6}[String(suffix??'').toLowerCase()]??1);
export function parseRequest(text){
 const handles=[...text.matchAll(/(?:^|[\s,])@([A-Za-z0-9_]{1,15})\b/g)].map(m=>m[1]);
 const budget=/budget\s*(?:of|:)?\s*\$?\s*([\d,.]+)\s*([km])?/i.exec(text)??/\$\s*([\d,.]+)\s*([km])?(?!\w)/i.exec(text);
 const cpm=/cpm\s*(?:of|:)?\s*\$?\s*([\d.]+)/i.exec(text);
 const region=/\b(asia|europe|latam|africa|mena|oceania|north america|usa)\b/i.exec(text);
 return {handles,budget_usd:budget?toNumber(budget[1],budget[2]):undefined,cpm_usd:cpm?Number(cpm[1]):undefined,region:region?.[1]?.toLowerCase()};
}

// A follow-up comment ("drop anyone above $5K, focus on Asia, remove @x") as constraints for rerank. null when nothing is recognised.
export function parseFollowUp(text){
 const t=String(text??'');const update={};
 const fee=/(?:above|over|more than|exceeding|higher than|cap(?:ped)?(?: at)?|max(?:imum)?(?: fee)?(?: of)?|under|below|at most)\s*\$\s*([\d,.]+)\s*([km])?/i.exec(t);
 if(fee)update.max_fee_usd=toNumber(fee[1],fee[2]);
 const drop=[...t.matchAll(/(?:drop|remove|exclude|without|skip)\s+@([A-Za-z0-9_]{1,15})/gi)].map(m=>m[1]);
 if(drop.length)update.exclude_handles=drop;
 const region=/\b(asia|europe|latam|africa|mena|oceania|north america|usa)\b/i.exec(t);
 if(region)update.region=region[1].toLowerCase();
 const budget=/budget\s*(?:to|of|:|is)?\s*\$?\s*([\d,.]+)\s*([km])?/i.exec(t);
 if(budget)update.budget_usd=toNumber(budget[1],budget[2]);
 const cpm=/cpm\s*(?:to|of|:|is)?\s*\$?\s*([\d.]+)/i.exec(t);
 if(cpm)update.cpm_usd=Number(cpm[1]);
 return Object.keys(update).length?update:null;
}
