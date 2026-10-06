// Free text -> structured params, for the CLI only. The agent passes structured tool arguments instead.
const toNumber=(n,suffix)=>Number(n.replace(/,/g,''))*({k:1e3,m:1e6}[String(suffix??'').toLowerCase()]??1);
export function parseRequest(text){
 const handles=[...text.matchAll(/(?:^|[\s,])@([A-Za-z0-9_]{1,15})\b/g)].map(m=>m[1]);
 const budget=/budget\s*(?:of|:)?\s*\$?\s*([\d,.]+)\s*([km])?/i.exec(text)??/\$\s*([\d,.]+)\s*([km])?(?!\w)/i.exec(text);
 const cpm=/cpm\s*(?:of|:)?\s*\$?\s*([\d.]+)/i.exec(text);
 const region=/\b(asia|europe|latam|africa|mena|north america|usa)\b/i.exec(text);
 return {handles,budget_usd:budget?toNumber(budget[1],budget[2]):undefined,cpm_usd:cpm?Number(cpm[1]):undefined,region:region?.[1]?.toLowerCase()};
}
