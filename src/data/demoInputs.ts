// 8 个预置演示输入。注意:这些只是「自然语言文本」,
// 路线结果完全由 pipeline 实时计算,不存在任何预存路线。
export interface DemoInput {
  id: string;
  label: string;
  text: string;
  suggestPersona?: string; // 仅作为演示默认,可任意切换
}

export const DEMO_INPUTS: DemoInput[] = [
  {
    id: 'demo0',
    label: '朋友·新天地下午',
    text: '朋友来上海,下午在新天地附近逛逛,3点想找个安静地方接电话,晚上想吃饭但别排队太久,人均300内',
    suggestPersona: 'friends',
  },
  {
    id: 'demo1',
    label: '情侣·外滩夜晚',
    text: '周六晚上和女朋友在外滩附近约会,想要安静一点有氛围,人均400左右,最好能看夜景,不要太吵',
    suggestPersona: 'couple',
  },
  {
    id: 'demo2',
    label: '带娃·静安半天',
    text: '周日下午带4岁小孩在静安寺一带玩,要亲子友好不要太累,预算人均150,晚饭前要结束',
    suggestPersona: 'family',
  },
  {
    id: 'demo3',
    label: '朋友·大学路热闹',
    text: '五个朋友周五晚上在大学路聚会,想热闹好玩,吃点好的再玩一玩,人均200以内,可以玩到挺晚',
    suggestPersona: 'friends',
  },
  {
    id: 'demo4',
    label: '独逛·武康路citywalk',
    text: '一个人下午想在武康路衡复一带citywalk,喜欢文艺安静能拍照的地方,预算不高人均100',
    suggestPersona: 'solo',
  },
  {
    id: 'demo5',
    label: '情侣·新天地下午到晚上',
    text: '和对象新天地从下午逛到晚上,想要精致浪漫,看个演出再吃饭,人均500没问题',
    suggestPersona: 'couple',
  },
  {
    id: 'demo6',
    label: '朋友·徐家汇玩一天',
    text: '周末几个同学在徐家汇玩一天,想看电影玩密室,中间吃饭,人均180,别太赶',
    suggestPersona: 'friends',
  },
  {
    id: 'demo7',
    label: '带娃·陆家嘴亲子',
    text: '带孩子去陆家嘴,想看科技馆和登高看景,中午吃饭,人均200,晚上7点前回家',
    suggestPersona: 'family',
  },
  {
    id: 'demo8',
    label: '独逛·豫园老城厢',
    text: '自己一个人白天去豫园老城厢逛逛,想看园林和老上海的东西,顺便吃点本地小吃,不要太贵',
    suggestPersona: 'solo',
  },
];
