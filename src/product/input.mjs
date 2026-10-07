import {handlesIn} from '../notices.mjs';
const IMAGE_EXT=/\.(?:png|jpe?g|webp|gif)(?:[?#][^\s)>\]]*)?$/i;
const toNumber=(n,suffix)=>Number(String(n).replace(/,/g,''))*({k:1e3,m:1e6}[String(suffix??'').toLowerCase()]??1);
const REGIONS=/\b(india|asia|europe|latam|africa|mena|oceania|north america|usa|uk|uae|japan|brazil)\b/i;
// Task attachments reach the worker as markdown links in the Task description; chat can carry the same link or a bare URL.
const urlsIn=text=>[...String(text??'').matchAll(/https?:\/\/[^\s)>\]"']+/gi)].map(m=>m[0].replace(/[.,;:!?]+$/,''));
export function parseProductBrief(text){
 const t=String(text??'');
 const urls=urlsIn(t);
 const imageUrl=urls.find(u=>IMAGE_EXT.test(u)||/\/(?:blob|files?|uploads?)\//i.test(u))??null;
 const budget=/budget\s*(?:of|:|is)?\s*\$?\s*([\d,.]+)\s*([km])?/i.exec(t)??/\$\s*([\d,.]+)\s*([km])?(?!\w)/i.exec(t);
 const region=REGIONS.exec(t)?.[1];
 const description=t.replace(/!?\[[^\]]*\]\([^)]*\)/g,' ').replace(/https?:\/\/\S+/g,' ').replace(/\s+/g,' ').trim();
 return {imageUrl,referenceUrl:urls.find(u=>u!==imageUrl)??null,description,budget_usd:budget?toNumber(budget[1],budget[2]):undefined,region:region?.toLowerCase()};
}
const TOKEN_WORDS=/\$[A-Za-z]{2,10}\b|\b0x[0-9a-fA-F]{40}\b|\b(?:token|coin|memecoin|airdrop|defi|nft|kol|kols|shill)\b/i;
const PRODUCT_WORDS=/\b(product|shoes?|sneakers?|trainers?|bottle|bag|watch|jacket|hoodie|shirt|dress|skincare|serum|cream|headphones?|earbuds?|phone|laptop|gadget|device|brand|launch|campaign|influencer|creators?|marketing|photo|image|picture|app|snack|drink|coffee|tea|furniture|jewel\w*|cosmetics?|makeup|perfume|toy|game)\b/i;
// 'token': handles or token words present -> existing path. 'product': a photo, or a product-like description, without handles or token words.
export function routeBrief(text){
 const t=String(text??'');
 if(handlesIn(t).length||TOKEN_WORDS.test(t))return 'token';
 const b=parseProductBrief(t);
 if(b.imageUrl)return 'product';
 return b.description.length>=12&&PRODUCT_WORDS.test(b.description)?'product':'none';
}
