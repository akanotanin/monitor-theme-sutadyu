import * as THREE from 'three';
import { STATUS } from './hub.js?v=1.8.13';

/* ------------------------------------------------------------------ *
 * 小鸡头顶的信息卡（纸卡风），两档：
 *
 *   紧凑（宽屏常驻）  ╭────────────────────────────────╮
 *                     │ ● Tokyo Node  在线 90ms        │
 *                     │ CPU ▓ 13% 内存 ▓ 20% 磁盘 ▓ 61%│
 *                     │ 流量 28.0G / 500G  ↓4K/s ↑2K/s │
 *                     ╰───────────▽────────────────────╯
 *   展开（走近/悬停）  ╭────────────────────────────────╮
 *                     │ ● Tokyo Node        在线       │
 *                     │ CPU ▓▓▓▓░░ 13%                 │
 *                     │ 内存 ▓▓░░░ 21%                 │
 *                     │ 磁盘 ▓▓▓▓▓░ 61%                │
 *                     │ ────────────────────────────   │
 *                     │ 延迟 90ms · 流量 28.0G / 500G  │
 *                     │ ↓1.2M/s ↑340K/s · 今日 ↓3.0G ↑1.0G
 *                     │ 年付 · 三网优化（有备注才出现） │
 *                     ╰───────────▽────────────────────╯
 *
 *   · 流量 = 已用 / 总量（月度配额），用满 ≥80% 琥珀、≥95% 红
 *   · dot 档：卡片收起，只留一颗状态色圆点
 *   · 位图 2.5× 超采样（2x 屏放大也锐）；数据变了才重画
 *   · 透明度 / 尺寸都是线性过渡：常驻→展开是「长出来」而不是跳变
 *   · 卡片下沿的小指针指向小鸡；离线整卡变淡
 * ------------------------------------------------------------------ */

const S = 2.5;                  // 画布超采样倍数
const DW = 384;                 // 设计宽（1x 逻辑 px）
const NOTCH_W = 30;             // 底部指针宽
const NOTCH_H = 14;             // 底部指针高
const W_COMPACT = 6.0;          // 紧凑卡世界宽
const W_FULL = 6.4;             // 展开卡世界宽
const DOT_WORLD = 0.72;         // 状态点世界尺寸
const CARD_MIN_GAP = 6.6;       // 两张完整卡之间的距离下限：必须 ≥ 卡宽（6.0），否则「防叠」本身就是个摆设
const KEEP_GAP = 7.1;           // 已在出卡的「保留间距」：比 CARD_MIN_GAP 宽一档，走位时卡不来回跳
const FADE_RATE = 3.4;          // 透明度/尺寸过渡速率（越小越润；约 0.9s 到位）
// 系统开了「减少动态效果」：卡片直接到位，不做渐变
const REDUCE_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* 窄屏「贴边收卡」：手机上一张卡就占半屏，贴着边界的卡会被切掉一半。
   切掉超过 CLIP_HIDE 就收成状态点，回到 CLIP_SHOW 以下才重新展开（滞回，边界处不闪）。 */
const CLIP_NARROW = 700;     // 与 CSS 断点 / main.js 的 NARROW_VIEW 同口径
const CLIP_HIDE = 0.15;   // 切掉 15% 就收（约 33px，圆角已经缺了）
const CLIP_SHOW = 0.05;   // 回到 5% 以内才重新展开（滞回）

const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",system-ui,sans-serif';
const COL_BG = '#fffaf0';
const COL_BORDER = 'rgba(120, 88, 56, 0.55)';
const COL_INK = '#3f2d20';
const COL_DIM = '#7a6250';
const COL_TRACK = 'rgba(120, 88, 56, 0.16)';
const COL_SHADOW = 'rgba(96, 66, 38, 0.17)';
const COL_LINE = 'rgba(120, 88, 56, 0.18)';
const F_LOAD = 60, F_HOT = 85;  // 与列表页相同的高负载阈值

const _proj = new THREE.Vector3();
/** 卡片投影到屏幕后被切掉的比例（0 = 完整，1 = 整张都在屏外） */
function clippedFraction(camera, x, y, z, wWorld, hWorld) {
  const vh = camera.top - camera.bottom;      // 正交相机的视野高
  if (!(vh > 0)) return 0;
  _proj.set(x, y, z).project(camera);
  const ppwu = window.innerHeight / vh;
  const w = wWorld * ppwu;
  const h = hWorld * ppwu;
  const cx = (_proj.x * 0.5 + 0.5) * window.innerWidth;
  const cy = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
  const ix = Math.max(0, Math.min(cx + w / 2, window.innerWidth) - Math.max(cx - w / 2, 0));
  const iy = Math.max(0, Math.min(cy + h / 2, window.innerHeight) - Math.max(cy - h / 2, 0));
  const area = w * h;
  return area > 0 ? 1 - (ix * iy) / area : 0;
}

function newCanvas(hDesign) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(DW * S);
  canvas.height = Math.round(hDesign * S);
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  return { canvas, ctx };
}

/** 卡片外轮廓：圆角矩形 + 底部小指针。描边和填充走同一条路径，接缝不露线 */
function cardPath(bodyH) {
  const p = new Path2D();
  p.roundRect(3, 3, DW - 6, bodyH - 6, 16);
  const cx = DW / 2;
  const base = bodyH - 3;
  p.moveTo(cx - NOTCH_W / 2, base - 6);
  p.lineTo(cx + NOTCH_W / 2, base - 6);
  p.lineTo(cx, base + NOTCH_H);
  p.closePath();
  return p;
}

/** 纸卡底：先画一层错位的软影子，再描边+填充 */
function paintFrame(ctx, bodyH) {
  const path = cardPath(bodyH);
  ctx.save();
  ctx.translate(0, 4.5);
  ctx.fillStyle = COL_SHADOW;
  ctx.fill(path);
  ctx.restore();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COL_BORDER;
  ctx.lineWidth = 4;
  ctx.stroke(path);
  ctx.fillStyle = COL_BG;
  ctx.fill(path);
}

function bar(ctx, x, y, w, h, pct, color) {
  ctx.fillStyle = COL_TRACK;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  const p = Math.max(0, Math.min(1, pct / 100));
  if (p > 0) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(h, w * p), h, h / 2);
    ctx.fill();
  }
}

function loadColor(pct) {
  if (pct >= 85) return '#d1665c';
  if (pct >= 60) return '#d9a740';
  return '#7aa86a';
}

/** 超宽文字截断成 末尾… */
function fit(ctx, text, maxW) {
  let s = String(text ?? '');
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function fmtAgo(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.round(s / 60)}分前`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}小时前`;
  return `${Math.round(s / 86400)}天前`;
}

/** 右侧状态文字：离线时把「离线多久」也带出来 */
function statusText(server) {
  const st = STATUS[server.status] || STATUS.unknown;
  if (server.status === 'offline' && server.lastSeenAgo !== null && server.lastSeenAgo !== undefined) {
    return `离线 ${fmtAgo(server.lastSeenAgo)}`;
  }
  return st.label;
}

/** 延迟配色：<120 绿 / <220 琥珀 / 其余红（和负载条同族色） */
function latColor(ms) {
  if (ms === null || ms === undefined) return COL_DIM;
  if (ms < 120) return '#7aa86a';
  if (ms < 220) return '#d9a740';
  return '#d1665c';
}

/** 小数收尾：43.0 → 43、1.2 → 1.2 */
const trimZero = (s) => s.replace(/\.0$/, '');

/** KB/s → 紧凑网速（340K/s、1.2M/s、6G/s） */
function fmtRateShort(v) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  if (v >= 1048576) return `${trimZero((v / 1048576).toFixed(1))}G/s`;
  if (v >= 1024) return `${trimZero((v / 1024).toFixed(1))}M/s`;
  if (v >= 100) return `${Math.round(v)}K/s`;
  return `${trimZero(v.toFixed(1))}K/s`;
}

/** 字节 → 短单位（3G、840M、512K、1.2T） */
function fmtBytesShort(b) {
  if (b === null || b === undefined || !isFinite(b)) return '—';
  if (b >= 1099511627776) return `${trimZero((b / 1099511627776).toFixed(1))}T`;
  if (b >= 1073741824) return `${trimZero((b / 1073741824).toFixed(1))}G`;
  if (b >= 1048576) return `${Math.round(b / 1048576)}M`;
  if (b >= 1024) return `${Math.round(b / 1024)}K`;
  return `${Math.round(b)}B`;
}

/** 流量文案：已用 / 总量（月度配额口径，取自 month_used + traffic_limit） */
function trafficText(server) {
  const used = server.trafficUsed;
  const limit = server.trafficLimit;
  const hasUsed = used !== null && used !== undefined && isFinite(used);
  const hasLimit = limit !== null && limit !== undefined && isFinite(limit) && limit > 0;
  if (!hasUsed && !hasLimit) return '';
  if (hasUsed && hasLimit) return `流量 ${fmtBytesShort(used)} / ${fmtBytesShort(limit)}`;
  if (hasUsed) return `流量 ${fmtBytesShort(used)}`;
  return `流量 — / ${fmtBytesShort(limit)}`;
}

/** 流量用满的警戒色：≥80% 琥珀、≥95% 红（平时保持底色） */
function trafficColor(server) {
  const used = server.trafficUsed;
  const limit = server.trafficLimit;
  if (used === null || used === undefined || !(limit > 0)) return COL_DIM;
  const ratio = used / limit;
  if (ratio >= 0.95) return '#d1665c';
  if (ratio >= 0.8) return '#d9a740';
  return COL_DIM;
}

/** 第一行：状态点 + 名字 + 状态文字（+ 延迟；名字按剩余宽度截断） */
function drawHead(ctx, server, st, cy, opts = {}) {
  const { withLatency = false } = opts;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = st.css;
  ctx.beginPath();
  ctx.arc(27, cy, 7.5, 0, Math.PI * 2);
  ctx.fill();

  // 右侧从右往左排：延迟（若有）→ 状态文字
  let rightEdge = DW - 20;
  let latW = 0;
  const showLat = withLatency
    && server.status !== 'offline'
    && server.avgLatency !== null && server.avgLatency !== undefined;
  if (showLat) {
    const ms = Math.round(server.avgLatency);
    ctx.font = `bold 18px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = latColor(ms);
    ctx.fillText(`${ms}ms`, rightEdge, cy);
    latW = ctx.measureText(`${ms}ms`).width + 12;
  }

  const stateText = statusText(server);
  ctx.font = `bold 20px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = st.css;
  ctx.fillText(stateText, rightEdge - latW, cy);
  const stateW = ctx.measureText(stateText).width;

  ctx.textAlign = 'left';
  ctx.fillStyle = COL_INK;
  ctx.font = `bold 25px ${FONT}`;
  ctx.fillText(fit(ctx, server.name, rightEdge - latW - stateW - 12 - 42), 42, cy + 1);
}

const pctText = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);

/** 展开卡的一整行指标：标签 + 长条 + 数值 */
function metricRow(ctx, label, v, y) {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = COL_DIM;
  ctx.font = `17px ${FONT}`;
  ctx.fillText(label, 20, y);
  bar(ctx, 78, y - 5.5, 208, 11, v, loadColor(v ?? 0));
  ctx.textAlign = 'right';
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillStyle = v === null || v === undefined ? COL_DIM : COL_INK;
  ctx.fillText(pctText(v), DW - 20, y);
  ctx.textAlign = 'left';
}

const C_BODY = 122;             // 紧凑卡主体高（不含指针）

function drawCompact(server) {
  const { canvas, ctx } = newCanvas(C_BODY + NOTCH_H);
  const st = STATUS[server.status] || STATUS.unknown;
  paintFrame(ctx, C_BODY);
  drawHead(ctx, server, st, 30, { withLatency: true });

  // 第二行三格：CPU / 内存 / 磁盘
  ctx.textBaseline = 'middle';
  const y = 77;
  [['CPU', server.cpu], ['内存', server.mem], ['磁盘', server.disk]].forEach(([label, v], i) => {
    const col = 18 + i * 116;
    ctx.textAlign = 'left';
    ctx.fillStyle = COL_DIM;
    ctx.font = `16px ${FONT}`;
    ctx.fillText(label, col, y);
    bar(ctx, col + 34, y - 5, 36, 10, v, loadColor(v ?? 0));
    ctx.textAlign = 'right';
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = v === null || v === undefined ? COL_DIM : COL_INK;
    ctx.fillText(pctText(v), col + 114, y);
  });

  // 第三行：流量（已用/总量，左；超阈值变警戒色）+ 实时带宽 ↓↑（右）
  ctx.font = `16px ${FONT}`;
  const netOk = (server.netIn ?? null) !== null || (server.netOut ?? null) !== null;
  const netStr = netOk ? `↓${fmtRateShort(server.netIn)} ↑${fmtRateShort(server.netOut)}` : '';
  if (netStr) {
    ctx.textAlign = 'right';
    ctx.fillStyle = COL_DIM;
    ctx.fillText(netStr, DW - 20, 108);
  }
  const netW = netStr ? ctx.measureText(netStr).width + 16 : 0;
  const tText = trafficText(server);
  if (tText) {
    ctx.textAlign = 'left';
    ctx.fillStyle = trafficColor(server);
    ctx.fillText(fit(ctx, tText, DW - 20 - netW - 20), 20, 108);
  }
  ctx.textAlign = 'left';

  return canvas;
}

const F_BODY = 194;             // 展开卡主体高（无备注）
const F_BODY_ROLE = 220;        // 带备注行

function drawFull(server) {
  const role = server.role && String(server.role).trim();
  const bodyH = role ? F_BODY_ROLE : F_BODY;
  const { canvas, ctx } = newCanvas(bodyH + NOTCH_H);
  const st = STATUS[server.status] || STATUS.unknown;
  paintFrame(ctx, bodyH);
  drawHead(ctx, server, st, 32);

  metricRow(ctx, 'CPU', server.cpu, 64);
  metricRow(ctx, '内存', server.mem, 90);
  metricRow(ctx, '磁盘', server.disk, 116);

  // 分隔线 + 两行补充信息（+ 备注行）
  ctx.strokeStyle = COL_LINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(20, 136);
  ctx.lineTo(DW - 20, 136);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = COL_DIM;
  ctx.font = `16px ${FONT}`;

  // R5：延迟 + 流量（已用/总量）；流量超阈值时这一段变警戒色
  let lx = 20;
  const putSeg = (text, color) => {
    if (!text) return;
    const sep = lx > 20 ? ' · ' : '';
    const raw = sep + text;
    const room = DW - 20 - lx;
    const shown = ctx.measureText(raw).width <= room ? raw : fit(ctx, raw, room);
    ctx.fillStyle = color;
    ctx.fillText(shown, lx, 156);
    lx += ctx.measureText(shown).width;
  };
  if (server.avgLatency !== null && server.avgLatency !== undefined) putSeg(`延迟 ${Math.round(server.avgLatency)}ms`, COL_DIM);
  putSeg(trafficText(server), trafficColor(server));
  if (lx === 20) putSeg('—', COL_DIM);

  const line2 = [];
  if ((server.netIn ?? null) !== null || (server.netOut ?? null) !== null) {
    line2.push(`↓${fmtRateShort(server.netIn)} ↑${fmtRateShort(server.netOut)}`);
  }
  if ((server.dayRx ?? null) !== null || (server.dayTx ?? null) !== null) {
    line2.push(`今日 ↓${fmtBytesShort(server.dayRx)} ↑${fmtBytesShort(server.dayTx)}`);
  }
  ctx.fillText(fit(ctx, line2.join(' · ') || '—', DW - 40), 20, 180);

  if (role) ctx.fillText(fit(ctx, role, DW - 40), 20, 204);

  return canvas;
}

function drawDot(server) {
  const D = 84;
  const canvas = document.createElement('canvas');
  canvas.width = D * 2;
  canvas.height = D * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  const st = STATUS[server.status] || STATUS.unknown;
  ctx.fillStyle = COL_SHADOW;
  ctx.beginPath();
  ctx.arc(D / 2, D / 2 + 3, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = st.css;
  ctx.beginPath();
  ctx.arc(D / 2, D / 2, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 250, 240, 0.92)';
  ctx.lineWidth = 7;
  ctx.stroke();
  return canvas;
}

/** 只有「显示出来的内容」变了才值得重画贴图（用显示口径，避免原始值抖动） */
function sigOf(server) {
  return JSON.stringify([
    server.name, server.status,
    Math.round(server.cpu ?? -1), Math.round(server.mem ?? -1), Math.round(server.disk ?? -1),
    server.role,
    server.avgLatency === null || server.avgLatency === undefined ? null : Math.round(server.avgLatency),
    server.lastSeenAgo,
    server.netIn === null || server.netIn === undefined ? null : fmtRateShort(server.netIn),
    server.netOut === null || server.netOut === undefined ? null : fmtRateShort(server.netOut),
    server.dayRx === null || server.dayRx === undefined ? null : fmtBytesShort(server.dayRx),
    server.dayTx === null || server.dayTx === undefined ? null : fmtBytesShort(server.dayTx),
    server.trafficUsed === null || server.trafficUsed === undefined ? null : fmtBytesShort(server.trafficUsed),
    server.trafficLimit === null || server.trafficLimit === undefined ? null : fmtBytesShort(server.trafficLimit),
  ]);
}

export class ServerCards {
  constructor(scene) {
    this.scene = scene;
    this.cards = new Map(); // id -> { sprite, tex, dot, dotTex, sig, tier, op, dotOp, w, h, aspect }
    this.mode = 'always';
    this.enabled = true;   // 「卡片」总开关（主站按钮控制）
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  _makeTex(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  _makeSprite(canvas) {
    const tex = this._makeTex(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0 });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 30;
    return { sprite, tex };
  }

  /**
   * 把 sprite 换成新画布。
   * 注意：three r169 下「改 texture.image + needsUpdate」不会重传 GL 贴图
   * （实测屏幕不刷新），必须新建 CanvasTexture 顶上、旧的释放。
   */
  _setTexture(card, which, canvas) {
    const next = this._makeTex(canvas);
    if (which === 'card') {
      card.sprite.material.map = next;
      card.sprite.material.needsUpdate = true;
      card.tex.dispose();
      card.tex = next;
    } else {
      card.dot.material.map = next;
      card.dot.material.needsUpdate = true;
      card.dotTex.dispose();
      card.dotTex = next;
    }
  }

  /** 数据变了才重画卡片 */
  sync(servers) {
    const ids = new Set(servers.map((s) => s.id));
    for (const [id, card] of [...this.cards]) {
      if (ids.has(id)) continue;
      this.group.remove(card.sprite);
      this.group.remove(card.dot);
      card.tex.dispose();
      card.dotTex.dispose();
      this.cards.delete(id);
    }
    for (const server of servers) {
      let card = this.cards.get(server.id);
      if (!card) {
        const canvas = drawCompact(server);
        const { sprite, tex } = this._makeSprite(canvas);
        const { sprite: dot, tex: dotTex } = this._makeSprite(drawDot(server));
        dot.scale.set(DOT_WORLD, DOT_WORLD, 1);
        dot.visible = false;
        this.group.add(sprite);
        this.group.add(dot);
        const aspect = canvas.height / canvas.width;
        const h = W_COMPACT * aspect;
        sprite.scale.set(W_COMPACT, h, 1);
        card = { sprite, tex, dot, dotTex, sig: sigOf(server), tier: 'compact', op: 0, dotOp: 0, clipOp: 1, clipped: false, w: W_COMPACT, h, aspect, gap: 0.72, pending: false };
        this.cards.set(server.id, card);
      }
      const sig = sigOf(server);
      if (sig !== card.sig) {
        card.sig = sig;
        card.pending = true;                              // 重画排队，避免一次刷新画几十张
        this._setTexture(card, 'dot', drawDot(server));   // 状态点很小，直接重画
      }
    }
  }

  _redraw(card, server) {
    const canvas = card.tier === 'full' ? drawFull(server) : drawCompact(server);
    this._setTexture(card, 'card', canvas);
    card.aspect = canvas.height / canvas.width;
  }

  setMode(mode) {
    this.mode = mode;
  }

  /** 主站的「卡片显示」总开关：关掉后小鸡头顶连状态点也收掉 */
  setEnabled(on) {
    this.enabled = !!on;
  }

  /**
   * 每帧把卡片放到小鸡头顶。
   * @param {Array} items 小鸡列表（含 pos / height / server）
   * @param {THREE.Vector3} playerPos
   * @param {string|null} focusedId 当前悬停/被提示的那只
   * @param {number} dt 帧间隔（过渡系数用，帧率无关）
   */
  update(items, playerPos, focusedId = null, dt = 1 / 60, camera = null) {
    const K = REDUCE_MOTION ? 1 : 1 - Math.exp(-dt * FADE_RATE);   // 一阶平滑：约 0.9s 到位（放慢一档，切换更丝滑）
    const KOUT = REDUCE_MOTION ? 1 : 1 - Math.exp(-dt * FADE_RATE * 2.6);  // 收卡快一档：约 0.35s，别压着别人的卡
    // 间距判定用的位置走一层低通：小鸡会自己溜达，拿实时坐标判会逐帧翻牌（一会儿出卡一会儿变点），
    // 拿窝点判又管不住「两只鸡走到一起」——低通（约 1.8 s 跟上）两头都照顾到
    const KSLOW = 1 - Math.exp(-dt * 0.55);
    const seen = [];
    for (const item of items) {
      const card = this.cards.get(item.server.id);
      if (!card) continue;
      if (card.sx === undefined) { card.sx = item.pos.x; card.sz = item.pos.z; }
      card.sx += (item.pos.x - card.sx) * KSLOW;
      card.sz += (item.pos.z - card.sz) * KSLOW;
      seen.push({ item, card, d: Math.hypot(playerPos.x - item.pos.x, playerPos.z - item.pos.z) });
    }
    seen.sort((a, b) => a.d - b.d);

    // 常驻档的同屏完整卡预算：按视口宽度微调（宽屏 12、手机窄屏更少）。
    // 数量多的站点里，超出的先缩成状态点，走近自然轮到它——不然 40 张卡直接糊成一团。
    const budget = Math.max(8, Math.min(14, Math.round(window.innerWidth / 140)));
    this._budget = budget;
    // 每帧最多重画几张卡（数据刷新时先上队，避免一次刷新画 40 张造成顿卡）
    let redrawBudget = 3;

    // 同屏卡「互不叠放」名单（带滞回，走位时卡片不来回跳）：
    // 1) 已在出卡的用较宽的保留间距继续留着；2) 新卡按严格间距补位，总数不超预算。
    // （悬停/被提示的那只无条件出卡；总开关关掉时整段跳过）
    let allowed = null;
    if (this.enabled && this.mode === 'always') {
      allowed = new Set();
      const at = (card) => ({ x: card.sx, z: card.sz });
      const accepted = [];
      // 小站点也必须过一遍间距检查：默认配置下最近的两只鸡只隔 3.4，卡片会叠掉 44%
      const focusedEntry = focusedId ? seen.find((x) => x.item.server.id === focusedId) : null;
      if (focusedEntry) {
        const h = at(focusedEntry.card);
        allowed.add(focusedId);
        accepted.push({ x: h.x, z: h.z });
      }
      // 1) 保留：上一帧已经在出卡的（容忍度宽一档，边界处不抖）
      for (const { item, card } of seen) {
        if (allowed.size >= budget + 2) break;
        const sid = item.server.id;
        if (allowed.has(sid) || !card.wasAllowed) continue;
        const h = at(card);
        let clash = false;
        for (const a of accepted) {
          if (Math.hypot(a.x - h.x, a.z - h.z) < KEEP_GAP) { clash = true; break; }
        }
        if (clash) continue;
        allowed.add(sid);
        accepted.push({ x: h.x, z: h.z });
      }
      // 2) 补位：新卡按严格间距进
      for (const { item, card } of seen) {
        if (allowed.size >= budget) break;
        const sid = item.server.id;
        if (allowed.has(sid)) continue;
        const h = at(card);
        let clash = false;
        for (const a of accepted) {
          if (Math.hypot(a.x - h.x, a.z - h.z) < CARD_MIN_GAP) { clash = true; break; }
        }
        if (clash) continue;
        allowed.add(sid);
        accepted.push({ x: h.x, z: h.z });
      }

      // 3) 兜底：间距是拿「低通位置」判的，追上真实位置要 1~2 s。
      //    两只鸡正好对穿而过时，低通还觉得它们离得够远，屏幕上的卡已经压上了。
      //    这里按真实位置再硬查一遍：宁可一张收成状态点，也不许两张卡糊在一起。
      //    判据用「屏幕矩形」而不是世界距离：斜视角下两张卡世界距离够远，投影到屏幕上照样压住。
      const byId = new Map(seen.map((x) => [x.item.server.id, x]));
      const vh = camera ? camera.top - camera.bottom : 0;
      const ppwu = vh > 0 ? window.innerHeight / vh : 0;
      const placed = [];
      for (const sid of [...allowed]) {
        const entry = byId.get(sid);
        if (!entry) continue;
        const it = entry.item;
        const c = entry.card;
        let box;
        if (camera && ppwu) {
          const y = it.height + c.gap + c.h / 2;
          const v = _proj.set(it.pos.x, y, it.pos.z).project(camera);
          box = {
            x: (v.x * 0.5 + 0.5) * window.innerWidth,
            y: (-v.y * 0.5 + 0.5) * window.innerHeight,
            w: c.w * ppwu,
            h: c.h * ppwu,
          };
        }
        if (box && placed.some((a) => Math.abs(a.x - box.x) < (a.w + box.w) * 0.46 && Math.abs(a.y - box.y) < (a.h + box.h) * 0.46)) {
          allowed.delete(sid);
          continue;
        }
        if (box) placed.push(box);
      }
    }
    // 记下本帧结果，供下一帧的滞回判断
    for (const [id, c] of this.cards) c.wasAllowed = !!(allowed && allowed.has(id));

    // 同一时刻最多展开一张卡：优先悬停/被提示的那只；否则最近且已走近的。
    // 已在展开的走远一点（>5.4）才收，避免边界处展开卡闪来闪去。
    let expandId = null;
    if (this.enabled) {
      const prevEntry = this._expandId ? seen.find((x) => x.item.server.id === this._expandId) : null;
      if (focusedId && seen.some((x) => x.item.server.id === focusedId)) expandId = focusedId;
      else if (prevEntry && prevEntry.d < 5.4) expandId = this._expandId;
      else if (seen.length && seen[0].d < 4.2) expandId = seen[0].item.server.id;
      this._expandId = expandId;
    } else {
      this._expandId = null;
    }

    seen.forEach(({ item, card, d }, rank) => {
      const server = item.server;
      const focused = focusedId === server.id;
      const offline = server.status === 'offline' || server.status === 'unknown';

      let tier = null;
      let cardOp = 0;
      let dotOp = 0;
      if (!this.enabled) {
        // 主站「卡片」总开关关掉：头顶什么都不留（走近详情仍可用）
      } else if (this.mode === 'dot') {
        dotOp = 1;
      } else if (this.mode === 'near') {
        if (focused || (rank === 0 && d < 9.5)) { tier = 'full'; cardOp = 1; }
      } else {
        // 常驻：人人有卡，但同屏只留「最近且互不叠放」的一批；其余缩成状态点
        const inBudget = allowed.has(server.id);
        tier = inBudget ? (server.id === expandId ? 'full' : 'compact') : null;
        cardOp = inBudget ? 1 : 0;
        dotOp = inBudget ? 0 : 1;
      }

      if (tier && tier !== card.tier) {
        card.tier = tier;
        card.pending = false;   // 顺手把最新数据画上
        this._redraw(card, server);
      } else if (card.pending && redrawBudget > 0) {
        card.pending = false;
        redrawBudget--;
        this._redraw(card, server);
      }

      // 出卡慢慢「长出来」，收卡要利索：让位的卡别在别人卡上面赖着半透明
      card.op += (cardOp - card.op) * (cardOp > card.op ? K : KOUT);
      card.dotOp += (dotOp - card.dotOp) * K;

      // 尺寸目标按当前档位；切换档位时尺寸渐变 → 「长出来」的效果
      const wT = card.tier === 'full' ? W_FULL : W_COMPACT;
      const hT = wT * (card.aspect || C_BODY / DW);
      card.w += (wT - card.w) * K;
      card.h += (hT - card.h) * K;

      // 展开的卡抬高一点（避开 E 提示），抬升同样平滑过渡
      card.gap += ((card.tier === 'full' ? 1.5 : 0.72) - card.gap) * K;
      card.sprite.scale.set(card.w, card.h, 1);
      card.sprite.position.set(item.pos.x, item.height + card.gap + card.h / 2, item.pos.z);

      // 窄屏：被屏幕边缘切掉太多就收卡（换成状态点），别露半张卡
      if (camera && window.innerWidth < CLIP_NARROW) {
        const p = card.sprite.position;
        const frac = clippedFraction(camera, p.x, p.y, p.z, card.w, card.h);
        if (frac > CLIP_HIDE) card.clipped = true;
        else if (frac < CLIP_SHOW) card.clipped = false;
      } else {
        card.clipped = false;
      }
      card.clipOp += ((card.clipped ? 0 : 1) - card.clipOp) * K;

      card.sprite.material.opacity = card.op * (offline ? 0.8 : 1) * card.clipOp;
      card.sprite.visible = card.op * card.clipOp > 0.02;
      card.sprite.renderOrder = 30 + Math.max(0, 140 - Math.round(d * 4));

      // 收起后留一颗状态点，那只鸡头顶不至于空着
      const dotOpEff = Math.max(card.dotOp, card.clipped ? card.op : 0);
      card.dotEff = dotOpEff;
      card.dot.position.set(item.pos.x, item.height + 0.75, item.pos.z);
      card.dot.material.opacity = dotOpEff * (offline ? 0.7 : 1);
      card.dot.visible = dotOpEff > 0.02;
      card.dot.renderOrder = 60;
    });
  }

  /** 验收探针（check-theme / check-live 用） */
  debugInfo() {
    let visible = 0;
    let full = 0;
    let compact = 0;
    let dots = 0;
    for (const c of this.cards.values()) {
      if (c.sprite.visible && c.op * (c.clipOp ?? 1) > 0.5) {
        visible++;
        if (c.tier === 'full') full++;
        else compact++;
      }
      if (c.dot.visible && (c.dotEff ?? c.dotOp) > 0.5) dots++;
    }
    return { mode: this.mode, enabled: this.enabled, total: this.cards.size, visible, full, compact, dots, budget: this._budget || 0 };
  }
}
