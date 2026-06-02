export type TraceStatus = 'loading' | 'ok' | 'warn' | 'error';

export interface AgentTraceLog {
  step: string;
  status: TraceStatus;
  latency: number;
}

export interface RouteStopMock {
  role: string;
  poiName: string;
  eta: string;
  transitToNext?: string;
  isRepaired?: boolean;
}

export const mockStore = {
  userContext: { budget: 400, mobility: 'walk+taxi', vibe: 'quiet' },
  agentTrace: [
    { step: 'Parsing constraints', status: 'ok', latency: 45 },
    { step: 'OR-Tools TSPTW solver', status: 'ok', latency: 320 },
    { step: 'Patching Node 2 (Walking > 15m)', status: 'ok', latency: 80 },
  ],
  route: {
    summary: { time: '4h 15m', cost: '¥380', risk: 'low' },
    stops: [
      { role: '低压破冰', poiName: 'Manner Coffee (外滩源)', eta: '14:00', transitToNext: '8m' },
      { role: '自然过渡', poiName: '圆明园路街区', eta: '14:55', transitToNext: '6m' },
      { role: '氛围晚餐', poiName: 'Mercato by Jean-Georges', eta: '16:10', transitToNext: '9m', isRepaired: true },
      { role: '夜景收尾', poiName: '外白渡桥观景点', eta: '18:05' },
    ],
  },
} satisfies {
  userContext: { budget: number; mobility: string; vibe: string };
  agentTrace: AgentTraceLog[];
  route: {
    summary: { time: string; cost: string; risk: string };
    stops: RouteStopMock[];
  };
};

export const activeTags = [
  '偏好模型: 活跃',
  '历史: 避免重复',
  '约束: 低步行',
  '数据源: 并行取证',
];

export const defaultIntent =
  '周六晚上和女朋友在外滩约会，想安静有氛围，人均 400，看夜景，别太赶';

export const evidenceByPoi: Record<string, {
  matchScore: string;
  UGCQuote: string;
  history: string;
  tags: string[];
  price: string;
  distance: string;
  queue: string;
  risk: string;
}> = {
  'Manner Coffee (外滩源)': {
    matchScore: '92%',
    UGCQuote: '靠窗位安静，下午人流稳定，适合自然聊天。',
    history: '你收藏过外滩源附近咖啡，并多次选择低排队门店。',
    tags: ['安静', '破冰', '外滩源', '低排队', '步行友好', '预算安全'],
    price: '人均 ¥42，低于本次预算上限。',
    distance: '距集合点步行 6 分钟，下一站步行 8 分钟。',
    queue: '14:00-15:00 排队风险低。',
    risk: '低风险：若满座，可替换同街区 2 家咖啡。',
  },
  'Mercato by Jean-Georges': {
    matchScore: '95%',
    UGCQuote: '窗边江景适合约会，晚餐氛围稳定，不会太吵。',
    history: '你的历史偏好显示：更接受江景、精致餐、低噪声环境。',
    tags: ['氛围晚餐', '江景', '约会', '不尴尬', '同价位替换', '修复后节点'],
    price: '预计人均 ¥338，整条路线控制在 ¥380。',
    distance: '替换后少走 15 分钟，接驳更顺。',
    queue: '当前无需等位，优于原计划 40 分钟排队。',
    risk: '中低风险：建议提前锁定窗边位。',
  },
  '圆明园路街区': {
    matchScore: '89%',
    UGCQuote: '街区节奏慢，建筑密度高，适合边走边聊。',
    history: '你过去更偏好文艺、安静、可自然停留的城市街区。',
    tags: ['自然过渡', '文艺', '低成本', '可拍照', '不赶路', '室外备选'],
    price: '无强制消费，可把预算留给晚餐。',
    distance: '从咖啡步行 8 分钟，到晚餐点步行 6 分钟。',
    queue: '开放街区，无排队风险。',
    risk: '低风险：下雨时可替换为附近展厅。',
  },
  '外白渡桥观景点': {
    matchScore: '91%',
    UGCQuote: '黄昏后灯光稳定，适合轻量收尾，不需要额外排队。',
    history: '你的收藏里夜景/江景内容占比高，且偏好低压力散步。',
    tags: ['夜景', '收尾', '免费', '江景', '轻步行', '记忆点'],
    price: '免费，整条路线预算保持在 ¥380。',
    distance: '从晚餐点步行 9 分钟，结束后打车点近。',
    queue: '开放观景点，不需要等位。',
    risk: '低风险：如风大，可改为室内江景座位。',
  },
};

export const repairPatch = {
  oldNode: '外滩屋顶餐吧',
  newNode: 'Mercato by Jean-Georges',
  triggerReason: '原计划第二站排队约 40 分钟，且从咖啡步行超过 15 分钟，可能破坏约会节奏。',
};

export const replanPrompts = ['她不想走太多', '预算降到 200', '下雨了', '有人迟到 30 分钟'];
