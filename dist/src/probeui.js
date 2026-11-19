/* ------------------------------------------------------------------ *
 * 探针界面：右上角概况条 + 「当前点开的是哪台机器」
 *
 * 小鸡头顶的名牌在 1.5.0 就交给 3D 卡片层（cards.js / ServerCards）了；
 * 这里原本还留着一整套 DOM 名牌（#srv-labels / .srv-label / sync / update），
 * 但 labelsDisabled 恒为 true、update() 也没有任何调用点 —— 纯死码，1.8.12 删除。
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
    this.current = null;
    this.updatedAt = null;
    this.focusedId = null;
    this.denied = false;
  }

  setSummary(summary, updatedAt) {
    this.updatedAt = updatedAt;
    this._last = { summary, updatedAt };   // 记住最近一份：denied 翻回 false 时立刻恢复，不等下一帧
    this._paint();
  }

  _paint() {
    const { summary, updatedAt } = this._last || { summary: null, updatedAt: null };
    if (!this.bar) return;
    if (this.denied) {
      // 站点关了公开页：不是「未发现服务器」，是「需要登录」
      this.bar.dataset.state = 'locked';
      if (this.barStatus) this.barStatus.textContent = '本站未对访客开放';
      if (this.barTime) this.barTime.textContent = '';
      return;
    }
    if (!summary) return;
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
    this._paint();
  }

  /** 记录当前聚焦的小鸡（名牌改由 3D 卡片显示） */
  setFocused(hoverId, promptedId) {
    this.focusedId = hoverId || promptedId || null;
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
