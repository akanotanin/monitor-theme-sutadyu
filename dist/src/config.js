/**
 * 小镇 · 布局与配色
 * 常用坐标与比例统一收在这张常量表：
 * 地图 42.5 × 36.2，河在 x∈[7.15,10.85] 南北向，木桥在 z∈[-1.54,1.54]。
 */

/* ------------------------------ 地图 ------------------------------ */

export const MAP = { x1: -21.25, x2: 21.25, z1: -18.1, z2: 18.1 };

export const RIVER = {
  centerX: 9,
  halfWidth: 1.85, // 水面半宽
  waterY: -0.22, // 水面高度
  bedY: -0.6, // 河床顶面
};

export const BRIDGE = { x1: 6.65, x2: 11.35, z1: -1.54, z2: 1.54, deckY: 0.33 };

/** 可行走的水上平台 */
export const WALKWAYS = [BRIDGE];

export const PLAZA = { x: -2, z: 0, w: 9, d: 7 };

export const FARM = {
  x1: -14.6,
  x2: -4.8,
  z1: 10.1,
  z2: 17.2,
  gateZ1: 12.1,
  gateZ2: 14.9,
};

/** 石板 / 土路：按网格铺小砖 */
export const PATHS = [
  { x: -2, z: 0, w: 9, d: 7, stone: true }, // 广场
  { x: -2, z: 9.2, w: 2.25, d: 12.2 },
  { x: -2, z: -9.4, w: 2.25, d: 12.2 },
  { x: -10.3, z: 0, w: 14.4, d: 2.15 },
  { x: 4.7, z: 0, w: 4.4, d: 2.4 },
  { x: 14.7, z: 0, w: 8.2, d: 2.3 },
  { x: -8.8, z: 8.7, w: 15.3, d: 1.65 },
  { x: -3.9, z: 13.6, w: 3.4, d: 1.7 },
  { x: -8.1, z: -3.2, w: 2.1, d: 4.4 },
  { x: 1.2, z: -3.8, w: 2, d: 5.2 },
  { x: -9.7, z: 7.75, w: 2, d: 2.1 },
  { x: 15.2, z: -3, w: 1.65, d: 5.8 },
  { x: 1.1, z: 11.35, w: 8.6, d: 1.55 },
];

/* ------------------------------ 房屋 ------------------------------ */

export const HOUSES = [
  {
    id: 'bakery', name: '麦香面包房', x: -9, z: -6, width: 4.8, depth: 4,
    wall: '#e9bd78', roof: '#b85f49', roofAlt: '#d47a58', trim: '#704c38',
    door: '#68836a', shutter: '#7e9b78', awning: true, windowStyle: 1, sign: '麦香面包',
  },
  {
    id: 'blue', name: '蓝顶小屋', x: 1.3, z: -7.4, width: 4.1, depth: 3.7,
    wall: '#f0d6a4', roof: '#62899b', roofAlt: '#7ca2ae', trim: '#72533e',
    door: '#b46952', shutter: '#d08368', roofLayers: 5, roofRise: 0.38, dormer: true, windowStyle: 2,
  },
  {
    id: 'teal', name: '青瓦人家', x: -10, z: 4.8, width: 4.2, depth: 4,
    wall: '#e6a99b', roof: '#5f8c7d', roofAlt: '#7ba291', trim: '#76513d',
    door: '#876493', shutter: '#f0cf91', roofLayers: 7, roofRise: 0.22, gable: true,
  },
  {
    id: 'orange', name: '橙顶农舍', x: 4.4, z: 8.8, width: 4.2, depth: 3.6,
    wall: '#b9c795', roof: '#c17b4f', roofAlt: '#da9863', trim: '#6e533c',
    door: '#65859b', shutter: '#8b9e6b', roofLayers: 5, roofRise: 0.34, windowStyle: 1,
  },
  {
    id: 'cabin', name: '紫顶木屋', x: 16.3, z: -7, width: 3.8, depth: 3.6,
    wall: '#d8b586', roof: '#7d6a91', roofAlt: '#9980a5', trim: '#674d3c',
    door: '#9c5f49', shutter: '#8c9d72', roofLayers: 4, roofRise: 0.24, cabin: true, windowStyle: 2,
  },
];

/* ------------------------------ 装饰位置 ------------------------------ */

export const LAMPS = [
  [-5.5, -0.8], [1.7, -2.75], [-5.5, 6.6], [-2.9, 10.1],
  [5.7, -1.75], [12.4, -2.2], [18.4, -2.65],
];

export const BENCHES = [
  [-3.8, -2.3, 0], [0.8, -2.2, Math.PI], [17, 2.8, 0],
];

export const PLANTERS = [
  [-5.25, 1.1, 1.15, 2.05], [1.25, 0.95, 1.2, 1.8], [-6.2, -3.15, 1.5, 0.7],
  [3.9, -5.1, 1.1, 1.8], [-12.6, 7.15, 1.3, 0.75], [13.25, -4.7, 1.4, 0.8],
  [19, 5.3, 1, 2.1],
];

export const CRATES = [
  [-12.15, -4.1, 0.72, 0], [-12.25, -3.35, 0.58, 0.3], [3.85, -6.1, 0.68, 0],
  [3.65, 12.55, 0.74, 0.2], [18.6, -4.85, 0.68, 0], [17.65, 5.55, 0.62, 0.4],
];

export const BARRELS = [[-11.95, -3.45], [-7.3, 7.35]];

export const FENCES = [
  { x1: -14.6, z1: 10.1, x2: -14.6, z2: 17.2, n: 6 },
  { x1: -14.6, z1: 17.2, x2: -4.8, z2: 17.2, n: 8 },
  { x1: -14.6, z1: 10.1, x2: -4.8, z2: 10.1, n: 8 },
  { x1: -4.8, z1: 10.1, x2: -4.8, z2: 12.1, n: 2 },
  { x1: -4.8, z1: 14.9, x2: -4.8, z2: 17.2, n: 2 },
  { x1: -17.2, z1: -1.8, x2: -12.6, z2: -1.8, n: 4 },
  { x1: -16.8, z1: 9.1, x2: -12.3, z2: 9.1, n: 4 },
];

export const SIGN = { x: -4.7, z: 3.65 };
export const FOUNTAIN = { x: -2, z: 0 };

/** 固定树 [x, z, scale] */
export const TREES = [
  [-19, -15, 1.15], [-16.7, -15.8, 1], [-13.8, -15.2, 1.2], [-5, -15.8, 1.05],
  [4.8, -15.4, 1.15], [-19, -10.8, 1.1], [-18.7, -5.5, 1], [-19, 1.2, 1.2],
  [-18.8, 6.1, 1], [-19, 13.4, 1.1], [-17.1, 16.2, 1], [-3.9, -12.8, 0.9],
  [5, -11.9, 0.9], [-15.6, 2.7, 0.85], [-15.9, 7.1, 0.95],
];

/** 灌木 [x, z] */
export const BUSHES = [
  [-16, 11], [-16.5, 14], [-15.8, 17.5], [-6, -11], [-3, -12], [4, -13],
  [5.8, -10], [19, -10], [20, -6], [20, -1], [20, 8], [18, 10], [14, 9],
  [-17, -9], [-17, -6], [-16, 1], [-14, 8], [5, 14], [6, 12], [-12, -11],
  [-18, 3], [3, 16],
];

/** 村民 */
export const NPCS = [
  {
    id: 'lulu', name: '露露', x: 0.75, z: 3.15,
    shirt: '#d98578', pants: '#6d8294', accent: '#f3cf7d', hair: '#71503d',
    lines: [
      '今天的风是蜂蜜色的。喷泉边的小花，昨天才刚刚开呢。',
      '过桥以后有一片野餐草地。慢慢走过去，别错过河边的小鸭子。',
      '小镇不赶时间，你也可以不赶时间。',
    ],
  },
  {
    id: 'ahe', name: '阿禾', x: -3.35, z: 13.25,
    shirt: '#e4b45f', pants: '#718258', accent: '#ba6748', hair: '#624738', hat: '#c99a58',
    lines: [
      '田里的南瓜已经熟啦，靠近后按 E 就能采摘。摘下的都是你的！',
      '泥土香比什么都让人安心。今天卷心菜也长得精神抖擞。',
      '累了就在田边坐一会儿，庄稼也需要晒晒太阳。',
    ],
  },
  {
    id: 'noah', name: '诺亚', x: 14.2, z: 1.25,
    shirt: '#78958a', pants: '#765f52', accent: '#e3c58a', hair: '#50443e', hat: '#718164',
    lines: [
      '木桥刚检修过，放心走吧。顺着小路向北，能看见紫色屋顶的木屋。',
      '树林里的蘑菇不能乱吃，不过看看也很可爱，对吧？',
      '听，溪水把今天的故事又讲了一遍。',
    ],
  },
];

export const PLAYER_START = { x: -0.3, z: 2.2 };

/** 作物 */
export const CROPS = [
  { type: 'pumpkin', name: '金色南瓜' },
  { type: 'cabbage', name: '脆叶卷心菜' },
  { type: 'sunflower', name: '太阳花' },
  { type: 'turnip', name: '甜菜根' },
];

/* ------------------------------ 配色 ------------------------------ */

export const C = {
  dirtBase: 0x75583f,
  grassWest: 0x78a06c,
  grassEast: 0x6f9667,
  rim: 0x7c9272,
  edge: [0x6f5541, 0x806047, 0x8c6a4b],
  patch: [0x7da36b, 0x82a770, 0x769c68, 0x89ab72, 0x7a9f6b, 0x729765],
  dirtPath: 0xcfa977,
  pathTiles: [0xdfbd84, 0xe4c38c, 0xd6b27a, 0xe8ca94],
  stoneBase: 0xb8a795,
  stoneTiles: [0xded2bd, 0xcdbda7, 0xe7dbc5, 0xc1b09b],
  water: 0x3f9ea8,
  waterShallow: 0x77b9a7,
  riverbed: 0x396f78,
  bankStone: [0x9c9270, 0xa89d79, 0x8b886b],
  wood: 0xa97949,
  woodLight: [0xa97949, 0xb88953, 0xc0945e],
  woodDark: 0x78583d,
  woodMid: 0x9c7449,
  trunk: 0x8a6240,
  flowers: [0xe88783, 0xf0c45e, 0xb39aca, 0xf5dfac, 0xdc7894],
  grass: [0x6f9154, 0x7f9e5b, 0x8ca764],
  leaves: [
    ['#3f7356', '#578a60', '#6c9e68', '#7bad70'],
    ['#4f7750', '#6a9258', '#7ea35f', '#90b36c'],
    ['#3e6b62', '#4f8270', '#669477', '#7ca47c'],
    ['#6e8547', '#879c52', '#9aab5e', '#aebb6e'],
  ],
};

/* ------------------------------ 几何小工具 ------------------------------ */

/** 河面范围（南北向，贯穿整张地图） */
export function isInRiver(x, z) {
  return x > RIVER.centerX - RIVER.halfWidth && x < RIVER.centerX + RIVER.halfWidth && Math.abs(z) < 45;
}

/** 木桥桥面 */
export function isOnBridge(x, z) {
  return x > BRIDGE.x1 && x < BRIDGE.x2 && z > BRIDGE.z1 && z < BRIDGE.z2;
}

/** 站上去之后脚底的高度 */
export function groundHeightAt(x, z) {
  if (isOnBridge(x, z)) {
    // 桥头做一点缓坡，走上去不会突然弹一下
    if (x < BRIDGE.x1 + 0.9) return 0.1 + (BRIDGE.deckY - 0.1) * ((x - BRIDGE.x1) / 0.9);
    if (x > BRIDGE.x2 - 0.9) return 0.1 + (BRIDGE.deckY - 0.1) * ((BRIDGE.x2 - x) / 0.9);
    return BRIDGE.deckY;
  }
  return 0.1;
}
