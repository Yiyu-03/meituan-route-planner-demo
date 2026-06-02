import type { POI, Category, SceneTag } from '../types';
import { AREA_MAP } from './areas';

// ------------------------------------------------------------
// 84 个 Mock POI。坐标 = 区域中心 + 小幅偏移(伪随机但确定),
// 保证同区域的点彼此很近、跨区域的点距离合理。
// 名称为虚构但贴近上海真实业态,避免使用真实商标。
// ------------------------------------------------------------

type Seed = {
  id: string;
  name: string;
  cat: Category;
  area: string;
  rating: number;
  reviews: number;
  per: number;        // 人均 ¥
  open: number;
  close: number;      // 可 >24
  dur: number;        // 停留分钟
  tags: SceneTag[];
  ugc: string;
  queue: number;      // 0-1
  // 偏移因子(让坐标分散),范围约 ±0.012 度 ≈ ±1.2km
  dx: number; dy: number;
};

const S: Seed[] = [
  // ============ 餐饮 dining (22) ============
  { id:'d01', name:'外滩源·本帮菜馆', cat:'dining', area:'bund', rating:4.7, reviews:8200, per:280, open:11, close:22, dur:90, tags:['upscale','local','foodie','romantic'], ugc:'红烧肉入口即化,临窗能看外滩夜景', queue:0.6, dx:0.004, dy:-0.003 },
  { id:'d02', name:'石库门私房菜', cat:'dining', area:'xintiandi', rating:4.6, reviews:5400, per:220, open:11.5, close:21.5, dur:85, tags:['local','romantic','foodie'], ugc:'老洋房里的本帮味,环境很出片', queue:0.5, dx:-0.003, dy:0.002 },
  { id:'d03', name:'弄堂生煎铺', cat:'dining', area:'yuyuan', rating:4.5, reviews:12000, per:35, open:6.5, close:20, dur:35, tags:['local','budget','foodie','lively'], ugc:'皮薄汁多,本地人从小吃到大', queue:0.8, dx:0.002, dy:0.004 },
  { id:'d04', name:'蟹粉小笼·豫园店', cat:'dining', area:'yuyuan', rating:4.4, reviews:15600, per:90, open:9, close:21, dur:50, tags:['local','foodie','lively'], ugc:'蟹粉给得足,游客本地人都爱', queue:0.85, dx:-0.002, dy:0.003 },
  { id:'d05', name:'梧桐里法餐', cat:'dining', area:'wukang', rating:4.8, reviews:3100, per:580, open:17.5, close:23, dur:120, tags:['upscale','romantic','trendy'], ugc:'纪念日首选,摆盘像艺术品', queue:0.4, dx:0.003, dy:-0.002 },
  { id:'d06', name:'川味江湖菜', cat:'dining', area:'jingan', rating:4.5, reviews:9800, per:120, open:11, close:22.5, dur:80, tags:['lively','foodie','local'], ugc:'够麻够辣,聚餐气氛拉满', queue:0.7, dx:-0.004, dy:0.003 },
  { id:'d07', name:'静安寺素斋', cat:'dining', area:'jingan', rating:4.3, reviews:2600, per:150, open:11, close:20, dur:70, tags:['quiet','cultural','upscale'], ugc:'清净雅致,素食也能很惊艳', queue:0.3, dx:0.002, dy:0.004 },
  { id:'d08', name:'港式茶餐厅', cat:'dining', area:'xujiahui', rating:4.2, reviews:11200, per:75, open:10, close:23, dur:55, tags:['budget','lively','local'], ugc:'丝袜奶茶配菠萝包,深夜也开', queue:0.55, dx:-0.003, dy:-0.002 },
  { id:'d08b', name:'徐家汇日式居酒屋', cat:'dining', area:'xujiahui', rating:4.6, reviews:4300, per:200, open:17, close:25, dur:95, tags:['lively','trendy','nightlife','foodie'], ugc:'烤物配清酒,下班来一杯', queue:0.5, dx:0.004, dy:0.002 },
  { id:'d09', name:'云南菌菇火锅', cat:'dining', area:'daxuelu', rating:4.5, reviews:6700, per:130, open:11, close:22, dur:90, tags:['lively','foodie','local'], ugc:'菌汤鲜到眉毛掉,学生党聚餐地', queue:0.65, dx:-0.002, dy:0.003 },
  { id:'d10', name:'大学路韩餐', cat:'dining', area:'daxuelu', rating:4.3, reviews:8900, per:85, open:11, close:23, dur:70, tags:['lively','budget','trendy'], ugc:'部队锅分量大,年轻人扎堆', queue:0.6, dx:0.003, dy:-0.003 },
  { id:'d11', name:'本帮老饭店', cat:'dining', area:'peoplesq', rating:4.4, reviews:7600, per:160, open:11, close:21, dur:80, tags:['local','foodie','upscale'], ugc:'浓油赤酱的正宗上海味', queue:0.6, dx:-0.003, dy:0.002 },
  { id:'d12', name:'人广日料放题', cat:'dining', area:'peoplesq', rating:4.1, reviews:13400, per:260, open:11.5, close:22, dur:100, tags:['lively','foodie','trendy'], ugc:'刺身管够,适合一群人开吃', queue:0.7, dx:0.004, dy:0.003 },
  { id:'d13', name:'陆家嘴空中粤菜', cat:'dining', area:'lujiazui', rating:4.7, reviews:4900, per:420, open:11, close:22, dur:100, tags:['upscale','romantic','foodie'], ugc:'高层落地窗看江景,商务宴请', queue:0.45, dx:-0.002, dy:-0.003 },
  { id:'d14', name:'江景小龙虾', cat:'dining', area:'lujiazui', rating:4.3, reviews:10200, per:180, open:16, close:25.5, dur:90, tags:['lively','nightlife','foodie','local'], ugc:'夜宵剥虾配啤酒,江风很爽', queue:0.6, dx:0.003, dy:0.002 },
  { id:'d15', name:'田子坊创意菜', cat:'dining', area:'tianzifang', rating:4.4, reviews:5600, per:140, open:11, close:22, dur:80, tags:['trendy','photo','romantic'], ugc:'融合菜摆盘精致,巷子里的小惊喜', queue:0.55, dx:-0.003, dy:0.003 },
  { id:'d16', name:'打浦桥家常面馆', cat:'dining', area:'tianzifang', rating:4.5, reviews:9100, per:30, open:7, close:21, dur:30, tags:['budget','local','foodie'], ugc:'葱油拌面便宜大碗,街坊最爱', queue:0.5, dx:0.002, dy:-0.002 },
  { id:'d17', name:'武康路精致小馆', cat:'dining', area:'wukang', rating:4.6, reviews:3800, per:240, open:11.5, close:21.5, dur:90, tags:['romantic','upscale','quiet','photo'], ugc:'梧桐树下的小资约会地', queue:0.4, dx:-0.004, dy:0.002 },
  { id:'d18', name:'亲子主题餐厅', cat:'dining', area:'xujiahui', rating:4.2, reviews:6200, per:110, open:10.5, close:21, dur:80, tags:['family','lively','budget'], ugc:'有儿童区和宝宝餐,带娃省心', queue:0.5, dx:0.002, dy:0.004 },
  { id:'d19', name:'新天地意大利餐厅', cat:'dining', area:'xintiandi', rating:4.5, reviews:4400, per:300, open:11.5, close:23, dur:100, tags:['romantic','upscale','trendy','photo'], ugc:'手工意面正宗,氛围浪漫', queue:0.45, dx:0.003, dy:-0.002 },
  { id:'d20', name:'静安寺亲子日餐', cat:'dining', area:'jingan', rating:4.3, reviews:3900, per:160, open:11, close:21, dur:75, tags:['family','quiet','foodie'], ugc:'分区安静,定食适合小孩', queue:0.4, dx:-0.002, dy:-0.003 },
  { id:'d21', name:'外滩亲子西餐', cat:'dining', area:'bund', rating:4.2, reviews:5100, per:200, open:10, close:21.5, dur:85, tags:['family','romantic'], ugc:'有儿童菜单,落地窗看船', queue:0.45, dx:-0.003, dy:0.003 },

  // ============ 咖啡茶饮 cafe (14) ============
  { id:'c01', name:'外滩观景咖啡', cat:'cafe', area:'bund', rating:4.6, reviews:6700, per:65, open:8, close:22, dur:45, tags:['photo','romantic','trendy','upscale'], ugc:'露台正对江景,出片率超高', queue:0.5, dx:0.003, dy:-0.002 },
  { id:'c02', name:'武康路梧桐咖啡', cat:'cafe', area:'wukang', rating:4.7, reviews:8900, per:55, open:8.5, close:21, dur:50, tags:['photo','quiet','romantic','trendy'], ugc:'网红打卡点,街角第一眼就想拍', queue:0.65, dx:-0.003, dy:0.002 },
  { id:'c03', name:'静安独立咖啡馆', cat:'cafe', area:'jingan', rating:4.5, reviews:3400, per:48, open:9, close:20, dur:55, tags:['quiet','cultural','local'], ugc:'手冲很专业,适合安静坐一下午', queue:0.35, dx:0.002, dy:0.003 },
  { id:'c04', name:'田子坊文艺茶室', cat:'cafe', area:'tianzifang', rating:4.4, reviews:4200, per:60, open:10, close:21, dur:60, tags:['cultural','quiet','photo','romantic'], ugc:'老房子里的茶空间,很有味道', queue:0.4, dx:-0.002, dy:0.003 },
  { id:'c05', name:'新天地精品咖啡', cat:'cafe', area:'xintiandi', rating:4.5, reviews:5600, per:58, open:8, close:22, dur:45, tags:['trendy','upscale','photo'], ugc:'豆子选得好,环境时髦', queue:0.5, dx:0.003, dy:-0.003 },
  { id:'c06', name:'大学路学院咖啡', cat:'cafe', area:'daxuelu', rating:4.3, reviews:7100, per:38, open:8, close:23, dur:60, tags:['budget','cultural','lively','local'], ugc:'学生最爱,价格友好能久坐', queue:0.45, dx:-0.003, dy:0.002 },
  { id:'c07', name:'陆家嘴云端茶歇', cat:'cafe', area:'lujiazui', rating:4.4, reviews:2900, per:80, open:9, close:21, dur:40, tags:['upscale','photo','trendy'], ugc:'高空俯瞰,商务下午茶首选', queue:0.4, dx:0.002, dy:-0.002 },
  { id:'c08', name:'人民广场城市咖啡', cat:'cafe', area:'peoplesq', rating:4.2, reviews:6300, per:45, open:7.5, close:21, dur:40, tags:['trendy','local','lively'], ugc:'地铁口出来就能喝,通勤友好', queue:0.5, dx:-0.002, dy:0.002 },
  { id:'c09', name:'徐家汇亲子咖啡', cat:'cafe', area:'xujiahui', rating:4.1, reviews:2200, per:50, open:9, close:20, dur:55, tags:['family','quiet','budget'], ugc:'有童书角,带娃喝咖啡不慌', queue:0.3, dx:0.003, dy:0.003 },
  { id:'c10', name:'豫园老茶馆', cat:'cafe', area:'yuyuan', rating:4.3, reviews:5400, per:70, open:9, close:21, dur:65, tags:['cultural','local','quiet','photo'], ugc:'听评弹品茶,老上海情调', queue:0.4, dx:-0.002, dy:0.003 },
  { id:'c11', name:'衡复花园咖啡', cat:'cafe', area:'wukang', rating:4.6, reviews:3600, per:62, open:9, close:20, dur:55, tags:['nature','quiet','romantic','photo'], ugc:'院子里有花有树,慵懒惬意', queue:0.45, dx:-0.004, dy:0.003 },
  { id:'c12', name:'静安寺商场咖啡', cat:'cafe', area:'jingan', rating:4.0, reviews:4800, per:42, open:8, close:22, dur:35, tags:['trendy','lively','budget'], ugc:'逛街间隙歇脚,出杯快', queue:0.4, dx:-0.003, dy:-0.002 },
  { id:'c13', name:'外滩手作茶饮', cat:'cafe', area:'bund', rating:4.2, reviews:8100, per:32, open:10, close:22, dur:25, tags:['trendy','budget','photo','lively'], ugc:'国风茶饮,杯子很上镜', queue:0.6, dx:-0.003, dy:-0.003 },
  { id:'c14', name:'大学路宠物友好咖啡', cat:'cafe', area:'daxuelu', rating:4.4, reviews:3300, per:46, open:9, close:22, dur:60, tags:['family','lively','trendy','local'], ugc:'可以撸猫撸狗,遛娃也合适', queue:0.4, dx:0.003, dy:-0.003 },

  // ============ 文化艺术 culture (13) ============
  { id:'u01', name:'外滩美术馆', cat:'culture', area:'bund', rating:4.6, reviews:5200, per:80, open:10, close:18, dur:90, tags:['cultural','photo','quiet','upscale'], ugc:'当代艺术展质量高,建筑也美', queue:0.4, dx:0.004, dy:-0.002 },
  { id:'u02', name:'人民广场城市历史馆', cat:'culture', area:'peoplesq', rating:4.5, reviews:6800, per:0, open:9, close:17, dur:80, tags:['cultural','family','quiet'], ugc:'免费看老上海变迁,带娃涨知识', queue:0.45, dx:-0.003, dy:0.002 },
  { id:'u03', name:'当代艺术博物馆', cat:'culture', area:'xujiahui', rating:4.7, reviews:4100, per:60, open:10, close:18, dur:100, tags:['cultural','photo','quiet'], ugc:'空间感超强,随手拍都是大片', queue:0.35, dx:0.003, dy:-0.003 },
  { id:'u04', name:'武康路历史建筑群', cat:'culture', area:'wukang', rating:4.6, reviews:9200, per:0, open:0, close:24, dur:60, tags:['cultural','photo','romantic','local'], ugc:'梧桐与老洋房,citywalk 经典线', queue:0.5, dx:-0.003, dy:0.003 },
  { id:'u05', name:'田子坊艺术弄堂', cat:'culture', area:'tianzifang', rating:4.3, reviews:11400, per:0, open:9, close:22, dur:70, tags:['cultural','photo','trendy','lively','local'], ugc:'小店密布,拍照逛展两不误', queue:0.6, dx:-0.002, dy:0.002 },
  { id:'u06', name:'豫园古典园林', cat:'culture', area:'yuyuan', rating:4.5, reviews:18900, per:40, open:8.5, close:17, dur:90, tags:['cultural','photo','family','local'], ugc:'江南园林精华,亭台楼阁很出片', queue:0.7, dx:0.002, dy:0.003 },
  { id:'u07', name:'新天地石库门博物馆', cat:'culture', area:'xintiandi', rating:4.4, reviews:3700, per:30, open:10, close:18, dur:60, tags:['cultural','quiet','photo'], ugc:'还原老上海里弄生活,小而精', queue:0.3, dx:0.003, dy:-0.002 },
  { id:'u08', name:'静安雕塑公园展区', cat:'culture', area:'jingan', rating:4.3, reviews:4500, per:0, open:6, close:22, dur:55, tags:['cultural','nature','photo','family'], ugc:'露天雕塑+草坪,遛娃拍照都行', queue:0.35, dx:0.002, dy:0.004 },
  { id:'u09', name:'大学路独立书店', cat:'culture', area:'daxuelu', rating:4.5, reviews:5300, per:20, open:10, close:22, dur:60, tags:['cultural','quiet','local','photo'], ugc:'选书有品味,咖啡区可久坐', queue:0.3, dx:-0.003, dy:0.002 },
  { id:'u10', name:'陆家嘴科技馆', cat:'culture', area:'lujiazui', rating:4.4, reviews:14200, per:90, open:9, close:17, dur:120, tags:['family','cultural','lively'], ugc:'互动展项多,小孩能玩一下午', queue:0.6, dx:-0.002, dy:-0.002 },
  { id:'u11', name:'徐家汇藏书楼', cat:'culture', area:'xujiahui', rating:4.5, reviews:2800, per:0, open:9, close:17, dur:50, tags:['cultural','quiet','photo'], ugc:'百年藏书楼,安静又有历史感', queue:0.25, dx:-0.002, dy:0.003 },
  { id:'u12', name:'外滩历史陈列馆', cat:'culture', area:'bund', rating:4.3, reviews:6100, per:50, open:9, close:17, dur:70, tags:['cultural','family','quiet'], ugc:'讲透万国建筑群的来龙去脉', queue:0.4, dx:-0.003, dy:-0.002 },
  { id:'u13', name:'亲子科学探索馆', cat:'culture', area:'daxuelu', rating:4.4, reviews:7600, per:80, open:9, close:18, dur:110, tags:['family','cultural','lively'], ugc:'动手做实验,孩子玩到不肯走', queue:0.55, dx:0.002, dy:-0.003 },

  // ============ 娱乐体验 entertainment (12) ============
  { id:'e01', name:'新天地沉浸式剧场', cat:'entertainment', area:'xintiandi', rating:4.7, reviews:4900, per:280, open:14, close:22.5, dur:120, tags:['trendy','romantic','lively'], ugc:'观演体验炸裂,情侣约会很加分', queue:0.5, dx:-0.003, dy:0.002 },
  { id:'e02', name:'外滩 LiveHouse', cat:'entertainment', area:'bund', rating:4.5, reviews:3600, per:160, open:19, close:25.5, dur:130, tags:['nightlife','lively','trendy'], ugc:'乐队现场氛围好,蹦迪首选', queue:0.45, dx:0.003, dy:-0.003 },
  { id:'e03', name:'徐家汇密室逃脱', cat:'entertainment', area:'xujiahui', rating:4.4, reviews:8200, per:150, open:11, close:24, dur:120, tags:['lively','trendy'], ugc:'机关精巧,一群人玩超带感', queue:0.6, dx:0.002, dy:0.003 },
  { id:'e04', name:'亲子室内乐园', cat:'entertainment', area:'xujiahui', rating:4.3, reviews:11200, per:120, open:9.5, close:21, dur:120, tags:['family','lively'], ugc:'滑梯海洋球应有尽有,娃放电神器', queue:0.55, dx:-0.003, dy:-0.002 },
  { id:'e05', name:'静安剧院话剧', cat:'entertainment', area:'jingan', rating:4.6, reviews:5400, per:220, open:19, close:22, dur:130, tags:['cultural','romantic','upscale'], ugc:'话剧质量高,文艺约会优选', queue:0.4, dx:0.002, dy:0.004 },
  { id:'e06', name:'大学路桌游吧', cat:'entertainment', area:'daxuelu', rating:4.4, reviews:4700, per:60, open:13, close:25.5, dur:150, tags:['lively','budget','trendy','local'], ugc:'桌游种类全,朋友局一坐一晚', queue:0.4, dx:-0.002, dy:0.003 },
  { id:'e07', name:'陆家嘴观光厅', cat:'entertainment', area:'lujiazui', rating:4.5, reviews:21000, per:180, open:9, close:22, dur:80, tags:['photo','romantic','family','trendy'], ugc:'城市天际线一览无余,必拍', queue:0.7, dx:0.002, dy:-0.002 },
  { id:'e08', name:'田子坊手作工坊', cat:'entertainment', area:'tianzifang', rating:4.3, reviews:3900, per:130, open:10.5, close:21, dur:100, tags:['photo','romantic','cultural','trendy'], ugc:'做陶/做香,情侣亲子都适合', queue:0.4, dx:-0.002, dy:0.002 },
  { id:'e09', name:'人广电玩城', cat:'entertainment', area:'peoplesq', rating:4.2, reviews:9600, per:90, open:10, close:24, dur:90, tags:['lively','trendy','family'], ugc:'娃娃机抓不停,年轻人解压', queue:0.5, dx:-0.003, dy:0.003 },
  { id:'e10', name:'徐家汇 IMAX 影城', cat:'entertainment', area:'xujiahui', rating:4.4, reviews:15800, per:80, open:10, close:25.5, dur:140, tags:['lively','trendy','family','romantic'], ugc:'巨幕音效一流,看大片就来这', queue:0.45, dx:0.004, dy:0.002 },
  { id:'e11', name:'静安亲子绘本馆', cat:'entertainment', area:'jingan', rating:4.3, reviews:2600, per:70, open:9.5, close:19, dur:90, tags:['family','quiet','cultural'], ugc:'安静的亲子阅读空间,小宝宝友好', queue:0.3, dx:-0.002, dy:-0.003 },
  { id:'e12', name:'大学路脱口秀小剧场', cat:'entertainment', area:'daxuelu', rating:4.5, reviews:4100, per:120, open:19.5, close:23, dur:110, tags:['lively','trendy','nightlife'], ugc:'笑到肚子疼,朋友聚会很合适', queue:0.45, dx:0.003, dy:-0.003 },

  // ============ 购物 shopping (11) ============
  { id:'s01', name:'南京路步行街', cat:'shopping', area:'peoplesq', rating:4.3, reviews:32000, per:200, open:10, close:22, dur:90, tags:['lively','local','trendy'], ugc:'老字号与潮牌都有,人气最旺', queue:0.5, dx:0.002, dy:-0.002 },
  { id:'s02', name:'静安高奢商场', cat:'shopping', area:'jingan', rating:4.5, reviews:12400, per:500, open:10, close:22, dur:100, tags:['upscale','trendy','photo'], ugc:'一线大牌齐全,环境精致', queue:0.4, dx:-0.003, dy:0.002 },
  { id:'s03', name:'新天地时尚街区', cat:'shopping', area:'xintiandi', rating:4.4, reviews:9800, per:300, open:10, close:22.5, dur:90, tags:['trendy','photo','romantic','upscale'], ugc:'设计师品牌多,边逛边拍', queue:0.45, dx:0.003, dy:-0.002 },
  { id:'s04', name:'田子坊文创市集', cat:'shopping', area:'tianzifang', rating:4.2, reviews:14600, per:120, open:10, close:22, dur:80, tags:['trendy','photo','local','lively'], ugc:'小众文创和手作,适合淘礼物', queue:0.55, dx:-0.002, dy:0.003 },
  { id:'s05', name:'徐家汇综合商场', cat:'shopping', area:'xujiahui', rating:4.3, reviews:18900, per:250, open:10, close:22, dur:100, tags:['lively','family','trendy'], ugc:'吃喝玩买一站式,带娃也方便', queue:0.5, dx:0.002, dy:0.003 },
  { id:'s06', name:'陆家嘴江景商场', cat:'shopping', area:'lujiazui', rating:4.5, reviews:16200, per:350, open:10, close:22, dur:100, tags:['upscale','trendy','photo','family'], ugc:'高层有观景餐厅,购物看江景', queue:0.45, dx:0.002, dy:-0.002 },
  { id:'s07', name:'豫园老街市集', cat:'shopping', area:'yuyuan', rating:4.2, reviews:22000, per:100, open:9, close:21, dur:80, tags:['local','photo','lively','cultural'], ugc:'非遗手作和小吃,年味十足', queue:0.65, dx:-0.002, dy:0.003 },
  { id:'s08', name:'大学路潮流小店', cat:'shopping', area:'daxuelu', rating:4.3, reviews:6700, per:150, open:11, close:22, dur:70, tags:['trendy','local','photo','lively'], ugc:'年轻设计师集合,逛吃一条街', queue:0.4, dx:-0.003, dy:0.002 },
  { id:'s09', name:'武康路买手店', cat:'shopping', area:'wukang', rating:4.5, reviews:4300, per:400, open:11, close:21, dur:60, tags:['upscale','trendy','photo','quiet'], ugc:'选品有态度,小资淘货地', queue:0.35, dx:-0.004, dy:0.002 },
  { id:'s10', name:'人广亲子购物中心', cat:'shopping', area:'peoplesq', rating:4.2, reviews:11100, per:180, open:10, close:22, dur:90, tags:['family','lively','budget'], ugc:'有母婴区和玩具城,溜娃购物两便', queue:0.45, dx:-0.003, dy:0.003 },
  { id:'s11', name:'外滩礼品集合店', cat:'shopping', area:'bund', rating:4.1, reviews:5600, per:120, open:10, close:22, dur:50, tags:['local','photo','trendy'], ugc:'城市文创伴手礼,适合送人', queue:0.4, dx:-0.003, dy:-0.002 },

  // ============ 夜景酒吧 nightscape (12) ============
  { id:'n01', name:'外滩屋顶酒吧', cat:'nightscape', area:'bund', rating:4.7, reviews:8900, per:280, open:18, close:26, dur:90, tags:['nightlife','romantic','photo','upscale','trendy'], ugc:'对岸天际线尽收眼底,约会顶配', queue:0.6, dx:0.004, dy:-0.003 },
  { id:'n02', name:'陆家嘴高空酒廊', cat:'nightscape', area:'lujiazui', rating:4.8, reviews:6400, per:380, open:18, close:25.5, dur:90, tags:['nightlife','romantic','photo','upscale'], ugc:'云端俯瞰外滩,氛围感满分', queue:0.55, dx:0.002, dy:-0.002 },
  { id:'n03', name:'新天地清吧', cat:'nightscape', area:'xintiandi', rating:4.5, reviews:5200, per:180, open:18.5, close:26, dur:90, tags:['nightlife','romantic','trendy'], ugc:'安静小酌,适合慢慢聊天', queue:0.45, dx:0.003, dy:-0.002 },
  { id:'n04', name:'静安精酿酒吧', cat:'nightscape', area:'jingan', rating:4.5, reviews:6700, per:140, open:17, close:26, dur:90, tags:['nightlife','lively','trendy','local'], ugc:'精酿种类多,朋友小聚很热闹', queue:0.5, dx:-0.003, dy:0.002 },
  { id:'n05', name:'外滩江畔夜游', cat:'nightscape', area:'bund', rating:4.4, reviews:24000, per:150, open:18, close:22, dur:60, tags:['romantic','photo','family','local'], ugc:'坐船看两岸灯光,老少咸宜', queue:0.65, dx:-0.003, dy:-0.003 },
  { id:'n06', name:'田子坊小酒馆', cat:'nightscape', area:'tianzifang', rating:4.3, reviews:4800, per:120, open:18, close:25.5, dur:90, tags:['nightlife','lively','trendy','local'], ugc:'弄堂里的烟火小酒馆,接地气', queue:0.45, dx:-0.002, dy:0.003 },
  { id:'n07', name:'大学路露台酒吧', cat:'nightscape', area:'daxuelu', rating:4.4, reviews:5300, per:110, open:18, close:26, dur:90, tags:['nightlife','lively','trendy','budget'], ugc:'学生价精酿,露台很惬意', queue:0.4, dx:0.003, dy:-0.003 },
  { id:'n08', name:'武康路威士忌吧', cat:'nightscape', area:'wukang', rating:4.6, reviews:3100, per:260, open:19, close:26, dur:100, tags:['nightlife','romantic','quiet','upscale'], ugc:'藏在老洋房里的安静酒吧', queue:0.4, dx:-0.004, dy:0.003 },
  { id:'n09', name:'人广天台观景台', cat:'nightscape', area:'peoplesq', rating:4.3, reviews:9200, per:60, open:17, close:23, dur:50, tags:['photo','romantic','family','trendy'], ugc:'市中心夜景一览,免费出片', queue:0.5, dx:-0.002, dy:0.002 },
  { id:'n10', name:'徐家汇音乐酒吧', cat:'nightscape', area:'xujiahui', rating:4.3, reviews:6100, per:160, open:19, close:26, dur:100, tags:['nightlife','lively','trendy'], ugc:'驻唱好听,下班放松的好去处', queue:0.45, dx:0.004, dy:0.002 },
  { id:'n11', name:'豫园灯会夜赏', cat:'nightscape', area:'yuyuan', rating:4.5, reviews:19800, per:50, open:18, close:22, dur:70, tags:['photo','family','cultural','local','romantic'], ugc:'古建配花灯,夜晚美得不真实', queue:0.7, dx:-0.002, dy:0.003 },
  { id:'n12', name:'陆家嘴江畔散步道', cat:'nightscape', area:'lujiazui', rating:4.4, reviews:13400, per:0, open:0, close:24, dur:50, tags:['romantic','photo','nature','family','local'], ugc:'免费滨江步道,夜跑遛娃都行', queue:0.3, dx:0.003, dy:0.002 },
];

export const POIS: POI[] = S.map((s) => {
  const center = AREA_MAP[s.area];
  const source =
    s.cat === 'culture' || s.cat === 'entertainment'
      ? 'mock_meituan'
      : s.cat === 'dining' || s.cat === 'cafe'
        ? 'mock_dianping'
        : 'mock_map';
  const confidence = Math.min(0.96, 0.72 + Math.log10(Math.max(10, s.reviews)) * 0.055 + s.rating * 0.015);
  const freshness = s.cat === 'nightscape' || s.queue >= 0.65 ? 'daily' : s.cat === 'shopping' ? 'static' : 'daily';
  return {
    id: s.id,
    name: s.name,
    category: s.cat,
    area: s.area,
    lat: +(center.lat + s.dy).toFixed(5),
    lng: +(center.lng + s.dx).toFixed(5),
    rating: s.rating,
    reviews: s.reviews,
    perCapita: s.per,
    openHour: s.open,
    closeHour: s.close,
    avgDuration: s.dur,
    sceneTags: s.tags,
    ugc: s.ugc,
    queueBase: s.queue,
    source,
    confidence: +confidence.toFixed(2),
    freshness,
  };
});

export const POI_MAP: Record<string, POI> = Object.fromEntries(
  POIS.map((p) => [p.id, p]),
);

// 便捷分组
export function poisByCategory(cat: Category): POI[] {
  return POIS.filter((p) => p.category === cat);
}
