import type { Constraints, POI } from '../types';

const STRONG_FAMILY_RE = /亲子|儿童|孩子|小孩|宝宝|绘本|乐园|海洋球|母婴|玩具|遛娃|童书/;
const FAMILY_INTENT_RE = /带娃|带孩子|小孩|孩子|亲子|宝宝|儿童|遛娃|一家|全家|4岁|岁小孩/;
const ADULT_NIGHT_RE = /酒吧|清吧|酒廊|小酒馆|精酿|威士忌|LiveHouse|livehouse|夜店|蹦迪/;
const ADULT_NIGHT_INTENT_RE = /酒吧|清吧|酒廊|小酒馆|精酿|威士忌|LiveHouse|livehouse|夜店|蹦迪|小酌|喝一杯|夜生活/;
const NIGHT_VIEW_INTENT_RE = /夜景|江景|看景|登高|夜游|灯会|灯光|天际线/;
const QUIET_INTENT_RE = /安静|清净|不吵|别太吵|不要太吵|接电话|打电话|开会|聊天/;

export function hasExplicitFamilyIntent(c: Constraints): boolean {
  return c.prefs.includes('family') || FAMILY_INTENT_RE.test(c.raw);
}

export function wantsAdultNightlife(c: Constraints): boolean {
  return c.prefs.includes('nightlife') || ADULT_NIGHT_INTENT_RE.test(c.raw);
}

export function wantsNightView(c: Constraints): boolean {
  return NIGHT_VIEW_INTENT_RE.test(c.raw);
}

export function isQuietIntent(c: Constraints): boolean {
  return c.prefs.includes('quiet') || QUIET_INTENT_RE.test(c.raw);
}

export function isAdultNightlifePOI(p: POI): boolean {
  return p.sceneTags.includes('nightlife') || ADULT_NIGHT_RE.test(`${p.name} ${p.ugc}`);
}

export function isStrongFamilyPOI(p: POI): boolean {
  if (!p.sceneTags.includes('family')) return false;
  return STRONG_FAMILY_RE.test(`${p.name} ${p.ugc}`);
}

export function isSemanticMismatch(p: POI, c: Constraints): boolean {
  const explicitFamily = hasExplicitFamilyIntent(c);
  const adultNightWanted = wantsAdultNightlife(c);

  if (explicitFamily && isAdultNightlifePOI(p) && !adultNightWanted) return true;
  if (!explicitFamily && isStrongFamilyPOI(p)) return true;
  if (isQuietIntent(c) && isAdultNightlifePOI(p) && !adultNightWanted) return true;
  return false;
}
