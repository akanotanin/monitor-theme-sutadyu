import * as THREE from 'three';
import { STATUS } from './hub.js?v=1.8.11';

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


export class ProbeUI {
  constructor() {
    this.bar = document.getElementById('probe-bar');
    this.barStatus = this.bar?.querySelector('.probe-status') ?? null;
    this.barTime = this.bar?.querySelector('.probe-time') ?? null;
    this.labelLayer = document.getElementById('srv-labels');
    this.labels = new Map();
    this._v = new THREE.Vector3();
    this.current = null;
    this.updatedAt = null;
    this.onLabelPick = null;
    this.labelsDisabled = true;
    this.focusedId = null;
    this.denied = false;
    if (this.labelLayer) this.labelLayer.style.display = 'none';
  }

  setSummary(summary, updatedAt) {
    this.updatedAt = updatedAt;
    if (!this.bar) return;
    if (this.denied) {
      // 站点关了公开页：不是「未发现服务器」，是「需要登录」
      this.bar.dataset.state = 'locked';
      if (this.barStatus) this.barStatus.textContent = '本站未对访客开放';
      if (this.barTime) this.barTime.textContent = '';
      return;
    }
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

  /** 站点关了公开页：概况条要能说清「需要登录」，而不是「未发现服务器」 */
  setDenied(v) {
    const next = !!v;
    if (this.denied === next) return;
    this.denied = next;
    if (this.denied) {
      if (this.bar) this.bar.dataset.state = 'locked';
      if (this.barStatus) this.barStatus.textContent = '本站未对访客开放';
      if (this.barTime) this.barTime.textContent = '';
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

  /**
   * 详情统一由 panel 的详情页承担，这里只记住「当前是哪台」。
   * （旧版在这里拼一整张 .srv-card 的 HTML 却从不加 .show，纯属死路径——
   *  5 处调用每次都白建 DOM、白挂监听，还让 probeUI.open 恒为 false。）
   */
  showDetail(server) {
    if (!server) return;
    this.current = server;
  }

  hideDetail() {
    this.current = null;
  }
}
