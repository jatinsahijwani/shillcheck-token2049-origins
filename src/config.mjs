import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const isMock=(env=process.env)=>env.SHILLCHECK_MOCK==='true';
export const dataDir=(env=process.env)=>env.SHILLCHECK_DATA_DIR?resolve(env.SHILLCHECK_DATA_DIR):join(repoRoot,'.local','reports');
export const cacheDir=(env=process.env)=>env.SHILLCHECK_CACHE_DIR?resolve(env.SHILLCHECK_CACHE_DIR):join(dirname(dataDir(env)),'cache');
export function assertRealMode(env=process.env){
 if(isMock(env))throw new Error('SHILLCHECK_MOCK=true serves fixtures. Refusing to start a paid-task process with mock data.');
}
const int=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback};
// Per-task caps keep one run well under the 20 minute paid deadline (target: under 8 minutes).
export const limits=(env=process.env)=>({
 maxXCalls:int(env.SHILLCHECK_MAX_X_CALLS,60),
 maxCoinGeckoCalls:int(env.SHILLCHECK_MAX_CG_CALLS,150),
 maxRunMs:int(env.SHILLCHECK_MAX_RUN_MS,7*60*1000),
 coingeckoRatePerMin:int(env.COINGECKO_RATE_PER_MIN,28),
 concurrency:3,
});
// Decision constants. Printed in every report so the rules are auditable.
export const RULES={
 maxHandles:10,maxPromoCoins:8,originalPostsForAverages:50,replySample:30,minReplySample:10,
 botAgeDays:90,botFollowers:10,botSignalsNeeded:2,
 defaultCpmUsd:15,lowEngagementRate:0.002,
 avoidBotShare:0.4,negotiateBotShare:0.2,negotiateFeeFactor:1.5,
 dumpPct:-70,avoidMedianPct:-50,negotiateMedianPct:-20,avoidMinPromos:3,
 recentSearchDays:7,pendingDays:30,maxHistoryDays:365,
};
export const MAJORS=new Set(['BTC','ETH','SOL','BNB','XRP','ADA','DOGE','USDT','USDC','DAI','TRX','TON','AVAX','DOT','LINK','MATIC','POL','LTC','BCH','SHIB','XLM','ATOM','NEAR','WBTC','WETH','STETH']);
