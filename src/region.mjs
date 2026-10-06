const REGIONS={
 asia:['asia','apac','southeast asia','singapore','hong kong','hongkong','japan','tokyo','osaka','korea','seoul','china','shanghai','beijing','shenzhen','india','mumbai','delhi','bangalore','bengaluru','hyderabad','pune','chennai','kolkata','ujjain','indore','vietnam','hanoi','saigon','ho chi minh','thailand','bangkok','indonesia','jakarta','bali','malaysia','kuala lumpur','philippines','manila','taiwan','taipei','pakistan','karachi','lahore','bangladesh','dhaka','sri lanka','nepal','kazakhstan','cambodia','myanmar'],
 europe:['europe','eu','uk','united kingdom','england','scotland','london','germany','berlin','munich','france','paris','spain','madrid','barcelona','italy','rome','milan','netherlands','amsterdam','switzerland','zurich','zug','geneva','portugal','lisbon','poland','warsaw','sweden','stockholm','norway','denmark','copenhagen','finland','helsinki','ireland','dublin','austria','vienna','belgium','brussels','czech','prague','estonia','tallinn','malta','cyprus','ukraine','kyiv','romania','bucharest','greece','athens','lithuania','vilnius','serbia','belgrade'],
 'north america':['usa','u.s.','united states','america','new york','nyc','brooklyn','california','los angeles','san francisco','sf','silicon valley','miami','texas','austin','dallas','chicago','boston','seattle','denver','washington dc','canada','toronto','vancouver','montreal','north america'],
 latam:['latam','latin america','brazil','sao paulo','são paulo','rio','argentina','buenos aires','mexico','mexico city','colombia','bogota','bogotá','medellin','chile','santiago','peru','lima','venezuela','uruguay','costa rica','panama','el salvador'],
 mena:['mena','middle east','dubai','uae','united arab emirates','abu dhabi','saudi','riyadh','qatar','doha','bahrain','kuwait','oman','turkey','türkiye','istanbul','israel','tel aviv','iran','jordan','lebanon','beirut','egypt','cairo'],
 africa:['africa','nigeria','lagos','abuja','kenya','nairobi','south africa','cape town','johannesburg','ghana','accra','ethiopia','tanzania','uganda','rwanda','morocco','tunisia','senegal'],
 oceania:['oceania','australia','sydney','melbourne','brisbane','perth','new zealand','auckland','wellington','fiji'],
};
const ALIASES={'southeast asia':'asia','sea':'asia','apac':'asia','south asia':'asia','us':'north america','usa':'north america','america':'north america','canada':'north america','eu':'europe','uk':'europe','middle east':'mena','gulf':'mena','latin america':'latam','south america':'latam','anz':'oceania','australia':'oceania','pacific':'oceania'};
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const has=(text,kw)=>new RegExp(`(?<![a-z])${esc(kw)}(?![a-z])`,'i').test(text);
export const canonicalRegion=name=>{const k=String(name??'').trim().toLowerCase();return ALIASES[k]??(REGIONS[k]?k:null)};
// Regions a free-text location resolves to (a location can name several, e.g. "Singapore / Dubai"). Empty if unrecognised.
export function regionsOf(location){
 const text=String(location??'').trim();
 if(!text)return [];
 return Object.entries(REGIONS).filter(([,kws])=>kws.some(kw=>has(text,kw))).map(([r])=>r);
}
// 'match' | 'mismatch' | 'unknown' | 'n/a'. Location is self-reported free text: only a recognised place in
// another region is a mismatch. Blank or unrecognised text ("Travelling", "the internet") is unknown, never a mismatch.
export function regionFit(region,location){
 if(!region)return 'n/a';
 const loc=String(location??'').trim();
 if(!loc)return 'unknown';
 const wanted=canonicalRegion(region);
 const found=regionsOf(loc);
 if(wanted)return found.includes(wanted)?'match':found.length?'mismatch':'unknown';
 const key=String(region).trim().toLowerCase();
 if(has(loc,key))return 'match';
 return found.length?'mismatch':'unknown';
}
