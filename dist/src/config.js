/**
 * 小镇 · 布局与配色
 * 常用坐标与比例统一收在这张常量表：
 * 地图 42.5 × 36.2，河在 x∈[7.15,10.85] 南北向，木桥在 z∈[-1.54,1.54]。
 */

/**
 * 小镇整体放大系数：只放大「位置 / 路宽」，房子、树、人、道具的尺寸都不变。
 * 调这一个数就能把镇子摊开（1 = 原始大小），中间的路不会再挤成一条缝。
 */
export const LAYOUT = 1.3;
export const P = (v) => Math.round(v * LAYOUT * 1000) / 1000;

/* ------------------------------ 地图 ------------------------------ */

export const MAP = { x1: P(-21.25), x2: P(21.25), z1: P(-18.1), z2: P(18.1) };

export const RIVER = {
  centerX: P(9),
  halfWidth: 1.85, // 水面半宽
  waterY: -0.22, // 水面高度
  bedY: -0.6, // 河床顶面
};

export const BRIDGE = { x1: P(9) - 2.35, x2: P(9) + 2.35, z1: -1.54, z2: 1.54, deckY: 0.33 };

/** 可行走的水上平台 */
export const WALKWAYS = [BRIDGE];

export const PLAZA = { x: P(-2), z: P(0), w: P(9), d: P(7) };

export const FARM = {
  x1: P(-14.6),
  x2: P(-4.8),
  z1: P(10.1),
  z2: P(17.2),
  gateZ1: P(12.1),
  gateZ2: P(14.9),
};

/** 石板 / 土路：按网格铺小砖 */
export const PATHS = [
  { x: P(-2), z: P(0), w: P(9), d: P(7), stone: true }, // 广场
  { x: P(-2), z: P(9.2), w: P(2.25), d: P(12.2) },
  { x: P(-2), z: P(-9.4), w: P(2.25), d: P(12.2) },
  { x: P(-10.3), z: P(0), w: P(14.4), d: P(2.15) },
  { x: P(4.7), z: P(0), w: P(4.4), d: P(2.4) },
  { x: P(14.7), z: P(0), w: P(8.2), d: P(2.3) },
  { x: P(-8.8), z: P(8.7), w: P(15.3), d: P(1.65) },
  { x: P(-3.9), z: P(13.6), w: P(3.4), d: P(1.7) },
  { x: P(-8.1), z: P(-3.2), w: P(2.1), d: P(4.4) },
  { x: P(1.2), z: P(-3.8), w: P(2), d: P(5.2) },
  { x: P(-9.7), z: P(7.75), w: P(2), d: P(2.1) },
  { x: P(15.2), z: P(-3), w: P(1.65), d: P(5.8) },
  { x: P(1.1), z: P(11.35), w: P(8.6), d: P(1.55) },
];

/* ------------------------------ 房屋 ------------------------------ */

export const HOUSES = [
  {
    id: 'bakery', name: '麦香面包房', x: P(-9), z: P(-6), width: 4.8, depth: 4,
    wall: '#e9bd78', roof: '#b85f49', roofAlt: '#d47a58', trim: '#704c38',
    door: '#68836a', shutter: '#7e9b78', awning: true, windowStyle: 1, sign: '麦香面包',
  },
  {
    id: 'blue', name: '蓝顶小屋', x: P(1.3), z: P(-7.4), width: 4.1, depth: 3.7,
    wall: '#f0d6a4', roof: '#62899b', roofAlt: '#7ca2ae', trim: '#72533e',
    door: '#b46952', shutter: '#d08368', roofLayers: 5, roofRise: 0.38, dormer: true, windowStyle: 2,
  },
  {
    id: 'teal', name: '青瓦人家', x: P(-10), z: P(4.8), width: 4.2, depth: 4,
    wall: '#e6a99b', roof: '#5f8c7d', roofAlt: '#7ba291', trim: '#76513d',
    door: '#876493', shutter: '#f0cf91', roofLayers: 7, roofRise: 0.22, gable: true,
  },
  {
    id: 'orange', name: '橙顶农舍', x: P(4.4), z: P(8.8), width: 4.2, depth: 3.6,
    wall: '#b9c795', roof: '#c17b4f', roofAlt: '#da9863', trim: '#6e533c',
    door: '#65859b', shutter: '#8b9e6b', roofLayers: 5, roofRise: 0.34, windowStyle: 1,
  },
  {
    id: 'cabin', name: '紫顶木屋', x: P(16.3), z: P(-7), width: 3.8, depth: 3.6,
    wall: '#d8b586', roof: '#7d6a91', roofAlt: '#9980a5', trim: '#674d3c',
    door: '#9c5f49', shutter: '#8c9d72', roofLayers: 4, roofRise: 0.24, cabin: true, windowStyle: 2,
  },
];

/* ------------------------------ 装饰位置 ------------------------------ */

export const LAMPS = [
  [P(-5.5), P(-0.8)], [P(1.7), P(-2.75)], [P(-5.5), P(6.6)], [P(-2.9), P(10.1)],
  [P(5.7), P(-1.75)], [P(12.4), P(-2.2)], [P(18.4), P(-2.65)],
];

export const BENCHES = [
  [P(-3.8), P(-2.3), 0], [P(0.8), P(-2.2), Math.PI], [P(17), P(2.8), 0],
];

export const PLANTERS = [
  [P(-5.25), P(1.1), 1.15, 2.05], [P(1.25), P(0.95), 1.2, 1.8], [P(-6.2), P(-3.15), 1.5, 0.7],
  [P(3.9), P(-5.1), 1.1, 1.8], [P(-12.6), P(7.15), 1.3, 0.75], [P(13.25), P(-4.7), 1.4, 0.8],
  [P(19), P(5.3), 1, 2.1],
];

export const CRATES = [
  [P(-12.15), P(-4.1), 0.72, 0], [P(-12.25), P(-3.35), 0.58, 0.3], [P(3.85), P(-6.1), 0.68, 0],
  [P(3.65), P(12.55), 0.74, 0.2], [P(18.6), P(-4.85), 0.68, 0], [P(17.65), P(5.55), 0.62, 0.4],
];

export const BARRELS = [[P(-11.95), P(-3.45)], [P(-7.3), P(7.35)]];

const FN = (n) => Math.round(n * LAYOUT);
export const FENCES = [
  { x1: P(-14.6), z1: P(10.1), x2: P(-14.6), z2: P(17.2), n: FN(6) },
  { x1: P(-14.6), z1: P(17.2), x2: P(-4.8), z2: P(17.2), n: FN(8) },
  { x1: P(-14.6), z1: P(10.1), x2: P(-4.8), z2: P(10.1), n: FN(8) },
  { x1: P(-4.8), z1: P(10.1), x2: P(-4.8), z2: P(12.1), n: FN(2) },
  { x1: P(-4.8), z1: P(14.9), x2: P(-4.8), z2: P(17.2), n: FN(2) },
  { x1: P(-17.2), z1: P(-1.8), x2: P(-12.6), z2: P(-1.8), n: FN(4) },
  { x1: P(-16.8), z1: P(9.1), x2: P(-12.3), z2: P(9.1), n: FN(4) },
];

export const SIGN = { x: P(-4.7), z: P(3.65) };
export const FOUNTAIN = { x: P(-2), z: P(0) };

/** 固定树 [x, z, scale] */
export const TREES = [
  [P(-19), P(-15), 1.15], [P(-16.7), P(-15.8), 1], [P(-13.8), P(-15.2), 1.2], [P(-5), P(-15.8), 1.05],
  [P(4.8), P(-15.4), 1.15], [P(-19), P(-10.8), 1.1], [P(-18.7), P(-5.5), 1], [P(-19), P(1.2), 1.2],
  [P(-18.8), P(6.1), 1], [P(-19), P(13.4), 1.1], [P(-17.1), P(16.2), 1], [P(-3.9), P(-12.8), 0.9],
  [P(5), P(-11.9), 0.9], [P(-15.6), P(2.7), 0.85], [P(-15.9), P(7.1), 0.95],
];

/** 灌木 [x, z] */
export const BUSHES = [
  [P(-16), P(11)], [P(-16.5), P(14)], [P(-15.8), P(17.5)], [P(-6), P(-11)], [P(-3), P(-12)], [P(4), P(-13)],
  [P(5.8), P(-10)], [P(19), P(-10)], [P(20), P(-6)], [P(20), P(-1)], [P(20), P(8)], [P(18), P(10)], [P(14), P(9)],
  [P(-17), P(-9)], [P(-17), P(-6)], [P(-16), P(1)], [P(-14), P(8)], [P(5), P(14)], [P(6), P(12)], [P(-12), P(-11)],
  [P(-18), P(3)], [P(3), P(16)],
];

/** 村民 */
export const NPCS = [
  {
    id: 'lulu', name: '露露', x: P(0.75), z: P(3.15),
    shirt: '#d98578', pants: '#6d8294', accent: '#f3cf7d', hair: '#71503d',
    lines: [
      '今天的风是蜂蜜色的。喷泉边的小花，昨天才刚刚开呢。',
      '过桥以后有一片野餐草地。慢慢走过去，别错过河边的小鸭子。',
      '小镇不赶时间，你也可以不赶时间。',
    ],
  },
  {
    id: 'ahe', name: '阿禾', x: P(-3.35), z: P(13.25),
    shirt: '#e4b45f', pants: '#718258', accent: '#ba6748', hair: '#624738', hat: '#c99a58',
    lines: [
      '田里的南瓜已经熟啦，靠近后按 E 就能采摘。摘下的都是你的！',
      '泥土香比什么都让人安心。今天卷心菜也长得精神抖擞。',
      '累了就在田边坐一会儿，庄稼也需要晒晒太阳。',
    ],
  },
  {
    id: 'noah', name: '诺亚', x: P(14.2), z: P(1.25),
    shirt: '#78958a', pants: '#765f52', accent: '#e3c58a', hair: '#50443e', hat: '#718164',
    lines: [
      '木桥刚检修过，放心走吧。顺着小路向北，能看见紫色屋顶的木屋。',
      '树林里的蘑菇不能乱吃，不过看看也很可爱，对吧？',
      '听，溪水把今天的故事又讲了一遍。',
    ],
  },
];

export const PLAYER_START = { x: P(-0.3), z: P(2.2) };

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
  return x > RIVER.centerX - RIVER.halfWidth && x < RIVER.centerX + RIVER.halfWidth && Math.abs(z) < MAP.z2 + 2;
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
