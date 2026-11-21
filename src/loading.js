/* ------------------------------------------------------------------ *
 * 载入动画 · 像素小镇「建起来」
 *
 * 一颗胶囊视窗里的像素小镇：小鸡一趟趟把木料搬过去，房子按真实加载进度
 * 一层层砌起来（放线 → 地基 → 三段墙 → 门 → 窗 → 两段屋顶 → 烟囱），
 * 树跟着长高、野花跟着冒头；进度满时开窗点灯、升旗、撒花，幕布才揭。
 *
 * 约束：
 *   · 只依赖 canvas 2D，不 import 任何模块 —— 它必须比 three 的模块图先跑；
 *   · 进度来自真实等待（boot 两个接口 → 主模块模块图 → 首帧），不编时间轴；
 *   · 美术画在 216×128 的整数网格上，按 DPR 取整数倍放大，永远是硬边像素。
 * ------------------------------------------------------------------ */

const ART_W = 216;
const ART_H = 128;

/* 胶囊几何：深墨线 1px → 奶油边 3px → 内墨线 1px（照参考视频的三层结构，不额外加投影） */
const PILL = { x0: 9, y0: 9, x1: 206, y1: 118, r: 54 };
const FRAME = { ink: 1, cream: 3, lip: 1 };
const IN = {
  x0: PILL.x0 + FRAME.ink + FRAME.cream + FRAME.lip,
  y0: PILL.y0 + FRAME.ink + FRAME.cream + FRAME.lip,
  x1: PILL.x1 - FRAME.ink - FRAME.cream - FRAME.lip,
  y1: PILL.y1 - FRAME.ink - FRAME.cream - FRAME.lip,
};

/* 地面分层（y 越小越远） */
const G_TREE = 76;   // 远景树线
const G_BACK = 82;   // 后草地：房子 / 树 / 栅栏的落脚线
const G_PATH = 90;   // 土路上沿
const G_FRONT = 99;  // 前景草地上沿
const FEET = 98;     // 小鸡脚底

/* 房子占地：四坡顶（梯形），屋脊是一条横线而不是一个尖 —— 正立面的房子这样才站得住 */
const H = {
  x0: 120, x1: 172, base: G_BACK,
  apexX: 146,
  ridgeY: 45,        // 屋脊高度
  top: 58,           // 檐口高度
  ridgeHalf: 11,     // 屋脊半宽
  eaveHalf: 29,      // 檐口半宽
};
/* 门窗都坐在石基上沿（base - 4 = 78）之上，不能穿进石基里 */
const DOOR = { x: 134, y: 62, w: 11, h: 16 };
const WIN = { x: 152, y: 62, w: 15, h: 13 };

/* 小鸡搬木料的两头 */
const CX0 = 34;
const CX1 = 112;

const C = {
  ink: '#6a4b31',
  hair: 'rgba(122, 90, 62, 0.34)',
  cream: '#fff6dc',
  creamLo: '#f0dcb8',
  lip: '#e6cfa6',
  sky: ['#bcd7e4', '#cfe0dc', '#ebe2c4', '#ffeccb'],
  cloud: '#fffaf0',
  cloudLo: '#e7dbc2',
  hillBack: '#b6cdb0', hillBackRim: '#cbdcc2',
  hillFront: '#9cba95', hillFrontRim: '#b4cdac',
  treeLine: '#7ea178',
  grassBack: '#74996a', grassBackLo: '#688c60', grassBackRim: '#8ab07c',
  grassFront: '#87a978', grassFrontLo: '#789a6a', grassFrontRim: '#9bbd8c',
  path: '#cfa977', pathLo: '#b98e62', pathHi: '#dfbd8d',
  stone: '#c0b09e', stoneLo: '#9a8f6e', stoneHi: '#d5c8b6',
  plaster: '#f4e4c6', plasterLo: '#e3cca4', plasterHi: '#fff8e8',
  wood: '#b88953', woodLo: '#8a6240', woodMid: '#a97949', woodHi: '#d0a068',
  roof: '#c96f5e', roofLo: '#a8503f', roofHi: '#e2907c',
  roofLeft: '#d07865', roofLeftLo: '#b25a48', roofRight: '#a95343', roofRightLo: '#8d4234',
  glass: '#9dc7d6', glassLo: '#7caec0', glow: '#ffe9a8',
  leaf: ['#4f7d5a', '#628a5c', '#76a063', '#8ab372'],
  flower: ['#e88783', '#f0c45e', '#b39aca', '#f5dfac', '#dc7894'],
  comb: '#c93434', beak: '#d98a2b', leg: '#d9a441',
  feather: '#f7f2e6', featherLo: '#dbd0bb', eye: '#2b2622',
  sun: '#f8d792', sunHi: '#fdf0c4',
  flag: '#d9544f', flagHi: '#e8706a',
  smoke: '#efe6d6',
};

/* 进度条配色：比场景木色深一档，小尺寸下也读得出 */
const UI = {
  track: '#f7ecd4', trackLo: '#e4d2ac',
  fill: '#ce7746', fillHi: '#e79a63', fillLo: '#b25f34',
  digit: '#6a4b31',
};

/* 真实进度之上，等待期间最多自动蹭到这么多 —— 绝不越过它去假装完成 */
const CREEP_CAP = 0.88;

/* 5×7 像素数字 */
const GLYPH = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
};

/* 施工阶段：bar 与场景共用同一个 p；房子到 94% 才封顶，别提前完工 */
const AT = {
  stake: 0.06,
  foundation: 0.13,
  wall: [0.22, 0.32, 0.42],
  door: 0.49,
  window: 0.55,
  roof: [0.61, 0.76],
  chimney: 0.83,
  glow: 0.90,
  fence: 0.47,
  bush: 0.57,
  well: [0.40, 0.52, 0.66],
  treeA: [0.10, 0.23, 0.40],
  treeB: [0.34, 0.52, 0.72],
  flower: 0.52,
};

/* ---------------------------- 小工具 ---------------------------- */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** 确定性伪随机：撒花 / 云 / 草丛都用它，帧间不抖 */
function noise(i, seed = 0) {
  const x = Math.sin(i * 127.1 + seed * 311.7 + 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/** stadium 的逐行跨度：两端半圆，中间直边 */
function rowsOf(x0, y0, x1, y1, r) {
  const out = [];
  const h = y1 - y0 + 1;
  const cy = y0 + h / 2;
  for (let i = 0; i < h; i++) {
    const d = Math.abs(y0 + i + 0.5 - cy);
    const cap = d >= r ? 0 : Math.sqrt(r * r - d * d);
    const inset = Math.round(r - cap);
    out.push({ y: y0 + i, x0: x0 + inset, x1: x1 - inset });
  }
  return out;
}

function pathOf(rows) {
  const p = new Path2D();
  for (const r of rows) p.rect(r.x0, r.y, r.x1 - r.x0 + 1, 1);
  return p;
}

function fillRows(ctx, rows, color) {
  ctx.fillStyle = color;
  for (const r of rows) ctx.fillRect(r.x0, r.y, r.x1 - r.x0 + 1, 1);
}

/* ---------------------------- 装载 ---------------------------- */

export function mount() {
  const curtain = document.getElementById('loading');
  const canvas = document.getElementById('ld-canvas');
  if (!curtain || !canvas || !canvas.getContext) return null;
  if (window.__SUTADYU_LOAD__ && window.__SUTADYU_LOAD__.mounted) return window.__SUTADYU_LOAD__;

  const ctx = canvas.getContext('2d');
  const scene = document.createElement('canvas');
  scene.width = ART_W;
  scene.height = ART_H;
  const s = scene.getContext('2d');
  s.imageSmoothingEnabled = false;

  const still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---- 三层胶囊（外墨线 / 奶油边 / 内墨线），场景按最内层裁剪 ---- */
  const rOuter = rowsOf(PILL.x0, PILL.y0, PILL.x1, PILL.y1, PILL.r);
  const rCream = rowsOf(PILL.x0 + FRAME.ink, PILL.y0 + FRAME.ink, PILL.x1 - FRAME.ink, PILL.y1 - FRAME.ink, PILL.r - FRAME.ink);
  const rLip = rowsOf(PILL.x0 + FRAME.ink + FRAME.cream, PILL.y0 + FRAME.ink + FRAME.cream,
    PILL.x1 - FRAME.ink - FRAME.cream, PILL.y1 - FRAME.ink - FRAME.cream, PILL.r - FRAME.ink - FRAME.cream);
  const rInner = rowsOf(IN.x0, IN.y0, IN.x1, IN.y1, PILL.r - FRAME.ink - FRAME.cream - FRAME.lip);
  const pOuter = pathOf(rOuter);
  const pCream = pathOf(rCream);
  const pLip = pathOf(rLip);
  const pScene = pathOf(rInner);
  const SKY = [
    { y0: IN.y0, y1: 36, c: C.sky[0] },
    { y0: 36, y1: 52, c: C.sky[1] },
    { y0: 52, y1: 64, c: C.sky[2] },
    { y0: 64, y1: G_BACK, c: C.sky[3] },
  ];

  /** 某一行的可用横向跨度（胶囊是圆头，靠边那几行要往里收） */
  function innerBand(y, pad = 0) {
    const r = rInner[clamp(Math.round(y) - IN.y0, 0, rInner.length - 1)];
    return [r.x0 + pad, r.x1 - pad];
  }
  const CLOUDS = [
    { x: 34, y: 32, w: 27, s: 0.55 },
    { x: 84, y: 27, w: 19, s: 0.38 },
    { x: 166, y: 34, w: 16, s: 0.30 },
  ];
  const FLOWERS = [];
  for (let i = 0; i < 14; i++) {
    FLOWERS.push({
      x: 20 + Math.round(noise(i, 3) * 176),
      y: 102 + Math.round(noise(i, 7) * 7),
      c: C.flower[i % C.flower.length],
      at: AT.flower + (i / 14) * 0.42,
    });
  }
  const TUFTS = [];
  for (let i = 0; i < 28; i++) {
    const y = 101 + Math.round(noise(i, 13) * 9);
    const band = innerBand(y, 3);
    TUFTS.push({
      x: band[0] + Math.round(noise(i, 11) * Math.max(1, band[1] - band[0])),
      y,
    });
  }
  const TREE_LINE = [];
  for (let x = IN.x0 + 4; x < IN.x1 - 4; x += 7) {
    TREE_LINE.push({ x, h: 4 + Math.round(noise(x, 5) * 4) });
  }

  /* ---- 运行状态 ---- */
  let target = 0.05;
  let shown = 0.02;
  let lastSetAt = 0;      // 上一次收到真实进度的时间（creep 的闸门）
  let phase = 'load';   // load | celebrate | gone
  let phaseT = 0;
  let endCb = null;
  let hopAt = 0;        // 点小鸡：跳跃起点
  let tapAt = 0;        // 点小鸡：气泡起点

  /* ---- 尺寸：整数倍放大，保证像素硬边 ---- */
  let scale = 1;
  function fit() {
    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 640;
    const aspect = ART_H / ART_W;
    const maxH = clamp(vh * 0.46, 96, 420);
    const wantW = Math.min(clamp(vw * 0.86, 200, 420), maxH / aspect);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    // 取最接近目标宽度的整数倍率；别永远退到 1×（1080p 桌面会小得可怜）
    scale = Math.max(1, Math.round((wantW * dpr) / ART_W));
    while (scale > 1 && (ART_W * scale) / dpr > vw * 0.94) scale -= 1;
    const w = ART_W * scale;
    const h = ART_H * scale;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas.style.width = `${Math.round(w / dpr)}px`;
    canvas.style.height = `${Math.round(h / dpr)}px`;
    ctx.imageSmoothingEnabled = false;
  }

  /* ---- 笔触 ---- */
  const px = (x, y, w, h, c) => {
    s.fillStyle = c;
    s.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };

  function blob(cx, cy, rx, ry, c) {
    s.fillStyle = c;
    const y0 = Math.round(cy - ry);
    const y1 = Math.round(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / (ry + 0.4);
      if (Math.abs(dy) > 1) continue;
      const half = Math.max(0, Math.round(rx * Math.sqrt(1 - dy * dy)));
      s.fillRect(Math.round(cx - half), y, Math.max(1, half * 2), 1);
    }
  }

  /* ---------- 天空 / 远景 ---------- */
  function drawSky() {
    for (const b of SKY) px(IN.x0, b.y0, IN.x1 - IN.x0 + 1, b.y1 - b.y0, b.c);
    // 分层交界做两行棋盘抖动，避免生硬横线
    for (let k = 0; k < SKY.length - 1; k++) {
      const y = SKY[k].y1;
      const a = SKY[k].c;
      const b = SKY[k + 1].c;
      for (let x = IN.x0; x <= IN.x1; x++) {
        const on = (x + y) % 2 === 0;
        px(x, y - 1, 1, 1, on ? b : a);
        px(x, y, 1, 1, on ? a : b);
      }
    }
  }

  function drawSun(p) {
    const cx = 33;
    const cy = 49;
    const halo = 12 + Math.round(p * 5);
    s.globalAlpha = 0.10 + p * 0.14;
    blob(cx, cy, halo, halo, C.sun);
    s.globalAlpha = 0.18 + p * 0.20;
    blob(cx, cy, halo - 3, halo - 3, C.sun);
    s.globalAlpha = 1;
    blob(cx, cy, 7, 7, C.sun);
    blob(cx - 1, cy - 2, 4, 4, C.sunHi);
  }

  function drawCloud(x, y, w) {
    px(x + 2, y + 4, w - 3, 3, C.cloud);
    px(x + 5, y + 1, w - 11, 4, C.cloud);
    px(x + 9, y - 1, w - 16, 3, C.cloud);
    px(x, y + 6, w, 1, C.cloud);
    px(x + 3, y + 7, w - 6, 1, C.cloudLo);
  }

  function drawClouds(t) {
    if (still) {
      drawCloud(CLOUDS[0].x, CLOUDS[0].y, CLOUDS[0].w);
      drawCloud(CLOUDS[2].x, CLOUDS[2].y, CLOUDS[2].w);
      return;
    }
    for (const cl of CLOUDS) {
      const span = 160;
      const x = 18 + (((cl.x - 18 + t * cl.s) % span) + span) % span;
      drawCloud(Math.round(x), cl.y, cl.w);
    }
  }

  function drawHills() {
    for (let x = IN.x0; x <= IN.x1; x++) {
      const b = Math.round(64 - 4 * Math.sin(x * 0.058) - 2 * Math.sin(x * 0.023 + 2.1));
      px(x, b, 1, G_BACK - b, C.hillBack);
      px(x, b, 1, 1, C.hillBackRim);
      const f = Math.round(72 - 3 * Math.sin(x * 0.043 + 1.4) - 2 * Math.sin(x * 0.019 + 0.5));
      px(x, f, 1, G_BACK - f, C.hillFront);
      px(x, f, 1, 1, C.hillFrontRim);
    }
  }

  /** 远景树线：常驻，保证第一帧也不空 */
  function drawTreeLine() {
    for (const t of TREE_LINE) {
      const top = G_TREE - t.h;
      px(t.x, top + 2, 5, t.h - 2, C.treeLine);
      px(t.x + 1, top, 3, 3, C.treeLine);
      px(t.x + 1, top + 1, 1, 1, C.grassBackRim);
    }
  }

  function drawGround() {
    px(IN.x0, G_BACK, IN.x1 - IN.x0 + 1, G_PATH - G_BACK, C.grassBack);
    px(IN.x0, G_BACK, IN.x1 - IN.x0 + 1, 1, C.grassBackRim);
    px(IN.x0, G_PATH - 1, IN.x1 - IN.x0 + 1, 1, C.grassBackLo);

    px(IN.x0, G_PATH, IN.x1 - IN.x0 + 1, G_FRONT - G_PATH, C.path);
    px(IN.x0, G_PATH, IN.x1 - IN.x0 + 1, 1, C.pathLo);
    px(IN.x0, G_FRONT - 2, IN.x1 - IN.x0 + 1, 1, C.pathHi);
    for (let i = 0; i < 24; i++) {
      const x = IN.x0 + 2 + Math.round(noise(i, 21) * (IN.x1 - IN.x0 - 4));
      const y = G_PATH + 2 + Math.round(noise(i, 23) * 5);
      px(x, y, 2, 1, C.pathLo);
    }

    px(IN.x0, G_FRONT, IN.x1 - IN.x0 + 1, IN.y1 - G_FRONT + 1, C.grassFront);
    px(IN.x0, G_FRONT, IN.x1 - IN.x0 + 1, 1, C.grassFrontRim);
    for (const tf of TUFTS) {
      px(tf.x, tf.y, 1, 2, C.grassFrontLo);
      px(tf.x + 1, tf.y + 1, 1, 1, C.grassFrontLo);
    }
  }

  function drawFlowers(p) {
    for (const f of FLOWERS) {
      if (p < f.at) continue;
      px(f.x, f.y + 2, 1, 2, C.grassFrontLo);
      px(f.x - 1, f.y + 1, 3, 1, f.c);
      px(f.x, f.y, 1, 1, f.c);
    }
  }

  /* ---------- 房子 ---------- */
  /** 放线：三个木桩 + 一根拉线，最先出现 */
  function drawStakes() {
    for (const x of [H.x0, H.apexX, H.x1]) {
      px(x, H.base - 4, 1, 4, C.wood);
      px(x, H.base - 4, 1, 1, C.woodHi);
    }
    px(H.x0, H.base - 3, H.x1 - H.x0, 1, 'rgba(138,98,64,0.5)');
  }

  function drawFoundation() {
    px(H.x0 - 3, H.base - 4, H.x1 - H.x0 + 7, 5, C.stone);
    px(H.x0 - 3, H.base - 4, H.x1 - H.x0 + 7, 1, C.stoneHi);
    px(H.x0 - 3, H.base, H.x1 - H.x0 + 7, 1, C.stoneLo);
    for (let x = H.x0 - 1; x < H.x1 + 2; x += 6) px(x, H.base - 3, 1, 3, C.stoneLo);
  }

  function drawWalls(p) {
    // 三段墙各自到点：先砌腰线以下，再腰线，最后檐下
    const segs = [
      { y0: 74, y1: H.base - 4, at: AT.wall[0] },
      { y0: 66, y1: 74, at: AT.wall[1] },
      { y0: H.top, y1: 66, at: AT.wall[2] },
    ];
    for (const sg of segs) {
      if (p < sg.at) break;
      px(H.x0, sg.y0, H.x1 - H.x0 + 1, sg.y1 - sg.y0, C.plaster);
      px(H.x0, sg.y0, H.x1 - H.x0 + 1, 1, C.plasterHi);
      px(H.x0, sg.y1 - 1, H.x1 - H.x0 + 1, 1, C.plasterLo);
      // 木构：两根角柱 + 段顶横梁
      px(H.x0, sg.y0, 3, sg.y1 - sg.y0, C.wood);
      px(H.x0 + 2, sg.y0, 1, sg.y1 - sg.y0, C.woodLo);
      px(H.x1 - 2, sg.y0, 3, sg.y1 - sg.y0, C.wood);
      px(H.x1 - 2, sg.y0, 1, sg.y1 - sg.y0, C.woodLo);
      px(H.x0, sg.y0, H.x1 - H.x0 + 1, 2, C.wood);
      px(H.x0, sg.y0 + 1, H.x1 - H.x0 + 1, 1, C.woodLo);
    }
  }

  function drawDoor(p) {
    if (p < AT.door) return;
    const { x, y, w, h } = DOOR;
    // 门槛 + 门框内投影：门窗不加这两笔就只是一张贴纸
    px(x, y, w, h, C.woodLo);
    px(x + 1, y + 1, w - 2, h - 1, C.wood);
    px(x + 1, y + 1, w - 2, 1, C.woodHi);
    px(x + 1, y + 1, 1, h - 1, 'rgba(60,40,26,0.25)');
    if (phase === 'celebrate') {
      // 满进度：门开一条缝，屋里透暖光
      px(x + 1, y + 1, w - 2, h - 1, '#4a3222');
      px(x + 2, y + 1, w - 4, h - 1, C.glow);
      px(x + 3, y + 2, w - 6, h - 3, '#ffdc94');
    } else {
      px(x + 5, y + 1, 1, h - 1, C.woodLo);
      px(x + w - 3, y + 9, 1, 1, '#f3cf7d');
    }
    // 门槛：比石基亮一档，压出门洞与地基的层次
    px(x - 1, y + h, w + 2, 1, C.stoneHi);
    px(x - 1, y + h + 1, w + 2, 1, 'rgba(60,40,26,0.18)');
  }

  function drawWindow(p) {
    if (p < AT.window) return;
    const { x, y, w, h } = WIN;
    px(x, y, w, h, C.woodLo);
    px(x + 1, y + 1, w - 2, h - 2, C.glassLo);
    px(x + 2, y + 2, w - 4, h - 4, C.glass);
    px(x + Math.floor(w / 2), y + 2, 1, h - 4, C.woodMid);
    px(x + 2, y + Math.floor(h / 2), w - 4, 1, C.woodMid);
    // 玻璃左上角的高光：两段斜边，别用纯白方块（读起来像个补丁）
    px(x + 3, y + 3, 2, 1, '#dceff3');
    px(x + 3, y + 4, 1, 2, '#dceff3');
    if (p >= AT.glow) {
      // 点灯：窗格变暖，窗台往草地上洒一小片光
      px(x + 2, y + 2, w - 4, h - 4, C.glow);
      px(x + 3, y + 3, 2, 1, C.cream);
      s.globalAlpha = 0.18;
      px(x + 1, y + h, w - 2, 1, C.glow);
      px(x - 2, y + h + 1, w + 4, 1, C.glow);
      s.globalAlpha = 1;
    }
    // 窗框内投影 + 窗台：跟门同一个逻辑
    px(x + 1, y + 1, 1, h - 2, 'rgba(60,40,26,0.25)');
    px(x, y, w, 1, C.stoneHi);
    px(x - 1, y + h, w + 2, 1, C.stoneHi);
    px(x - 1, y + h + 1, w + 2, 1, 'rgba(60,40,26,0.16)');
  }

  /** 屋顶木架：瓦还没铺到的地方露出椽子 + 檩条，读成「施工中」而不是「屋顶飘着」 */
  function drawRoofFrame() {
    const span = H.top - H.ridgeY;
    const ridgeY = H.ridgeY;
    // 先在整片屋面铺一层暗色的望板 —— 否则瓦没铺到的部分会露出天空，读成屋顶悬空
    for (let y = ridgeY; y <= H.top; y++) {
      const k = (y - ridgeY) / span;
      const half = H.ridgeHalf + Math.round(k * (H.eaveHalf - H.ridgeHalf));
      px(H.apexX - half, y, half * 2 + 1, 1, k > 0.5 ? '#6a4933' : '#775237');
    }
    // 两根斜脊梁（左右坡的外沿）
    for (let i = 0; i <= span; i++) {
      const y = ridgeY + i;
      const k = i / span;
      const dx = Math.round(H.ridgeHalf + k * (H.eaveHalf - H.ridgeHalf));
      px(H.apexX - dx, y, 1, 1, C.woodMid);
      px(H.apexX + dx, y, 1, 1, C.woodMid);
    }
    // 椽条：沿坡向排列的细木，等间距
    for (let s = -3; s <= 3; s++) {
      for (let i = 0; i <= span; i++) {
        const y = ridgeY + i;
        const k = i / span;
        const half = H.ridgeHalf + Math.round(k * (H.eaveHalf - H.ridgeHalf));
        const x = H.apexX + Math.round((s / 3) * half);
        px(x, y, 1, 1, '#8a6240');
      }
    }
    // 两根横向檩条
    for (const at of [0.34, 0.7]) {
      const y = ridgeY + Math.round(span * at);
      const dx = Math.round(H.ridgeHalf + at * (H.eaveHalf - H.ridgeHalf));
      px(H.apexX - dx, y, dx * 2 + 1, 1, C.wood);
      px(H.apexX - dx, y + 1, dx * 2 + 1, 1, 'rgba(60,40,26,0.35)');
    }
  }

  function drawRoof(p) {
    if (p < AT.roof[0]) return;
    drawRoofFrame();
    // 从屋脊往下铺：先铺到腰，再铺到檐
    const last = p >= AT.roof[1] ? H.top : (H.ridgeY + H.top) / 2;
    const span = H.top - H.ridgeY;
    for (let y = H.ridgeY; y < last; y++) {
      const k = (y - H.ridgeY) / span;
      const half = H.ridgeHalf + Math.round(k * (H.eaveHalf - H.ridgeHalf));
      const x0 = H.apexX - half;
      const x1 = H.apexX + half;
      // 瓦垄：每 3 行一道压边；整片屋面靠左亮右暗立起坡度
      const row = y - H.ridgeY;
      const lite = row % 3 === 2 ? C.roofLeftLo : C.roofLeft;
      const dark = row % 3 === 2 ? C.roofRightLo : C.roofRight;
      const midL = H.apexX - Math.round(half * 0.42);
      const midR = H.apexX + Math.round(half * 0.42);
      px(x0, y, midL - x0, 1, lite);
      px(midL, y, midR - midL, 1, C.roof);
      px(midR, y, x1 - midR + 1, 1, dark);
      // 受光边 / 背光边
      px(x0, y, 1, 1, C.roofHi);
      px(x1, y, 1, 1, C.roofLo);
    }
    // 铺到哪儿，那儿就有一道「瓦口」——边推进边有厚度
    {
      const y = Math.round(last) - 1;
      const half = H.ridgeHalf + Math.round(((last - H.ridgeY) / span) * (H.eaveHalf - H.ridgeHalf));
      px(H.apexX - half, y, half * 2 + 1, 1, C.roofHi);
      px(H.apexX - half, y + 1, half * 2 + 1, 1, C.roofLo);
    }
    // 屋脊压顶：一条横向的亮瓦带，四坡顶的辨识度全在这
    px(H.apexX - H.ridgeHalf - 1, H.ridgeY - 2, H.ridgeHalf * 2 + 3, 2, C.roofHi);
    px(H.apexX - H.ridgeHalf - 1, H.ridgeY, H.ridgeHalf * 2 + 3, 1, C.roof);
    if (p >= AT.roof[1]) {
      // 檐口：亮瓦 + 一道暗影，屋顶才像压住墙
      const half = H.eaveHalf;
      px(H.apexX - half - 1, H.top - 1, (half + 1) * 2 + 1, 2, C.roofHi);
      px(H.apexX - half - 1, H.top + 1, (half + 1) * 2 + 1, 1, C.roofLo);
      px(H.x0 - 5, H.top + 2, H.x1 - H.x0 + 11, 1, 'rgba(70,45,30,0.22)');
    }
  }

  /** 屋顶在某一列 x 上的「瓦面 y」（与 drawRoof 同一套公式，保证接缝对得上） */
  function roofTopAt(x) {
    const d = Math.abs(x - H.apexX);
    if (d <= H.ridgeHalf) return H.ridgeY;
    const k = (d - H.ridgeHalf) / (H.eaveHalf - H.ridgeHalf);
    return H.ridgeY + Math.round(k * (H.top - H.ridgeY));
  }

  function drawChimney(p, t) {
    if (p < AT.chimney) return;
    const cL = 160;
    const cR = 166;
    // 顶在 HUD 下方（HUD 占 y20..35，胶囊上沿只有 x40..175 可用）
    const top = 37;
    // 逐列裁到瓦面（+1px 埋进去）：底边跟着斜面走，不会有一条横线悬在屋顶外
    for (let x = cL; x <= cR; x++) {
      const b = Math.max(top + 4, roofTopAt(x) + 1);
      px(x, top, 1, b - top, x === cR ? '#8f5245' : x === cL ? '#c07c66' : '#b8705c');
    }
    px(cL, top, cR - cL + 1, 1, '#d0866f');
    // 烟囱帽
    px(cL - 1, top - 2, cR - cL + 3, 3, '#8f5245');
    px(cL - 1, top - 2, cR - cL + 3, 1, '#a86255');

    if (still) return;
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.4 + i * 0.33) % 1;
      const sy = top - 5 - ph * 14;
      const sx = cL + 3 + Math.round(Math.sin(ph * 5 + i) * 3);
      s.globalAlpha = (1 - ph) * 0.45;
      blob(sx, sy, 1.4 + ph * 2.4, 1.4 + ph * 2, C.smoke);
      s.globalAlpha = 1;
    }
  }

  /* ---------- 树 / 灌木 / 栅栏 ---------- */
  /** 地面接触阴影：太阳在左边，影子统一往右下压一格 */
  function groundShadow(cx, base, halfW) {
    s.globalAlpha = 0.11;
    px(cx - halfW, base, halfW * 2 + 1, 1, '#3d2a1d');
    px(cx - halfW + 2, base + 1, halfW * 2 - 3, 1, '#3d2a1d');
    s.globalAlpha = 1;
  }

  function tree(cx, base, stage) {
    if (stage <= 0) return;
    if (stage === 1) {
      // 树苗：一根细枝两片叶
      px(cx, base - 5, 1, 5, C.woodLo);
      px(cx - 2, base - 6, 2, 1, C.leaf[2]);
      px(cx + 1, base - 7, 2, 1, C.leaf[3]);
      groundShadow(cx, base, 2);
      return;
    }
    const trunkH = stage === 2 ? 10 : 14;
    groundShadow(cx, base, stage === 2 ? 4 : 6);
    px(cx - 1, base - trunkH, 3, trunkH, C.woodLo);
    px(cx, base - trunkH, 1, trunkH, C.wood);
    if (stage === 2) {
      blob(cx, base - trunkH - 3, 7, 6, C.leaf[1]);
      blob(cx - 2, base - trunkH - 5, 5, 4, C.leaf[2]);
      blob(cx - 3, base - trunkH - 6, 3, 2, C.leaf[3]);
    } else {
      blob(cx, base - trunkH - 2, 10, 9, C.leaf[0]);
      blob(cx - 1, base - trunkH - 5, 9, 7, C.leaf[1]);
      blob(cx - 2, base - trunkH - 7, 6, 5, C.leaf[2]);
      blob(cx - 4, base - trunkH - 8, 3, 3, C.leaf[3]);
    }
  }

  function drawBush() {
    const x = 72;
    groundShadow(x, G_BACK, 4);
    blob(x, G_BACK - 3, 6, 4, C.leaf[0]);
    blob(x - 1, G_BACK - 4, 5, 3, C.leaf[1]);
    blob(x - 2, G_BACK - 5, 3, 2, C.leaf[2]);
    px(x + 2, G_BACK - 2, 1, 1, C.leaf[3]);
  }

  /** 小石井：左半的视觉分量，别让房子一头沉 */
  function drawWell(p) {
    const x = 56;
    const base = G_BACK;
    // 出现过程：先井台，再立柱，最后盖顶（跟房子同一套「一点点长出来」的节奏）
    const stage = p < AT.well[1] ? 1 : p < AT.well[2] ? 2 : 3;
    groundShadow(x, base, 5);
    // 井台
    px(x - 6, base - 1, 13, 1, 'rgba(60,45,30,0.16)');
    blob(x, base - 6, 6, 5, C.stone);
    blob(x, base - 6, 5, 4, C.stoneHi);
    // 井口
    px(x - 3, base - 8, 7, 3, C.stoneLo);
    px(x - 2, base - 8, 5, 2, '#2f3a3c');
    px(x - 2, base - 8, 5, 1, '#1f282a');
    // 石缝
    px(x - 5, base - 4, 1, 1, C.stoneLo);
    px(x + 1, base - 3, 2, 1, C.stoneLo);
    px(x - 2, base - 6, 1, 1, C.stoneLo);
    if (stage < 2) return;
    // 两根立柱 + 横梁 + 挂桶（左柱受光、右柱在影里）
    px(x - 4, base - 16, 1, 9, C.wood);
    px(x + 4, base - 16, 1, 9, C.woodLo);
    px(x - 4, base - 16, 9, 1, C.woodMid);
    px(x, base - 15, 1, 2, C.woodLo);
    px(x - 1, base - 13, 3, 2, C.woodMid);
    px(x - 1, base - 13, 3, 1, C.woodHi);
    if (stage < 3) return;
    // 小瓦顶
    for (let i = 0; i < 3; i++) {
      const w = 7 - i * 2;
      px(x - w, base - 18 + i, w * 2 + 1, 1, i === 0 ? C.roofHi : C.roof);
    }
  }

  function drawFence() {
    const base = G_BACK;
    s.globalAlpha = 0.1;
    px(177, base, 20, 1, '#3d2a1d');
    s.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const x = 179 + i * 5;
      px(x, G_BACK - 9, 2, 9, C.creamLo);
      px(x, G_BACK - 9, 1, 9, C.cream);
      px(x, G_BACK - 9, 2, 1, C.cream);
    }
    px(178, G_BACK - 7, 18, 1, C.creamLo);
    px(178, G_BACK - 4, 18, 1, C.creamLo);
  }

  /* ---------- 木料：左堆 → 工地上码好的箱子 ---------- */
  function crate(x, y) {
    px(x, y, 6, 5, C.woodHi);
    px(x, y, 6, 1, '#d9ad74');
    px(x, y + 4, 6, 1, C.woodLo);
    px(x + 1, y + 1, 1, 3, C.woodLo);
    px(x + 4, y + 1, 1, 3, C.woodLo);
    px(x + 2, y + 2, 2, 1, C.woodLo);
  }

  function drawSupply(delivered) {
    const base = G_BACK;
    const left = clamp(6 - delivered, 0, 6);
    if (left > 0) groundShadow(24, base, 7);
    // 垫木 + 斜靠的木板（读成“料堆”，别画成小屋）
    px(16, base - 1, 20, 1, 'rgba(60,45,30,0.16)');
    for (let i = 0; i < 3; i++) {
      px(17 + i * 4, base - 8 - i, 2, 8 + i, i % 2 ? C.wood : C.woodLo);
    }
    for (let i = 0; i < left; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      crate(24 + col * 7, base - 5 - row * 6);
    }
  }

  function drawDelivered(n) {
    if (n > 0) groundShadow(104, G_BACK, 10);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      crate(106 + col * 7, G_BACK - 5 - row * 6);
    }
  }

  /* ---------- 小鸡（画在 ~8px 高：门高 16px，家禽就该是门的四分之一） ---------- */
  function chicken(cx, feet, dir, step, carrying, hop) {
    const bob = step === 1 && !hop ? 1 : 0;
    const y = feet - hop - bob;

    s.globalAlpha = hop ? 0.08 : 0.14;
    blob(cx, feet + 1, hop ? 3 : 4, 1.2, '#3d2a1d');
    s.globalAlpha = 1;

    // 腿
    const legY = y - 2;
    if (step) {
      px(cx - 2, legY, 1, 2, C.leg);
      px(cx + 1, legY, 1, 2, C.leg);
      px(cx - 3, legY + 2, 2, 1, C.leg);
      px(cx + 1, legY + 2, 2, 1, C.leg);
    } else {
      px(cx - 2, legY, 1, 2, C.leg);
      px(cx + 1, legY, 1, 2, C.leg);
      px(cx - 3, legY + 2, 2, 1, C.leg);
      px(cx + 1, legY + 2, 2, 1, C.leg);
    }

    // 身体
    blob(cx, y - 4, 3.5, 2.6, C.feather);
    blob(cx, y - 3, 3.5, 2, C.feather);
    px(cx - 1, y - 3, 2, 1, C.featherLo);
    // 尾羽
    px(cx - dir * 4, y - 5, 1, 2, C.featherLo);
    // 头
    const hx = cx + dir * 2;
    blob(hx, y - 7, 2, 2, C.feather);
    // 冠 / 喙 / 眼 / 肉垂
    px(hx, y - 10, 1, 2, C.comb);
    px(hx + dir, y - 9, 1, 1, C.comb);
    px(hx + dir * 2, y - 7, 1, 1, C.beak);
    px(hx, y - 8, 1, 1, C.eye);
    px(hx + dir, y - 5, 1, 1, C.comb);

    if (carrying) {
      const bx = cx - dir;
      px(bx - 2, y - 8, 3, 2, C.woodHi);
      px(bx - 2, y - 8, 3, 1, '#d9ad74');
      px(bx - 2, y - 7, 3, 1, C.woodLo);
    }
  }

  /* ---------- 进度条 + 百分比 ---------- */
  function drawDigits(x, y, text) {
    let cx = x;
    for (const ch of text) {
      const g = GLYPH[ch];
      if (!g) { cx += 4; continue; }
      s.fillStyle = UI.digit;
      for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < g[r].length; c++) {
          if (g[r][c] === '1') s.fillRect(cx + c, y + r, 1, 1);
        }
      }
      cx += 6;
    }
    return cx - 1;
  }

  function drawBar(p) {
    // 进度条做成工地左侧的「木牌」：两根立柱插进草地，牌面本身就是槽
    const bx = 33;
    const by = 30;
    const bw = 66;
    const bh = 13;

    // 立柱 + 斜撑（先画柱，牌面压在上面）
    px(bx + 6, by + bh, 1, 13, C.woodLo);
    px(bx + bw - 7, by + bh, 1, 13, C.woodLo);
    px(bx + 7, by + bh + 12, 2, 1, 'rgba(60,40,26,0.16)');
    px(bx + bw - 7, by + bh + 12, 2, 1, 'rgba(60,40,26,0.16)');
    // 牌面：木框 + 深墨线
    px(bx - 1, by - 1, bw + 2, bh + 2, C.woodLo);
    px(bx, by, bw, bh, C.wood);
    px(bx, by, bw, 1, C.woodHi);
    px(bx, by + bh - 1, bw, 1, '#7d5a3c');
    px(bx, by, 1, bh, '#7d5a3c');
    // 槽：底板做旧一点，跟填充分得开
    px(bx + 2, by + 2, bw - 4, bh - 4, UI.trackLo);
    px(bx + 2, by + 2, bw - 4, 1, '#dcc7a0');

    const inner = bw - 6;
    const fw = Math.round(inner * clamp(p, 0, 1));
    if (fw > 0) {
      px(bx + 3, by + 3, fw, bh - 6, UI.fill);
      px(bx + 3, by + 3, fw, 1, UI.fillHi);
      px(bx + 3, by + bh - 4, fw, 1, UI.fillLo);
      if (fw < inner - 1) px(bx + fw + 3, by + 3, 1, bh - 6, UI.fillLo);
    }
    // 刻度：每 1/5 一格，读得出「还剩多远」
    for (let i = 1; i < 5; i++) {
      const tickX = bx + 3 + Math.round((inner * i) / 5);
      px(tickX, by + 3, 1, bh - 6, 'rgba(70,45,30,0.18)');
    }

    // 百分比：刻在第一根立柱下方的小木牌上（跟进度条同一个木牌家族）
    const label = `${Math.round(clamp(p, 0, 1) * 100)}%`;
    const tw = 26;
    const th = 13;
    const tx = bx + 1;
    const ty = by + bh + 4;
    px(tx - 1, ty - 1, tw + 2, th + 2, C.woodLo);
    px(tx, ty, tw, th, C.wood);
    px(tx, ty, tw, 1, C.woodHi);
    px(tx, ty + th - 1, tw, 1, '#7d5a3c');
    px(tx + 1, ty + 1, tw - 2, th - 2, C.cream);
    px(tx + 1, ty + 1, tw - 2, 1, '#fffdf4');
    px(tx + 1, ty + th - 2, tw - 2, 1, C.lip);
    const w = label.length * 6 - 1;
    drawDigits(tx + Math.round((tw - w) / 2), ty + 3, label);
  }

  /* ---------- 撒花 ---------- */
  function drawConfetti(t) {
    for (let i = 0; i < 26; i++) {
      const delay = noise(i, 31) * 0.28;
      const life = clamp((t - delay) / 0.8, 0, 1);
      if (life <= 0 || life >= 1) continue;
      const x0 = IN.x0 + 6 + noise(i, 37) * (IN.x1 - IN.x0 - 12);
      const drift = (noise(i, 41) - 0.5) * 26;
      const y = IN.y0 + 6 + life * (IN.y1 - IN.y0 - 14) * (0.7 + noise(i, 43) * 0.3);
      const x = x0 + drift * life;
      s.globalAlpha = life > 0.72 ? (1 - life) * 3.5 : 1;
      px(x, y, 2, 2, C.flower[i % C.flower.length]);
      s.globalAlpha = 1;
    }
  }

  /* ---------- 一帧 ---------- */
  function drawScene(now, p) {
    const t = still ? 0 : now / 1000;

    drawSky();
    drawSun(p);
    drawClouds(t);
    drawHills();
    drawTreeLine();
    drawGround();

    // 房子与树的落地影
    s.globalAlpha = 0.1;
    px(H.x0 - 4, G_BACK - 1, H.x1 - H.x0 + 9, 1, '#3d2a1d');
    s.globalAlpha = 1;

    tree(90, G_BACK, p >= AT.treeB[2] ? 3 : p >= AT.treeB[1] ? 2 : p >= AT.treeB[0] ? 1 : 0);

    // 井：左半的配重（比房子早一点起来）
    if (p >= AT.well[0]) drawWell(p);

    if (p >= AT.fence) drawFence();
    if (p >= AT.bush) drawBush();

    if (p < AT.foundation) drawStakes();
    if (p >= AT.foundation) drawFoundation();
    drawWalls(p);
    drawDoor(p);
    drawWindow(p);
    // 烟囱先画、屋顶后画：屋檐盖住烟囱下段，才像是从瓦面里长出来，而不是贴在屋顶上
    drawChimney(p, t);
    drawRoof(p);

    const delivered = clamp(Math.floor(p * 7), 0, 6);
    drawDelivered(delivered);
    drawSupply(delivered);
    drawFlowers(p);

    // 进度条永远压在最上面（它是 HUD，不该被屋顶/烟囱挡住）
    drawBar(p);

    // 小鸡：搬 → 放 → 空手回 → 再搬
    let chX = CX0;
    let carrying = false;
    let step = 0;
    let hop = 0;
    if (phase === 'celebrate') {
      chX = 92;
      const cycle = (phaseT % 0.64) / 0.64;
      // 尊重 prefers-reduced-motion：不蹦，只站着（收尾照样发生）
      hop = still ? 0 : Math.round(Math.sin(cycle * Math.PI) * 4);
      step = still ? 0 : cycle < 0.5 ? 0 : 1;
    } else if (still) {
      chX = 74;
      carrying = true;
    } else {
      const trip = (t % 5.0) / 5.0;
      if (trip < 0.44) {
        chX = lerp(CX0, CX1, trip / 0.44);
        carrying = true;
        step = Math.floor(t * 6) % 2;
      } else if (trip < 0.5) {
        chX = CX1;
        carrying = trip < 0.47;
      } else if (trip < 0.86) {
        chX = lerp(CX1, CX0, (trip - 0.5) / 0.36);
        step = Math.floor(t * 8) % 2;
      } else {
        chX = CX0;
        carrying = trip > 0.93;
      }
    }
    if (hopAt) {
      const k = clamp((now - hopAt) / 470, 0, 1);
      if (k < 1) hop = Math.max(hop, Math.round(Math.sin(k * Math.PI) * 6));
    }
    chicken(Math.round(chX), FEET, 1, step, carrying, hop);

    // 点过之后冒一个「♪」
    const bubble = now - tapAt;
    if (tapAt && bubble < 900) {
      const bx = Math.round(chX) + 8;
      const by = FEET - 24 - Math.round(Math.sin(clamp(bubble / 900, 0, 1) * Math.PI) * 4);
      s.globalAlpha = bubble > 660 ? 1 - (bubble - 660) / 240 : 1;
      px(bx, by, 9, 8, 'rgba(255,248,226,0.96)');
      px(bx, by, 9, 1, C.ink);
      px(bx, by + 7, 9, 1, C.ink);
      px(bx, by, 1, 8, C.ink);
      px(bx + 8, by, 1, 8, C.ink);
      // 一个像素音符
      px(bx + 3, by + 2, 1, 4, C.ink);
      px(bx + 4, by + 2, 1, 1, C.ink);
      px(bx + 5, by + 3, 1, 1, C.ink);
      px(bx + 2, by + 6, 2, 1, C.ink);
      s.globalAlpha = 1;
    }

    if (phase === 'celebrate') drawConfetti(phaseT);
  }

  /* ---------- 合成到屏幕画布：投影 + 胶囊框 ---------- */
  function render(now, p) {
    s.clearRect(0, 0, ART_W, ART_H);
    s.fillStyle = C.ink;
    s.fill(pOuter);
    s.fillStyle = C.cream;
    s.fill(pCream);
    s.fillStyle = C.ink;
    s.fill(pLip);

    s.save();
    s.clip(pScene);
    drawScene(now, p);
    // 内侧一圈极淡的墨线，让画面不像浮在奶油边上
    s.fillStyle = C.hair;
    for (let i = 0; i < rInner.length; i++) {
      const r = rInner[i];
      if (i === 0 || i === rInner.length - 1) { s.fillRect(r.x0, r.y, r.x1 - r.x0 + 1, 1); continue; }
      s.fillRect(r.x0, r.y, 1, 1);
      s.fillRect(r.x1, r.y, 1, 1);
    }
    s.restore();

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, ART_W, ART_H);
    // 落地阴影：两档叠出一点柔度
    ctx.save();
    ctx.translate(0, 4);
    ctx.globalAlpha = 0.1;
    fillRows(ctx, rowsOf(PILL.x0 + 5, PILL.y0 + 3, PILL.x1 - 5, PILL.y1 + 1, PILL.r), '#58361f');
    ctx.translate(0, 3);
    ctx.globalAlpha = 0.06;
    fillRows(ctx, rowsOf(PILL.x0 + 11, PILL.y0 + 3, PILL.x1 - 11, PILL.y1 + 1, PILL.r), '#58361f');
    ctx.restore();
    ctx.drawImage(scene, 0, 0);
  }

  /* ---------- 帧循环 ---------- */
  let raf = 0;
  let last = 0;

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function loop(now) {
    if (!canvas.isConnected) return stop();
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now;

    if (phase === 'load') {
      // 真实进度是下限；等得久了就往上慢慢蹭一点，但永不越过 88%
      // （这一步只为「别卡在 12% 干等」，不会替首帧宣布完成）
      const idle = last ? (now - lastSetAt) / 1000 : 0;
      if (target < CREEP_CAP) {
        target = Math.min(CREEP_CAP, target + dt * 0.030 * clamp(idle / 0.6, 0, 1));
      }
      shown += (target - shown) * (1 - Math.exp(-dt * 3.6));
      if (target - shown < 0.004) shown = target;
    } else if (phase === 'celebrate') {
      phaseT += dt;
      if (phaseT > 0.9) shown = 1;
      if (phaseT > 1.1 && endCb) {
        const cb = endCb;
        endCb = null;
        cb();
      }
      if (phaseT > 2.2) { phase = 'gone'; return stop(); }
    }
    render(now, shown);
  }

  /* ---------- 尺寸跟随 ---------- */
  let resizeTimer = 0;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = 0;
      fit();
      render(performance.now(), shown);
    }, 120);
  }

  /* ---------- 点小鸡：跳一下 ---------- */
  function onTap(e) {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const ax = ((e.clientX - r.left) / r.width) * ART_W;
    // 只在小鸡能落脚的那一段响应，别让整条路都变成按钮
    if (ax < CX0 - 12 || ax > CX1 + 24) return;
    hopAt = performance.now();
    tapAt = hopAt;
  }

  /* ---------- 对外接口 ---------- */
  const api = {
    mounted: true,
    /** 真实进度落点（0..1），只往上走 */
    set(v) {
      if (phase !== 'load') return;
      const n = clamp(Number(v) || 0, 0, 1);
      if (n > target) target = n;
      lastSetAt = performance.now();
    },
    /** 首帧已渲染：把 100% 那段演完再揭幕 */
    done(cb) {
      if (phase === 'celebrate' || phase === 'gone') { if (cb) cb(); return; }
      phase = 'celebrate';
      phaseT = 0;
      endCb = cb || null;
      target = 1;
    },
    /** 出错了：不演完，直接收场 */
    fail(cb) {
      phase = 'gone';
      stop();
      if (cb) cb();
    },
    get progress() { return shown; },
    /** 验收用探针：当前阶段、显示进度、是否在跳、画布尺寸 */
    state() {
      return { phase, shown, target, hop: hopAt > 0, tap: tapAt > 0, w: canvas.width, h: canvas.height, scale };
    },
  };

  fit();
  render(performance.now(), shown);
  raf = requestAnimationFrame(loop);
  window.addEventListener('resize', onResize, { passive: true });
  canvas.addEventListener('pointerdown', onTap, { passive: true });

  window.__SUTADYU_LOAD__ = api;
  api.dispose = () => {
    stop();
    window.removeEventListener('resize', onResize);
    canvas.removeEventListener('pointerdown', onTap);
    if (window.__SUTADYU_LOAD__ === api) delete window.__SUTADYU_LOAD__;
  };
  return api;
}
