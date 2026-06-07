// lib/handlers/plan.ts
import { randomUUID } from "node:crypto";

// contract/types.ts
import { z } from "zod";
var CategorySchema = z.enum([
  "dining",
  "cafe",
  "culture",
  "entertainment",
  "shopping",
  "nightscape"
]);
var PaceSchema = z.enum(["relaxed", "normal", "packed"]);
var PersonaIdSchema = z.enum(["couple", "family", "friends", "solo"]);
var FieldSourceSchema = z.enum(["amap", "user", "derived"]);
var POISchema = z.object({
  id: z.string(),
  name: z.string(),
  category: CategorySchema,
  city: z.string(),
  area: z.string(),
  lat: z.number(),
  lng: z.number(),
  rating: z.number().nullable(),
  // amap business.rating (may be absent)
  perCapita: z.number().nullable(),
  // amap business.cost (may be absent)
  tags: z.array(z.string()),
  // amap business.tag tokens
  openHour: z.number().nullable(),
  // parsed from amap opentime
  closeHour: z.number().nullable(),
  photos: z.array(z.string()).default([]),
  tel: z.string().nullable().default(null),
  source: z.literal("amap")
});
var ScoredPOISchema = z.object({
  poi: POISchema,
  score: z.number(),
  reasons: z.array(z.string()),
  sources: z.record(z.string(), FieldSourceSchema)
  // per-field provenance
});
var ConstraintsSchema = z.object({
  city: z.string(),
  district: z.string().nullable(),
  startTime: z.number(),
  durationMin: z.number(),
  party: z.number(),
  budgetPerCapita: z.number().nullable(),
  diningBudgetPerCapita: z.number().nullable(),
  prefs: z.array(z.string()),
  avoid: z.array(z.string()),
  mustCategories: z.array(CategorySchema),
  pace: PaceSchema,
  personaId: PersonaIdSchema,
  raw: z.string()
});
var LegSchema = z.object({
  distM: z.number(),
  minutes: z.number(),
  mode: z.enum(["walk", "transit"])
}).nullable();
var CheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string()
});
var RouteStopSchema = z.object({
  poi: POISchema,
  arrive: z.number(),
  depart: z.number(),
  legFromPrev: LegSchema,
  reasons: z.array(z.string()),
  sources: z.record(z.string(), FieldSourceSchema)
});
var RouteSchema = z.object({
  id: z.string(),
  stops: z.array(RouteStopSchema),
  totalCost: z.number(),
  totalWalkMin: z.number(),
  totalTransitMin: z.number(),
  endTime: z.number(),
  coverage: z.array(CategorySchema),
  checks: z.array(CheckSchema),
  explanation: z.string(),
  risks: z.array(z.string())
});
var DataSourceStatusSchema = z.object({
  configured: z.boolean(),
  used: z.boolean(),
  status: z.string()
});
var DataSourcesSchema = z.object({
  amapPoi: DataSourceStatusSchema,
  amapRoute: DataSourceStatusSchema,
  deepseek: DataSourceStatusSchema,
  cache: z.object({ hits: z.number(), misses: z.number() })
});
var PlanResultSchema = z.object({
  planId: z.string(),
  constraints: ConstraintsSchema,
  routes: z.array(RouteSchema),
  dataSources: DataSourcesSchema
});

// contract/events.ts
import { z as z2 } from "zod";
var PlanRequestSchema = z2.object({
  request: z2.string().min(1),
  preferences: z2.object({
    personaPick: z2.enum(["auto", "couple", "family", "friends", "solo"]),
    prefs: z2.array(z2.string()),
    budgetPref: z2.number().nullable()
  }),
  previousPlan: RouteSchema.nullable(),
  sessionId: z2.string().optional(),
  // Refine: the user's ORIGINAL request that produced previousPlan, so the LLM keeps full intent context.
  baseRequest: z2.string().optional(),
  // ReAct: resume a paused conversation (askUser) with the user's answer.
  conversationId: z2.string().optional(),
  answer: z2.string().optional()
});
var StageEventSchema = z2.object({
  type: z2.literal("stage"),
  key: z2.string(),
  label: z2.string(),
  status: z2.enum(["running", "ok", "skip", "fail"]),
  ms: z2.number().optional(),
  summary: z2.string().optional()
});
var ConstraintsEventSchema = z2.object({
  type: z2.literal("constraints"),
  constraints: ConstraintsSchema
});
var CandidatesEventSchema = z2.object({
  type: z2.literal("candidates"),
  candidates: z2.array(ScoredPOISchema)
});
var RouteEventSchema = z2.object({
  type: z2.literal("route"),
  route: RouteSchema
});
var ExplanationEventSchema = z2.object({
  type: z2.literal("explanation"),
  routeId: z2.string(),
  delta: z2.string()
});
var DoneEventSchema = z2.object({
  type: z2.literal("done"),
  planId: z2.string(),
  routes: z2.array(RouteSchema),
  dataSources: DataSourcesSchema
});
var ErrorEventSchema = z2.object({
  type: z2.literal("error"),
  code: z2.enum(["needs-clarification", "insufficient-data", "upstream-unavailable", "bad-request"]),
  message: z2.string(),
  recoverable: z2.boolean()
});
var ThoughtEventSchema = z2.object({
  type: z2.literal("thought"),
  text: z2.string()
});
var ActionEventSchema = z2.object({
  type: z2.literal("action"),
  tool: z2.enum(["searchPOI", "askUser", "finish"]),
  args: z2.string()
  // human-readable arg summary, e.g. the keyword being searched
});
var ObservationEventSchema = z2.object({
  type: z2.literal("observation"),
  summary: z2.string(),
  count: z2.number().optional()
});
var QuestionEventSchema = z2.object({
  type: z2.literal("question"),
  conversationId: z2.string(),
  question: z2.string(),
  options: z2.array(z2.string()).optional()
});
var SSEEventSchema = z2.discriminatedUnion("type", [
  StageEventSchema,
  ConstraintsEventSchema,
  CandidatesEventSchema,
  RouteEventSchema,
  ExplanationEventSchema,
  DoneEventSchema,
  ErrorEventSchema,
  ThoughtEventSchema,
  ActionEventSchema,
  ObservationEventSchema,
  QuestionEventSchema
]);

// contract/framing.ts
function encodeSSE(event) {
  const data = JSON.stringify(event);
  return `event: ${event.type}
data: ${data}

`;
}

// lib/locationResolver.js
var AMAP_BASE_URL = "https://restapi.amap.com/v3";
var DISTRICT_TIMEOUT_MS = 1600;
var POI_TIMEOUT_MS = 2200;
var MUNICIPALITIES = /* @__PURE__ */ new Set(["\u5317\u4EAC\u5E02", "\u4E0A\u6D77\u5E02", "\u5929\u6D25\u5E02", "\u91CD\u5E86\u5E02"]);
var CITY_SUFFIX_RE = /(市|地区|自治州|州|盟)$/;
var PROVINCE_OPTION_PREFS = {
  \u6D59\u6C5F\u7701: ["\u676D\u5DDE", "\u5B81\u6CE2", "\u7ECD\u5174", "\u6E29\u5DDE"],
  \u6E56\u5317\u7701: ["\u6B66\u6C49", "\u5B9C\u660C", "\u8944\u9633", "\u8346\u5DDE"],
  \u6E56\u5357\u7701: ["\u957F\u6C99", "\u5F20\u5BB6\u754C", "\u5CB3\u9633", "\u6E58\u6F6D"],
  \u65B0\u7586\u7EF4\u543E\u5C14\u81EA\u6CBB\u533A: ["\u4E4C\u9C81\u6728\u9F50", "\u5580\u4EC0", "\u5410\u9C81\u756A", "\u963F\u52D2\u6CF0", "\u5317\u5C6F"]
};
var PROVINCE_ALIASES = {
  \u5317\u4EAC: "\u5317\u4EAC\u5E02",
  \u5317\u4EAC\u5E02: "\u5317\u4EAC\u5E02",
  \u4E0A\u6D77: "\u4E0A\u6D77\u5E02",
  \u4E0A\u6D77\u5E02: "\u4E0A\u6D77\u5E02",
  \u5929\u6D25: "\u5929\u6D25\u5E02",
  \u5929\u6D25\u5E02: "\u5929\u6D25\u5E02",
  \u91CD\u5E86: "\u91CD\u5E86\u5E02",
  \u91CD\u5E86\u5E02: "\u91CD\u5E86\u5E02",
  \u6CB3\u5317: "\u6CB3\u5317\u7701",
  \u6CB3\u5317\u7701: "\u6CB3\u5317\u7701",
  \u5C71\u897F: "\u5C71\u897F\u7701",
  \u5C71\u897F\u7701: "\u5C71\u897F\u7701",
  \u8FBD\u5B81: "\u8FBD\u5B81\u7701",
  \u8FBD\u5B81\u7701: "\u8FBD\u5B81\u7701",
  \u5409\u6797: "\u5409\u6797\u7701",
  \u5409\u6797\u7701: "\u5409\u6797\u7701",
  \u9ED1\u9F99\u6C5F: "\u9ED1\u9F99\u6C5F\u7701",
  \u9ED1\u9F99\u6C5F\u7701: "\u9ED1\u9F99\u6C5F\u7701",
  \u6C5F\u82CF: "\u6C5F\u82CF\u7701",
  \u6C5F\u82CF\u7701: "\u6C5F\u82CF\u7701",
  \u6D59\u6C5F: "\u6D59\u6C5F\u7701",
  \u6D59\u6C5F\u7701: "\u6D59\u6C5F\u7701",
  \u5B89\u5FBD: "\u5B89\u5FBD\u7701",
  \u5B89\u5FBD\u7701: "\u5B89\u5FBD\u7701",
  \u798F\u5EFA: "\u798F\u5EFA\u7701",
  \u798F\u5EFA\u7701: "\u798F\u5EFA\u7701",
  \u6C5F\u897F: "\u6C5F\u897F\u7701",
  \u6C5F\u897F\u7701: "\u6C5F\u897F\u7701",
  \u5C71\u4E1C: "\u5C71\u4E1C\u7701",
  \u5C71\u4E1C\u7701: "\u5C71\u4E1C\u7701",
  \u6CB3\u5357: "\u6CB3\u5357\u7701",
  \u6CB3\u5357\u7701: "\u6CB3\u5357\u7701",
  \u6E56\u5317: "\u6E56\u5317\u7701",
  \u6E56\u5317\u7701: "\u6E56\u5317\u7701",
  \u6E56\u5357: "\u6E56\u5357\u7701",
  \u6E56\u5357\u7701: "\u6E56\u5357\u7701",
  \u5E7F\u4E1C: "\u5E7F\u4E1C\u7701",
  \u5E7F\u4E1C\u7701: "\u5E7F\u4E1C\u7701",
  \u6D77\u5357: "\u6D77\u5357\u7701",
  \u6D77\u5357\u7701: "\u6D77\u5357\u7701",
  \u56DB\u5DDD: "\u56DB\u5DDD\u7701",
  \u56DB\u5DDD\u7701: "\u56DB\u5DDD\u7701",
  \u8D35\u5DDE: "\u8D35\u5DDE\u7701",
  \u8D35\u5DDE\u7701: "\u8D35\u5DDE\u7701",
  \u4E91\u5357: "\u4E91\u5357\u7701",
  \u4E91\u5357\u7701: "\u4E91\u5357\u7701",
  \u9655\u897F: "\u9655\u897F\u7701",
  \u9655\u897F\u7701: "\u9655\u897F\u7701",
  \u7518\u8083: "\u7518\u8083\u7701",
  \u7518\u8083\u7701: "\u7518\u8083\u7701",
  \u9752\u6D77: "\u9752\u6D77\u7701",
  \u9752\u6D77\u7701: "\u9752\u6D77\u7701",
  \u53F0\u6E7E: "\u53F0\u6E7E\u7701",
  \u53F0\u6E7E\u7701: "\u53F0\u6E7E\u7701",
  \u5185\u8499\u53E4: "\u5185\u8499\u53E4\u81EA\u6CBB\u533A",
  \u5185\u8499\u53E4\u81EA\u6CBB\u533A: "\u5185\u8499\u53E4\u81EA\u6CBB\u533A",
  \u5E7F\u897F: "\u5E7F\u897F\u58EE\u65CF\u81EA\u6CBB\u533A",
  \u5E7F\u897F\u58EE\u65CF\u81EA\u6CBB\u533A: "\u5E7F\u897F\u58EE\u65CF\u81EA\u6CBB\u533A",
  \u897F\u85CF: "\u897F\u85CF\u81EA\u6CBB\u533A",
  \u897F\u85CF\u81EA\u6CBB\u533A: "\u897F\u85CF\u81EA\u6CBB\u533A",
  \u5B81\u590F: "\u5B81\u590F\u56DE\u65CF\u81EA\u6CBB\u533A",
  \u5B81\u590F\u56DE\u65CF\u81EA\u6CBB\u533A: "\u5B81\u590F\u56DE\u65CF\u81EA\u6CBB\u533A",
  \u65B0\u7586: "\u65B0\u7586\u7EF4\u543E\u5C14\u81EA\u6CBB\u533A",
  \u65B0\u7586\u7EF4\u543E\u5C14\u81EA\u6CBB\u533A: "\u65B0\u7586\u7EF4\u543E\u5C14\u81EA\u6CBB\u533A",
  \u9999\u6E2F: "\u9999\u6E2F\u7279\u522B\u884C\u653F\u533A",
  \u9999\u6E2F\u7279\u522B\u884C\u653F\u533A: "\u9999\u6E2F\u7279\u522B\u884C\u653F\u533A",
  \u6FB3\u95E8: "\u6FB3\u95E8\u7279\u522B\u884C\u653F\u533A",
  \u6FB3\u95E8\u7279\u522B\u884C\u653F\u533A: "\u6FB3\u95E8\u7279\u522B\u884C\u653F\u533A"
};
var LOCAL_CITY_PROVINCE = {
  \u5317\u4EAC: "\u5317\u4EAC\u5E02",
  \u4E0A\u6D77: "\u4E0A\u6D77\u5E02",
  \u5929\u6D25: "\u5929\u6D25\u5E02",
  \u91CD\u5E86: "\u91CD\u5E86\u5E02",
  \u676D\u5DDE: "\u6D59\u6C5F\u7701",
  \u5B81\u6CE2: "\u6D59\u6C5F\u7701",
  \u7ECD\u5174: "\u6D59\u6C5F\u7701",
  \u6E29\u5DDE: "\u6D59\u6C5F\u7701",
  \u82CF\u5DDE: "\u6C5F\u82CF\u7701",
  \u5357\u4EAC: "\u6C5F\u82CF\u7701",
  \u6B66\u6C49: "\u6E56\u5317\u7701",
  \u957F\u6C99: "\u6E56\u5357\u7701",
  \u53A6\u95E8: "\u798F\u5EFA\u7701",
  \u897F\u5B89: "\u9655\u897F\u7701",
  \u6210\u90FD: "\u56DB\u5DDD\u7701",
  \u5E7F\u5DDE: "\u5E7F\u4E1C\u7701",
  \u6DF1\u5733: "\u5E7F\u4E1C\u7701",
  \u4E4C\u9C81\u6728\u9F50: "\u65B0\u7586\u7EF4\u543E\u5C14\u81EA\u6CBB\u533A",
  \u5317\u5C6F: "\u65B0\u7586\u7EF4\u543E\u5C14\u81EA\u6CBB\u533A"
};
var LOCAL_DISTRICT_PARENT = {
  \u5434\u6C5F\u533A: { city: "\u82CF\u5DDE", province: "\u6C5F\u82CF\u7701" },
  \u4F59\u676D\u533A: { city: "\u676D\u5DDE", province: "\u6D59\u6C5F\u7701" },
  \u897F\u6E56\u533A: { city: "\u676D\u5DDE", province: "\u6D59\u6C5F\u7701" },
  \u6D77\u6DC0\u533A: { city: "\u5317\u4EAC", province: "\u5317\u4EAC\u5E02" },
  \u671D\u9633\u533A: { city: "\u5317\u4EAC", province: "\u5317\u4EAC\u5E02" },
  \u6D2A\u5C71\u533A: { city: "\u6B66\u6C49", province: "\u6E56\u5317\u7701" },
  \u6B66\u660C\u533A: { city: "\u6B66\u6C49", province: "\u6E56\u5317\u7701" },
  \u6C5F\u6C49\u533A: { city: "\u6B66\u6C49", province: "\u6E56\u5317\u7701" },
  \u5CB3\u9E93\u533A: { city: "\u957F\u6C99", province: "\u6E56\u5357\u7701" }
};
var ALIAS_REPLACEMENTS = [
  { re: /西湿地公园/g, from: "\u897F\u6E7F\u5730\u516C\u56ED", to: "\u897F\u6EAA\u6E7F\u5730\u516C\u56ED" },
  { re: /西湿地/g, from: "\u897F\u6E7F\u5730", to: "\u897F\u6EAA\u6E7F\u5730\u516C\u56ED" },
  { re: /西溪湿地公园公园/g, from: "\u897F\u6EAA\u6E7F\u5730\u516C\u56ED\u516C\u56ED", to: "\u897F\u6EAA\u6E7F\u5730\u516C\u56ED" },
  { re: /西溪湿地(?!公园)/g, from: "\u897F\u6EAA\u6E7F\u5730", to: "\u897F\u6EAA\u6E7F\u5730\u516C\u56ED" },
  { re: /乌市/g, from: "\u4E4C\u5E02", to: "\u4E4C\u9C81\u6728\u9F50" },
  { re: /魔都/g, from: "\u9B54\u90FD", to: "\u4E0A\u6D77" },
  { re: /帝都/g, from: "\u5E1D\u90FD", to: "\u5317\u4EAC" },
  { re: /羊城/g, from: "\u7F8A\u57CE", to: "\u5E7F\u5DDE" },
  { re: /鹏城/g, from: "\u9E4F\u57CE", to: "\u6DF1\u5733" },
  { re: /江城/g, from: "\u6C5F\u57CE", to: "\u6B66\u6C49" },
  { re: /星城/g, from: "\u661F\u57CE", to: "\u957F\u6C99" },
  { re: /蓉城/g, from: "\u84C9\u57CE", to: "\u6210\u90FD" },
  { re: /山城/g, from: "\u5C71\u57CE", to: "\u91CD\u5E86" },
  { re: /长安/g, from: "\u957F\u5B89", to: "\u897F\u5B89" }
];
var GENERIC_POI_WORDS = /* @__PURE__ */ new Set([
  "\u666F\u70B9",
  "\u516C\u56ED",
  "\u535A\u7269\u9986",
  "\u535A\u7269\u9662",
  "\u7F8E\u672F\u9986",
  "\u9910\u5385",
  "\u996D\u5E97",
  "\u5496\u5561",
  "\u5976\u8336",
  "\u65E9\u5348\u9910",
  "brunch",
  "\u7F8A\u8089\u4E32",
  "\u70E7\u70E4",
  "\u7F8E\u98DF",
  "\u5348\u996D",
  "\u665A\u996D",
  "\u65E9\u996D",
  "\u5730\u65B9",
  "\u57CE\u5E02",
  "\u9644\u8FD1"
]);
var BAD_POI_RE = /酒店|宾馆|停车场|政府|学校|小区|住宅|写字楼|产业园|售楼|服务区|收费站|KTV|夜总会|洗浴|足浴|按摩/i;
var WEAK_POI_HINT_RE = /^(?:周边|附近|边上|旁边|边上的|附近的|旁边的)?(?:古镇|老街|古街|公园|博物馆|景点|景区|商场|万象汇|美食|餐厅)$/;
var NON_LOCATION_HINT_RE = /同性|都是男|都是女|男的|女的|朋友|同学|同事|家人|对象|预算|人均|上午|下午|晚上|打算|带他|带她|想去|想吃|逛逛|玩一下|以内|左右|出发|到达|小时|分钟|轻松|慢慢|不要太累/;
var districtCache = /* @__PURE__ */ new Map();
var poiCache = /* @__PURE__ */ new Map();
var inputtipsCache = /* @__PURE__ */ new Map();
var geocodeCache = /* @__PURE__ */ new Map();
var anchorCache = /* @__PURE__ */ new Map();
function getAmapKey() {
  return process.env.AMAP_API_KEY?.trim() || process.env.GAODE_API_KEY?.trim() || process.env.AMAP_KEY?.trim() || "";
}
function uniq(values) {
  return [...new Set(values.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}
function asString(value) {
  if (Array.isArray(value)) return value.find((item) => typeof item === "string" && item.trim()) ?? "";
  return typeof value === "string" ? value.trim() : "";
}
function isUsefulHint(value) {
  const text = asString(value);
  return text.length >= 2 && !NON_LOCATION_HINT_RE.test(text);
}
function stripCitySuffix(name) {
  const text = asString(name);
  if (!text) return "";
  if (MUNICIPALITIES.has(text)) return text.replace(/市$/, "");
  return text.replace(CITY_SUFFIX_RE, "");
}
function normalizeProvinceName(name) {
  const text = asString(name);
  if (!text) return null;
  return text;
}
function parseCenter(center) {
  const [lngRaw, latRaw] = asString(center).split(",");
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}
function parentCityAdcode(adcode) {
  const code = asString(adcode);
  if (!/^\d{6}$/.test(code)) return "";
  if (["11", "12", "31", "50"].includes(code.slice(0, 2))) return `${code.slice(0, 2)}0000`;
  if (code.endsWith("00")) return code;
  return `${code.slice(0, 4)}00`;
}
function provinceAdcode(adcode) {
  const code = asString(adcode);
  if (!/^\d{6}$/.test(code)) return "";
  return `${code.slice(0, 2)}0000`;
}
async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchAmapJson(url, timeoutMs) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await fetchJson(url, timeoutMs);
      if (data?.infocode === "10021" || /EXCEEDED_THE_LIMIT/i.test(asString(data?.info))) {
        await sleep(420 + attempt * 220);
        continue;
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < 1) await sleep(220 + attempt * 220);
    }
  }
  throw lastError ?? new Error("Amap request failed");
}
function shouldTryCitySuffix(keyword) {
  const clean = asString(keyword);
  return /^[\u4e00-\u9fa5]{2,8}$/.test(clean) && !/(省|自治区|特别行政区|市|地区|自治州|州|盟|区|县|旗|乡|镇|街道)$/.test(clean);
}
function normalizeDistrictResponse(data) {
  if (data?.status !== "1") {
    return { configured: true, used: true, status: "error", info: data?.info, districts: [] };
  }
  return {
    configured: true,
    used: true,
    status: (data.districts ?? []).length ? "ok" : "empty",
    districts: data.districts ?? []
  };
}
async function districtLookup(keyword, subdistrict = 0) {
  const key = getAmapKey();
  if (!key) return { configured: false, used: false, status: "not_configured", districts: [] };
  const clean = asString(keyword);
  if (!clean) return { configured: true, used: false, status: "not_needed", districts: [] };
  const cacheKey = `${clean}:${subdistrict}`;
  if (districtCache.has(cacheKey)) return districtCache.get(cacheKey);
  const params = new URLSearchParams({
    key,
    keywords: clean,
    subdistrict: String(subdistrict),
    extensions: "base",
    output: "JSON"
  });
  const result = fetchAmapJson(`${AMAP_BASE_URL}/config/district?${params.toString()}`, DISTRICT_TIMEOUT_MS).then(async (data) => {
    const primary = normalizeDistrictResponse(data);
    if (primary.status !== "empty" || !shouldTryCitySuffix(clean)) return primary;
    const fallbackParams = new URLSearchParams({
      key,
      keywords: `${clean}\u5E02`,
      subdistrict: String(subdistrict),
      extensions: "base",
      output: "JSON"
    });
    const fallback2 = await fetchAmapJson(`${AMAP_BASE_URL}/config/district?${fallbackParams.toString()}`, DISTRICT_TIMEOUT_MS);
    const secondary = normalizeDistrictResponse(fallback2);
    return secondary.status === "ok" ? secondary : primary;
  }).catch((error) => ({
    configured: true,
    used: true,
    status: "error",
    info: error instanceof Error ? error.message : String(error),
    districts: []
  }));
  districtCache.set(cacheKey, result);
  const final = await result;
  if (final.status === "error") districtCache.delete(cacheKey);
  return final;
}
async function poiLookup(keyword, city = "") {
  const key = getAmapKey();
  if (!key) return { configured: false, used: false, status: "not_configured", pois: [] };
  const clean = asString(keyword);
  if (!clean) return { configured: true, used: false, status: "not_needed", pois: [] };
  const cacheKey = `${clean}:${city}`;
  if (poiCache.has(cacheKey)) return poiCache.get(cacheKey);
  const params = new URLSearchParams({
    key,
    keywords: clean,
    city,
    citylimit: city ? "true" : "false",
    offset: "8",
    page: "1",
    extensions: "all",
    output: "JSON"
  });
  const result = fetchAmapJson(`${AMAP_BASE_URL}/place/text?${params.toString()}`, POI_TIMEOUT_MS).then((data) => {
    if (data?.status !== "1") {
      return { configured: true, used: true, status: "error", info: data?.info, pois: [] };
    }
    return {
      configured: true,
      used: true,
      status: (data.pois ?? []).length ? "ok" : "empty",
      pois: data.pois ?? []
    };
  }).catch((error) => ({
    configured: true,
    used: true,
    status: "error",
    info: error instanceof Error ? error.message : String(error),
    pois: []
  }));
  poiCache.set(cacheKey, result);
  const final = await result;
  if (final.status === "error") poiCache.delete(cacheKey);
  return final;
}
async function inputtipsLookup(keyword, city = "") {
  const key = getAmapKey();
  if (!key) return { configured: false, used: false, status: "not_configured", tips: [] };
  const clean = asString(keyword);
  if (!clean) return { configured: true, used: false, status: "not_needed", tips: [] };
  const cacheKey = `${clean}:${city}`;
  if (inputtipsCache.has(cacheKey)) return inputtipsCache.get(cacheKey);
  const params = new URLSearchParams({
    key,
    keywords: clean,
    city,
    citylimit: city ? "true" : "false",
    datatype: "poi",
    output: "JSON"
  });
  const result = fetchAmapJson(`${AMAP_BASE_URL}/assistant/inputtips?${params.toString()}`, POI_TIMEOUT_MS).then((data) => {
    if (data?.status !== "1") {
      return { configured: true, used: true, status: "error", info: data?.info, tips: [] };
    }
    return {
      configured: true,
      used: true,
      status: (data.tips ?? []).length ? "ok" : "empty",
      tips: data.tips ?? []
    };
  }).catch((error) => ({
    configured: true,
    used: true,
    status: "error",
    info: error instanceof Error ? error.message : String(error),
    tips: []
  }));
  inputtipsCache.set(cacheKey, result);
  const final = await result;
  if (final.status === "error") inputtipsCache.delete(cacheKey);
  return final;
}
async function geocodeLookup(keyword, city = "") {
  const key = getAmapKey();
  if (!key) return { configured: false, used: false, status: "not_configured", geocodes: [] };
  const clean = asString(keyword);
  if (!clean) return { configured: true, used: false, status: "not_needed", geocodes: [] };
  const cacheKey = `${clean}:${city}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  const params = new URLSearchParams({
    key,
    address: clean,
    city,
    output: "JSON"
  });
  const result = fetchAmapJson(`${AMAP_BASE_URL}/geocode/geo?${params.toString()}`, POI_TIMEOUT_MS).then((data) => {
    if (data?.status !== "1") {
      return { configured: true, used: true, status: "error", info: data?.info, geocodes: [] };
    }
    return {
      configured: true,
      used: true,
      status: (data.geocodes ?? []).length ? "ok" : "empty",
      geocodes: data.geocodes ?? []
    };
  }).catch((error) => ({
    configured: true,
    used: true,
    status: "error",
    info: error instanceof Error ? error.message : String(error),
    geocodes: []
  }));
  geocodeCache.set(cacheKey, result);
  const final = await result;
  if (final.status === "error") geocodeCache.delete(cacheKey);
  return final;
}
async function resolveAnchor(anchorText, city = "", deps = {}) {
  const clean = asString(anchorText);
  if (!clean) return null;
  const key = getAmapKey();
  if (!key) return null;
  const cleanCity = stripCitySuffix(city);
  const cacheKey = `${clean}:${cleanCity}`;
  if (anchorCache.has(cacheKey)) return anchorCache.get(cacheKey);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const getJson = async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), POI_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      return await res.json().catch(() => null);
    } finally {
      clearTimeout(timeout);
    }
  };
  let center = null;
  try {
    const geoParams = new URLSearchParams({
      key,
      address: cleanCity ? `${cleanCity}${clean}` : clean,
      city: cleanCity,
      output: "JSON"
    });
    const geo = await getJson(`${AMAP_BASE_URL}/geocode/geo?${geoParams.toString()}`);
    if (geo?.status === "1") center = parseCenter(geo.geocodes?.[0]?.location);
    if (!center) {
      const placeParams = new URLSearchParams({
        key,
        keywords: clean,
        city: cleanCity,
        citylimit: cleanCity ? "true" : "false",
        offset: "1",
        page: "1",
        extensions: "base",
        output: "JSON"
      });
      const place = await getJson(`${AMAP_BASE_URL}/place/text?${placeParams.toString()}`);
      if (place?.status === "1") center = parseCenter(place.pois?.[0]?.location);
    }
  } catch {
    center = null;
  }
  if (center) anchorCache.set(cacheKey, center);
  return center;
}
function normalizeAliases(raw) {
  let text = asString(raw);
  const matched = [];
  for (const alias of ALIAS_REPLACEMENTS) {
    alias.re.lastIndex = 0;
    if (!alias.re.test(text)) continue;
    alias.re.lastIndex = 0;
    text = text.replace(alias.re, alias.to);
    matched.push(alias.from === alias.to ? alias.from : `${alias.from}=>${alias.to}`);
  }
  text = text.replace(/西溪湿地公园公园/g, "\u897F\u6EAA\u6E7F\u5730\u516C\u56ED");
  return { text, matched };
}
function splitLocationList(value) {
  return uniq(asString(value).replace(/(上午|下午|晚上|早上|中午)?\s*\d{1,2}\s*点/g, " ").split(/、|,|，|和|及|以及|\/|;|；|\s+/).map((item) => item.replace(/^(想去|去|逛|到|在|来|玩|一下|一下子|边上的|附近的|旁边的|周边的)/, "").replace(/(玩一下|玩玩|逛逛|逛一下|逛一逛|看看|玩|旅游|旅行|一带|附近|周边)$/g, "").trim()).filter((item) => item.length >= 2 && item.length <= 16));
}
function cleanupAdminHint(value) {
  let text = asString(value);
  text = text.replace(/^.+(?:来|到|在)(?=[\u4e00-\u9fa5]{2,})/, "");
  text = text.replace(/^(?:想去|去|逛|到|在|来|玩)/, "");
  text = text.replace(/(?:玩|旅游|旅行|逛逛|逛一下|一带|附近|周边)$/g, "");
  return text.trim();
}
function expandAdminHint(value) {
  const clean = cleanupAdminHint(value);
  if (!clean) return [];
  const hints = [clean];
  if (!/自治区|特别行政区/.test(clean)) {
    const cityDistrict = clean.match(/^([\u4e00-\u9fa5]{2,8}?)(?:市)?([\u4e00-\u9fa5]{2,8}(?:区|县|旗))$/);
    if (cityDistrict) {
      hints.push(cityDistrict[1], cityDistrict[2]);
    }
  }
  return uniq(hints);
}
function explicitAdminSelections(text) {
  const matches = [...text.matchAll(/(?:城市|目的地|区域|区县|地点)\s*[:：]\s*([^，,。；;\s]{2,12})/g)];
  return uniq(matches.flatMap((match) => splitLocationList(match[1])));
}
function looseAdminFragments(text) {
  const fragments = [];
  fragments.push(...explicitAdminSelections(text));
  const travelRuns = [...text.matchAll(/[\u4e00-\u9fa5]{2,40}/g)].map((match) => match[0]);
  const stopWords = /朋友|同学|同事|家人|客户|我们|他们|她们|上午|下午|晚上|早上|中午|预算|人均|打算|计划|安排|想要|想去|想逛|来|去|到|在|玩|旅游|旅行|出差|逛|吃|喝|带他|带她|带朋友|带客户|一下|逛逛|看看|博物馆|博物院|美术馆|公园|餐厅|饭店|羊肉串|烧烤|午饭|晚饭|早饭|以内|左右|以内/g;
  for (const run of travelRuns) {
    const cleanRun = run.replace(/(?:上午|下午|晚上|早上|中午)?\d{1,2}点/g, " ");
    for (const piece of cleanRun.split(stopWords)) {
      const clean = cleanupAdminHint(piece).replace(/^(?:的|和|及|以及|再|然后|顺便|附近|边上|旁边)+/, "").replace(/(?:的|和|及|以及|再|然后|顺便|附近|边上|旁边)+$/, "").trim();
      if (clean.length < 2 || clean.length > 12) continue;
      if (GENERIC_POI_WORDS.has(clean)) continue;
      if (/预算|人均|朋友|上午|下午|晚上|早上|中午|打算|计划|安排/.test(clean)) continue;
      fragments.push(clean);
    }
  }
  return uniq(fragments);
}
function addPhrasePoiHints(text, poiHints) {
  const foodPlaceMatches = [...text.matchAll(/(?:带(?:他|她|ta|TA|朋友|同学|家人|客户)?|去|到|在)([\u4e00-\u9fa5A-Za-z0-9·]{2,16}?)(?:吃|喝|逛|玩|午饭|晚饭|brunch)/g)];
  for (const match of foodPlaceMatches) {
    poiHints.push(...splitLocationList(match[1]));
  }
}
function isWeakPoiHint(value) {
  const clean = asString(value).replace(/^(?:周边|附近|边上|边上的|旁边|旁边的|附近的)/, "").replace(/(?:玩一下|玩玩|逛逛|逛一下|逛一逛|看看|玩)$/g, "").trim();
  return !clean || GENERIC_POI_WORDS.has(clean) || WEAK_POI_HINT_RE.test(clean);
}
function extractLocationHints(rawInput) {
  const { text, matched: aliasMatches } = normalizeAliases(rawInput);
  const adminHints = [];
  const poiHints = [];
  const comeMatch = text.match(/来([^，,。；;\s]{2,18}?)(?:玩|旅游|旅行|出差|逛|$)/);
  if (comeMatch?.[1]) adminHints.push(...splitLocationList(comeMatch[1]));
  adminHints.push(...looseAdminFragments(text));
  const arriveMatches = [...text.matchAll(/(?:到|在)([^，,。；;\s]{2,18}?)(?:，|,|。|；|;|\s|人均|预算|想|吃|逛|玩|$)/g)];
  for (const match of arriveMatches) adminHints.push(...splitLocationList(match[1]));
  const adminSuffixMatches = [...text.matchAll(/(?:^|[，,。；;\s到在来])([\u4e00-\u9fa5]{1,14}(?:省|自治区|特别行政区|市|地区|自治州|州|盟|区|县|旗))/g)];
  for (const match of adminSuffixMatches) adminHints.push(match[1]);
  const wantMatches = [...text.matchAll(/(?:想去|想逛|去|逛一下|逛逛|看看)([^。；;]+?)(?:。|；|;|$)/g)];
  for (const match of wantMatches) poiHints.push(...splitLocationList(match[1]));
  addPhrasePoiHints(text, poiHints);
  const expandedAdminHints = adminHints.flatMap((item) => expandAdminHint(item));
  const explicitAdminHints = explicitAdminSelections(text);
  const adminCandidates = uniq(expandedAdminHints).filter((item) => isUsefulHint(item) && !GENERIC_POI_WORDS.has(item) && !isWeakPoiHint(item));
  const explicitProvinceContext = adminCandidates.filter((item) => {
    const province = PROVINCE_ALIASES[item];
    return province && !MUNICIPALITIES.has(province);
  });
  const adminSet = new Set(explicitAdminHints.length ? uniq([...explicitAdminHints, ...explicitProvinceContext]) : adminCandidates);
  const poiSet = new Set(uniq(poiHints).filter((item) => isUsefulHint(item) && !GENERIC_POI_WORDS.has(item)));
  for (const item of adminSet) {
    if (poiSet.has(item)) poiSet.delete(item);
  }
  return {
    normalizedText: text,
    aliasMatches,
    adminHints: [...adminSet],
    poiHints: [...poiSet]
  };
}
function childOptionsFromProvince(district) {
  const raw = Array.isArray(district?.districts) ? district.districts : [];
  const names2 = raw.filter((item) => ["city", "province"].includes(item.level) || /市$|自治州$|地区$|盟$/.test(asString(item.name))).map((item) => stripCitySuffix(item.name)).filter(Boolean);
  const province = normalizeProvinceName(district?.name);
  const preferred = PROVINCE_OPTION_PREFS[province] ?? [];
  return uniq([...preferred.filter((item) => names2.includes(item)), ...names2]).slice(0, 8);
}
function fallbackProvinceDistrict(keyword) {
  const province = PROVINCE_ALIASES[asString(keyword)];
  if (!province || MUNICIPALITIES.has(province)) return null;
  return {
    name: province,
    level: "province",
    adcode: "",
    citycode: "",
    center: "",
    districts: (PROVINCE_OPTION_PREFS[province] ?? []).map((name) => ({ name: `${name}\u5E02`, level: "city" }))
  };
}
function provinceChildEvidenceFromHints(province, hints) {
  const options = province?.options ?? [];
  if (!options.length) return null;
  const optionByCleanName = new Map(options.map((name) => [stripCitySuffix(name), stripCitySuffix(name)]));
  const provinceClean = stripCitySuffix(province.province);
  for (const hint of hints) {
    const clean = stripCitySuffix(hint);
    if (!clean || clean === provinceClean || clean === province.province) continue;
    const city = optionByCleanName.get(clean);
    if (!city) continue;
    return {
      kind: "city",
      keyword: hint,
      city,
      province: province.province,
      district: null,
      adcode: null,
      citycode: null,
      center: null,
      matched: `${hint}=>${city}`,
      confidence: 0.86,
      source: "district-province-child"
    };
  }
  return null;
}
function localExplicitResolution(hints, resolutionPath, warnings) {
  const allHints = uniq([hints.normalizedText, ...hints.adminHints, ...hints.poiHints]);
  const joined = allHints.join(" ");
  const district = Object.keys(LOCAL_DISTRICT_PARENT).find((name) => allHints.some((hint) => asString(hint).includes(name)) || joined.includes(name));
  if (district) {
    const parent = LOCAL_DISTRICT_PARENT[district];
    const extraAnchors2 = hints.adminHints.filter((hint) => hint !== district && stripCitySuffix(hint) !== parent.city && isUsefulHint(hint));
    resolutionPath.push("local explicit admin fallback");
    warnings.push(`\u9AD8\u5FB7\u884C\u653F\u533A\u67E5\u8BE2\u4E0D\u7A33\u5B9A\uFF0C\u5DF2\u6309\u663E\u5F0F\u533A\u53BF\u300C${district}\u300D\u515C\u5E95\u5230${parent.city}\u3002`);
    return {
      status: "resolved",
      city: parent.city,
      province: parent.province,
      district,
      adcode: null,
      citycode: null,
      center: null,
      anchors: uniq([district, ...extraAnchors2, ...hints.poiHints]).filter(isUsefulHint),
      poiHints: uniq([...extraAnchors2, ...hints.poiHints]).filter(isUsefulHint),
      matched: uniq([district, `${district}=>${parent.city}`, parent.city]),
      confidence: 0.72,
      resolutionPath,
      warnings
    };
  }
  const city = Object.keys(LOCAL_CITY_PROVINCE).find((name) => allHints.some((hint) => stripCitySuffix(hint) === name || asString(hint).includes(name)) || joined.includes(name));
  if (!city) return null;
  const extraAnchors = hints.adminHints.filter((hint) => stripCitySuffix(hint) !== city && !asString(hint).includes(`${city}`) && isUsefulHint(hint));
  resolutionPath.push("local explicit city fallback");
  warnings.push(`\u9AD8\u5FB7\u884C\u653F\u533A\u67E5\u8BE2\u4E0D\u7A33\u5B9A\uFF0C\u5DF2\u6309\u663E\u5F0F\u57CE\u5E02\u300C${city}\u300D\u515C\u5E95\u3002`);
  return {
    status: "resolved",
    city,
    province: LOCAL_CITY_PROVINCE[city],
    district: null,
    adcode: null,
    citycode: null,
    center: null,
    anchors: uniq([...extraAnchors, ...hints.poiHints]).filter(isUsefulHint),
    poiHints: uniq([...extraAnchors, ...hints.poiHints]).filter(isUsefulHint),
    matched: uniq([city]),
    confidence: 0.68,
    resolutionPath,
    warnings
  };
}
async function normalizeAdminDistrict(keyword, district) {
  const name = asString(district?.name);
  const level = asString(district?.level);
  const adcode = asString(district?.adcode);
  const citycode = asString(district?.citycode);
  const center = parseCenter(district?.center);
  const isMunicipality = MUNICIPALITIES.has(name);
  if (level === "province" && !isMunicipality) {
    return {
      kind: "province",
      keyword,
      province: normalizeProvinceName(name),
      provinceAdcode: adcode,
      center,
      options: childOptionsFromProvince(district),
      matched: name
    };
  }
  if (level === "city" || isMunicipality) {
    const provinceCode = provinceAdcode(adcode);
    const provinceResult = provinceCode && provinceCode !== adcode ? await districtLookup(provinceCode, 0) : null;
    const province = normalizeProvinceName(provinceResult?.districts?.[0]?.name) ?? (isMunicipality ? name : null);
    return {
      kind: "city",
      keyword,
      city: stripCitySuffix(name),
      province,
      district: null,
      adcode,
      citycode,
      center,
      matched: name,
      confidence: keyword === name || keyword === stripCitySuffix(name) ? 0.96 : 0.9,
      source: "district-city"
    };
  }
  if (["district", "street"].includes(level) || /区$|县$|旗$/.test(name)) {
    const parentCode = parentCityAdcode(adcode);
    const cityResult = parentCode ? await districtLookup(parentCode, 0) : null;
    const cityDistrict = cityResult?.districts?.[0];
    const cityName = stripCitySuffix(cityDistrict?.name);
    const provinceCode = provinceAdcode(adcode);
    const provinceResult = provinceCode ? await districtLookup(provinceCode, 0) : null;
    const province = normalizeProvinceName(provinceResult?.districts?.[0]?.name);
    return {
      kind: "district",
      keyword,
      city: cityName || stripCitySuffix(cityDistrict?.name),
      province,
      district: name,
      adcode,
      citycode: asString(cityDistrict?.citycode) || citycode,
      center,
      matched: name,
      confidence: 0.92,
      source: "district-parent-city"
    };
  }
  return null;
}
function poiCityFromFields(item) {
  const pname = asString(item.pname ?? item.province);
  const cityRaw = asString(item.cityname ?? item.city);
  const adname = asString(item.adname ?? item.district);
  const adcode = asString(item.adcode);
  let city = stripCitySuffix(cityRaw);
  if (!city && MUNICIPALITIES.has(pname)) city = stripCitySuffix(pname);
  return {
    city,
    province: normalizeProvinceName(pname),
    district: adname || null,
    adcode,
    citycode: asString(item.citycode),
    center: parseCenter(item.location)
  };
}
function poiScore(keyword, item, provinceHint, cityHint) {
  const name = asString(item.name ?? item.formatted_address);
  const text = `${name} ${asString(item.type)} ${asString(item.address)} ${asString(item.district)}`;
  if (!name || BAD_POI_RE.test(text)) return -100;
  const loc = poiCityFromFields(item);
  let score = 20;
  if (name === keyword) score += 34;
  else if (name.includes(keyword) || keyword.includes(name)) score += 24;
  if (provinceHint && loc.province === provinceHint) score += 18;
  if (cityHint && loc.city === cityHint) score += 18;
  if (/风景|景区|公园|名胜|博物馆|文化|古迹|街区|旅游|休闲/.test(text)) score += 8;
  if (loc.city) score += 10;
  if (loc.center) score += 4;
  return score;
}
async function poiEvidenceFromHint(keyword, provinceHint, cityHint) {
  const [place, tips, geocode] = await Promise.all([
    poiLookup(keyword, cityHint ?? ""),
    inputtipsLookup(keyword, cityHint ?? ""),
    geocodeLookup(keyword, cityHint ?? "")
  ]);
  const placePois = (place.pois ?? []).map((item) => ({ ...item, __source: "place-text" }));
  const tipPois = (tips.tips ?? []).filter((item) => asString(item.location)).map((item) => ({ ...item, __source: "inputtips" }));
  const geocodePois = (geocode.geocodes ?? []).map((item) => ({
    name: asString(item.formatted_address) || keyword,
    pname: item.province,
    cityname: item.city,
    adname: item.district,
    adcode: item.adcode,
    location: item.location,
    __source: "geocode"
  }));
  const all = [...placePois, ...tipPois, ...geocodePois].map((item) => ({ item, score: poiScore(keyword, item, provinceHint, cityHint) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  const best = all[0];
  if (!best) {
    return {
      keyword,
      status: "empty",
      placeStatus: place.status,
      inputtipsStatus: tips.status,
      geocodeStatus: geocode.status,
      evidence: null
    };
  }
  const loc = poiCityFromFields(best.item);
  return {
    keyword,
    status: "ok",
    placeStatus: place.status,
    inputtipsStatus: tips.status,
    geocodeStatus: geocode.status,
    evidence: {
      kind: "poi",
      keyword,
      city: loc.city,
      province: loc.province,
      district: loc.district,
      adcode: loc.adcode,
      citycode: loc.citycode,
      center: loc.center,
      matched: `${keyword}=>${asString(best.item.name) || keyword}`,
      confidence: Math.min(0.9, 0.64 + best.score / 180),
      source: best.item.__source
    }
  };
}
function chooseCity(evidence, provinceHint) {
  const byCity = /* @__PURE__ */ new Map();
  for (const item of evidence) {
    if (!item?.city) continue;
    if (provinceHint && item.province && item.province !== provinceHint) continue;
    const prev = byCity.get(item.city) ?? { score: 0, items: [] };
    const weight = item.kind === "city" ? 1.1 : item.kind === "district" ? 1 : 0.82;
    prev.score += (item.confidence ?? 0.7) * weight;
    prev.items.push(item);
    byCity.set(item.city, prev);
  }
  return [...byCity.entries()].map(([city, value]) => ({ city, ...value })).sort((a, b) => b.score - a.score || b.items.length - a.items.length)[0] ?? null;
}
function mergeCityInfo(chosen, preferredDistrict = null) {
  const items = chosen?.items ?? [];
  const strong = items.find((item) => item.kind === "city") ?? items.find((item) => item.kind === "district") ?? items[0];
  const district = preferredDistrict ?? items.find((item) => item.kind === "district" && item.district)?.district ?? items.find((item) => item.district)?.district ?? null;
  return {
    city: chosen?.city ?? strong?.city ?? null,
    province: strong?.province ?? items.find((item) => item.province)?.province ?? null,
    district,
    adcode: strong?.kind === "city" ? strong.adcode : parentCityAdcode(strong?.adcode) || strong?.adcode || null,
    citycode: strong?.citycode || null,
    center: strong?.center ?? items.find((item) => item.center)?.center ?? null
  };
}
function anchorHintsFromAdminHints(adminHints, cityInfo, provinceOnly, adminEvidence) {
  const ignored = new Set([
    cityInfo.city,
    `${cityInfo.city}\u5E02`,
    cityInfo.province,
    ...provinceOnly.flatMap((item) => [item.keyword, item.province, stripCitySuffix(item.province)]),
    ...adminEvidence.flatMap((item) => item.city ? [item.city, `${item.city}\u5E02`] : [])
  ].filter(Boolean));
  return adminHints.filter((hint) => !ignored.has(hint) && !ignored.has(stripCitySuffix(hint)));
}
function clarificationMessage(province, options) {
  if (!province) return "\u8BF7\u6307\u5B9A\u5177\u4F53\u57CE\u5E02\u6216\u533A\u57DF\u3002";
  const visible = options.length ? `\uFF0C\u4F8B\u5982${options.slice(0, 4).join("\u3001")}` : "";
  return `\u5DF2\u8BC6\u522B\u4E3A${province}\uFF0C\u8BF7\u6307\u5B9A${visible}\u7B49\u5177\u4F53\u57CE\u5E02\u3002`;
}
async function resolveLocation(rawInput) {
  const key = getAmapKey();
  const hints = extractLocationHints(rawInput);
  const resolutionPath = [
    "raw input",
    "alias normalization",
    "district lookup"
  ];
  const warnings = [];
  const matched = [...hints.aliasMatches];
  const sourceUsage = {
    amapDistrict: {
      configured: Boolean(key),
      used: false,
      status: key ? "not_needed" : "not_configured"
    },
    amapPoi: {
      configured: Boolean(key),
      used: false,
      status: key ? "not_needed" : "not_configured"
    }
  };
  const adminEvidence = [];
  const provinceOnly = [];
  const districtStatuses = [];
  if (hints.adminHints.length) {
    const adminResults = await Promise.all(hints.adminHints.map(async (hint) => {
      const lookup = await districtLookup(hint, 1);
      sourceUsage.amapDistrict.used = sourceUsage.amapDistrict.used || lookup.used;
      districtStatuses.push(lookup.status);
      let first = lookup.districts?.[0];
      const provinceFallback = first ? null : fallbackProvinceDistrict(hint);
      if (provinceFallback && lookup.used) {
        first = provinceFallback;
        districtStatuses.push("ok");
        warnings.push(`\u9AD8\u5FB7\u884C\u653F\u533A\u67E5\u8BE2\u300C${hint}\u300D\u8FD4\u56DE\u4E0D\u7A33\u5B9A\uFF0C\u5DF2\u4F7F\u7528\u7701\u7EA7\u540D\u79F0\u515C\u5E95\u3002`);
      }
      if (!first) {
        return null;
      }
      const normalized = await normalizeAdminDistrict(hint, first);
      return normalized;
    }));
    for (const item of adminResults) {
      if (!item) continue;
      matched.push(item.keyword === item.matched ? item.matched : `${item.keyword}=>${item.matched}`);
      if (item.kind === "province") provinceOnly.push(item);
      else adminEvidence.push(item);
    }
    for (const province of provinceOnly) {
      const childEvidence = provinceChildEvidenceFromHints(province, hints.adminHints);
      if (childEvidence && !adminEvidence.some((item) => item.city === childEvidence.city)) {
        adminEvidence.push(childEvidence);
        matched.push(childEvidence.matched);
      }
    }
  }
  if (sourceUsage.amapDistrict.used) {
    sourceUsage.amapDistrict.status = districtStatuses.includes("ok") ? "ok" : districtStatuses.find((status) => status === "error") ?? "empty";
  }
  const provinceHint = adminEvidence.find((item) => item.province)?.province ?? provinceOnly[0]?.province ?? null;
  const cityHint = adminEvidence.find((item) => item.city)?.city ?? null;
  const preferredDistrictHint = [...hints.adminHints].filter((item) => /(?:区|县|旗)$/.test(item) && !/自治区|特别行政区/.test(item)).sort((a, b) => a.length - b.length)[0] ?? null;
  const poiResults = [];
  const hasStrongAdminCity = Boolean(cityHint && adminEvidence.some((item) => item.kind === "city" || item.kind === "district"));
  const poiHintsForInference = hasStrongAdminCity ? [] : hints.poiHints.filter((hint) => cityHint || provinceHint || !isWeakPoiHint(hint));
  if (poiHintsForInference.length) {
    resolutionPath.push("poi reverse city inference");
    const results = await Promise.all(poiHintsForInference.map((hint) => poiEvidenceFromHint(hint, provinceHint, cityHint)));
    for (const result of results) {
      sourceUsage.amapPoi.used = true;
      poiResults.push(result);
      if (result.evidence) {
        adminEvidence.push(result.evidence);
        matched.push(result.evidence.matched);
      }
    }
    const statuses = poiResults.flatMap((item) => [item.placeStatus, item.inputtipsStatus, item.geocodeStatus]).filter(Boolean);
    sourceUsage.amapPoi.status = statuses.includes("ok") ? "ok" : statuses.find((status) => status === "error") ?? "empty";
  } else if (hints.poiHints.length && !hasStrongAdminCity && !hints.adminHints.length) {
    warnings.push("\u5DF2\u5FFD\u7565\u7F3A\u5C11\u57CE\u5E02\u4E0A\u4E0B\u6587\u7684\u6CDB\u5730\u70B9\u63CF\u8FF0\uFF0C\u907F\u514D\u7528\u201C\u53E4\u9547/\u5546\u573A\u201D\u7B49\u6CDB\u8BCD\u8BEF\u5224\u57CE\u5E02\u3002");
  }
  if (!key && !adminEvidence.length) {
    return {
      status: "error",
      city: null,
      province: null,
      district: null,
      adcode: null,
      citycode: null,
      center: null,
      anchors: [],
      poiHints: hints.poiHints.filter(isUsefulHint),
      matched,
      confidence: 0,
      resolutionPath,
      warnings: ["AMAP_API_KEY/GAODE_API_KEY/AMAP_KEY is not configured."],
      dataSources: sourceUsage,
      message: "\u9AD8\u5FB7 Web \u670D\u52A1 key \u672A\u914D\u7F6E\uFF0C\u65E0\u6CD5\u8FDB\u884C\u901A\u7528\u5730\u540D\u89E3\u6790\u3002"
    };
  }
  const localFallback = localExplicitResolution(hints, [...resolutionPath], [...warnings]);
  const chosen = chooseCity(adminEvidence, provinceHint);
  if (localFallback?.city && chosen?.city && chosen.city !== localFallback.city) {
    return {
      ...localFallback,
      warnings: [...localFallback.warnings ?? [], `POI \u53CD\u63A8\u57CE\u5E02\u300C${chosen.city}\u300D\u4E0E\u663E\u5F0F\u884C\u653F\u533A\u51B2\u7A81\uFF0C\u5DF2\u4F18\u5148\u91C7\u7528\u663E\u5F0F\u8F93\u5165\u3002`],
      dataSources: sourceUsage,
      normalizedInput: hints.normalizedText
    };
  }
  if (chosen?.city) {
    const cityInfo = mergeCityInfo(chosen, preferredDistrictHint);
    const districts = uniq([
      cityInfo.district,
      ...adminEvidence.filter((item) => item.kind === "district" && item.district && item.city === cityInfo.city).map((item) => item.district)
    ]);
    const adminAnchors = anchorHintsFromAdminHints(hints.adminHints, cityInfo, provinceOnly, adminEvidence);
    const anchors = uniq([...districts, ...adminAnchors, ...hints.poiHints]).filter(isUsefulHint);
    const confidence = Math.max(0.55, Math.min(0.98, chosen.score / Math.max(1, chosen.items.length)));
    matched.push(cityInfo.city);
    return {
      status: "resolved",
      city: cityInfo.city,
      province: cityInfo.province ?? provinceHint,
      district: cityInfo.district,
      adcode: cityInfo.adcode,
      citycode: cityInfo.citycode,
      center: cityInfo.center,
      anchors,
      poiHints: hints.poiHints.filter(isUsefulHint),
      matched: uniq(matched),
      confidence: +confidence.toFixed(2),
      resolutionPath,
      warnings,
      dataSources: sourceUsage,
      normalizedInput: hints.normalizedText
    };
  }
  if (localFallback) {
    return {
      ...localFallback,
      dataSources: sourceUsage,
      normalizedInput: hints.normalizedText
    };
  }
  if (provinceOnly.length) {
    const province = provinceOnly[0];
    const options = childOptionsFromProvince({ name: province.province, districts: province.options.map((name) => ({ name: `${name}\u5E02`, level: "city" })) });
    return {
      status: "needs-clarification",
      city: null,
      province: province.province,
      district: null,
      adcode: province.provinceAdcode,
      citycode: null,
      center: province.center,
      anchors: [],
      poiHints: hints.poiHints.filter(isUsefulHint),
      matched: uniq(matched),
      confidence: 0.52,
      resolutionPath,
      warnings,
      dataSources: sourceUsage,
      clarificationOptions: options,
      message: clarificationMessage(province.province, options),
      normalizedInput: hints.normalizedText
    };
  }
  return {
    status: "needs-clarification",
    city: null,
    province: null,
    district: null,
    adcode: null,
    citycode: null,
    center: null,
    anchors: [],
    poiHints: hints.poiHints.filter(isUsefulHint),
    matched: uniq(matched),
    confidence: 0.2,
    resolutionPath,
    warnings,
    dataSources: sourceUsage,
    clarificationOptions: [],
    message: "\u8BF7\u6307\u5B9A\u5177\u4F53\u57CE\u5E02\u6216\u533A\u57DF\u3002",
    normalizedInput: hints.normalizedText
  };
}

// lib/sse.js
function openSSE(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (typeof res.writeHead === "function") res.writeHead(200);
  return {
    /** Validate against the frozen contract, then write the framed event. */
    send(event) {
      const parsed = SSEEventSchema.parse(event);
      res.write(encodeSSE(parsed));
    },
    /** SSE comment line — keep-alive, never parsed by clients. */
    comment(text = "keep-alive") {
      res.write(`: ${text}

`);
    },
    close() {
      res.end();
    }
  };
}

// lib/db/client.js
import { neon } from "@neondatabase/serverless";
var cached = null;
function hasDatabase() {
  return Boolean(process.env.DATABASE_URL?.trim());
}
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw lastErr;
}
function getSql() {
  if (!hasDatabase()) throw new Error("DATABASE_URL is not configured");
  if (!cached) {
    const base = neon(process.env.DATABASE_URL);
    const wrapped = (...args) => withRetry(() => base(...args));
    wrapped.query = (...args) => withRetry(() => base.query(...args));
    cached = wrapped;
  }
  return cached;
}

// lib/db/users.js
async function userForSession(token) {
  if (!token) return null;
  const sql = getSql();
  const rows = await sql`
    SELECT u.id, u.username, u.prefs, u.budget_pref
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()
  `;
  return rows[0] ?? null;
}
async function createGuest(deviceToken, prefs = []) {
  const sql = getSql();
  await sql`
    INSERT INTO guests (device_token, prefs) VALUES (${deviceToken}, ${JSON.stringify(prefs)}::jsonb)
    ON CONFLICT (device_token) DO NOTHING
  `;
  return { deviceToken };
}

// lib/auth.js
import bcrypt from "bcryptjs";
function parseBearer(header) {
  const value = typeof header === "string" ? header.trim() : "";
  const m = value.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// lib/identity.js
async function resolveIdentity(req) {
  const bearer = parseBearer(req.headers?.authorization);
  const headerDevice = String(req.headers?.["x-device-token"] || "").trim() || null;
  const token = bearer || headerDevice;
  if (token && hasDatabase()) {
    const user = await userForSession(token);
    if (user) return { userId: Number(user.id), deviceToken: null, user };
  }
  return { userId: null, deviceToken: token, user: null };
}

// lib/db/plans.js
async function savePlan({ id, userId = null, deviceToken = null, request, constraints, routes, dataSources }) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO plans (id, user_id, device_token, request, constraints, routes, data_sources)
    VALUES (${id}, ${userId}, ${deviceToken}, ${request},
            ${JSON.stringify(constraints)}::jsonb, ${JSON.stringify(routes)}::jsonb, ${JSON.stringify(dataSources)}::jsonb)
    RETURNING id, created_at
  `;
  return rows[0];
}

// lib/agent/persona.ts
var PERSONAS = {
  couple: {
    id: "couple",
    label: "\u60C5\u4FA3",
    sceneWeights: { romantic: 1, quiet: 0.7, photo: 0.6, upscale: 0.4, cultural: 0.5, lively: 0.1, nightlife: 0.2, foodie: 0.5, local: 0.3, nature: 0.4 },
    categoryPriority: { cafe: 0.5, dining: 0.4, culture: 0.5, nightscape: 0.4 },
    budgetSensitivity: 0.4,
    walkTolerance: 18,
    latestEnd: 22.5,
    partyDefault: 2,
    pace: "normal"
  },
  family: {
    id: "family",
    label: "\u5BB6\u5EAD",
    sceneWeights: { family: 1, quiet: 0.5, cultural: 0.6, nature: 0.7, photo: 0.3, local: 0.4, foodie: 0.5, budget: 0.3, lively: 0.2, nightlife: -1, upscale: -0.2 },
    categoryPriority: { culture: 0.6, dining: 0.5, shopping: 0.3, entertainment: 0.2 },
    budgetSensitivity: 0.6,
    walkTolerance: 14,
    latestEnd: 20.5,
    partyDefault: 3,
    pace: "relaxed"
  },
  friends: {
    id: "friends",
    label: "\u670B\u53CB",
    sceneWeights: { lively: 0.9, foodie: 0.7, trendy: 0.6, photo: 0.5, local: 0.5, budget: 0.4, romantic: 0.2, nightlife: 0.4, cultural: 0.4, nature: 0.3 },
    categoryPriority: { dining: 0.6, entertainment: 0.4, cafe: 0.4, shopping: 0.4 },
    budgetSensitivity: 0.5,
    walkTolerance: 20,
    latestEnd: 23,
    partyDefault: 4,
    pace: "normal"
  },
  solo: {
    id: "solo",
    label: "\u72EC\u884C",
    sceneWeights: { quiet: 0.9, cultural: 0.9, local: 0.7, photo: 0.4, nature: 0.5, foodie: 0.5, budget: 0.4, lively: -0.1, romantic: 0.1, nightlife: 0.1 },
    categoryPriority: { culture: 0.7, cafe: 0.5, dining: 0.4, shopping: 0.2 },
    budgetSensitivity: 0.5,
    walkTolerance: 22,
    latestEnd: 21.5,
    partyDefault: 1,
    pace: "normal"
  }
};
function personaFor(pick) {
  if (pick === "auto") return PERSONAS.friends;
  return PERSONAS[pick];
}

// lib/agent/geo.ts
function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371e3;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function distBetween(a, b) {
  return haversineM(a.lat, a.lng, b.lat, b.lng);
}
function travelEstimate(distM, walkToleranceMin) {
  const walkSpeed = 80;
  const walkMin = Math.round(distM / walkSpeed);
  if (walkMin <= walkToleranceMin) return { minutes: walkMin, mode: "walk" };
  const transitMin = Math.round(8 + distM / 350);
  return { minutes: transitMin, mode: "transit" };
}

// lib/agent/score.ts
var SCORE_WEIGHTS = {
  quality: 25,
  sceneFit: 22,
  prefMatch: 28,
  budgetFit: 12,
  proximity: 8,
  companionFit: 5
};
function clamp(x, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, x));
}
function qualityScore(p) {
  if (p.rating == null) return 0.5;
  return clamp((p.rating - 3.6) / (5 - 3.6));
}
function sceneFitScore(p, persona) {
  let sum = 0;
  const hits = [];
  for (const tag of p.sceneTags) {
    const w = persona.sceneWeights[tag] ?? 0;
    sum += w;
    if (w >= 0.5) hits.push(tag);
  }
  return { v: clamp((sum + 1.2) / 3.2), hits };
}
function prefMatchScore(p, c) {
  if (c.prefs.length === 0) return { v: 0.5, hits: [] };
  const hits = c.prefs.filter((t) => p.sceneTags.includes(t));
  let v = hits.length / c.prefs.length;
  const avoidHit = c.avoid.filter((t) => p.sceneTags.includes(t));
  v -= avoidHit.length * 0.25;
  return { v: clamp(v), hits };
}
function budgetFitScore(p, c, persona) {
  if (p.perCapita == null) return { v: 0.5, over: false };
  const budget = c.budgetPerCapita ?? (p.category === "dining" ? c.diningBudgetPerCapita : null);
  if (budget == null) return { v: clamp(1 - p.perCapita / 600), over: false };
  const ratio = p.perCapita / budget;
  if (ratio <= 1) return { v: clamp(0.6 + 0.4 * (1 - Math.abs(0.7 - ratio))), over: false };
  const penalty = (ratio - 1) * (1 + persona.budgetSensitivity * 2);
  return { v: clamp(1 - penalty), over: true };
}
function proximityScore(p, centerLat, centerLng) {
  return clamp(1 - haversineM(centerLat, centerLng, p.lat, p.lng) / 6e3);
}
function companionFitScore(p, c) {
  const party = c.party;
  if (party >= 4) {
    let v2 = 0.5;
    if (p.sceneTags.includes("lively")) v2 += 0.25;
    if (p.sceneTags.includes("budget")) v2 += 0.1;
    if (p.sceneTags.includes("quiet")) v2 -= 0.2;
    return clamp(v2);
  }
  if (party <= 1) {
    let v2 = 0.5;
    if (p.sceneTags.includes("quiet")) v2 += 0.2;
    if (p.sceneTags.includes("cultural")) v2 += 0.15;
    if (p.sceneTags.includes("lively")) v2 -= 0.15;
    return clamp(v2);
  }
  let v = 0.55;
  if (p.sceneTags.includes("romantic")) v += 0.15;
  if (p.sceneTags.includes("photo")) v += 0.05;
  return clamp(v);
}
var SCENE_LABEL = {
  romantic: "\u6D6A\u6F2B",
  quiet: "\u5B89\u9759",
  photo: "\u62CD\u7167",
  family: "\u4EB2\u5B50",
  lively: "\u70ED\u95F9",
  cultural: "\u6587\u5316",
  trendy: "\u6F6E\u6D41",
  local: "\u672C\u5730",
  upscale: "\u7CBE\u81F4",
  budget: "\u5B9E\u60E0",
  nature: "\u81EA\u7136",
  nightlife: "\u591C\u751F\u6D3B",
  foodie: "\u7F8E\u98DF"
};
function buildReasons(p, c, persona, prefHits, over) {
  const r = [];
  if (prefHits.length) r.push(`\u547D\u4E2D\u4F60\u7684\u9700\u6C42\uFF1A${prefHits.map((t) => SCENE_LABEL[t] ?? t).join("\u3001")}`);
  if (p.perCapita != null && c.diningBudgetPerCapita != null && p.category === "dining") {
    r.push(over ? `\u6B63\u9910\u4EBA\u5747 \xA5${p.perCapita}\uFF0C\u7565\u8D85\u5403\u996D\u9884\u7B97` : `\u6B63\u9910\u4EBA\u5747 \xA5${p.perCapita}\uFF0C\u5728 \xA5${c.diningBudgetPerCapita} \u9884\u7B97\u5185`);
  } else if (p.perCapita != null && c.budgetPerCapita != null) {
    r.push(over ? `\u4EBA\u5747 \xA5${p.perCapita}\uFF0C\u7565\u8D85\u9884\u7B97\u9700\u7559\u610F` : `\u4EBA\u5747 \xA5${p.perCapita}\uFF0C\u5728 \xA5${c.budgetPerCapita} \u9884\u7B97\u5185`);
  }
  if (p.rating != null && p.rating >= 4.5) r.push(`\u8BC4\u5206 ${p.rating}\uFF0C\u53E3\u7891\u7A81\u51FA`);
  if (r.length === 0) {
    r.push(p.rating != null ? `\u7EFC\u5408\u8BC4\u5206 ${p.rating}` : `\u8D34\u5408\u300C${persona.label}\u300D\u8FD9\u6B21\u7684\u5B89\u6392`);
  }
  return r.slice(0, 4);
}
function scorePOI(p, c, persona, centerLat, centerLng) {
  const quality = qualityScore(p);
  const { v: sceneFit } = sceneFitScore(p, persona);
  const { v: prefMatch, hits: prefHits } = prefMatchScore(p, c);
  const { v: budgetFit, over } = budgetFitScore(p, c, persona);
  const proximity = proximityScore(p, centerLat, centerLng);
  const companionFit = companionFitScore(p, c);
  const catBoost = 1 + (persona.categoryPriority[p.category] ?? 0) * 0.12;
  const total = quality * SCORE_WEIGHTS.quality + sceneFit * SCORE_WEIGHTS.sceneFit * catBoost + prefMatch * SCORE_WEIGHTS.prefMatch + budgetFit * SCORE_WEIGHTS.budgetFit + proximity * SCORE_WEIGHTS.proximity + companionFit * SCORE_WEIGHTS.companionFit;
  const sources = {
    rating: "amap",
    perCapita: "amap",
    sceneTags: "derived",
    proximity: "amap"
  };
  return {
    poi: p,
    score: Math.max(0, Math.min(100, +total.toFixed(1))),
    reasons: buildReasons(p, c, persona, prefHits, over),
    sources
  };
}
function scorePOIs(pois, c, persona, centerLat, centerLng) {
  return pois.map((p) => scorePOI(p, c, persona, centerLat, centerLng)).sort((a, b) => b.score - a.score);
}

// lib/agent/build.ts
var BEAM = 6;
var TOPK_PER_SLOT = 7;
var OUTPUT = 6;
var ANCHOR_RADII_M = [3e3, 5e3, 8e3];
var MIN_CATS_IN_RADIUS = 2;
var MIN_CANDIDATES_IN_RADIUS = 4;
function densestClusterCenter(pois, radiusM = 3e3) {
  if (!pois.length) return null;
  let best = pois[0];
  let bestCount = -1;
  for (const p of pois) {
    let count = 0;
    for (const q of pois) {
      if (haversineM(p.lat, p.lng, q.lat, q.lng) <= radiusM) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = p;
    }
  }
  return { lat: best.lat, lng: best.lng };
}
function clusterToAnchor(scored, center) {
  let chosen = scored;
  for (const r of ANCHOR_RADII_M) {
    const inside = scored.filter((s) => haversineM(center.lat, center.lng, s.poi.lat, s.poi.lng) <= r);
    const cats = new Set(inside.map((s) => s.poi.category)).size;
    chosen = inside;
    if (cats >= MIN_CATS_IN_RADIUS && inside.length >= MIN_CANDIDATES_IN_RADIUS) return inside;
  }
  return chosen.length ? chosen : scored;
}
var OPEN_FALLBACK = 0;
var CLOSE_FALLBACK = 24;
function openOf(p) {
  return p.openHour ?? OPEN_FALLBACK;
}
function closeOf(p) {
  return p.closeHour ?? CLOSE_FALLBACK;
}
function durOf(p) {
  return p.poi.avgDuration ?? 60;
}
function planSlots(c, persona) {
  const durH = c.durationMin / 60;
  let n = durH <= 2.5 ? 3 : durH <= 4 ? 4 : 5;
  if (c.pace === "relaxed") n = Math.max(durH <= 3 ? 2 : 3, n - 1);
  if (c.pace === "packed") n = Math.min(5, n + 1);
  const slots = [...c.mustCategories];
  const fillers = ["culture", "dining", "cafe", "shopping", "entertainment"];
  for (const f of fillers) {
    if (slots.length >= n) break;
    if (!slots.includes(f)) slots.push(f);
  }
  return slots.slice(0, n);
}
function topKForSlots(slots, scored) {
  const byCat = /* @__PURE__ */ new Map();
  for (const s of scored) {
    const arr = byCat.get(s.poi.category) ?? [];
    arr.push(s);
    byCat.set(s.poi.category, arr);
  }
  const result = /* @__PURE__ */ new Map();
  slots.forEach((cat, idx) => {
    let pool = byCat.get(cat) ?? [];
    if (pool.length === 0) pool = scored;
    result.set(idx, pool.slice(0, TOPK_PER_SLOT));
  });
  return result;
}
function estimateEta(picks, c, persona) {
  let clock = c.startTime;
  for (let i = 0; i < picks.length; i++) {
    if (i > 0) {
      const d = distBetween(picks[i - 1].poi, picks[i].poi);
      clock += travelEstimate(d, persona.walkTolerance).minutes / 60;
    }
    clock = Math.max(clock, openOf(picks[i].poi)) + durOf(picks[i]) / 60;
  }
  return clock + 0.2;
}
function effectiveLatestEnd(c, persona) {
  return Math.min(persona.latestEnd, c.startTime + c.durationMin / 60 + 0.25);
}
function buildRouteCandidates(scored, c, persona, opts = {}) {
  const clustered = opts.anchorCenter ? clusterToAnchor(scored, opts.anchorCenter) : scored;
  const slots = planSlots(c, persona);
  const slotPools = topKForSlots(slots, clustered);
  const latestEnd = effectiveLatestEnd(c, persona);
  const plannedCount = /* @__PURE__ */ new Map();
  for (const s of slots) plannedCount.set(s, (plannedCount.get(s) ?? 0) + 1);
  let beams = [{ picks: [], usedIds: /* @__PURE__ */ new Set(), scoreSum: 0, penalty: 0 }];
  for (let i = 0; i < slots.length; i++) {
    const pool = slotPools.get(i) ?? [];
    const next = [];
    for (const beam of beams) {
      if (pool.length === 0) {
        next.push(beam);
        continue;
      }
      const eta = estimateEta(beam.picks, c, persona);
      const feasible = pool.filter((cand) => {
        const arrive = Math.max(eta, openOf(cand.poi));
        if (arrive >= closeOf(cand.poi) - 0.01) return false;
        if (arrive + durOf(cand) / 60 > latestEnd + 0.5) return false;
        return true;
      });
      const usePool = feasible.length ? feasible : pool;
      let extended = 0;
      for (const cand of usePool) {
        if (beam.usedIds.has(cand.poi.id)) continue;
        let legPenalty = 0;
        const prev = beam.picks[beam.picks.length - 1];
        if (prev) {
          const d = distBetween(prev.poi, cand.poi);
          legPenalty = travelEstimate(d, persona.walkTolerance).minutes * 0.6;
        }
        const waitPenalty = Math.max(0, openOf(cand.poi) - eta) * 6;
        const haveCat = beam.picks.reduce((nn, p) => p.poi.category === cand.poi.category ? nn + 1 : nn, 0);
        const allowed = Math.max(1, plannedCount.get(cand.poi.category) ?? 1);
        const repeatPenalty = haveCat >= allowed ? (haveCat - allowed + 1) * 28 : 0;
        next.push({
          picks: [...beam.picks, cand],
          usedIds: new Set(beam.usedIds).add(cand.poi.id),
          scoreSum: beam.scoreSum + cand.score,
          penalty: beam.penalty + legPenalty + waitPenalty + repeatPenalty
        });
        extended += 1;
      }
      if (extended === 0) next.push(beam);
    }
    next.sort((a, b) => b.scoreSum - b.penalty - (a.scoreSum - a.penalty));
    const seen = /* @__PURE__ */ new Set();
    beams = [];
    for (const b of next) {
      const k = b.picks.map((p) => p.poi.id).sort().join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      beams.push(b);
      if (beams.length >= BEAM) break;
    }
  }
  const availableCats = new Set(clustered.map((s) => s.poi.category)).size;
  const target = c.pace === "relaxed" && slots.length <= 2 ? 2 : 3;
  const minStops = Math.max(2, Math.min(target, availableCats));
  const routes = beams.filter((b) => b.picks.length >= minStops).slice(0, OUTPUT).map((b, idx) => materializeRoute(b.picks, c, persona, idx));
  return { slots, routes };
}
function orderStops(picks, c) {
  const night = picks.filter((p) => p.poi.category === "nightscape");
  const meals = picks.filter((p) => p.poi.category === "dining");
  const rest = picks.filter((p) => p.poi.category !== "nightscape" && p.poi.category !== "dining");
  const nnOrder = [];
  const remaining = [...rest];
  if (remaining.length) {
    let curr = remaining.shift();
    nnOrder.push(curr);
    while (remaining.length) {
      let bestIdx = 0;
      let bestD = Infinity;
      remaining.forEach((cand, idx) => {
        const d = distBetween(curr.poi, cand.poi);
        if (d < bestD) {
          bestD = d;
          bestIdx = idx;
        }
      });
      curr = remaining.splice(bestIdx, 1)[0];
      nnOrder.push(curr);
    }
  }
  if (c.startTime >= 18) return [...meals, ...nnOrder, ...night];
  const mid = Math.floor(nnOrder.length / 2);
  return [...nnOrder.slice(0, mid), ...meals, ...nnOrder.slice(mid), ...night];
}
function materializeRoute(picks, c, persona, seq) {
  const ordered = orderStops(picks, c);
  const stops = [];
  let clock = c.startTime;
  let totalWalk = 0;
  let totalTransit = 0;
  let cost = 0;
  ordered.forEach((sp, i) => {
    let leg = null;
    if (i > 0) {
      const d = distBetween(ordered[i - 1].poi, sp.poi);
      const t = travelEstimate(d, persona.walkTolerance);
      leg = { distM: Math.round(d), minutes: t.minutes, mode: t.mode };
      clock += t.minutes / 60;
      if (t.mode === "walk") totalWalk += t.minutes;
      else totalTransit += t.minutes;
    }
    const arrive = Math.max(clock, sp.poi.openHour ?? OPEN_FALLBACK);
    const depart = arrive + durOf(sp) / 60;
    clock = depart;
    cost += sp.poi.perCapita ?? 0;
    stops.push({
      poi: sp.poi,
      arrive,
      depart,
      legFromPrev: leg,
      reasons: sp.reasons,
      sources: sp.sources
    });
  });
  const coverage = [...new Set(stops.map((s) => s.poi.category))];
  return {
    id: `route-${seq}`,
    stops,
    totalCost: Math.round(cost),
    totalWalkMin: totalWalk,
    totalTransitMin: totalTransit,
    endTime: clock,
    coverage,
    checks: [],
    explanation: "",
    risks: []
  };
}

// lib/agent/validate.ts
function fmtH(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
var CATEGORY_LABEL = {
  dining: "\u9910\u996E",
  cafe: "\u5496\u5561",
  culture: "\u6587\u5316",
  entertainment: "\u5A31\u4E50",
  shopping: "\u8D2D\u7269",
  nightscape: "\u591C\u666F"
};
var MAX_LEG_DISTANCE_M = 12e3;
var MAX_LEG_MINUTES = 45;
var MAX_WALK_MINUTES = 25;
function validateRoute(route, c, persona) {
  const checks = [];
  let openFail = 0, openWarn = 0;
  const openDetails = [];
  for (const s of route.stops) {
    const { openHour, closeHour, name } = s.poi;
    if (openHour == null || closeHour == null) continue;
    if (s.arrive < openHour - 0.01) {
      openFail++;
      openDetails.push(`${name} \u672A\u5F00\u95E8\uFF08${fmtH(openHour)} \u8425\u4E1A\uFF09`);
    } else if (s.depart > closeHour + 0.01) {
      if (s.arrive < closeHour) {
        openWarn++;
        openDetails.push(`${name} \u6E38\u73A9\u8DE8\u8D8A\u6253\u70CA\uFF08${fmtH(closeHour)}\uFF09`);
      } else {
        openFail++;
        openDetails.push(`${name} \u5DF2\u6253\u70CA\uFF08${fmtH(closeHour)}\uFF09`);
      }
    }
  }
  checks.push({
    key: "open",
    label: "\u8425\u4E1A\u65F6\u95F4",
    status: openFail ? "fail" : openWarn ? "warn" : "pass",
    detail: openFail || openWarn ? openDetails.join("\uFF1B") : "\u5168\u7A0B\u5747\u5728\u8425\u4E1A\u65F6\u95F4\u5185\uFF08\u672A\u77E5\u8425\u4E1A\u65F6\u95F4\u7684\u5E97\u672A\u53C2\u4E0E\u5224\u5B9A\uFF09"
  });
  if (c.budgetPerCapita != null) {
    const ratio = route.totalCost / c.budgetPerCapita;
    let status = "pass";
    if (ratio > 1.15) status = "fail";
    else if (ratio > 1) status = "warn";
    checks.push({
      key: "budget",
      label: "\u9884\u7B97",
      status,
      detail: `\u4EBA\u5747\u5408\u8BA1 \xA5${route.totalCost} / \u9884\u7B97 \xA5${c.budgetPerCapita}\uFF08${Math.round(ratio * 100)}%\uFF09`
    });
  } else {
    checks.push({ key: "budget", label: "\u9884\u7B97", status: "pass", detail: `\u672A\u8BBE\u9884\u7B97 \xB7 \u4EBA\u5747\u5408\u8BA1 \xA5${route.totalCost}` });
  }
  const mobilityProblems = route.stops.filter((s) => {
    const leg = s.legFromPrev;
    if (!leg) return false;
    if (leg.distM > MAX_LEG_DISTANCE_M) return true;
    if (leg.minutes > MAX_LEG_MINUTES) return true;
    if (leg.mode === "walk" && leg.minutes > MAX_WALK_MINUTES) return true;
    return false;
  }).map((s) => `${s.poi.name} \u524D\u4E00\u6BB5 ${s.legFromPrev.minutes} \u5206\u949F/${(s.legFromPrev.distM / 1e3).toFixed(1)}km`);
  const totalMove = route.totalWalkMin + route.totalTransitMin;
  const durMin = Math.max(1, c.durationMin);
  checks.push({
    key: "mobility",
    label: "\u79FB\u52A8\u8DDD\u79BB",
    status: mobilityProblems.length || totalMove >= 100 ? "fail" : totalMove > Math.min(90, durMin * 0.35) ? "warn" : "pass",
    detail: mobilityProblems.length ? `\u79FB\u52A8\u8FC7\u957F\uFF1A${mobilityProblems.join("\uFF1B")}` : totalMove >= 100 ? `\u603B\u79FB\u52A8\u7EA6 ${totalMove} \u5206\u949F\uFF0C\u660E\u663E\u4E0D\u9002\u5408\u4F5C\u4E3A\u672C\u5730\u8DEF\u7EBF` : `\u5355\u6BB5\u79FB\u52A8\u53EF\u63A7\uFF0C\u603B\u79FB\u52A8\u7EA6 ${totalMove} \u5206\u949F`
  });
  const cov = new Set(route.coverage);
  const missMust = c.mustCategories.filter((m) => !cov.has(m));
  checks.push({
    key: "coverage",
    label: "\u7C7B\u76EE\u8986\u76D6",
    status: missMust.length ? "warn" : cov.size >= 3 ? "pass" : "warn",
    detail: missMust.length ? `\u7F3A\u5C11\u4F60\u8981\u6C42\u7684\u7C7B\u76EE\uFF1A${missMust.map((m) => CATEGORY_LABEL[m] ?? m).join("\u3001")}` : `\u8986\u76D6 ${[...cov].map((x) => CATEGORY_LABEL[x] ?? x).join("\u3001")}`
  });
  const minStops = c.pace === "relaxed" && c.durationMin <= 240 ? 2 : 3;
  checks.push({
    key: "count",
    label: "POI \u6570\u91CF",
    status: route.stops.length >= minStops ? "pass" : "fail",
    detail: `${route.stops.length} \u4E2A POI${route.stops.length >= minStops ? `\uFF08\u6EE1\u8DB3 \u2265${minStops}\uFF09` : `\uFF08\u4E0D\u8DB3 ${minStops} \u4E2A\uFF09`}`
  });
  const plannedEnd = c.startTime + c.durationMin / 60;
  if (route.endTime > plannedEnd + 0.5) {
    checks.push({ key: "schedule", label: "\u65F6\u95F4\u7A97\u53E3", status: "fail", detail: `\u9884\u8BA1 ${fmtH(route.endTime)} \u7ED3\u675F\uFF0C\u660E\u663E\u8D85\u51FA\u672C\u6B21 ${fmtH(plannedEnd)} \u5DE6\u53F3\u7684\u65F6\u95F4\u7A97\u53E3` });
  } else if (route.endTime > plannedEnd + 0.01) {
    checks.push({ key: "schedule", label: "\u65F6\u95F4\u7A97\u53E3", status: "warn", detail: `\u9884\u8BA1 ${fmtH(route.endTime)} \u7ED3\u675F\uFF0C\u7565\u8D85\u51FA\u672C\u6B21 ${fmtH(plannedEnd)} \u5DE6\u53F3\u7684\u65F6\u95F4\u7A97\u53E3` });
  }
  return checks;
}
function checkSummary(checks) {
  return {
    pass: checks.filter((c) => c.status === "pass").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length
  };
}

// lib/agent/repair.ts
function price(p) {
  return p.poi.perCapita ?? 0;
}
function durOf2(p) {
  return p.poi.avgDuration ?? 60;
}
function rebuild(picks, c, persona, seq) {
  const route = materializeRoute(picks, c, persona, seq);
  return { ...route, checks: validateRoute(route, c, persona) };
}
function names(route) {
  return route.stops.map((s) => s.poi.name).join(" \u2192 ");
}
function mealRequested(c) {
  return /吃饭|午饭|午餐|晚饭|晚餐|正餐|美食/.test(c.raw) || c.mustCategories.includes("dining");
}
function replacementPool(route, allScored, cat) {
  const used = new Set(route.stops.map((s) => s.poi.id));
  return allScored.filter((s) => s.poi.category === cat && !used.has(s.poi.id));
}
function canDropStop(picks, idx, c) {
  const stop = picks[idx];
  const minStops = c.pace === "relaxed" && c.durationMin <= 180 ? 2 : 3;
  if (picks.length <= minStops) return false;
  if (stop.poi.category === "dining" && mealRequested(c)) return false;
  const remaining = picks.filter((_, i) => i !== idx);
  for (const cat of c.mustCategories) {
    if (!remaining.some((p) => p.poi.category === cat)) return false;
  }
  return true;
}
function openAtSlot(route, idx, cand) {
  const arrive = route.stops[idx]?.arrive;
  if (arrive == null) return true;
  const open = cand.poi.openHour ?? 0;
  const close = cand.poi.closeHour ?? 24;
  return arrive >= open - 0.01 && arrive + durOf2(cand) / 60 <= close + 0.01;
}
function preferSort(cands, prefer) {
  if (prefer === "cheaper") return [...cands].sort((a, b) => price(a) - price(b) || b.score - a.score);
  if (prefer === "higher_rated") return [...cands].sort((a, b) => (b.poi.rating ?? 0) - (a.poi.rating ?? 0) || b.score - a.score);
  return [...cands].sort((a, b) => b.score - a.score);
}
function repairIfNeeded(route, constraints, persona, allScored, opts = {}) {
  const prefer = opts.prefer ?? null;
  let current = route;
  const logs = [];
  const maxRounds = constraints.budgetPerCapita != null ? 5 : 2;
  for (let round = 1; round <= maxRounds; round++) {
    const budgetIssue = constraints.budgetPerCapita != null && current.totalCost > constraints.budgetPerCapita ? current.checks.find((k) => k.key === "budget") : void 0;
    const issue = budgetIssue ?? current.checks.find((k) => k.status === "fail");
    if (!issue) break;
    const before = names(current);
    let picks = current.stops.map((s) => ({
      poi: s.poi,
      score: 0,
      reasons: s.reasons,
      sources: s.sources
    }));
    picks = picks.map((p) => allScored.find((s) => s.poi.id === p.poi.id) ?? p);
    let action = "";
    if (issue.key === "budget") {
      const sortedByPrice = picks.map((pick, idx) => ({ pick, idx })).sort((a, b) => price(b.pick) - price(a.pick));
      let patch = null;
      for (const { pick, idx } of sortedByPrice) {
        const repl = replacementPool(current, allScored, pick.poi.category).filter((s) => price(s) < price(pick) && openAtSlot(current, idx, s)).sort((a, b) => price(a) - price(b) || b.score - a.score)[0];
        if (repl) {
          patch = { idx, old: pick, repl, mode: "same" };
          break;
        }
      }
      if (!patch) {
        const drop = sortedByPrice.find(({ idx }) => canDropStop(picks, idx, constraints));
        if (drop) patch = { idx: drop.idx, old: drop.pick, mode: "drop" };
      }
      if (!patch) {
        logs.push({ round, trigger: issue.label, action: "\u8BE5\u533A\u57DF\u5185\u5DF2\u65E0\u66F4\u4F4E\u4EF7\u5019\u9009\uFF0C\u5EFA\u8BAE\u63D0\u9AD8\u9884\u7B97\u6216\u51CF\u5C11\u7AD9\u70B9", before, after: before, resolved: false });
        break;
      }
      if (patch.mode === "drop") {
        picks = picks.filter((_, idx) => idx !== patch.idx);
        action = `\u9884\u7B97\u8D85\u9650\uFF0C\u79FB\u9664\u975E\u5FC5\u8981\u7AD9\u300C${patch.old.poi.name}\u300D`;
      } else if (patch.repl) {
        picks[patch.idx] = patch.repl;
        action = `\u9884\u7B97\u8D85\u9650\uFF0C\u5C06\u300C${patch.old.poi.name}\u300D\u6362\u6210\u66F4\u4F4E\u4EF7\u300C${patch.repl.poi.name}\u300D`;
      }
    } else if (issue.key === "open") {
      const victim = current.stops.find((s) => issue.detail.includes(s.poi.name));
      if (!victim) break;
      const idx = current.stops.findIndex((s) => s.poi.id === victim.poi.id);
      const arrive = victim.arrive;
      const openCands = replacementPool(current, allScored, victim.poi.category).filter((s) => arrive >= (s.poi.openHour ?? 0) && arrive + durOf2(s) / 60 <= (s.poi.closeHour ?? 24));
      const repl = preferSort(openCands, prefer)[0];
      if (!repl) {
        logs.push({ round, trigger: issue.label, action: "\u672A\u627E\u5230\u8425\u4E1A\u65F6\u95F4\u5339\u914D\u7684\u540C\u7C7B\u5019\u9009", before, after: before, resolved: false });
        break;
      }
      picks[idx] = repl;
      action = `\u8425\u4E1A\u65F6\u95F4\u51B2\u7A81\uFF0C\u5C06\u300C${victim.poi.name}\u300D\u66FF\u6362\u4E3A\u540C\u7C7B\u53EF\u8425\u4E1A\u7684\u300C${repl.poi.name}\u300D`;
    } else if (issue.key === "count") {
      const used = new Set(picks.map((s) => s.poi.id));
      const add = allScored.find((s) => !used.has(s.poi.id));
      if (!add) break;
      picks.push(add);
      action = `POI \u6570\u4E0D\u8DB3\uFF0C\u8865\u5165\u9AD8\u5206\u5019\u9009\u300C${add.poi.name}\u300D`;
    } else {
      logs.push({ round, trigger: issue.label, action: "\u4FDD\u7559\u8DEF\u7EBF\uFF0C\u4EA4\u7ED9\u7528\u6237\u5C40\u90E8\u8C03\u6574", before, after: before, resolved: false });
      break;
    }
    current = rebuild(picks, constraints, persona, round);
    const after = names(current);
    const resolved = !current.checks.some((k) => k.key === issue.key && k.status !== "pass");
    logs.push({ round, trigger: issue.label, action, before, after, resolved });
  }
  return { route: current, logs };
}

// lib/agent/rank.ts
function rankRoutes(routes, c, persona) {
  const scored = routes.map((r) => {
    const sum = checkSummary(r.checks);
    const checkScore = sum.pass * 3 - sum.warn * 4 - sum.fail * 15;
    const actualMin = (r.endTime - c.startTime) * 60;
    const overrun = actualMin - c.durationMin;
    let paceScore = 0;
    if (c.pace === "relaxed") paceScore = -Math.abs(overrun) * 0.05;
    else if (c.pace === "packed") paceScore = overrun >= -30 ? 4 : -4;
    else paceScore = -Math.max(0, overrun - 30) * 0.05;
    const moveMin = r.totalWalkMin + r.totalTransitMin;
    const compactScore = -moveMin * 0.06;
    let budgetScore = 0;
    if (c.budgetPerCapita != null && c.budgetPerCapita > 0) {
      const ratio = r.totalCost / c.budgetPerCapita;
      budgetScore = ratio <= 1 ? 3 : -(ratio - 1) * 38 * (0.8 + persona.budgetSensitivity);
    }
    const rankScore = +(checkScore + paceScore + compactScore + budgetScore).toFixed(1);
    return { route: r, rankScore };
  });
  scored.sort((a, b) => b.rankScore - a.rankScore);
  return scored.map((s, i) => ({ ...s.route, id: `route-${i}` }));
}

// lib/agent/replan.ts
var CAT_WORDS = [
  { cat: "dining", words: ["\u9910\u5385", "\u996D\u5E97", "\u5403\u996D", "\u5403\u7684", "\u6B63\u9910", "\u672C\u5E2E", "\u83DC", "\u7F8E\u98DF", "\u9910"] },
  { cat: "cafe", words: ["\u5496\u5561", "\u5496\u5561\u9986", "\u4E0B\u5348\u8336", "\u5976\u8336", "\u8336"] },
  { cat: "culture", words: ["\u7F8E\u672F\u9986", "\u535A\u7269\u9986", "\u5C55\u9986", "\u5C55\u89C8", "\u4E66\u5E97", "\u56ED\u6797", "\u6587\u5316", "\u5C55"] },
  { cat: "entertainment", words: ["\u5A31\u4E50", "\u6F14\u51FA", "\u8BDD\u5267", "\u5267\u573A", "\u7535\u5F71", "\u5BC6\u5BA4", "\u684C\u6E38", "\u4E50\u56ED"] },
  { cat: "shopping", words: ["\u8D2D\u7269", "\u5546\u573A", "\u901B\u8857", "\u4E70"] },
  { cat: "nightscape", words: ["\u591C\u666F", "\u770B\u666F", "\u6C5F\u666F", "\u591C\u6E38", "\u89C2\u666F"] }
];
var CN_NUM = { \u4E00: 1, \u4E8C: 2, \u4E24: 2, \u4E09: 3, \u56DB: 4, \u4E94: 5, \u516D: 6, \u4E03: 7, \u516B: 8, \u4E5D: 9, \u5341: 10 };
function detectCategory(text) {
  for (const { cat, words } of CAT_WORDS) {
    if (words.some((w) => text.includes(w))) return cat;
  }
  return void 0;
}
function detectOrdinalIndex(text, length) {
  if (/最后(一)?(家|站|个|个地方)?/.test(text)) return Math.max(0, length - 1);
  if (/第一(家|站|个)?|头一(家|站|个)/.test(text)) return 0;
  const m = text.match(/第\s*([一二两三四五六七八九十]|\d+)\s*(?:家|站|个|处)/);
  if (m) {
    const n = CN_NUM[m[1]] ?? parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) return n - 1;
  }
  return void 0;
}
function indexOfCategory(prev, cat) {
  const i = prev.stops.findIndex((s) => s.poi.category === cat);
  return i >= 0 ? i : void 0;
}
function resolveTarget(text, prev, cat) {
  const ord = detectOrdinalIndex(text, prev.stops.length);
  if (ord != null && ord < prev.stops.length) return ord;
  if (cat) return indexOfCategory(prev, cat);
  return void 0;
}
var CRITERION = {
  cheaper: /便宜|实惠|省钱|低预算|更便宜|划算|性价比|不贵/,
  closer: /近一点|近点|更近|距离短|步行|少走|少坐车|少打车|不要太远|别太远/,
  higher: /评分(更)?高|高分|好评|口碑|更好|更高分|评分高/
};
function parseEditIntent(request, prev) {
  const raw = request.trim();
  const cat = detectCategory(raw);
  const bm = raw.match(/(?:预算|控制在|不超过)?\s*(?:降到|改成|调到|降低到|控制在|不超过|降至)\s*(\d{2,4})/) || (/预算/.test(raw) ? raw.match(/(\d{2,4})/) : null);
  if (bm && /预算|控制在|不超过|整体.*(\d)/.test(raw)) {
    return { op: "rebudget", newBudget: parseInt(bm[1], 10), raw };
  }
  const target = resolveTarget(raw, prev, cat);
  if (/去掉|删掉|删除|删|不要(这|那)|拿掉|去除/.test(raw)) {
    return { op: "remove", targetIndex: target, targetCategory: cat, raw };
  }
  if (/(再|多)?加(一?(家|个|站))|新增|添(一?(家|个))|补(一?(家|个|站))/.test(raw)) {
    return { op: "add", targetCategory: cat, targetIndex: target, raw };
  }
  if (CRITERION.cheaper.test(raw)) {
    return { op: "cheaper", targetIndex: target, targetCategory: cat, raw };
  }
  if (CRITERION.closer.test(raw)) {
    return { op: "closer", targetIndex: target, targetCategory: cat, raw };
  }
  if (CRITERION.higher.test(raw)) {
    return { op: "higher_rated", targetIndex: target, targetCategory: cat, raw };
  }
  if (/换|替换|改一(家|个)|换个|换成/.test(raw)) {
    return { op: "swap", targetIndex: target, targetCategory: cat, raw };
  }
  return { op: "swap", targetIndex: target, targetCategory: cat, raw };
}
var VALID_OPS = ["cheaper", "closer", "higher_rated", "swap", "remove", "add", "rebudget", "clarify"];
var VALID_CATS = ["dining", "cafe", "culture", "entertainment", "shopping", "nightscape"];
function editPrompt(request, prev, baseRequest) {
  const stops = prev.stops.map((s, i) => ({
    index: i,
    category: s.poi.category,
    name: s.poi.name,
    perCapita: s.poi.perCapita,
    rating: s.poi.rating
  }));
  return [
    { role: "system", content: [
      "\u4F60\u662F\u8DEF\u7EBF\u300C\u6539\u65B9\u6848\u300D\u7684\u51B3\u7B56\u8005\u3002\u7ED3\u5408\u3010\u539F\u59CB\u8BC9\u6C42 originalRequest\u3011+\u3010\u5F53\u524D\u8DEF\u7EBF currentPlan(\u6BCF\u7AD9\u542B index/\u7C7B\u76EE/\u4EBA\u5747/\u8BC4\u5206)\u3011+\u3010\u7528\u6237\u8FD9\u6B21\u7684\u4FEE\u6539\u8981\u6C42 modification\u3011,\u81EA\u5DF1\u5224\u65AD\u8BE5\u600E\u4E48\u6539\u3002\u53EA\u8F93\u51FA JSON\u3002",
      "\u5B57\u6BB5:",
      "- op: cheaper|closer|higher_rated|swap|remove|add|rebudget|clarify",
      '- **\u5F53\u4FEE\u6539\u8981\u6C42\u542B\u4E49\u4E0D\u660E\u3001\u65E0\u6CD5\u786E\u5B9A\u8981\u505A\u4EC0\u4E48\u65F6(\u4F8B\u5982"\u6539\u4E00\u4E0B/\u6362\u4E2A\u522B\u7684/\u4E0D\u592A\u6EE1\u610F"\u8FD9\u79CD\u6CA1\u65B9\u5411\u7684\u8BDD),\u4E0D\u8981\u786C\u731C:op \u8FD4\u56DE "clarify",\u5E76\u7ED9\u51FA question(\u7528\u4E00\u53E5\u8BDD\u95EE\u6E05\u7528\u6237\u60F3\u600E\u4E48\u6539)\u548C options(2-4 \u4E2A\u5177\u4F53\u3001\u53EF\u76F4\u63A5\u6267\u884C\u7684\u65B9\u5411,\u5982"\u7B2C1\u7AD9\u6362\u4FBF\u5B9C\u7684"/"\u53BB\u6389\u6700\u540E\u4E00\u7AD9"/"\u6574\u4F53\u6362\u66F4\u5B89\u9759\u7684")\u3002\u610F\u56FE\u6E05\u695A\u65F6\u4E0D\u8981\u7528 clarify\u3002**',
      "- targetIndex: \u8981\u6539/\u5220\u7684\u90A3\u4E00\u7AD9\u7684 0 \u8D77\u5E8F\u53F7\u3002**\u53EA\u8981 op \u4F5C\u7528\u5728\u67D0\u4E00\u7AD9\u4E0A(cheaper/closer/higher_rated/swap/remove),\u5C31\u5FC5\u987B\u7ED9\u51FA\u5177\u4F53 targetIndex,\u7EDD\u4E0D\u8FD4\u56DE null**\u3002\u7528\u6237\u6CA1\u70B9\u540D\u65F6,\u4F60\u7ED3\u5408\u539F\u59CB\u8BC9\u6C42\u81EA\u5DF1\u6311\u6700\u5408\u7406\u7684\u4E00\u7AD9:",
      '    \xB7 "\u5C11\u4E00\u7AD9/\u53BB\u6389\u4E00\u7AD9" \u2192 \u6311\u4E0E\u539F\u59CB\u8BC9\u6C42\u6700\u4E0D\u76F8\u5173\u3001\u6216\u540C\u7C7B\u91CC\u6700\u5197\u4F59/\u6700\u8D35\u7684\u90A3\u7AD9\u5220;',
      '    \xB7 "\u6362\u4FBF\u5B9C\u7684"\u6CA1\u8BF4\u54EA\u7AD9 \u2192 \u6311\u5F53\u524D\u6700\u8D35\u6216\u6700\u4E0D\u5FC5\u8981\u7684\u90A3\u7AD9;',
      '    \xB7 \u5E8F\u6570"\u7B2C\u4E8C/\u7B2C3/\u6700\u540E\u4E00\u5BB6"\u76F4\u63A5\u5BF9\u5E94 targetIndex\u3002',
      "- targetCategory: \u4EC5 add \u65F6\u7ED9\u76EE\u6807\u7C7B\u76EE(dining|cafe|culture|entertainment|shopping|nightscape),\u5426\u5219 null\u3002",
      "- newBudget: \u4EC5 rebudget \u65F6\u7ED9\u6570\u5B57\u3002",
      '\u8BED\u4E49\u5BF9\u5E94:"\u66F4\u4FBF\u5B9C/\u7701\u94B1"=cheaper;"\u66F4\u8FD1/\u5C11\u8D70/\u5C11\u6253\u8F66"=closer;"\u8BC4\u5206\u66F4\u9AD8/\u53E3\u7891\u66F4\u597D"=higher_rated;"\u6362\u4E00\u5BB6"=swap;"\u5C11\u4E00\u7AD9/\u53BB\u6389/\u5220\u6389"=remove;"\u52A0\u4E00\u7AD9/\u518D\u6765\u4E00\u4E2A"=add;"\u9884\u7B97\u6539\u6210X/\u63A7\u5236\u5728X\u5185"=rebudget\u3002'
    ].join("\n") },
    { role: "user", content: JSON.stringify({ originalRequest: baseRequest ?? null, currentPlan: stops, modification: request }) }
  ];
}
async function parseEditIntentLLM(request, prev, deps = {}) {
  const fallback2 = () => parseEditIntent(request, prev);
  if (!deps.chatJson) return fallback2();
  let llm = null;
  try {
    llm = await deps.chatJson(editPrompt(request, prev, deps.baseRequest));
  } catch {
    llm = null;
  }
  if (!llm || typeof llm !== "object" || !VALID_OPS.includes(llm.op)) return fallback2();
  const op = llm.op;
  if (op === "clarify") {
    const question = typeof llm.question === "string" && llm.question.trim() ? llm.question.trim() : "\u4F60\u60F3\u600E\u4E48\u6539\u8FD9\u6761\u8DEF\u7EBF?";
    const options = Array.isArray(llm.options) ? llm.options.map((o) => String(o)).filter(Boolean).slice(0, 4) : void 0;
    return { op, question, options, raw: request.trim() };
  }
  const targetIndex = Number.isInteger(llm.targetIndex) && llm.targetIndex >= 0 && llm.targetIndex < prev.stops.length ? llm.targetIndex : null;
  const targetCategory = VALID_CATS.includes(llm.targetCategory) ? llm.targetCategory : null;
  const newBudget = op === "rebudget" ? Number.isFinite(llm.newBudget) ? Number(llm.newBudget) : parseEditIntent(request, prev).newBudget : void 0;
  return { op, targetIndex, targetCategory, newBudget, raw: request.trim() };
}
var CAT_KEYWORD = {
  dining: ["\u9910\u5385", "\u7F8E\u98DF"],
  cafe: ["\u5496\u5561", "\u5496\u5561\u9986"],
  culture: ["\u535A\u7269\u9986", "\u5C55\u89C8", "\u4E66\u5E97"],
  entertainment: ["\u5267\u573A", "\u7535\u5F71\u9662"],
  shopping: ["\u5546\u573A", "\u8D2D\u7269\u4E2D\u5FC3"],
  nightscape: ["\u89C2\u666F", "\u591C\u666F"]
};
function replanKeywords(prev, cat) {
  const first = prev.stops[0]?.poi;
  const scope = first?.area || first?.city || "";
  return CAT_KEYWORD[cat].map((t) => scope ? `${scope} ${t}` : t).slice(0, 4);
}
function prevCenter(prev) {
  const n = Math.max(1, prev.stops.length);
  return {
    lat: prev.stops.reduce((s, st) => s + st.poi.lat, 0) / n,
    lng: prev.stops.reduce((s, st) => s + st.poi.lng, 0) / n
  };
}
function constraintsFromPrev(prev, persona, op) {
  const start = prev.stops[0]?.arrive ?? persona.latestEnd - 6;
  const durationMin = Math.max(120, Math.round((prev.endTime - start) * 60));
  const first = prev.stops[0]?.poi;
  const must = [...new Set(prev.stops.map((s) => s.poi.category))];
  return {
    city: first?.city ?? "",
    district: first?.area ?? null,
    startTime: start,
    durationMin,
    party: persona.partyDefault,
    budgetPerCapita: op.op === "rebudget" && op.newBudget != null ? op.newBudget : null,
    diningBudgetPerCapita: null,
    prefs: [],
    avoid: [],
    mustCategories: must,
    pace: persona.pace,
    personaId: persona.id,
    raw: op.raw
  };
}
function keptPick(stop) {
  return { poi: stop.poi, score: 0, reasons: stop.reasons, sources: stop.sources };
}
function chooseReplacement(op, current, pool, prev, targetIndex, usedIds) {
  const cat = current.poi.category;
  let cands = pool.filter((s) => s.poi.category === cat && s.poi.id !== current.poi.id && !usedIds.has(s.poi.id));
  if (cands.length === 0) return null;
  const cuisine = cuisineOf(current.poi);
  if (cuisine) {
    const sameKind = cands.filter((s) => cuisineOf(s.poi) === cuisine);
    if (sameKind.length > 0) cands = sameKind;
  }
  if (op.op === "cheaper") {
    const cur = current.poi.perCapita ?? Infinity;
    const cheaper = cands.filter((s) => (s.poi.perCapita ?? Infinity) < cur);
    return cheaper.sort((a, b) => (a.poi.perCapita ?? 0) - (b.poi.perCapita ?? 0) || b.score - a.score)[0] ?? null;
  }
  if (op.op === "higher_rated") {
    const cur = current.poi.rating ?? -Infinity;
    const higher = cands.filter((s) => (s.poi.rating ?? -Infinity) > cur);
    return higher.sort((a, b) => (b.poi.rating ?? 0) - (a.poi.rating ?? 0) || b.score - a.score)[0] ?? null;
  }
  if (op.op === "closer") {
    const neighbor = prev.stops[targetIndex - 1]?.poi ?? prev.stops[targetIndex + 1]?.poi;
    if (!neighbor) return cands.sort((a, b) => b.score - a.score)[0] ?? null;
    const curD = distBetween(current.poi, neighbor);
    const closer = cands.filter((s) => distBetween(s.poi, neighbor) < curD);
    return closer.sort((a, b) => distBetween(a.poi, neighbor) - distBetween(b.poi, neighbor) || b.score - a.score)[0] ?? null;
  }
  return cands.sort((a, b) => b.score - a.score)[0] ?? null;
}
function pickDropIndex(picks) {
  const counts = /* @__PURE__ */ new Map();
  for (const p of picks) counts.set(p.poi.category, (counts.get(p.poi.category) ?? 0) + 1);
  for (let i = picks.length - 1; i >= 0; i--) {
    if ((counts.get(picks[i].poi.category) ?? 0) > 1) return i;
  }
  return picks.length - 1;
}
function applyEdit(op, prev, scoredPool, constraints) {
  const picks = prev.stops.map(keptPick);
  const usedIds = new Set(picks.map((p) => p.poi.id));
  let idx = op.targetIndex;
  if (idx == null && op.targetCategory) {
    const found = prev.stops.findIndex((s) => s.poi.category === op.targetCategory);
    if (found >= 0) idx = found;
  }
  if (op.op === "remove") {
    if (picks.length <= 2) {
      return { picks, changed: false, note: "\u53EA\u5269\u4E24\u7AD9\uFF0C\u5220\u6389\u4F1A\u8BA9\u884C\u7A0B\u8FC7\u77ED\uFF0C\u5DF2\u4FDD\u7559\u539F\u7AD9\u70B9\u3002" };
    }
    let dropIdx = idx;
    if (dropIdx == null || dropIdx < 0 || dropIdx >= picks.length) {
      dropIdx = pickDropIndex(picks);
    }
    const removed = picks[dropIdx];
    picks.splice(dropIdx, 1);
    return { picks, changed: true, note: `\u5DF2\u53BB\u6389\u300C${removed.poi.name}\u300D\u8FD9\u4E00\u7AD9\u3002` };
  }
  if (op.op === "add") {
    const cat = op.targetCategory ?? "cafe";
    const add = scoredPool.filter((s) => s.poi.category === cat && !usedIds.has(s.poi.id)).sort((a, b) => b.score - a.score)[0];
    if (!add) {
      return { picks, changed: false, note: "\u8BE5\u533A\u57DF\u6CA1\u6709\u53EF\u8865\u5145\u7684\u771F\u5B9E\u5019\u9009\uFF0C\u65B9\u6848\u4FDD\u6301\u4E0D\u53D8\u3002" };
    }
    picks.push(add);
    return { picks, changed: true, note: `\u5DF2\u52A0\u5165\u4E00\u7AD9\u300C${add.poi.name}\u300D\u3002` };
  }
  if (op.op === "rebudget") {
    return { picks, changed: true, note: `\u5DF2\u628A\u6574\u4F53\u9884\u7B97\u8C03\u6574\u4E3A \xA5${op.newBudget}\uFF0C\u5E76\u5BF9\u8D85\u652F\u7AD9\u70B9\u964D\u6863\u3002` };
  }
  if (idx == null) {
    if (op.op === "cheaper") {
      idx = picks.reduce((best, p, i) => (p.poi.perCapita ?? 0) > (picks[best].poi.perCapita ?? 0) ? i : best, 0);
    } else if (op.op === "higher_rated") {
      idx = picks.reduce((best, p, i) => (p.poi.rating ?? 5) < (picks[best].poi.rating ?? 5) ? i : best, 0);
    } else {
      idx = 0;
    }
  }
  if (idx < 0 || idx >= picks.length) {
    return { picks, changed: false, note: "\u6CA1\u5B9A\u4F4D\u5230\u8981\u66FF\u6362\u7684\u7AD9\u70B9\uFF0C\u65B9\u6848\u4FDD\u6301\u4E0D\u53D8\u3002" };
  }
  const current = picks[idx];
  const repl = chooseReplacement(op, current, scoredPool, prev, idx, usedIds);
  if (!repl) {
    return { picks, changed: false, note: `\u6CA1\u6709\u627E\u5230\u66F4\u5408\u9002\u7684\u540C\u7C7B\u771F\u5B9E\u5019\u9009\uFF0C\u5DF2\u4FDD\u7559\u300C${current.poi.name}\u300D\u3002` };
  }
  picks[idx] = repl;
  return { picks, changed: true, note: `\u5DF2\u628A\u300C${current.poi.name}\u300D\u6362\u6210\u300C${repl.poi.name}\u300D\u3002` };
}
var CUISINE_MARKERS = [
  "\u706B\u9505",
  "\u4E32\u4E32\u9999",
  "\u4E32\u4E32",
  "\u70E4\u9C7C",
  "\u70E7\u70E4",
  "\u70E4\u8089",
  "\u5C0F\u9F99\u867E",
  "\u6D77\u9C9C",
  "\u65E5\u6599",
  "\u5BFF\u53F8",
  "\u97E9\u9910",
  "\u70E4\u8089",
  "\u897F\u9910",
  "\u725B\u6392",
  "\u62AB\u8428",
  "brunch",
  "\u65E9\u5348\u9910",
  "\u5DDD\u83DC",
  "\u6E58\u83DC",
  "\u7CA4\u83DC",
  "\u672C\u5E2E\u83DC",
  "\u6C5F\u6D59\u83DC",
  "\u4E1C\u5317\u83DC",
  "\u9762\u9986",
  "\u7C73\u7EBF",
  "\u5192\u83DC",
  "\u94B5\u94B5\u9E21",
  "\u5C0F\u5403",
  "\u8336\u9910\u5385",
  "\u9152\u9986",
  "\u5C45\u9152\u5C4B",
  "\u6E05\u5427",
  "\u7CBE\u917F",
  "\u9152\u5427",
  "\u5496\u5561",
  "\u8336\u996E",
  "\u751C\u54C1",
  "\u70D8\u7119",
  "\u4E66\u5E97",
  "\u7F8E\u672F\u9986",
  "\u535A\u7269\u9986",
  "\u5267\u573A",
  "\u5F71\u9662"
];
function cuisineOf(poi) {
  for (const m of CUISINE_MARKERS) if (poi.name.includes(m)) return m;
  return null;
}
function keywordsForEdit(op, prev) {
  let cat = op.targetCategory;
  let targetIdx = op.targetIndex;
  if (cat == null && targetIdx == null && op.op === "cheaper") {
    targetIdx = prev.stops.reduce((best, s, idx) => (s.poi.perCapita ?? 0) > (prev.stops[best].poi.perCapita ?? 0) ? idx : best, 0);
  }
  if (!cat && targetIdx != null) cat = prev.stops[targetIdx]?.poi.category;
  if (op.op === "rebudget") {
    const cats = [...new Set(prev.stops.filter((s) => (s.poi.perCapita ?? 0) > 0).map((s) => s.poi.category))];
    return [...new Set(cats.flatMap((c) => replanKeywords(prev, c)))].slice(0, 8);
  }
  if (!cat) cat = prev.stops[0]?.poi.category ?? "dining";
  const target = targetIdx != null ? prev.stops[targetIdx]?.poi : null;
  const cuisine = target ? cuisineOf(target) : null;
  const generic = replanKeywords(prev, cat);
  if (!cuisine) return generic;
  const scope = prev.stops[0]?.poi.area || prev.stops[0]?.poi.city || "";
  const scoped = scope ? `${scope} ${cuisine}` : cuisine;
  return [.../* @__PURE__ */ new Set([scoped, cuisine, ...generic])].slice(0, 4);
}

// lib/agent/loop.ts
function stage(key, label, status, extra = {}) {
  return { type: "stage", key, label, status, ...extra };
}
function toContractPOI(p) {
  const { sceneTags, avgDuration, ...rest } = p;
  return rest;
}
function stripScored(s) {
  return { ...s, poi: toContractPOI(s.poi) };
}
function stripRoute(r) {
  return { ...r, stops: r.stops.map((st) => ({ ...st, poi: toContractPOI(st.poi) })) };
}
async function* planFromCandidates(candidates, constraints, persona, req, identity, deps, opts = {}) {
  const amapStatus = opts.amapStatus ?? "ok";
  if (candidates.length < 2) {
    yield { type: "error", code: "insufficient-data", message: "\u771F\u5B9E\u5019\u9009\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u7EC4\u6210\u8DEF\u7EBF\u3002", recoverable: true };
    return;
  }
  const center = opts.center ?? {
    lat: candidates.reduce((s, p) => s + p.lat, 0) / candidates.length,
    lng: candidates.reduce((s, p) => s + p.lng, 0) / candidates.length
  };
  yield stage("score", "\u6253\u5206", "running");
  const scored = scorePOIs(candidates, constraints, persona, center.lat, center.lng);
  yield stage("score", "\u6253\u5206", "ok");
  yield { type: "candidates", candidates: scored.map(stripScored) };
  yield stage("build", "\u7EC4\u5408\u8DEF\u7EBF", "running");
  const anchorCenter = opts.center ?? densestClusterCenter(candidates) ?? center;
  const { routes: built } = buildRouteCandidates(scored, constraints, persona, { anchorCenter });
  if (built.length === 0) {
    yield stage("build", "\u7EC4\u5408\u8DEF\u7EBF", "fail");
    yield { type: "error", code: "insufficient-data", message: "\u771F\u5B9E\u5019\u9009\u65E0\u6CD5\u7EC4\u6210\u6EE1\u8DB3\u7EA6\u675F\u7684\u8DEF\u7EBF\u3002", recoverable: true };
    return;
  }
  yield stage("build", "\u7EC4\u5408\u8DEF\u7EBF", "ok", { summary: `${built.length} \u6761\u5019\u9009` });
  yield stage("validate", "\u4F53\u68C0", "running");
  const validated = built.map((r) => ({ ...r, checks: validateRoute(r, constraints, persona) }));
  yield stage("validate", "\u4F53\u68C0", "ok");
  yield stage("repair", "\u4FEE\u590D", "running");
  const repaired = validated.map((r) => repairIfNeeded(r, constraints, persona, scored).route);
  yield stage("repair", "\u4FEE\u590D", "ok");
  const ranked = rankRoutes(repaired, constraints, persona);
  let best = ranked[0];
  if (deps.attachLegs && best) {
    const routed = await deps.attachLegs(best);
    best = { ...routed, id: best.id, checks: validateRoute(routed, constraints, persona) };
  }
  yield { type: "route", route: stripRoute(best) };
  yield stage("explain", "\u5199\u63A8\u8350\u7406\u7531", "running");
  let explanation = "";
  for await (const delta of deps.streamExplanation(best, constraints)) {
    explanation += delta;
    yield { type: "explanation", routeId: best.id, delta };
  }
  yield stage("explain", "\u5199\u63A8\u8350\u7406\u7531", "ok");
  const finalRoutes = ranked.map((r, i) => i === 0 ? { ...best, explanation } : r);
  const dataSources = {
    amapPoi: { configured: true, used: amapStatus === "ok", status: amapStatus },
    amapRoute: { configured: true, used: Boolean(deps.attachLegs) && best.stops.length > 1, status: "ok" },
    deepseek: { configured: !!explanation, used: !!explanation, status: explanation ? "ok" : "fallback" },
    cache: { hits: opts.cacheHits ?? 0, misses: opts.cacheMisses ?? 0 }
  };
  const planId = deps.planId();
  const savedRoutes = finalRoutes.map(stripRoute);
  await deps.savePlan({
    id: planId,
    userId: identity.userId,
    deviceToken: identity.deviceToken,
    request: req.request,
    constraints,
    routes: savedRoutes,
    dataSources
  });
  yield { type: "done", planId, routes: savedRoutes, dataSources };
}
async function* runPlanLoop(req, identity, deps) {
  const persona = personaFor(req.preferences.personaPick);
  if (req.previousPlan != null && req.previousPlan.stops.length >= 2) {
    yield* runReplanLoop(req, req.previousPlan, identity, deps, persona);
    return;
  }
  yield stage("resolve", "\u5B9A\u4F4D\u57CE\u5E02", "running");
  const loc = await deps.resolveLocation(req.request);
  if (loc.status !== "resolved" || !loc.city) {
    yield stage("resolve", "\u5B9A\u4F4D\u57CE\u5E02", "fail");
    yield { type: "error", code: "needs-clarification", message: loc.message || "\u9700\u8981\u8865\u5145\u5177\u4F53\u57CE\u5E02\u6216\u533A\u57DF\uFF0C\u672A\u9ED8\u8BA4\u56DE\u9000\u3002", recoverable: true };
    return;
  }
  yield stage("resolve", "\u5B9A\u4F4D\u57CE\u5E02", "ok", { summary: loc.city });
  yield stage("understand", "\u8BFB\u61C2\u9700\u6C42", "running");
  const understood = await deps.understand(req.request, loc, persona, req.preferences);
  const constraints = understood.constraints;
  yield stage("understand", "\u8BFB\u61C2\u9700\u6C42", "ok", { summary: understood.llmUsed ? "LLM \u89E3\u6790" : "\u89C4\u5219\u89E3\u6790" });
  yield { type: "constraints", constraints };
  let anchorCenter = null;
  if (understood.anchor && deps.resolveAnchor) {
    anchorCenter = await deps.resolveAnchor(understood.anchor, loc.city).catch(() => null);
  }
  if (!anchorCenter && loc.center) anchorCenter = loc.center;
  yield stage("retrieve", "\u53EC\u56DE\u771F\u5B9E\u5730\u70B9", "running");
  const retrieved = await deps.retrieve(understood.keywords, {
    ...loc,
    district: loc.district ?? constraints.district,
    anchorCenter: anchorCenter ?? void 0
  });
  if (retrieved.pois.length < 2) {
    yield stage("retrieve", "\u53EC\u56DE\u771F\u5B9E\u5730\u70B9", "fail");
    if (retrieved.amapStatus === "error" || retrieved.amapStatus === "not_configured") {
      yield { type: "error", code: "upstream-unavailable", message: "\u9AD8\u5FB7 POI \u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF0C\u672A\u7F16\u9020\u5730\u70B9\u3002", recoverable: true };
    } else {
      yield { type: "error", code: "insufficient-data", message: "\u8BE5\u533A\u57DF\u771F\u5B9E\u5730\u70B9\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u7EC4\u6210\u8DEF\u7EBF\u3002", recoverable: true };
    }
    return;
  }
  yield stage("retrieve", "\u53EC\u56DE\u771F\u5B9E\u5730\u70B9", "ok", { summary: `${retrieved.pois.length} \u5BB6\u771F\u5B9E\u5E97` });
  yield* planFromCandidates(retrieved.pois, constraints, persona, req, identity, deps, {
    amapStatus: retrieved.amapStatus,
    cacheHits: retrieved.cacheHits,
    cacheMisses: retrieved.cacheMisses,
    center: anchorCenter ?? loc.center ?? void 0
  });
}
async function* runReplanLoop(req, previousPlan, identity, deps, persona) {
  yield stage("understand", "\u8BFB\u61C2\u4FEE\u6539\u9700\u6C42", "running");
  const planDesc = previousPlan.stops.map((s, i) => `${i + 1}.${s.poi.name}${s.poi.perCapita != null ? `(\xA5${s.poi.perCapita})` : ""}`).join("  ");
  yield { type: "thought", text: `\u539F\u8BA1\u5212\u300C${req.baseRequest || "\u4E4B\u524D\u7684\u5B89\u6392"}\u300D:${planDesc}\u3002\u7528\u6237\u73B0\u5728\u60F3:${req.request}\u3002\u5148\u5B9A\u4F4D\u6539\u54EA\u4E00\u7AD9\u3001\u6309\u4EC0\u4E48\u6807\u51C6\u6362\u3002` };
  const op = deps.editChatJson ? await parseEditIntentLLM(req.request, previousPlan, { chatJson: deps.editChatJson, baseRequest: req.baseRequest }) : parseEditIntent(req.request, previousPlan);
  if (op.op === "clarify") {
    yield { type: "thought", text: `\u8FD9\u6761\u4FEE\u6539\u6211\u4E0D\u592A\u786E\u5B9A\u5177\u4F53\u60F3\u600E\u4E48\u6539:${req.request}\u3002\u5148\u95EE\u6E05\u695A\u518D\u52A8\u624B\u3002` };
    yield stage("understand", "\u8BFB\u61C2\u4FEE\u6539\u9700\u6C42", "ok", { summary: "\u9700\u8981\u4F60\u8BF4\u6E05\u695A" });
    yield { type: "question", conversationId: deps.planId(), question: op.question || "\u4F60\u60F3\u600E\u4E48\u6539\u8FD9\u6761\u8DEF\u7EBF?", ...op.options ? { options: op.options } : {} };
    return;
  }
  const constraints = constraintsFromPrev(previousPlan, persona, op);
  const tgtIdx = op.targetIndex ?? (op.targetCategory ? previousPlan.stops.findIndex((s) => s.poi.category === op.targetCategory) : -1);
  const tgtName = tgtIdx >= 0 ? previousPlan.stops[tgtIdx]?.poi.name : null;
  const OP_CN = { cheaper: "\u66F4\u4FBF\u5B9C", closer: "\u66F4\u8FD1", higher_rated: "\u8BC4\u5206\u66F4\u9AD8", swap: "\u6362\u4E00\u5BB6", remove: "\u53BB\u6389", add: "\u52A0\u4E00\u7AD9", rebudget: "\u8C03\u6574\u9884\u7B97" };
  yield { type: "thought", text: op.op === "remove" ? `\u51B3\u5B9A:\u53BB\u6389${tgtName ? `\u300C${tgtName}\u300D` : "\u4E00\u7AD9"},\u5176\u4F59\u4FDD\u7559\u3002` : op.op === "add" ? "\u51B3\u5B9A:\u52A0\u4E00\u7AD9,\u5176\u4F59\u4FDD\u7559\u3002" : op.op === "rebudget" ? `\u51B3\u5B9A:\u9884\u7B97\u8C03\u5230 \xA5${op.newBudget},\u5BF9\u8D85\u652F\u7AD9\u964D\u6863\u3002` : `\u51B3\u5B9A:\u628A${tgtName ? `\u7B2C${tgtIdx + 1}\u7AD9\u300C${tgtName}\u300D` : "\u76EE\u6807\u7AD9"}\u6362\u6210${OP_CN[op.op]}\u7684,\u5176\u4F59\u4FDD\u7559\u3002` };
  yield stage("understand", "\u8BFB\u61C2\u4FEE\u6539\u9700\u6C42", "ok", { summary: `${OP_CN[op.op] ?? op.op}${tgtName ? ` \xB7 \u7B2C${tgtIdx + 1}\u7AD9` : ""}` });
  yield { type: "constraints", constraints };
  const center = prevCenter(previousPlan);
  const loc = { city: constraints.city, district: constraints.district, center };
  yield stage("retrieve", "\u53EC\u56DE\u66FF\u6362\u5019\u9009", "running");
  let pool = [];
  let amapStatus = "ok";
  let cacheHits = 0;
  let cacheMisses = 0;
  const needsRetrieve = op.op !== "remove";
  if (needsRetrieve) {
    const kws = keywordsForEdit(op, previousPlan);
    yield { type: "action", tool: "searchPOI", args: kws.join("\u3001") };
    const retrieved = await deps.retrieve(kws, loc);
    pool = retrieved.pois;
    amapStatus = retrieved.amapStatus;
    cacheHits = retrieved.cacheHits;
    cacheMisses = retrieved.cacheMisses;
    if (pool.length === 0 && (amapStatus === "error" || amapStatus === "not_configured")) {
      yield stage("retrieve", "\u53EC\u56DE\u66FF\u6362\u5019\u9009", "fail");
      yield { type: "error", code: "upstream-unavailable", message: "\u9AD8\u5FB7 POI \u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF0C\u672A\u7F16\u9020\u66FF\u6362\u5730\u70B9\u3002", recoverable: true };
      return;
    }
    yield { type: "observation", summary: `\u547D\u4E2D ${pool.length} \u5BB6\u771F\u5B9E\u66FF\u6362\u5019\u9009`, count: pool.length };
    yield stage("retrieve", "\u53EC\u56DE\u66FF\u6362\u5019\u9009", "ok", { summary: `${pool.length} \u5BB6\u771F\u5B9E\u5019\u9009` });
  } else {
    yield stage("retrieve", "\u53EC\u56DE\u66FF\u6362\u5019\u9009", "skip");
  }
  yield stage("score", "\u6253\u5206", "running");
  const scoredPool = scorePOIs(pool, constraints, persona, center.lat, center.lng);
  yield stage("score", "\u6253\u5206", "ok");
  yield stage("build", "\u6539\u65B9\u6848", "running");
  const { picks, changed, note } = applyEdit(op, previousPlan, scoredPool, constraints);
  if (picks.length < 2) {
    yield stage("build", "\u6539\u65B9\u6848", "fail");
    yield { type: "error", code: "insufficient-data", message: "\u4FEE\u6539\u540E\u884C\u7A0B\u8FC7\u77ED\uFF0C\u65E0\u6CD5\u6210\u884C\u3002", recoverable: true };
    return;
  }
  const buildSummary = !changed ? note : op.op === "remove" || op.op === "rebudget" ? note : op.op === "add" ? "\u5DF2\u52A0\u4E00\u7AD9" : `\u5DF2\u66F4\u65B0\u7B2C${tgtIdx + 1}\u7AD9`;
  yield stage("build", "\u6539\u65B9\u6848", changed ? "ok" : "skip", { summary: buildSummary });
  let route = materializeRoute(picks, constraints, persona, 0);
  yield stage("validate", "\u4F53\u68C0", "running");
  route = { ...route, checks: validateRoute(route, constraints, persona) };
  yield stage("validate", "\u4F53\u68C0", "ok");
  yield stage("repair", "\u4FEE\u590D", "running");
  const repairPool = [...picks.map((p) => ({ ...p })), ...scoredPool];
  const repairPrefer = op.op === "cheaper" ? "cheaper" : op.op === "higher_rated" ? "higher_rated" : null;
  route = repairIfNeeded(route, constraints, persona, repairPool, { prefer: repairPrefer }).route;
  yield stage("repair", "\u4FEE\u590D", "ok");
  const ranked = rankRoutes([route], constraints, persona);
  let best = ranked[0];
  if (deps.attachLegs && best) {
    const routed = await deps.attachLegs(best);
    best = { ...routed, id: best.id, checks: validateRoute(routed, constraints, persona) };
  }
  yield { type: "route", route: stripRoute(best) };
  if (changed && (op.op === "cheaper" || op.op === "higher_rated" || op.op === "closer" || op.op === "swap") && tgtIdx >= 0 && tgtIdx < best.stops.length) {
    const after = best.stops[tgtIdx]?.poi;
    const before = previousPlan.stops[tgtIdx]?.poi;
    if (after && before && after.id !== before.id) {
      const priceCmp = op.op === "cheaper" && before.perCapita != null && after.perCapita != null ? `(\xA5${before.perCapita} \u2192 \xA5${after.perCapita}${after.perCapita < before.perCapita ? ",\u66F4\u7701" : ""})` : op.op === "higher_rated" && before.rating != null && after.rating != null ? `(${before.rating}\u5206 \u2192 ${after.rating}\u5206)` : after.perCapita != null ? `(\xA5${after.perCapita})` : "";
      yield { type: "thought", text: `\u7B2C${tgtIdx + 1}\u7AD9\u5DF2\u6362\u6210\u300C${after.name}\u300D${priceCmp},\u5176\u4F59\u7AD9\u4FDD\u7559\u3002` };
    }
  } else if (changed && op.op === "add") {
    const prevIds = new Set(previousPlan.stops.map((s) => s.poi.id));
    const added = best.stops.find((s) => !prevIds.has(s.poi.id))?.poi;
    if (added) yield { type: "thought", text: `\u5DF2\u52A0\u4E00\u7AD9\u300C${added.name}\u300D${added.perCapita != null ? `(\xA5${added.perCapita})` : ""},\u5176\u4F59\u7AD9\u4FDD\u7559\u3002` };
  }
  yield stage("explain", "\u5199\u63A8\u8350\u7406\u7531", "running");
  let explanation = "";
  for await (const delta of deps.streamExplanation(best, constraints)) {
    explanation += delta;
    yield { type: "explanation", routeId: best.id, delta };
  }
  yield stage("explain", "\u5199\u63A8\u8350\u7406\u7531", "ok");
  const finalRoutes = ranked.map((r, i) => i === 0 ? { ...r, explanation } : r);
  const dataSources = {
    amapPoi: { configured: true, used: amapStatus === "ok" && needsRetrieve, status: amapStatus },
    amapRoute: { configured: true, used: best.stops.some((s) => s.legFromPrev?.mode === "walk"), status: "ok" },
    deepseek: { configured: !!explanation, used: !!explanation, status: explanation ? "ok" : "fallback" },
    cache: { hits: cacheHits, misses: cacheMisses }
  };
  const planId = deps.planId();
  const savedRoutes = finalRoutes.map(stripRoute);
  await deps.savePlan({
    id: planId,
    userId: identity.userId,
    deviceToken: identity.deviceToken,
    request: req.request,
    constraints,
    routes: savedRoutes,
    dataSources
  });
  yield { type: "done", planId, routes: savedRoutes, dataSources };
}

// lib/agent/react.ts
var MAX_STEPS = 4;
var TOOLS_DOC = `\u4F60\u662F\u4E00\u4E2A\u51FA\u884C\u89C4\u5212 agent\uFF0C\u7528 ReAct(\u63A8\u7406\u2192\u884C\u52A8\u2192\u89C2\u5BDF)\u65B9\u5F0F\u5DE5\u4F5C\u3002\u6BCF\u4E00\u6B65\u53EA\u8F93\u51FA\u4E00\u4E2A\u4E25\u683C JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u4EFB\u4F55\u591A\u4F59\u6587\u5B57:
{"thought":"\u4F60\u7684\u63A8\u7406","action":{"tool":"searchPOI|askUser|finish","args":{...}}}
\u5DE5\u5177:
- searchPOI: \u5728\u5DF2\u5B9A\u4F4D\u57CE\u5E02\u641C\u771F\u5B9E\u5730\u70B9\u3002args:{"keywords":["\u5173\u952E\u8BCD1","\u5173\u952E\u8BCD2",...],"district":"\u53EF\u9009\u533A\u53BF"}\u3002**\u4E00\u5F00\u59CB\u5C31\u628A\u6240\u6709\u76F8\u4E92\u72EC\u7ACB\u3001\u80FD\u786E\u5B9A\u7684\u641C\u7D22\u8BCD\u4E00\u6B21\u6027\u653E\u8FDB keywords \u6570\u7EC4**(\u5B83\u4EEC\u4F1A\u5E76\u884C\u6267\u884C,\u8FDC\u5FEB\u4E8E\u4E00\u6B65\u4E00\u4E2A);\u53EA\u6709\u9700\u8981\u6839\u636E\u4E0A\u4E00\u6B65\u7ED3\u679C\u518D\u8C03\u6574\u65F6\u624D\u8FFD\u52A0\u65B0\u7684 searchPOI\u3002\u4E5F\u517C\u5BB9\u5355\u4E2A {"keyword":"..."}\u3002
- askUser: \u4EC5\u5F53\u7528\u6237\u610F\u56FE\u672C\u8EAB\u7F3A\u5931\u3001\u641C\u7D22\u4E5F\u65E0\u4ECE\u4E0B\u624B\u65F6\u624D\u53CD\u95EE\u3002args:{"question":"\u95EE\u9898","options":["\u53EF\u9009\u9879..."]}\u3002\u95EE\u5B8C\u5373\u6682\u505C\u7B49\u5F85\u3002
- finish: \u5DF2\u6709\u8DB3\u591F\u771F\u5B9E\u5019\u9009,\u4EA7\u51FA\u65B9\u6848\u3002args:{}\u3002
\u7EA6\u675F: \u5019\u9009\u53EA\u80FD\u6765\u81EA searchPOI \u7684\u771F\u5B9E\u7ED3\u679C,\u4E0D\u8981\u7F16\u9020\u5730\u70B9\u3002
\u53CD\u95EE\u94C1\u5F8B(askUser \u662F\u6700\u540E\u624B\u6BB5,\u5148\u641C\u518D\u8BF4):
- **\u7F3A\u5177\u4F53\u533A\u57DF/\u5546\u5708/\u8857\u9053/\u5E97\u540D,\u7EDD\u4E0D\u662F\u53CD\u95EE\u7684\u7406\u7531**\u2014\u2014searchPOI \u80FD\u5728\u5168\u5E02\u6216\u4EFB\u4E00\u533A\u57DF\u76F4\u63A5\u641C,\u8BE5\u641C\u5C31\u641C,\u522B\u95EE\u7528\u6237"\u5728\u54EA\u4E2A\u533A""\u54EA\u6761\u8857"\u3002
- \u57CE\u5E02\u5DF2\u5B9A\u4F4D\u3001\u5FC5\u53BB\u7C7B\u76EE\u5DF2\u77E5,\u5C31\u76F4\u63A5 searchPOI;\u641C\u4E0D\u5230\u518D\u6362\u5173\u952E\u8BCD\u641C,\u800C\u4E0D\u662F\u95EE\u7528\u6237\u3002
- \u53EA\u6709\u5F53"\u7528\u6237\u5230\u5E95\u60F3\u8981\u4EC0\u4E48"\u8FD9\u4E00\u5C42\u90FD\u4E0D\u660E(\u4F8B\u5982\u5B8C\u5168\u6CA1\u7ED9\u57CE\u5E02\u3001\u6216\u8BC9\u6C42\u7B3C\u7EDF\u5230\u65E0\u6CD5\u843D\u6210\u4EFB\u4F55\u641C\u7D22\u8BCD)\u65F6,\u624D askUser,\u4E14\u4E00\u6B21\u95EE\u6E05\u3002
- \u62FF\u4E0D\u51C6\u65F6,\u9ED8\u8BA4"\u641C"\u800C\u4E0D\u662F"\u95EE"\u3002
\u6548\u7387\u94C1\u5F8B(\u6BCF\u6B21 LLM \u8C03\u7528\u90FD\u5F88\u6162,\u52A1\u5FC5\u9075\u5B88):
1. **\u7B2C\u4E00\u6B65\u5C31\u628A\u6240\u6709\u9700\u8981\u7684\u5173\u952E\u8BCD\u4E00\u6B21\u6027\u653E\u8FDB keywords \u5E76\u884C\u641C\u9F50**:**constraints.mustCategories \u91CC\u7684\u6BCF\u4E00\u4E2A\u7C7B\u76EE\u90FD\u5FC5\u987B\u6709\u5BF9\u5E94\u5173\u952E\u8BCD**(\u7528\u6237\u660E\u786E\u63D0\u5230\u7684"\u4E2D\u5348\u5403\u996D/\u559D\u5496\u5561/\u770B\u591C\u666F"\u7B49\u66F4\u4E0D\u80FD\u6F0F\u2014\u2014\u522B\u53EA\u641C\u4E3B\u8BC9\u6C42\u800C\u6F0F\u4E86\u914D\u5957\u7684\u5403\u996D),\u6BCF\u7C7B 1-2 \u4E2A\u8BCD\u3002
2. **\u53EA\u8981\u6BCF\u4E2A\u5FC5\u53BB\u7C7B\u76EE\u90FD\u5DF2\u6709\u5019\u9009,\u7ACB\u523B finish**\u2014\u2014\u901A\u5E38\u7B2C 2 \u6B65\u5C31\u8BE5 finish\u3002
3. **\u7EDD\u4E0D\u91CD\u590D\u641C\u7D22\u5DF2\u641C\u8FC7\u7684\u8BCD**;\u4E0D\u8981\u4E3A\u4E86"\u66F4\u5168"\u53CD\u590D\u641C\u540C\u4E49\u8BCD\u3002
4. \u53EA\u6709\u5F53\u67D0\u4E2A\u5FC5\u53BB\u7C7B\u76EE\u5B8C\u5168\u65E0\u5019\u9009\u65F6,\u624D\u8FFD\u52A0\u4E00\u6B21\u4E0D\u540C\u65B9\u5411\u7684\u641C\u7D22\u3002
\u6700\u591A ${MAX_STEPS} \u6B65,\u4F46\u76EE\u6807\u662F 2 \u6B65\u5185 finish\u3002`;
function systemPrompt(constraints, persona) {
  return `${TOOLS_DOC}
\u672C\u6B21\u8BF7\u6C42\u7EA6\u675F(\u5DF2\u89E3\u6790): ${JSON.stringify({
    city: constraints.city,
    district: constraints.district,
    startTime: constraints.startTime,
    durationMin: constraints.durationMin,
    party: constraints.party,
    diningBudget: constraints.diningBudgetPerCapita,
    prefs: constraints.prefs,
    mustCategories: constraints.mustCategories,
    persona: persona.id
  })}`;
}
function dedupeInto(into, pois) {
  let added = 0;
  for (const p of pois) {
    if (!into.has(p.id)) {
      into.set(p.id, p);
      added += 1;
    }
  }
  return added;
}
function ratingRange(pois) {
  const rs = pois.map((p) => p.rating).filter((r) => typeof r === "number");
  if (!rs.length) return "\u8BC4\u5206\u7F3A\u5931";
  return `\u8BC4\u5206 ${Math.min(...rs).toFixed(1)}~${Math.max(...rs).toFixed(1)}`;
}
function actionSummary(action) {
  const a = action?.args ?? {};
  if (action?.tool === "searchPOI") return [a.keyword, a.district].filter(Boolean).join(" / ") || "\u641C\u7D22";
  if (action?.tool === "askUser") return String(a.question ?? "\u53CD\u95EE");
  return "\u4EA7\u51FA\u65B9\u6848";
}
async function* runReactLoop(req, identity, deps) {
  const persona = personaFor(req.preferences.personaPick);
  let messages;
  let constraints;
  let city;
  let anchorCenter = null;
  const candById = /* @__PURE__ */ new Map();
  if (deps.priorState) {
    messages = [...deps.priorState.messages];
    constraints = deps.priorState.constraints;
    city = deps.priorState.city;
    anchorCenter = deps.priorState.anchorCenter ?? null;
    dedupeInto(candById, deps.priorState.candidates ?? []);
    if (req.answer) messages.push({ role: "user", content: `\u7528\u6237\u56DE\u7B54: ${req.answer}` });
  } else {
    yield stage2("resolve", "\u5B9A\u4F4D\u57CE\u5E02", "running");
    const loc = await deps.resolveLocation(req.request);
    if (loc.status !== "resolved" || !loc.city) {
      yield stage2("resolve", "\u5B9A\u4F4D\u57CE\u5E02", "fail");
      yield { type: "error", code: "needs-clarification", message: loc.message || "\u9700\u8981\u8865\u5145\u5177\u4F53\u57CE\u5E02\u6216\u533A\u57DF\uFF0C\u672A\u9ED8\u8BA4\u56DE\u9000\u3002", recoverable: true };
      return;
    }
    yield stage2("resolve", "\u5B9A\u4F4D\u57CE\u5E02", "ok", { summary: loc.city });
    yield stage2("understand", "\u8BFB\u61C2\u9700\u6C42", "running");
    const understood = await deps.understand(req.request, loc, persona, req.preferences);
    constraints = { ...understood.constraints, district: understood.constraints.district ?? loc.district ?? null };
    city = loc.city;
    if (understood.anchor && deps.resolveAnchor) {
      anchorCenter = await deps.resolveAnchor(understood.anchor, city).catch(() => null);
    }
    if (!anchorCenter && loc.center) anchorCenter = loc.center;
    yield stage2("understand", "\u8BFB\u61C2\u9700\u6C42", "ok", { summary: understood.llmUsed ? "LLM \u89E3\u6790" : "\u89C4\u5219\u89E3\u6790" });
    yield { type: "constraints", constraints };
    messages = [
      { role: "system", content: systemPrompt(constraints, persona) },
      { role: "user", content: `\u9700\u6C42: ${req.request}` }
    ];
  }
  let llmFailures = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    let decision = null;
    try {
      decision = await deps.chatJson(messages);
    } catch {
      decision = null;
    }
    const action = decision?.action;
    const tool = action?.tool;
    if (!decision || tool !== "searchPOI" && tool !== "askUser" && tool !== "finish") {
      llmFailures += 1;
      yield* fallback(req, identity, deps, persona, constraints, city, candById);
      return;
    }
    if (decision.thought) yield { type: "thought", text: String(decision.thought) };
    yield { type: "action", tool, args: actionSummary(action) };
    messages.push({ role: "assistant", content: JSON.stringify(decision) });
    if (tool === "searchPOI") {
      const district = action.args?.district ? String(action.args.district) : constraints.district ?? void 0;
      const kws = (Array.isArray(action.args?.keywords) ? action.args.keywords : [action.args?.keyword]).map((k) => String(k ?? "").trim()).filter(Boolean).slice(0, 6);
      const results = await Promise.all(
        kws.map((k) => deps.searchPOI(k, district, anchorCenter ?? void 0).catch(() => []))
      );
      const found = results.flat();
      const added = dedupeInto(candById, found);
      const head = kws.length > 1 ? `\u5E76\u884C\u641C\u300C${kws.join("\u3001")}\u300D: ` : "";
      const summary = found.length ? `${head}\u547D\u4E2D ${found.length} \u5BB6(\u65B0\u589E ${added}),${ratingRange(found)},\u7D2F\u8BA1 ${candById.size}` : `${head}\u65E0\u547D\u4E2D,\u7D2F\u8BA1 ${candById.size}`;
      yield { type: "observation", summary, count: found.length };
      messages.push({ role: "user", content: `\u89C2\u5BDF: ${summary}` });
      continue;
    }
    if (tool === "askUser") {
      const question = String(action.args?.question ?? "\u9700\u8981\u66F4\u591A\u4FE1\u606F").trim();
      const options = Array.isArray(action.args?.options) ? action.args.options.map((o) => String(o)).slice(0, 6) : void 0;
      const id = deps.conversationId();
      const owner = identity.userId != null ? String(identity.userId) : identity.deviceToken;
      const state = { messages, candidates: [...candById.values()], constraints, city, anchorCenter };
      try {
        await deps.saveConversation(id, owner, state);
      } catch {
      }
      yield { type: "question", conversationId: id, question, ...options ? { options } : {} };
      return;
    }
    yield* finishWith(candById, constraints, persona, req, identity, deps, false, anchorCenter);
    return;
  }
  if (candById.size >= 2) {
    yield { type: "thought", text: `\u5DF2\u8FBE\u6700\u5927\u6B65\u6570,\u7528\u5F53\u524D ${candById.size} \u5BB6\u771F\u5B9E\u5019\u9009\u76F4\u63A5\u51FA\u65B9\u6848\u3002` };
    yield* finishWith(candById, constraints, persona, req, identity, deps, true, anchorCenter);
    return;
  }
  yield* fallback(req, identity, deps, persona, constraints, city, candById, anchorCenter);
}
function stage2(key, label, status, extra = {}) {
  return { type: "stage", key, label, status, ...extra };
}
async function* finishWith(candById, constraints, persona, req, identity, deps, forced = false, anchorCenter = null) {
  const candidates = [...candById.values()];
  yield* planFromCandidates(
    candidates,
    constraints,
    persona,
    req,
    { deviceToken: identity.deviceToken, userId: identity.userId },
    { streamExplanation: deps.streamExplanation, savePlan: deps.savePlan, planId: deps.planId },
    { amapStatus: "ok", forced, center: anchorCenter ?? void 0 }
  );
}
async function* fallback(req, identity, deps, persona, constraints, city, candById, anchorCenter = null) {
  const loc = { city, district: constraints.district ?? null, center: anchorCenter ?? void 0 };
  yield stage2("retrieve", "\u53EC\u56DE\u771F\u5B9E\u5730\u70B9", "running");
  let retrieved;
  try {
    const understood = await deps.understand(req.request, loc, persona, req.preferences);
    retrieved = await deps.retrieve(understood.keywords, {
      ...loc,
      district: understood.constraints.district ?? loc.district,
      anchorCenter: anchorCenter ?? void 0
    });
  } catch {
    retrieved = { pois: [], center: { lat: 0, lng: 0 }, cacheHits: 0, cacheMisses: 0, amapStatus: "error" };
  }
  dedupeInto(candById, retrieved.pois);
  const merged = [...candById.values()];
  if (merged.length < 2) {
    yield stage2("retrieve", "\u53EC\u56DE\u771F\u5B9E\u5730\u70B9", "fail");
    if (retrieved.amapStatus === "error" || retrieved.amapStatus === "not_configured") {
      yield { type: "error", code: "upstream-unavailable", message: "\u9AD8\u5FB7 POI \u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF0C\u672A\u7F16\u9020\u5730\u70B9\u3002", recoverable: true };
    } else {
      yield { type: "error", code: "insufficient-data", message: "\u8BE5\u533A\u57DF\u771F\u5B9E\u5730\u70B9\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u7EC4\u6210\u8DEF\u7EBF\u3002", recoverable: true };
    }
    return;
  }
  yield stage2("retrieve", "\u53EC\u56DE\u771F\u5B9E\u5730\u70B9", "ok", { summary: `${merged.length} \u5BB6\u771F\u5B9E\u5E97` });
  yield* planFromCandidates(
    merged,
    constraints,
    persona,
    req,
    { deviceToken: identity.deviceToken, userId: identity.userId },
    { streamExplanation: deps.streamExplanation, savePlan: deps.savePlan, planId: deps.planId },
    { amapStatus: retrieved.amapStatus, cacheHits: retrieved.cacheHits, cacheMisses: retrieved.cacheMisses, center: anchorCenter ?? void 0 }
  );
}

// lib/agent/understand.ts
var PREF_LEX = [
  { tag: "romantic", words: ["\u6D6A\u6F2B", "\u7EA6\u4F1A", "\u60C5\u4FA3", "\u6C1B\u56F4", "\u5C0F\u8D44", "\u60C5\u8C03"] },
  { tag: "quiet", words: ["\u5B89\u9759", "\u6E05\u51C0", "\u4E0D\u5435", "\u50FB\u9759", "\u6162", "\u8F7B\u677E", "\u6162\u6162\u901B"] },
  { tag: "photo", words: ["\u62CD\u7167", "\u51FA\u7247", "\u6253\u5361", "\u4E0A\u955C", "\u597D\u770B", "\u989C\u503C"] },
  { tag: "family", words: ["\u5E26\u5A03", "\u5C0F\u5B69", "\u5B69\u5B50", "\u4EB2\u5B50", "\u5B9D\u5B9D", "\u513F\u7AE5", "\u905B\u5A03"] },
  { tag: "lively", words: ["\u70ED\u95F9", "\u597D\u73A9", "\u6C14\u6C1B", "\u55E8", "\u805A\u4F1A", "\u805A\u9910"] },
  { tag: "cultural", words: ["\u6587\u827A", "\u6587\u5316", "\u827A\u672F", "\u5C55", "\u5C55\u9986", "\u535A\u7269\u9986", "\u4E66\u5E97", "\u5386\u53F2", "\u56ED\u6797"] },
  { tag: "trendy", words: ["\u7F51\u7EA2", "\u6F6E", "\u65F6\u9AE6", "\u65B0\u6F6E", "\u6F6E\u6D41"] },
  { tag: "local", words: ["\u672C\u5730", "\u5730\u9053", "\u70DF\u706B", "\u5C0F\u5403", "\u7279\u8272", "\u672C\u5E2E"] },
  { tag: "upscale", words: ["\u7CBE\u81F4", "\u9AD8\u7AEF", "\u9AD8\u6863", "\u6B63\u5F0F", "\u5546\u52A1", "\u6863\u6B21"] },
  { tag: "budget", words: ["\u4FBF\u5B9C", "\u5B9E\u60E0", "\u6027\u4EF7\u6BD4", "\u5E73\u4EF7", "\u4E0D\u8D35", "\u7701"] },
  { tag: "nature", words: ["\u81EA\u7136", "\u7EFF", "\u516C\u56ED", "\u6C5F\u8FB9", "\u6EE8\u6C5F", "\u6237\u5916"] },
  { tag: "nightlife", words: ["\u9152\u5427", "\u591C\u751F\u6D3B", "\u8E66\u8FEA", "\u5C0F\u914C", "\u559D\u4E00\u676F", "livehouse", "\u591C\u5E97"] },
  { tag: "foodie", words: ["\u597D\u5403", "\u7F8E\u98DF", "\u5403\u8D27", "\u5927\u9910"] }
];
var AVOID_PATTERNS = [
  { re: /不要(太)?吵|别(太)?吵|太吵/, tag: "lively" },
  { re: /不要太贵|别太贵|不想太贵/, tag: "upscale" },
  { re: /不要(去)?酒吧|不喝酒|没有酒/, tag: "nightlife" }
];
var CAT_LEX = [
  { cat: "dining", words: ["\u5403\u996D", "\u5403", "\u7F8E\u98DF", "\u6B63\u9910", "\u665A\u996D", "\u5348\u996D", "\u5927\u9910", "\u9910\u5385", "\u672C\u5E2E", "\u83DC"] },
  { cat: "cafe", words: ["\u5496\u5561", "\u559D\u5496\u5561", "\u8336", "\u4E0B\u5348\u8336", "\u5976\u8336"] },
  { cat: "culture", words: ["\u535A\u7269\u9986", "\u7F8E\u672F\u9986", "\u5C55", "\u5C55\u9986", "\u56ED\u6797", "\u4E66\u5E97", "\u5386\u53F2", "\u6587\u5316", "citywalk"] },
  { cat: "entertainment", words: ["\u6F14\u51FA", "\u8BDD\u5267", "\u5267\u573A", "\u7535\u5F71", "\u5BC6\u5BA4", "\u684C\u6E38", "\u4E50\u56ED"] },
  { cat: "shopping", words: ["\u901B\u8857", "\u8D2D\u7269", "\u5546\u573A", "\u4E70", "\u6DD8"] },
  { cat: "nightscape", words: ["\u591C\u666F", "\u770B\u666F", "\u6C5F\u666F", "\u767B\u9AD8", "\u591C\u6E38", "\u706F"] }
];
var CAT_KEYWORD2 = {
  dining: ["\u9910\u5385", "\u5F53\u5730\u7279\u8272\u83DC", "\u7F8E\u98DF"],
  cafe: ["\u5496\u5561", "\u5496\u5561\u9986"],
  culture: ["\u535A\u7269\u9986", "\u5C55\u89C8", "\u4E66\u5E97"],
  entertainment: ["\u5267\u573A", "\u7535\u5F71\u9662"],
  shopping: ["\u5546\u573A", "\u8D2D\u7269\u4E2D\u5FC3"],
  nightscape: ["\u89C2\u666F", "\u591C\u666F"]
};
function parseStartTime(raw) {
  const m = raw.match(/(\d{1,2})\s*点(?!前|之前|以前|结束|回)/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (/晚|下午/.test(raw) && h <= 9 && !/中午/.test(raw)) h += 12;
    return h;
  }
  if (/凌晨|半夜/.test(raw)) return 0.5;
  if (/早上|上午|一早/.test(raw)) return 10;
  if (/中午/.test(raw)) return 12;
  if (/下午/.test(raw)) return 14;
  if (/傍晚/.test(raw)) return 17;
  if (/晚上|夜里|晚/.test(raw)) return 18.5;
  return 14;
}
function parseDuration(raw, startHour) {
  if (/一天|整天|玩一天/.test(raw)) return 360;
  if (/(下午|白天).*(晚上|夜)|逛到晚上|到晚上/.test(raw)) return 300;
  if (/半天/.test(raw)) return 240;
  const endM = raw.match(/(\d{1,2})\s*点前/);
  if (endM) {
    let endH = parseInt(endM[1], 10);
    if (endH <= 9) endH += 12;
    return Math.max(120, Math.round((endH - startHour) * 60));
  }
  if (/晚饭前/.test(raw)) return Math.max(120, Math.round((18 - startHour) * 60));
  return startHour >= 18 ? 240 : 300;
}
function parseBudget(raw) {
  const diningPatterns = [
    /(?:预算|人均)\s*(\d{2,4})\s*(?:吃午饭|吃午餐|吃晚饭|吃晚餐|吃饭|吃正餐)/,
    /(?:午饭|午餐|晚饭|晚餐|吃饭|正餐).*?(?:预算|人均)\s*(\d{2,4})/,
    /(\d{2,4})\s*(?:元|块)?\s*(?:吃午饭|吃午餐|吃晚饭|吃晚餐|吃饭|吃正餐)/,
    /(?:预算)\s*(\d{2,4})\s*吃饭/
  ];
  for (const p of diningPatterns) {
    const m = raw.match(p);
    if (m) return { total: null, dining: parseInt(m[1], 10) };
  }
  const patterns = [/人均\s*(\d{2,4})/, /预算\s*(?:人均)?\s*(\d{2,4})/, /(\d{2,4})\s*(?:左右|以内|以下|块|元)/];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) return { total: parseInt(m[1], 10), dining: null };
  }
  return { total: null, dining: null };
}
function parseParty(raw) {
  const cnMap = { \u4E00: 1, \u4E24: 2, \u4E8C: 2, \u4E09: 3, \u56DB: 4, \u4E94: 5, \u516D: 6, \u4E03: 7, \u516B: 8 };
  const m = raw.match(/([一两二三四五六七八]|\d+)\s*(?:个|位)?\s*(?:朋友|同学|人|家)/);
  if (m) {
    const n = cnMap[m[1]] ?? parseInt(m[1], 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  if (/情侣|对象|女朋友|男朋友|两个人/.test(raw)) return 2;
  if (/一个人|独自|自己/.test(raw)) return 1;
  if (/带娃|带孩子|一家|全家/.test(raw)) return 3;
  return 0;
}
function parsePace(raw) {
  if (/不要太赶|别太赶|不赶|慢慢|轻松|不要太累/.test(raw)) return "relaxed";
  if (/多逛|多玩|尽量多|紧凑|赶一点/.test(raw)) return "packed";
  return null;
}
function parseConstraintsFallback(raw, loc, persona) {
  const startTime = parseStartTime(raw);
  const durationMin = parseDuration(raw, startTime);
  const budget = parseBudget(raw);
  const party = parseParty(raw);
  const prefs = /* @__PURE__ */ new Set();
  for (const { tag, words } of PREF_LEX) if (words.some((w) => raw.includes(w))) prefs.add(tag);
  const avoid = /* @__PURE__ */ new Set();
  for (const { re, tag } of AVOID_PATTERNS) if (re.test(raw)) {
    avoid.add(tag);
    prefs.delete(tag);
  }
  const mustCategories = /* @__PURE__ */ new Set();
  for (const { cat, words } of CAT_LEX) if (words.some((w) => raw.includes(w))) mustCategories.add(cat);
  return {
    city: loc.city,
    district: loc.district,
    startTime,
    durationMin,
    party: party || persona.partyDefault,
    budgetPerCapita: budget.total,
    diningBudgetPerCapita: budget.dining,
    prefs: [...prefs],
    avoid: [...avoid],
    mustCategories: [...mustCategories],
    pace: parsePace(raw) ?? persona.pace,
    personaId: persona.id,
    raw
  };
}
function fallbackKeywords(c) {
  const scope = c.district || c.city;
  const words = /* @__PURE__ */ new Set();
  const cats = c.mustCategories.length ? c.mustCategories : ["dining", "cafe", "culture"];
  for (const cat of cats) {
    for (const term of CAT_KEYWORD2[cat]) words.add(`${scope} ${term}`);
  }
  if (c.prefs.includes("cultural")) words.add(`${scope} \u666F\u70B9`);
  if (c.prefs.includes("nature")) words.add(`${scope} \u516C\u56ED`);
  return [...words].slice(0, 8);
}

// lib/deepseek/client.ts
var DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
var DEFAULT_MODEL = "deepseek-v4-flash";
var DEFAULT_TIMEOUT_MS = 2e4;
function modelOf(deps) {
  return deps.model ?? process.env.DEEPSEEK_MODEL?.trim() ?? DEFAULT_MODEL;
}
function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return JSON.parse(fenced);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("model content is not JSON");
}
async function chatJson(p, deps = {}) {
  if (!p.apiKey) return null;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(DEEPSEEK_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelOf(deps),
        temperature: p.temperature ?? 0.2,
        max_tokens: p.maxTokens ?? 2e3,
        // deepseek-v4 是推理模型,reasoning_content 会占额度;400 会截断 JSON → 静默退化
        response_format: { type: "json_object" },
        messages: p.messages
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    return extractJson(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
async function* chatStream(p, deps = {}) {
  if (!p.apiKey) return;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(DEEPSEEK_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelOf(deps),
        temperature: p.temperature ?? 0.4,
        max_tokens: p.maxTokens ?? 600,
        stream: true,
        messages: p.messages
      })
    });
    const body = res.body;
    if (!res.ok || !body) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(line.indexOf(":") + 1).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
        }
      }
    }
  } catch {
    return;
  } finally {
    clearTimeout(timer);
  }
}

// lib/agent/understandLLM.ts
var VALID_CATS2 = ["dining", "cafe", "culture", "entertainment", "shopping", "nightscape"];
function prompt(raw, loc, persona, prefs) {
  return [
    { role: "system", content: '\u4F60\u628A\u4E2D\u6587\u51FA\u884C\u9700\u6C42\u89E3\u6790\u6210\u7ED3\u6784\u5316 JSON\u3002\u53EA\u8F93\u51FA JSON\u3002\u4E0D\u8981\u7ED9\u57CE\u5E02/\u533A\u53BF\uFF08\u540E\u7AEF\u5DF2\u5B9A\u4F4D\uFF09\u3002\u5B57\u6BB5\uFF1Aprefs(string[]) mustCategories(\u53D6\u81EA dining|cafe|culture|entertainment|shopping|nightscape) startHour(0-24) durationMin party diningBudget(number|null) totalBudget(number|null) keywords(\u9AD8\u5FB7\u641C\u7D22\u5173\u952E\u8BCD\u6570\u7EC4\uFF0C\u542B\u533A\u53BF\u524D\u7F00) anchor(string|null\uFF1A\u7528\u6237\u60F3\u805A\u62E2\u7684\u4E2D\u5FC3\u533A\u57DF\u6216\u5177\u4F53\u5730\u70B9\uFF0C\u53EF\u4E3A\u533A\u57DF\u540D\u5982"\u9759\u5B89/\u9646\u5BB6\u5634"\u6216\u5177\u4F53\u5730\u70B9\u5982"\u65B0\u4E16\u754C\u57CE/\u67D0\u5546\u573A"\uFF1B\u5982"\u5728\u65B0\u4E16\u754C\u57CE\u9644\u8FD1"\u2192"\u65B0\u4E16\u754C\u57CE"\uFF0C"\u9759\u5B89\u627E\u5496\u5561"\u2192"\u9759\u5B89"\uFF1B\u82E5\u7528\u6237\u53EA\u7ED9\u4E86\u57CE\u5E02\u6CA1\u6709\u66F4\u7EC6\u7684\u533A\u57DF/\u5730\u70B9\u5219\u4E3A null)\u3002' },
    { role: "user", content: JSON.stringify({ request: raw, district: loc.district, persona: persona.id, userPrefs: prefs.prefs, budgetPref: prefs.budgetPref }) }
  ];
}
async function understand(raw, loc, persona, prefs, deps = {}) {
  const base = parseConstraintsFallback(raw, loc, persona);
  for (const p of prefs.prefs ?? []) if (!base.prefs.includes(p)) base.prefs.push(p);
  const call = deps.chatJson ?? ((m) => chatJson({ apiKey: deps.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "", messages: m }));
  let llm = null;
  try {
    llm = await call(prompt(raw, loc, persona, prefs));
  } catch {
    llm = null;
  }
  if (!llm || typeof llm !== "object") {
    return { constraints: base, keywords: fallbackKeywords(base), llmUsed: false, anchor: null };
  }
  const anchor = typeof llm.anchor === "string" && llm.anchor.trim() ? llm.anchor.trim() : null;
  const mustCategories = Array.isArray(llm.mustCategories) ? llm.mustCategories.filter((c) => VALID_CATS2.includes(c)) : base.mustCategories;
  const merged = {
    ...base,
    startTime: Number.isFinite(llm.startHour) ? Number(llm.startHour) : base.startTime,
    durationMin: Number.isFinite(llm.durationMin) ? Number(llm.durationMin) : base.durationMin,
    party: Number.isFinite(llm.party) && llm.party > 0 ? Number(llm.party) : base.party,
    diningBudgetPerCapita: llm.diningBudget != null ? Number(llm.diningBudget) : base.diningBudgetPerCapita,
    budgetPerCapita: llm.totalBudget != null ? Number(llm.totalBudget) : base.budgetPerCapita,
    prefs: [.../* @__PURE__ */ new Set([...Array.isArray(llm.prefs) ? llm.prefs : [], ...base.prefs])].map(String),
    mustCategories: mustCategories.length ? mustCategories : base.mustCategories
  };
  const keywords = Array.isArray(llm.keywords) && llm.keywords.length ? llm.keywords.filter((k) => typeof k === "string").slice(0, 8) : fallbackKeywords(merged);
  return { constraints: merged, keywords, llmUsed: true, anchor };
}

// lib/amap/client.ts
var AMAP_V5 = "https://restapi.amap.com/v5";
async function fetchJson2(url, deps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 4500);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
async function searchPlaceText(p, deps = {}) {
  const params = new URLSearchParams({
    key: p.key,
    keywords: p.keyword,
    region: p.city,
    city_limit: p.citylimit === false ? "false" : "true",
    show_fields: "business,photos",
    page_size: String(p.pageSize ?? 12),
    page_num: "1"
  });
  try {
    const data = await fetchJson2(`${AMAP_V5}/place/text?${params.toString()}`, deps);
    if (data?.status !== "1") return { status: "error", pois: [], info: data?.info };
    const pois = Array.isArray(data.pois) ? data.pois : [];
    return { status: pois.length ? "ok" : "empty", pois };
  } catch (err) {
    return { status: "error", pois: [], info: err instanceof Error ? err.message : String(err) };
  }
}
async function searchPlaceAround(p, deps = {}) {
  const params = new URLSearchParams({
    key: p.key,
    keywords: p.keyword,
    location: `${p.center.lng},${p.center.lat}`,
    radius: String(Math.round(p.radius)),
    show_fields: "business,photos",
    page_size: String(p.pageSize ?? 12),
    page_num: "1"
  });
  try {
    const data = await fetchJson2(`${AMAP_V5}/place/around?${params.toString()}`, deps);
    if (data?.status !== "1") return { status: "error", pois: [], info: data?.info };
    const pois = Array.isArray(data.pois) ? data.pois : [];
    return { status: pois.length ? "ok" : "empty", pois };
  } catch (err) {
    return { status: "error", pois: [], info: err instanceof Error ? err.message : String(err) };
  }
}
async function directionLeg(kind, p, deps) {
  const params = new URLSearchParams({
    key: p.key,
    origin: `${p.from.lng},${p.from.lat}`,
    destination: `${p.to.lng},${p.to.lat}`
  });
  try {
    const data = await fetchJson2(`${AMAP_V5}/direction/${kind}?${params.toString()}`, { ...deps, timeoutMs: deps.timeoutMs ?? 1600 });
    const path = data?.route?.paths?.[0];
    const distM = Math.round(Number(path?.distance ?? 0));
    const durationSec = Number(path?.cost?.duration ?? path?.duration ?? 0);
    const minutes = Math.round(durationSec / 60);
    if (data?.status === "1" && distM > 0 && minutes > 0) return { distM, minutes };
    return null;
  } catch {
    return null;
  }
}
async function walkingLeg(p, deps = {}) {
  return directionLeg("walking", p, deps);
}
async function drivingLeg(p, deps = {}) {
  return directionLeg("driving", p, deps);
}

// lib/amap/cache.js
function norm(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
function normalizeCacheKey({ city, keyword, scope }) {
  return `poi:${norm(city)}|${norm(scope)}|${norm(keyword)}`;
}
function isFresh(fetchedAtIso, ttlDays) {
  const age = Date.now() - new Date(fetchedAtIso).getTime();
  return age <= ttlDays * 864e5;
}
var DEFAULT_TTL_DAYS = 21;
async function readCache(key, ttlDays = DEFAULT_TTL_DAYS) {
  if (!hasDatabase()) return null;
  const sql = getSql();
  const rows = await sql`SELECT payload, fetched_at FROM poi_cache WHERE key = ${key}`;
  const row = rows[0];
  if (!row) return null;
  if (!isFresh(new Date(row.fetched_at).toISOString(), ttlDays)) return null;
  return row.payload;
}
async function writeCache(key, payload) {
  if (!hasDatabase()) return;
  const sql = getSql();
  await sql`
    INSERT INTO poi_cache (key, payload, fetched_at)
    VALUES (${key}, ${JSON.stringify(payload)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()
  `;
}

// lib/amap/poiFeatures.ts
function categoryFor(text) {
  if (/咖啡|茶饮|奶茶|甜品|饮品|下午茶|面包|烘焙/.test(text)) return "cafe";
  if (/餐饮|餐厅|中餐|西餐|美食|小吃|肉串|烧烤|火锅|菜馆|饭店|brunch|早午餐/i.test(text)) return "dining";
  if (/夜景|观景|灯光|夜游/.test(text)) return "nightscape";
  if (/购物|商场|市集|大巴扎|商业/.test(text)) return "shopping";
  if (/影院|剧场|演出|娱乐|游乐|KTV|密室|桌游/.test(text)) return "entertainment";
  return "culture";
}
var TAG_MAP = [
  { re: /安静|清净|僻静/, tag: "quiet" },
  { re: /拍照|出片|打卡|环境|颜值/, tag: "photo" },
  { re: /浪漫|情调|氛围/, tag: "romantic" },
  { re: /亲子|儿童|带娃/, tag: "family" },
  { re: /热闹|气氛/, tag: "lively" },
  { re: /文化|艺术|文艺|历史/, tag: "cultural" },
  { re: /网红|潮流|时髦/, tag: "trendy" },
  { re: /本地|地道|特色|老字号|本帮/, tag: "local" },
  { re: /精致|高端|商务/, tag: "upscale" },
  { re: /实惠|平价|性价比/, tag: "budget" },
  { re: /自然|公园|江景/, tag: "nature" },
  { re: /酒吧|清吧|精酿/, tag: "nightlife" },
  { re: /美食|好吃/, tag: "foodie" }
];
function deriveSceneTags(tagStr, category) {
  const out = /* @__PURE__ */ new Set();
  const text = tagStr || "";
  for (const { re, tag } of TAG_MAP) if (re.test(text)) out.add(tag);
  if (category === "cafe" && !out.size) out.add("quiet");
  return [...out];
}
function parseOpenHours(opentime) {
  const m = (opentime || "").match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!m) return { openHour: null, closeHour: null };
  const open = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  let close = parseInt(m[3], 10) + parseInt(m[4], 10) / 60;
  if (close <= open) close += 24;
  return { openHour: open, closeHour: Math.min(close, 27) };
}
var STAY_BY_CATEGORY = {
  dining: 75,
  cafe: 50,
  culture: 90,
  entertainment: 85,
  shopping: 60,
  nightscape: 60
};
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
var BLOCKED_POI = /停车场|充电站|充电桩|快电|换电|超充|[Ee]\s?充电|地铁站|公交[车站]|站台|[0-9]号口|出入口|检票|售票|配送|仓库|物流|批发市场|医院|门诊|诊所|卫生院|药店|药房|银行|信用社|ATM|证券|保险公司|加油站|加气站|政府|管委会|派出所|公安局|法院|检察院|税务|居委会|村委会|小学|中学|大学|学院|幼儿园|驾校|写字楼|商务楼|产业园|创业园|小区|公寓|住宅|宿舍|人才市场|人力资源|招聘|房产中介|营业厅|汽车维修|汽修|4S店|售楼|售楼处|有限公司|厕所|公共卫生间|殡仪|陵园|酒店|宾馆|招待所|住宿|旅馆|旅社|客栈|民宿|青年旅舍|度假村|公寓式/;
function toEnrichedPOI(raw, city, district) {
  const name = (raw.name || "").trim();
  const [lngStr, latStr] = String(raw.location || "").split(",");
  const lng = Number(lngStr);
  const lat = Number(latStr);
  if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const typeText = `${name} ${raw.type || ""}`;
  if (BLOCKED_POI.test(typeText)) return null;
  const category = categoryFor(typeText);
  const b = raw.business || {};
  const { openHour, closeHour } = parseOpenHours(b.opentime_today || b.opentime_week);
  const photos = (raw.photos || []).map((p) => p.url).filter((u) => !!u);
  return {
    id: raw.id || `${name}-${raw.location}`,
    name,
    category,
    city,
    area: raw.adname || district || "",
    lat,
    lng,
    rating: num(b.rating),
    perCapita: num(b.cost),
    tags: (b.tag || "").split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    openHour,
    closeHour,
    photos,
    tel: (b.tel || "").trim() || null,
    source: "amap",
    sceneTags: deriveSceneTags(b.tag || "", category),
    avgDuration: STAY_BY_CATEGORY[category]
  };
}

// lib/agent/retrieve.ts
function stripCity(name) {
  return (name || "").replace(/(市|地区|自治州|州|盟)$/, "");
}
async function retrieve(p, deps = {}) {
  const { keywords, location, key, anchorCenter } = p;
  const radius = p.radius ?? 3e3;
  const useAround = Boolean(anchorCenter);
  const center = anchorCenter ?? location.center;
  if (!key) {
    return { pois: [], center, cacheHits: 0, cacheMisses: 0, amapStatus: "not_configured" };
  }
  const readCache2 = deps.readCache ?? (async () => null);
  const writeCache2 = deps.writeCache ?? (async () => {
  });
  const byId = /* @__PURE__ */ new Map();
  let cacheHits = 0;
  let cacheMisses = 0;
  let sawError = false;
  for (const keyword of keywords) {
    const scope = useAround ? `around:${anchorCenter.lng.toFixed(4)},${anchorCenter.lat.toFixed(4)}:${radius}` : "place-text";
    const cacheKey = normalizeCacheKey({ city: location.city, keyword, scope });
    let rawPois = await readCache2(cacheKey);
    if (rawPois) {
      cacheHits += 1;
    } else {
      const res = useAround ? await searchPlaceAround(
        { keyword, center: anchorCenter, radius, key },
        { fetchImpl: deps.fetchImpl }
      ) : await searchPlaceText(
        { keyword, city: location.city, key },
        { fetchImpl: deps.fetchImpl }
      );
      cacheMisses += 1;
      if (res.status === "error") {
        sawError = true;
        continue;
      }
      rawPois = res.pois;
      await writeCache2(cacheKey, rawPois);
    }
    for (const raw of rawPois) {
      const poi = toEnrichedPOI(raw, location.city, location.district);
      if (!poi) continue;
      if (poi.city && location.city && stripCity(poi.city) !== stripCity(location.city)) continue;
      if (!byId.has(poi.id)) byId.set(poi.id, poi);
    }
  }
  const pois = [...byId.values()];
  const amapStatus = pois.length ? "ok" : sawError ? "error" : "empty";
  return { pois, center, cacheHits, cacheMisses, amapStatus };
}

// lib/agent/explain.ts
var CATEGORY_LABEL2 = {
  dining: "\u6B63\u9910",
  cafe: "\u5496\u5561",
  culture: "\u6587\u5316\u70B9",
  entertainment: "\u5A31\u4E50",
  shopping: "\u901B\u8857",
  nightscape: "\u591C\u666F"
};
function fmtH2(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function deterministicExplanation(route, c) {
  const parts = [];
  route.stops.forEach((s, i) => {
    const when = fmtH2(s.arrive);
    const cat = CATEGORY_LABEL2[s.poi.category] ?? "\u4E00\u7AD9";
    const price2 = s.poi.perCapita != null ? `\uFF08\u4EBA\u5747\xA5${s.poi.perCapita}\uFF09` : "";
    const lead = i === 0 ? `${when} \u5148\u5230${cat}\u300C${s.poi.name}\u300D${price2}` : `\u968F\u540E\u7EA6 ${when} \u524D\u5F80\u300C${s.poi.name}\u300D${price2}`;
    const reason = s.reasons[0] ? `\uFF0C${s.reasons[0]}` : "";
    parts.push(`${lead}${reason}\u3002`);
  });
  const budget = c.diningBudgetPerCapita != null ? `\u5168\u7A0B\u6B63\u9910\u9884\u7B97\u63A7\u5236\u5728 \xA5${c.diningBudgetPerCapita} \u5185\u3002` : c.budgetPerCapita != null ? `\u4EBA\u5747\u5408\u8BA1\u7EA6 \xA5${route.totalCost}\uFF0C\u5728 \xA5${c.budgetPerCapita} \u9884\u7B97\u5185\u3002` : "";
  return parts.join("") + budget;
}
function buildPrompt(route, c) {
  const stops = route.stops.map((s) => ({
    name: s.poi.name,
    category: s.poi.category,
    area: s.poi.area,
    rating: s.poi.rating,
    perCapita: s.poi.perCapita,
    reasons: s.reasons
  }));
  return [
    { role: "system", content: [
      "\u4F60\u662F\u672C\u5730\u8DEF\u7EBF\u8BB2\u89E3\u5458\uFF0C\u4E3A\u7528\u6237\u5DF2\u6392\u597D\u7684\u884C\u7A0B\u5199\u4E00\u6BB5\u6E29\u6696\u3001\u5177\u4F53\u7684\u4E2D\u6587\u63A8\u8350\u7406\u7531\u3002",
      "\u786C\u6027\u8981\u6C42(\u5FC5\u987B\u9075\u5B88):",
      "1. \u53EA\u80FD\u63D0\u5230 stops \u6570\u7EC4\u91CC\u771F\u5B9E\u5B58\u5728\u7684\u5730\u70B9\u540D\uFF1B**\u7EDD\u5BF9\u4E0D\u8981\u63D0\u53CA\u3001\u63A8\u8350\u3001\u5047\u8BBE\u6216\u7F16\u9020\u4EFB\u4F55 stops \u4E4B\u5916\u7684\u5E97\u540D/\u9910\u5385/\u666F\u70B9**(\u54EA\u6015\u7528\u6237\u9700\u6C42\u91CC\u63D0\u5230\u4E86\u67D0\u7C7B\u800C\u884C\u7A0B\u91CC\u6CA1\u6709\uFF0C\u4E5F\u4E0D\u8981\u7F16\u4E00\u4E2A\u8865\u4E0A\uFF0C\u81EA\u7136\u7565\u8FC7\u5373\u53EF)\u3002",
      "2. \u4E0D\u8981\u53D9\u8FF0\u201C\u6362\u6210\u4E86/\u6539\u6210\u4E86/\u539F\u672C\u662F/\u53EF\u4EE5\u8003\u8651\u53BB\u201D\u8FD9\u7C7B\u53D8\u66F4\u6216\u5047\u8BBE\u52A8\u4F5C\u2014\u2014\u53EA\u8BB2\u5F53\u524D\u8FD9\u51E0\u7AD9\u672C\u8EAB\u597D\u5728\u54EA\u3001\u5982\u4F55\u4E32\u8054\u3002",
      "3. \u7D27\u6263\u7528\u6237\u9700\u6C42\u4E0E\u6BCF\u4E00\u7AD9\u7684\u771F\u5B9E\u4FE1\u606F(\u8BC4\u5206\u3001\u4EBA\u5747\u3001\u533A\u57DF\u3001reasons)\uFF0C\u4E0D\u7F16\u9020\u4EFB\u4F55\u6570\u636E\u3002",
      "4. \u4E00\u6BB5\u8BDD\uFF0C\u4E0D\u8981 Markdown\uFF0C\u4E0D\u8981\u5206\u70B9\u3002"
    ].join("\n") },
    { role: "user", content: JSON.stringify({ request: c.raw, constraints: { prefs: c.prefs, party: c.party, budgetPerCapita: c.budgetPerCapita, diningBudgetPerCapita: c.diningBudgetPerCapita }, stops }) }
  ];
}
async function* streamExplanation(route, c, deps) {
  const messages = buildPrompt(route, c);
  const streamFn = deps.stream ?? ((m) => chatStream({ apiKey: deps.apiKey, messages: m }));
  let produced = false;
  if (deps.apiKey) {
    for await (const delta of streamFn(messages)) {
      produced = true;
      yield delta;
    }
  }
  if (!produced) yield deterministicExplanation(route, c);
}

// lib/agent/legs.ts
var FAR_M = 2500;
var WALK_MAX_MIN = 20;
async function attachRealLegs(route, leg) {
  const stops = route.stops;
  if (stops.length === 0) return route;
  const out = [];
  let totalWalk = 0;
  let totalTransit = 0;
  let clock = stops[0].arrive;
  for (let i = 0; i < stops.length; i += 1) {
    const s = stops[i];
    const stay = s.depart - s.arrive;
    let legFromPrev = s.legFromPrev;
    if (i > 0) {
      const prev = stops[i - 1].poi;
      const cur = s.poi;
      const from = { lat: prev.lat, lng: prev.lng };
      const to = { lat: cur.lat, lng: cur.lng };
      const straight = haversineM(prev.lat, prev.lng, cur.lat, cur.lng);
      let chosen = null;
      if (straight <= FAR_M) {
        const walk = await leg(from, to, "walk");
        if (walk && walk.minutes <= WALK_MAX_MIN) chosen = { ...walk, mode: "walk" };
      }
      if (!chosen) {
        const drive = await leg(from, to, "transit");
        if (drive) chosen = { ...drive, mode: "transit" };
      }
      legFromPrev = chosen ?? s.legFromPrev ?? { distM: Math.round(straight), minutes: Math.max(1, Math.round(straight / 80)), mode: straight <= FAR_M ? "walk" : "transit" };
      const minutes = legFromPrev.minutes;
      if (legFromPrev.mode === "walk") totalWalk += minutes;
      else totalTransit += minutes;
      clock = Math.max(clock + minutes / 60, cur.openHour ?? clock + minutes / 60);
    } else {
      clock = Math.max(s.arrive, s.poi.openHour ?? s.arrive);
    }
    const arrive = i === 0 ? s.arrive : clock;
    const depart = arrive + stay;
    clock = depart;
    out.push({ ...s, arrive, depart, legFromPrev });
  }
  return {
    ...route,
    stops: out,
    totalWalkMin: totalWalk,
    totalTransitMin: totalTransit,
    endTime: clock
  };
}

// lib/db/conversations.js
var DEFAULT_TTL_MS = 60 * 60 * 1e3;
async function saveConversation(id, owner, state, ttlMs = DEFAULT_TTL_MS) {
  const sql = getSql();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const rows = await sql`
    INSERT INTO conversations (id, owner, state, expires_at)
    VALUES (${id}, ${owner}, ${JSON.stringify(state)}::jsonb, ${expiresAt})
    ON CONFLICT (id) DO UPDATE
      SET owner = EXCLUDED.owner, state = EXCLUDED.state, expires_at = EXCLUDED.expires_at
    RETURNING id
  `;
  return rows[0];
}
async function loadConversation(id) {
  const sql = getSql();
  const rows = await sql`
    SELECT id, owner, state, expires_at FROM conversations WHERE id = ${id}
  `;
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.id, owner: row.owner, state: row.state };
}

// lib/handlers/plan.ts
function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}
async function identityFromReq(req) {
  const id = await resolveIdentity(req);
  if (id.userId) return { userId: id.userId, deviceToken: null };
  const device = id.deviceToken || randomUUID();
  if (hasDatabase()) await createGuest(device).catch(() => {
  });
  return { userId: null, deviceToken: device };
}
async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Device-Token");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST /api/plan" });
  const parsed = PlanRequestSchema.safeParse(readBody(req));
  if (!parsed.success) {
    const sse2 = openSSE(res);
    sse2.send({ type: "error", code: "bad-request", message: "\u8BF7\u6C42\u683C\u5F0F\u4E0D\u6B63\u786E\u3002", recoverable: false });
    return sse2.close();
  }
  const reqData = parsed.data;
  const identity = await identityFromReq(req);
  const sse = openSSE(res);
  const key = getAmapKey();
  const apiKey = process.env.DEEPSEEK_API_KEY ?? "";
  const searchPOI = async (keyword, district, anchorCenter) => {
    const resolved = await resolveLocation(reqData.request).catch(() => null);
    const city = resolved?.city ?? null;
    if (!city) return [];
    const result = await retrieve(
      {
        keywords: [keyword],
        location: { city, district: district ?? null, center: anchorCenter ?? resolved.center },
        key,
        anchorCenter: anchorCenter ?? void 0
      },
      { readCache: (k) => readCache(k), writeCache: (k, payload) => writeCache(k, payload) }
    );
    return result.pois;
  };
  const cachedLeg = async (from, to, mode) => {
    const k = `leg:${mode}:${from.lng.toFixed(4)},${from.lat.toFixed(4)}>${to.lng.toFixed(4)},${to.lat.toFixed(4)}`;
    const hit = await readCache(k).catch(() => null);
    if (hit && typeof hit.minutes === "number") return hit;
    const r = mode === "walk" ? await walkingLeg({ from, to, key }) : await drivingLeg({ from, to, key });
    if (r) await writeCache(k, r).catch(() => {
    });
    return r;
  };
  const sharedDeps = {
    resolveLocation,
    resolveAnchor: (anchorText, city) => resolveAnchor(anchorText, city),
    attachLegs: key ? (route) => attachRealLegs(route, cachedLeg) : void 0,
    understand: (raw, loc, persona, preferences) => understand(raw, loc, persona, preferences, {}),
    retrieve: (keywords, loc) => retrieve(
      { keywords, location: loc, key, anchorCenter: loc?.anchorCenter, radius: loc?.radius },
      { readCache: (k) => readCache(k), writeCache: (k, payload) => writeCache(k, payload) }
    ),
    streamExplanation: (route, c) => streamExplanation(route, c, { apiKey }),
    savePlan: (record) => hasDatabase() ? savePlan(record) : Promise.resolve({ id: record.id }),
    planId: () => `plan-${randomUUID()}`
  };
  try {
    if (reqData.previousPlan != null && reqData.previousPlan.stops.length >= 2) {
      const deps = { ...sharedDeps, editChatJson: (messages) => chatJson({ apiKey, messages }) };
      for await (const event of runPlanLoop(reqData, identity, deps)) sse.send(event);
    } else {
      let priorState;
      if (reqData.conversationId && reqData.answer && hasDatabase()) {
        const conv = await loadConversation(reqData.conversationId).catch(() => null);
        if (conv) priorState = conv.state;
      }
      const reactDeps = {
        ...sharedDeps,
        searchPOI,
        saveConversation: (id, owner, state) => hasDatabase() ? saveConversation(id, owner, state) : Promise.resolve({ id }),
        conversationId: () => `conv-${randomUUID()}`,
        chatJson: (messages) => chatJson({ apiKey, messages }),
        priorState
      };
      for await (const event of runReactLoop(reqData, identity, reactDeps)) sse.send(event);
    }
  } catch (err) {
    sse.send({ type: "error", code: "upstream-unavailable", message: "\u89C4\u5212\u8FC7\u7A0B\u51FA\u73B0\u5F02\u5E38\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002", recoverable: true });
  } finally {
    sse.close();
  }
}
export {
  handler as default
};
