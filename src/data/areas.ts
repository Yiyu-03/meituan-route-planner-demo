import type { Area } from '../types';

// 10 个上海代表性区域中心点(近似真实经纬度,用于 Haversine 距离估算)
export const AREAS: Area[] = [
  { key: 'bund',       name: '外滩',        lat: 31.2397, lng: 121.4905 },
  { key: 'peoplesq',   name: '人民广场',    lat: 31.2304, lng: 121.4737 },
  { key: 'xintiandi',  name: '新天地',      lat: 31.2204, lng: 121.4753 },
  { key: 'tianzifang', name: '田子坊·打浦桥', lat: 31.2095, lng: 121.4680 },
  { key: 'jingan',     name: '静安寺',      lat: 31.2237, lng: 121.4453 },
  { key: 'xujiahui',   name: '徐家汇',      lat: 31.1951, lng: 121.4370 },
  { key: 'lujiazui',   name: '陆家嘴',      lat: 31.2397, lng: 121.4998 },
  { key: 'wukang',     name: '武康路·衡复',  lat: 31.2098, lng: 121.4348 },
  { key: 'yuyuan',     name: '豫园·老城厢',  lat: 31.2271, lng: 121.4920 },
  { key: 'daxuelu',    name: '大学路·五角场', lat: 31.2990, lng: 121.5140 },
];

export const AREA_MAP: Record<string, Area> = Object.fromEntries(
  AREAS.map((a) => [a.key, a]),
);
