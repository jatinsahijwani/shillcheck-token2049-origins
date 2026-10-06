const REGIONS={
 asia:['asia','apac','singapore','hong kong','hongkong','japan','tokyo','korea','seoul','china','shanghai','beijing','shenzhen','india','mumbai','delhi','bangalore','vietnam','hanoi','thailand','bangkok','indonesia','jakarta','bali','malaysia','kuala lumpur','philippines','manila','taiwan','taipei','pakistan','bangladesh'],
 europe:['europe','eu','uk','london','germany','berlin','france','paris','spain','italy','netherlands','amsterdam','switzerland','zurich','zug','portugal','lisbon','poland','sweden','ireland','dublin'],
 'north america':['usa','united states','us','new york','nyc','california','san francisco','miami','texas','austin','canada','toronto','vancouver','north america'],
 latam:['latam','latin america','brazil','argentina','mexico','colombia','chile','buenos aires','sao paulo','são paulo'],
 africa:['africa','nigeria','lagos','kenya','nairobi','south africa','cape town','ghana','egypt'],
 mena:['mena','middle east','dubai','uae','abu dhabi','saudi','riyadh','turkey','istanbul','israel'],
};
const ALIASES={'southeast asia':'asia','sea':'asia','apac':'asia','us':'north america','usa':'north america','america':'north america','eu':'europe','middle east':'mena','latin america':'latam'};
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const has=(text,kw)=>new RegExp(`(?<![a-z])${esc(kw)}(?![a-z])`,'i').test(text);
// 'match' | 'mismatch' | 'unknown'. Location is self-reported, so a blank location is unknown, not a mismatch.
export function regionFit(region,location){
 if(!region)return 'n/a';
 const loc=String(location??'').trim();
 if(!loc)return 'unknown';
 const key=region.trim().toLowerCase();
 const group=REGIONS[ALIASES[key]??key];
 const keywords=group??[key];
 return keywords.some(kw=>has(loc,kw))?'match':'mismatch';
}
