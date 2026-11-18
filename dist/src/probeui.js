import * as THREE from 'three';
import { STATUS } from './hub.js?v=1.8.4';

/* ------------------------------------------------------------------ *
 * 探针界面：右上角概况条、小鸡头顶名牌、右侧服务器详情卡
 * 极简风格：只有状态色、名字和几条指标
 * ------------------------------------------------------------------ */

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);

function barClass(v) {
  if (v === null || v === undefined) return '';
  if (v >= 85) return 'hot';
  if (v >= 60) return 'warm';
  return '';
}

export class ProbeUI {
  constructor() {
    this.bar = document.getElementById('probe-bar');
    this.barStatus = this.bar?.querySelector('.probe-status') ?? null;
    this.barTime = this.bar?.querySelector('.probe-time') ?? null;
    this.card = document.getElementById('srv-card');
    this.labelLayer = document.getElementById('srv-labels');
    this.labels = new Map();
    this._v = new THREE.Vector3();
    this.current = null;
    this.updatedAt = null;
    this.onLabelPick = null;
    this.labelsDisabled = true;
    this.focusedId = null;
    if (this.labelLayer) this.labelLayer.style.display = 'none';

    if (this.card) {
      this.card.querySelector('.srv-close')?.addEventListener('click', () => this.hideDetail());
    }
  }

  setSummary(summary, updatedAt) {
    this.updatedAt = updatedAt;
    if (!this.bar) return;
    const ok = summary.online === summary.total && summary.total > 0;
    this.bar.dataset.state = summary.total === 0 ? 'empty' : ok ? 'ok' : 'warn';
    if (this.barStatus) {
      this.barStatus.textContent = summary.total
        ? `在线 ${summary.online}/${summary.total}`
        : '未发现服务器';
    }
    if (this.barTime) {
      this.barTime.textContent = summary.total ? `更新 ${fmtTime(updatedAt)}` : '';
    }
  }

  /** 记录当前聚焦的小鸡（名牌改由 3D 卡片显示） */
  setFocused(hoverId, promptedId) {
    this.focusedId = hoverId || promptedId || null;
  }

  /** 按服务器列表建 / 删名牌（主题版不使用，保留给独立站） */
  sync(servers) {
    if (!this.labelLayer || this.labelsDisabled) return;
    const ids = new Set(servers.map((s) => s.id));
    for (const [id, el] of [...this.labels]) {
      if (!ids.has(id)) {
        el.remove();
        this.labels.delete(id);
      }
    }
    for (const server of servers) {
      let el = this.labels.get(server.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'srv-label';
        el.innerHTML = '<i class="dot"></i><span class="nm"></span><span class="cpu"></span>';
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.onLabelPick?.(server.id);
        });
        this.labelLayer.appendChild(el);
        this.labels.set(server.id, el);
      }
      const st = STATUS[server.status] || STATUS.unknown;
      el.dataset.state = server.status;
      el.title = `${server.name} · ${st.label}`;
      el.querySelector('.dot').style.background = st.css;
      el.querySelector('.nm').textContent = server.name;
      el.querySelector('.cpu').textContent = server.cpu === null ? '' : `${Math.round(server.cpu)}%`;
    }
  }

  /** 每帧把名牌投影到小鸡头顶（只在玩家靠近 / 悬停 / 打开卡片时显示） */
  update(camera, items, width, height, playerPos, hoverId = null, promptedId = null, mode = 'near') {
    if (!this.labelLayer || this.labelsDisabled) return;
    const openId = this.current ? this.current.id : null;
    for (const item of items) {
      const el = this.labels.get(item.server.id);
      if (!el) continue;
      const nearBy = playerPos ? Math.hypot(playerPos.x - item.pos.x, playerPos.z - item.pos.z) < 5.5 : true;
      // 已经弹出按键提示时，名牌上移避让，避免两行字叠在一起
      const isPrompted = promptedId === item.server.id;
      const focused = nearBy || hoverId === item.server.id || openId === item.server.id;
      const showFull = mode === 'dot' ? false : mode === 'always' ? true : focused;
      const show = true; // 远处也显示，但只留一个状态点
      this._v.set(item.pos.x, item.height + (isPrompted ? 1.12 : 0.62), item.pos.z);
      const p = this._v.clone().project(camera);
      const x = (p.x * 0.5 + 0.5) * width;
      const y = (-p.y * 0.5 + 0.5) * height;
      const onScreen = p.z < 1 && x > 40 && x < width - 40 && y > 30 && y < height - 30;
      const visible = onScreen && show;
      el.style.opacity = visible ? '1' : '0';
      el.style.pointerEvents = visible ? 'auto' : 'none';
      el.classList.toggle('compact', !showFull);
      if (visible) {
        el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    }
  }

  showDetail(server) {
    if (!this.card || !server) return;
    this.current = server;
    const st = STATUS[server.status] || STATUS.unknown;
    const rows = [];
    const metric = (label, value, pctValue) => {
      const cls = barClass(pctValue);
      const bar = pctValue === null || pctValue === undefined
        ? ''
        : `<i class="fill ${cls}" style="width:${Math.min(100, Math.max(0, pctValue))}%"></i>`;
      rows.push(`<div class="srv-row"><span class="k">${label}</span><span class="v">${value}</span><span class="bar">${bar}</span></div>`);
    };
    metric('CPU', pct(server.cpu), server.cpu);
    metric('内存', server.memText || pct(server.mem), server.mem);
    metric('磁盘', pct(server.disk), server.disk);
    const extra = [];
    if (server.load !== null) extra.push(`<span><b>负载</b>${server.load.toFixed(2)}</span>`);
    if (server.cores !== null) extra.push(`<span><b>核数</b>${server.cores}</span>`);
    if (server.uptimeDays !== null) extra.push(`<span><b>在线</b>${server.uptimeDays} 天</span>`);
    if (server.latency !== null) extra.push(`<span><b>延迟</b>${Math.round(server.latency)} ms</span>`);

    this.card.innerHTML = `
      <button class="srv-close" type="button" aria-label="关闭">×</button>
      <div class="srv-head">
        <span class="srv-dot" style="background:${st.css}"></span>
        <span class="srv-name"></span>
        <span class="srv-state" style="color:${st.css}">${st.label}</span>
      </div>
      ${server.role ? `<div class="srv-role"></div>` : ''}
      <div class="srv-rows">${rows.join('')}</div>
      ${extra.length ? `<div class="srv-extra">${extra.join('')}</div>` : ''}
      ${server.note ? `<div class="srv-note"></div>` : ''}
      <div class="srv-foot">数据时间 ${fmtTime(this.updatedAt)}</div>
    `;
    this.card.querySelector('.srv-name').textContent = server.name;
    if (server.role) this.card.querySelector('.srv-role').textContent = server.role;
    if (server.note) this.card.querySelector('.srv-note').textContent = server.note;
    this.card.querySelector('.srv-close').addEventListener('click', () => this.hideDetail());
    // 详情改由 panel 的详情页承担，这里不再弹小卡
    return;
  }

  hideDetail() {
    this.current = null;
    this.card?.classList.remove('show');
  }

  get open() {
    return !!this.card?.classList.contains('show');
  }
}
