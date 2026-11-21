/**
 * 折线图渲染器（详情页统一画法）
 *   · 自动量程 + 4 条网格线 + 两端时间轴标签
 *   · 支持多序列、空值断点、鼠标浮框（竖线 + 各序列圆点 + 数值）
 *   · 位图按 CSS 宽度 × dpr 重算，逻辑坐标不变（高分屏不糊）
 */

const PALETTE = ['#4c9a5e', '#4a86c8', '#c9782f', '#9b6fbf', '#c4555f', '#3f9e9e'];

/** 浮框里会插入 hub 给的探针名（后台可控字符串），一律转义 */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export { PALETTE };

function fitCanvas(canvas, W, H) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width || W;
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round((cssW * H) / W * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  return bw / W;
}

// 轴/浮框的紧凑数字：≥1000 走 k，≥10 取整，其余一位小数（0 → 「0.0」，别印成「0.00」）
const shortNum = (v) => {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  if (a >= 10) return String(Math.round(v));
  return v.toFixed(1);
};

// 带单位的轴刻度：**不能再走 k**。「延迟 1500 ms」拼成「1.5kms」是两个单位粘在一起
// （1200~9999 ms 的线路真会出现）。有单位就只收小数，不进位。
const numInUnit = (v) => {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 10) return String(Math.round(v));
  return v.toFixed(1);
};

function fmtBytes(v) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = v;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function axisTime(ts, long) {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (!long) return `${hh}:${mm}`;
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mo}-${dd} ${hh}:${mm}`;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{name:string,color:string,pts:Array<[number,number|null]>}>} series
 * @param {{unit?:string,max?:number|null,long?:boolean,hover?:boolean,format?:(v:number)=>string,axisFormat?:(v:number)=>string}} opt
 */
export function drawLine(canvas, series, opt = {}) {
  if (!canvas) return;
  const W = canvas.__lw || (canvas.__lw = Number(canvas.getAttribute('width')) || 760);
  const H = canvas.__lh || (canvas.__lh = Number(canvas.getAttribute('height')) || 170);
  const c = canvas.getContext('2d');
  const padL = 48, padR = 12, padT = 12, padB = 20;
  const iw = W - padL - padR;
  const ih = H - padT - padB;

  const all = series.flatMap((s) => s.pts || []);
  const clean = all.filter((p) => p && p[0] != null && p[1] != null && isFinite(p[0]) && isFinite(p[1]));
  const ts0 = clean.length ? Math.min(...clean.map((p) => p[0])) : 0;
  const ts1 = clean.length ? Math.max(...clean.map((p) => p[0])) : 0;
  const vals = clean.map((p) => p[1]);
  const vMax = opt.max != null ? opt.max : Math.max(...vals) * 1.15 || 1;
  const yScale = (v) => padT + ih * (1 - Math.max(0, Math.min(1, v / vMax)));
  const xScale = (t) => padL + iw * (ts1 === ts0 ? 0.5 : (t - ts0) / (ts1 - ts0));

  const rows = new Map();
  if (opt.hover) {
    series.forEach((s, i) => {
      for (const [t, v] of s.pts || []) {
        let r = rows.get(t);
        if (!r) { r = {}; rows.set(t, r); }
        r[i] = v;
      }
    });
  }
  const tss = opt.hover ? [...rows.keys()].sort((a, b) => a - b) : [];
  const fmt = opt.format || ((v) => (v == null || !isFinite(v) ? '—' : `${shortNum(v)}${opt.unit || ''}`));
  // 轴刻度：有单位时不进 k（否则「1.5kms」「3kKB/s」这种双单位），没单位才用 shortNum
  const axisFmt = opt.axisFormat
    || (opt.unit ? (v) => `${numInUnit(v)}${opt.unit}` : (v) => shortNum(v));
  let cursor = null;

  const paint = () => {
    const k = fitCanvas(canvas, W, H);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!clean.length) {
      c.fillStyle = 'rgba(90, 68, 46, 0.45)';
      c.font = '11px "PingFang SC", system-ui, sans-serif';
      c.fillText('暂无数据', padL, H / 2);
      return;
    }
    if (ts1 === ts0) {
      // 只有一个采样点：画出来也读不出趋势（x 固定落在 0.5），说明白比画个孤点好
      c.fillStyle = 'rgba(90, 68, 46, 0.45)';
      c.font = '11px "PingFang SC", system-ui, sans-serif';
      c.fillText('数据点不足（只有一个采样）', padL, H / 2);
      return;
    }

    // 网格 + Y 轴
    c.font = '10.5px ui-monospace, Consolas, monospace';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (ih * i) / 4;
      c.strokeStyle = 'rgba(120, 88, 56, 0.13)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(padL, y);
      c.lineTo(W - padR, y);
      c.stroke();
      c.fillStyle = 'rgba(90, 68, 46, 0.55)';
      const v = vMax * (1 - i / 4);
      c.fillText(axisFmt(v), 4, y + 3.5);
    }

    // 两端时间
    c.fillStyle = 'rgba(90, 68, 46, 0.5)';
    const l1 = axisTime(ts0, opt.long);
    const l2 = axisTime(ts1, opt.long);
    c.fillText(l1, padL, H - 5);
    c.fillText(l2, W - padR - c.measureText(l2).width, H - 5);

    // 折线
    for (const s of series) {
      if (!s.pts || !s.pts.length) continue;
      c.strokeStyle = s.color;
      c.lineWidth = 1.8;
      c.beginPath();
      let started = false;
      for (const [t, v] of s.pts) {
        if (v == null || !isFinite(v)) { started = false; continue; }
        const x = xScale(t), y = yScale(v);
        if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
      }
      c.stroke();
    }

    // 浮框：竖线 + 各序列圆点
    if (cursor != null) {
      const x = xScale(cursor);
      c.strokeStyle = 'rgba(90, 68, 46, 0.35)';
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(x, padT);
      c.lineTo(x, padT + ih);
      c.stroke();
      c.setLineDash([]);
      const row = rows.get(cursor) || {};
      series.forEach((s, i) => {
        const v = row[i];
        if (v == null || !isFinite(v)) return;
        c.fillStyle = s.color;
        c.beginPath();
        c.arc(x, yScale(v), 2.6, 0, Math.PI * 2);
        c.fill();
      });
    }
  };

  paint();
  requestAnimationFrame(paint);

  // 位图按 CSS 宽度 × dpr 算（fitCanvas），但以前只在绘制那一刻量一次：
  // 面板宽度变化（窗口 resize / 手机旋转 / 详情列数从 2 变 1）后 canvas.width
  // 仍是旧值，位图被 CSS 拉宽 → 线变模糊、字形拉伸。挂 ResizeObserver 重画。
  let ro = null;
  if (typeof ResizeObserver === 'function' && canvas.parentElement) {
    let lastW = canvas.getBoundingClientRect().width;
    ro = new ResizeObserver(() => {
      const w = canvas.getBoundingClientRect().width;
      if (Math.abs(w - lastW) < 0.5) return;   // 只认真的宽度变化（高度由宽度推）
      lastW = w;
      paint();
    });
    ro.observe(canvas.parentElement);
  }
  const stopResize = () => { try { ro?.disconnect(); } catch { /* 已断 */ } ro = null; };

  if (!opt.hover) return { destroy: stopResize };

  // ---- 鼠标浮框 ----
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  canvas.parentElement.appendChild(tip);

  const move = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * W;
    if (x < padL || x > W - padR || !tss.length) { cursor = null; tip.hidden = true; paint(); return; }
    const tGuess = ts0 + ((x - padL) / iw) * (ts1 - ts0);
    let nearest = tss[0];
    let best = Infinity;
    for (const t of tss) {
      const d = Math.abs(t - tGuess);
      if (d < best) { best = d; nearest = t; }
    }
    cursor = nearest;
    paint();

    // 浮框内容
    const row = rows.get(nearest) || {};
    const lines = series
      .map((s, i) => ({ name: s.name, color: s.color, v: row[i] }))
      .filter((o) => o.v != null && isFinite(o.v));
    tip.innerHTML = `<b>${axisTime(nearest, opt.long)}</b>${lines
      .map((o) => `<span><i style="background:${o.color}"></i>${esc(o.name)} ${fmt(o.v)}</span>`)
      .join('')}`;
    tip.hidden = false;
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const tw = tip.offsetWidth;
    const flip = px + tw + 16 > rect.width;
    tip.style.left = `${flip ? px - tw - 12 : px + 12}px`;
    tip.style.top = `${Math.max(0, py - 8)}px`;
  };
  const leave = () => { cursor = null; tip.hidden = true; paint(); };
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseleave', leave);
  return {
    destroy: () => {
      stopResize();
      canvas.removeEventListener('mousemove', move);
      canvas.removeEventListener('mouseleave', leave);
      tip.remove();
    },
  };
}

export { fmtBytes, shortNum, axisTime, numInUnit };
