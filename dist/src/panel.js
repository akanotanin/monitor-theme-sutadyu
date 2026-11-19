import { STATUS } from './hub.js?v=1.8.12';
import { drawLine, PALETTE, fmtBytes, axisTime } from './charts.js?v=1.8.12';

/** 详情图表缓存的有效期：只为「同一视图里来回切页签/档位」服务，不作长期缓存 */
const DETAIL_CACHE_TTL = 60_000;
const DETAIL_FETCH_TIMEOUT = 15_000;   // 反代吊住 body 时别让详情页永远停在「正在读探针数据…」

/* ------------------------------------------------------------------ *
 * 探针列表悬浮层 + 服务器详情（统一的展示形式）
 *
 * 列表：三列卡片网格（状态/名称/徽章 · 系统规格 · CPU 内存 磁盘 · 网速流量 · 三网延迟）
 * 详情：九格信息格 + 「资源 / 网络延迟」两个页签 + 时间范围切换 + 折线图
 *   九格：系统 / 架构 / 负载 / CPU / 内存 / 硬盘 / TCP·UDP / 本月流量 / 在线时间
 *   资源页：网络速率 · TCP/UDP · 进程 · CPU · 内存 · 硬盘 六张图（两列三排）
 *   延迟页：各探测点一张多线图 + 图例
 * ------------------------------------------------------------------ */

const fmtSpeed = (v) =>
  v === null || v === undefined || !isFinite(v) ? '—' : v >= 1024 ? `${(v / 1024).toFixed(1)} MB/s` : `${Math.round(v)} KB/s`;

const fmtRate = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : fmtSpeed(v));

const fmtGb = (bytes) => {
  if (bytes === null || bytes === undefined || !isFinite(bytes)) return '—';
  return fmtBytes(bytes);
};

/** 运行时长（秒 → 「3天0小时」）。在线时间格与卡片悬停提示共用 */
const fmtUptime = (sec) => {
  if (sec === null || sec === undefined || !isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}天${h}小时`;
  if (h) return `${h}小时${m}分`;
  return `${m}分`;
};

/** 「上次上报距今」的中文时长（hub 直接给秒数，别拿浏览器时钟去减） */
const fmtAgoSec = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.round(s / 60)}分前`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}小时前`;
  return `${Math.round(s / 86400)}天前`;
};

/** CPU 型号压缩：「AMD EPYC Processor」→「AMD EPYC」；空串表示没有可展示的型号 */
const shortCpu = (name) =>
  name ? String(name).replace(/\(R\)|\(TM\)|CPU|Processor|@.*$/gi, '').replace(/\s+/g, ' ').trim() : '';

/** 详情九格的 CPU 格：型号 × 核数（缺一个就只写有的那截，两个都缺整格隐身） */
function cpuLine(server) {
  const name = shortCpu(server.cpuName);
  const cores = Number(server.cores) || 0;
  if (name && cores > 0) return `${name} × ${cores}`;
  return name || (cores > 0 ? `${cores} 核` : '');
}

/** 在线时间格：在线给运行时长；离线写清离线多久；从没上报过 = 未接入 */
function onlineFor(s) {
  if (s.status !== 'offline') return fmtUptime(s.uptimeSec);
  const ago = s.lastSeenAgo;
  if (ago === null || ago === undefined) return '未接入';
  return ago >= 60 ? `离线 ${fmtUptime(ago)}` : '离线';
}

const pctText = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);
const barClass = (v) => (v === null || v === undefined ? '' : v >= 85 ? 'hot' : v >= 60 ? 'warm' : '');
const clamp = (v) => Math.max(0, Math.min(100, v ?? 0));

/** 时间档位：按 hub 的 /api/me history_days 生成（保留超过 7 天时补「全部 N 天」） */
function rangesFor(historyDays) {
  const days = Number.isFinite(historyDays) && historyDays >= 1 ? Math.min(365, Math.round(historyDays)) : 7;
  const list = [
    { key: '1h', hours: 1, points: 60, label: '1 小时' },
    { key: '6h', hours: 6, points: 120, label: '6 小时' },
    { key: '24h', hours: 24, points: 180, label: '24 小时' },
    { key: '7d', hours: 168, points: 168, label: '7 天' },
  ];
  const maxHours = days * 24;
  if (maxHours > 168) list.push({ key: 'all', hours: maxHours, points: 240, label: `全部 ${days} 天` });
  return list;
}
/** 打开详情默认落在「24 小时」 */
const DEFAULT_RANGE_KEY = '24h';

function shortOs(os) {
  if (!os) return '';
  const m = /^(Debian|Ubuntu|AlmaLinux|Rocky|CentOS|Arch|Alpine|openSUSE|Fedora)\b[^\d]*(\d+)?/i.exec(os);
  if (m) return `${m[1]}${m[2] ? ' ' + m[2] : ''}`;
  return os.split(/\s+/).slice(0, 2).join(' ');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 列表卡片里的三网一行 */
function carrierLine(carriers) {
  if (!carriers || !carriers.length) return '<span class="pc-carrier dim">三网数据加载中…</span>';
  return carriers
    .map((c) => {
      const loss = c.loss === null || c.loss === undefined ? null : Number(c.loss);
      const cls = loss === null ? '' : loss >= 5 ? 'bad' : loss >= 1 ? 'warn' : 'ok';
      const lat = c.latency === null || c.latency === undefined ? '—' : `${c.latency}ms`;
      const lossText = loss === null ? '—' : `${loss.toFixed(1)}%`;
      return `<span class="pc-carrier"><b>${c.label}</b><span class="lat">${lat}</span><span class="loss ${cls}">${lossText}</span></span>`;
    })
    .join('');
}

function cardHtml(server) {
  const st = STATUS[server.status] || STATUS.unknown;
  // 离线 / 还没上报过指标的机器：数值栏一律给「—」，别显示成 0%
  const live = server.status !== 'offline' && server.hasMetrics;
  const spec = [shortOs(server.os), server.virt ? server.virt.toUpperCase() : '', server.cores ? `${server.cores} 核` : '']
    .filter(Boolean)
    .join(' · ');
  const bars = [
    { k: 'CPU', v: server.cpu },
    { k: '内存', v: server.mem },
    { k: '磁盘', v: server.disk },
  ]
    .map(
      (b) => `
      <div class="pc-bar">
        <span class="k">${b.k}</span>
        <span class="track"><i class="fill ${barClass(b.v)}" style="width:${live ? clamp(b.v) : 0}%"></i></span>
        <span class="v">${live ? pctText(b.v) : '—'}</span>
      </div>`
    )
    .join('');
  const rate = (v) => (live && v !== null && v !== undefined && isFinite(v) ? fmtSpeed(v) : '—');
  const bytes = (v) => (live && v !== null && v !== undefined && isFinite(v) ? fmtGb(v) : '—');
  // 离线时把「离线多久」写进徽章（hub 自带 last_seen_ago）；在线/繁忙保持原样
  const stateText =
    server.status === 'offline' && server.lastSeenAgo !== null
      ? `离线 ${fmtAgoSec(server.lastSeenAgo)}`
      : st.label;
  const uptimeTitle = live && server.uptimeSec !== null ? ` · 已运行 ${fmtUptime(server.uptimeSec)}` : '';
  return `
    <button class="pp-card${server.status === 'offline' ? ' is-off' : ''}" type="button" data-id="${server.id}"
      title="点开 ${escapeHtml(server.name)} 的详情${escapeHtml(uptimeTitle)}">
      <div class="pc-head">
        <span class="pc-dot" style="background:${st.css}"></span>
        <span class="pc-name">${escapeHtml(server.name)}</span>
        <span class="pc-badge" style="--c:${st.css}">${escapeHtml(stateText)}</span>
      </div>
      <div class="pc-spec">${escapeHtml(spec || '—')}</div>
      <div class="pc-bars">${bars}</div>
      <div class="pc-net">
        <span>↓ ${rate(server.netIn)} ↑ ${rate(server.netOut)}</span>
        <span title="今日累计流量">↓ ${bytes(server.dayRx)} ↑ ${bytes(server.dayTx)}</span>
      </div>
      ${carrierBlock(server, live)}
      ${server.role ? `<div class="pc-pre" title="${escapeHtml(server.role)}">${escapeHtml(server.role)}</div>` : ''}
    </button>`;
}

/** 三网延迟一行：有数据就画；离线不留占位；拉过但没任务/没数据也不再转「加载中…」 */
function carrierBlock(server, live) {
  if (server.carriers && server.carriers.length) return `<div class="pc-carriers">${carrierLine(server.carriers)}</div>`;
  if (server.carriersLoaded) return '';
  if (!live) return '';
  return `<div class="pc-carriers"><span class="pc-carrier dim">三网数据加载中…</span></div>`;
}

/* ------------------------------------------------------------------ *
 * 详情页
 * ------------------------------------------------------------------ */

export class ProbePanel {
  constructor() {
    this.root = document.getElementById('plist');
    this.titleEl = document.getElementById('plist-title');
    this.sumEl = document.getElementById('plist-sum');
    this.bodyEl = document.getElementById('plist-body');
    this.detailEl = document.getElementById('plist-detail');
    this.backBtn = document.getElementById('plist-back');
    this.closeBtn = document.getElementById('plist-close');

    this.open = false;
    this.view = 'list'; // list | detail
    this.servers = [];
    this.selectedId = null;
    this.onPick = null;

    // 详情页状态
    this.nodeTab = 'res'; // res | lat
    this.rangeKey = DEFAULT_RANGE_KEY;
    this._rangesCache = null;
    this.detailCache = new Map(); // `${nodeId}:${rangeKey}` -> { at, payload }
    this.denied = false;          // 站点关了公开页：列表要写「需要登录」，不能写「暂无节点」
    this.detailToken = 0;
    this.chartHandles = [];

    this.backBtn?.addEventListener('click', () => this.showList());
    // 事件委托：卡片节点会按 id 复用，逐个挂监听会在重建时丢掉
    this.bodyEl?.addEventListener('click', (ev) => {
      const card = ev.target?.closest?.('.pp-card');
      if (!card || !this.bodyEl.contains(card)) return;
      const srv = this.servers.find((s) => s.id === card.dataset.id);
      if (!srv) return;
      this.showDetail(srv);
      this.onPick?.(srv);
    });
    this.closeBtn?.addEventListener('click', () => this.hide());
    this.root?.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.hide();
    });
  }

  setServers(servers) {
    this.servers = servers;
    if (!this.open) return;
    if (this.view === 'detail' && this.selectedId) {
      const srv = this.servers.find((s) => s.id === this.selectedId);
      // 详情页不整体重绘，避免打断看图；只刷新标题里的状态
      if (srv && this.titleEl) {
        const st = STATUS[srv.status] || STATUS.unknown;
        this.titleEl.innerHTML = `🐔 ${escapeHtml(srv.name)} <span class="pd-state" style="color:${st.css}">${st.label}</span>`;
      }
    } else if (this.view === 'list') {
      this.renderList();
    }
  }

  /** 站点关了公开页（/api/nodes 401）：列表改成「需要登录」的说法 */
  setDenied(v) {
    const next = !!v;
    if (this.denied === next) return;
    this.denied = next;
    if (this.open && this.view === 'list') this.renderList();
  }

  renderList() {
    if (!this.bodyEl) return;
    const total = this.servers.length;
    const online = this.servers.filter((s) => s.status === 'online' || s.status === 'warn').length;
    const lat = this.servers.map((s) => s.avgLatency).filter((v) => typeof v === 'number');
    const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
    if (this.sumEl) {
      this.sumEl.innerHTML = this.denied
        ? '本站未对访客开放'
        : `共 <b>${total}</b> 台 · 在线 <b>${online}</b>${avg !== null ? ` · 平均延迟 <b>${avg} ms</b>` : ''}`;
    }
    if (this.denied) {
      this.bodyEl.innerHTML = '<div class="pd-empty">本站未对访客开放<br>请登录后台查看（右上角 ⚙ 后台）</div>';
      return;
    }
    if (!this.servers.length) {
      this.bodyEl.innerHTML = '<div class="pd-empty">暂无节点</div>';
      return;
    }
    // 按 id 复用卡片节点：WS 每 2 s 推一帧，全量重写会把滚动位置、悬停态和键盘焦点一起冲掉。
    // 卡片里嵌着带宽/负载，每推必变 —— 所以「节点不换、只就地把内容换掉」：按钮节点留在原地，
    // 焦点、悬停、宽度过渡都不会被打断（换整颗节点的话键盘用户每 2 s 就会被踢回 body）。
    const existing = new Map();
    for (const el of [...this.bodyEl.children]) {
      if (el.classList?.contains('pp-card')) existing.set(el.dataset.id, el);
    }
    const nodes = this.servers.map((srv) => {
      const html = cardHtml(srv);
      const old = existing.get(srv.id);
      if (old && old.__html === html) return old;
      const box = document.createElement('div');
      box.innerHTML = html;
      const fresh = box.firstElementChild;
      if (!old) {
        fresh.__html = html;
        return fresh;
      }
      old.className = fresh.className;
      old.title = fresh.title;
      old.innerHTML = fresh.innerHTML;
      old.__html = html;
      return old;
    });
    // 节点全都没变就别动 DOM：replaceChildren 会先摘后插，焦点会被摘掉
    const cur = this.bodyEl.children;
    const same = cur.length === nodes.length && nodes.every((n, i) => cur[i] === n);
    if (same) return;
    // 顺序变了（hub 每次推送把离线排到最后）：先记下聚焦的是哪一张，插完再按 id 找回来
    const focusId = this.bodyEl.contains(document.activeElement)
      ? document.activeElement.closest?.('.pp-card')?.dataset.id ?? null
      : null;
    this.bodyEl.replaceChildren(...nodes);
    if (focusId) {
      const again = [...this.bodyEl.children].find((el) => el.dataset.id === focusId);
      again?.focus?.({ preventScroll: true });
    }
  }

  showList() {
    this.root?.classList.remove('is-detail');
    this.view = 'list';
    this.selectedId = null;
    this._destroyCharts();
    this.detailCache.clear();   // 回到列表就把详情数据丢掉：下次点开重新读，别拿几分钟前的曲线
    if (this.titleEl) this.titleEl.textContent = '🖥 探针列表';
    this.bodyEl?.classList.remove('hidden');
    this.detailEl?.classList.add('hidden');
    this.backBtn?.classList.add('hidden');
    this.renderList();
  }

  showDetail(server) {
    this.view = 'detail';
    this.selectedId = server.id;
    this.nodeTab = 'res';
    this.rangeKey = DEFAULT_RANGE_KEY;    // 每次打开都回到默认档位（24 小时），别沿用上一条的
    const st = STATUS[server.status] || STATUS.unknown;
    if (this.titleEl) this.titleEl.innerHTML = `🐔 ${escapeHtml(server.name)} <span class="pd-state" style="color:${st.css}">${st.label}</span>`;
    if (this.sumEl) this.sumEl.textContent = '';
    this.bodyEl?.classList.add('hidden');
    this.detailEl?.classList.remove('hidden');
    this.backBtn?.classList.remove('hidden');
    this.root?.classList.add('is-detail');
    this.renderDetail(server);
  }

  /** 档位表：按 hub 保留天数生成（生成一次就缓存；拿不到 /api/me 时退回 7 天） */
  _ranges() {
    if (!this._rangesCache) {
      const hd = Number(window.__SUTADYU_ME__ && window.__SUTADYU_ME__.historyDays) || 0;
      this._rangesCache = rangesFor(hd);
    }
    return this._rangesCache;
  }

  /** 详情主体：九格信息 + 页签 + 时间范围 + 图表 */
  renderDetail(server) {
    const m = server;
    const memTotal = m.memTotal;
    const diskTotal = m.diskTotal;
    const swapTotal = m.swapTotal;
    const loads = Array.isArray(m.loadAll) && m.loadAll.length ? m.loadAll.map((v) => Number(v).toFixed(2)) : null;
    // 九格（固定字段与顺序）：系统 / 架构 / 负载 / CPU / 内存·交换分区 / 硬盘 / TCP·UDP / 今日流量 / 在线时间
    const facts = [
      ['系统', [shortOs(m.os), m.kernel].filter(Boolean).join(' · ')],
      ['架构', [m.arch, m.virt && m.virt !== 'none' ? m.virt.toUpperCase() : '', m.procs ? `${m.procs} 进程` : ''].filter(Boolean).join(' · ')],
      ['负载', m.load !== null ? m.load.toFixed(2) : null, loads ? `1 / 5 / 15 分钟：${loads.join(' ')}` : ''],
      ['CPU', cpuLine(m) || null],
      [swapTotal > 0 ? '内存 / 交换分区' : '内存',
        memTotal ? (swapTotal > 0 ? `${fmtBytes(memTotal)} / ${fmtBytes(swapTotal)}` : fmtBytes(memTotal)) : null],
      ['硬盘', diskTotal ? fmtBytes(diskTotal) : null],
      ['TCP / UDP 连接', m.tcp !== null && m.udp !== null ? `${m.tcp} / ${m.udp}` : null],
      // 没有 day_rx/day_tx 的数据源：整格隐身，不印两个「—」
      ['今日流量', m.dayRx !== null || m.dayTx !== null ? `↓ ${fmtGb(m.dayRx)} · ↑ ${fmtGb(m.dayTx)}` : null],
      ['在线时间', onlineFor(m)],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '');

    this.detailEl.innerHTML = `
      <dl class="pgrid">${facts
        .map(([k, v, title]) => `<div class="cell"><dt>${escapeHtml(k)}</dt><dd title="${escapeHtml(String(title || v))}">${escapeHtml(String(v))}</dd></div>`)
        .join('')}</dl>
      <div class="tabs" id="dtabs">
        <button type="button" class="tab${this.nodeTab === 'res' ? ' on' : ''}" data-tab="res">资源</button>
        <button type="button" class="tab${this.nodeTab === 'lat' ? ' on' : ''}" data-tab="lat">网络延迟</button>
      </div>
      <div class="rangebar" id="drange">
        ${this._ranges().map((r) => `<button type="button" class="rbtn${r.key === this.rangeKey ? ' on' : ''}" data-range="${r.key}">${r.label}</button>`).join('')}
      </div>
      <div id="dcharts"><p class="note">正在读探针数据…</p></div>`;

    this.detailEl.querySelector('#dtabs')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab');
      if (!btn || btn.dataset.tab === this.nodeTab) return;
      this.nodeTab = btn.dataset.tab;
      for (const el of this.detailEl.querySelectorAll('#dtabs .tab')) {
        el.classList.toggle('on', el.dataset.tab === this.nodeTab);
      }
      this.loadAndDraw(server);
    });

    this.detailEl.querySelector('#drange')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.rbtn');
      if (!btn || btn.dataset.range === this.rangeKey) return;
      this.rangeKey = btn.dataset.range;
      for (const el of this.detailEl.querySelectorAll('#drange .rbtn')) {
        el.classList.toggle('on', el.dataset.range === this.rangeKey);
      }
      this.loadAndDraw(server);
    });

    this.loadAndDraw(server);
  }

  _destroyCharts() {
    for (const h of this.chartHandles) {
      try { h?.destroy?.(); } catch { /* 已移除 */ }
    }
    this.chartHandles = [];
  }

  async loadAndDraw(server) {
    const token = ++this.detailToken;
    const box = this.detailEl?.querySelector('#dcharts');
    if (!box) return;
    const range = this._ranges().find((r) => r.key === this.rangeKey) || this._ranges()[0];
    const cacheKey = `${server.nodeId}:${range.key}`;
    const cached = this.detailCache.get(cacheKey);
    // 缓存只服务「同一会话里来回切页签/档位」；超过 60 s 或面板一关就作废，
    // 否则同一台机器永远显示第一次读到的曲线
    const fresh = cached && Date.now() - cached.at < DETAIL_CACHE_TTL;

    if (!fresh) {
      box.innerHTML = '<p class="note">正在读探针数据…</p>';
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), DETAIL_FETCH_TIMEOUT);
      try {
        const res = await fetch(`/api/nodes/${server.nodeId}/metrics?hours=${range.hours}&points=${range.points}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: ac.signal,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this.detailCache.set(cacheKey, { at: Date.now(), payload: await res.json() });
      } catch (err) {
        // 超时别把英文 AbortError 原样拼给访客看（「The user aborted a request.」不像人能读的提示）
        const msg = ac.signal.aborted ? '读取超时（15 秒无响应）' : err.message;
        if (token === this.detailToken) box.innerHTML = `<p class="note">读取失败：${escapeHtml(msg)}</p>`;
        return;
      } finally {
        clearTimeout(timer);
      }
    }
    if (token !== this.detailToken) return;

    const payload = this.detailCache.get(cacheKey)?.payload;
    if (!payload) return;
    this._destroyCharts();
    if (this.nodeTab === 'lat') this._drawLatency(box, payload, range);
    else this._drawResources(box, payload, server, range);
  }

  /** 资源页：六张图，两列三排 */
  _drawResources(box, payload, server, range) {
    const rows = payload.metrics || [];
    const peak = (pick) => rows.reduce((hi, x) => Math.max(hi, Number(pick(x)) || 0), 0);
    const nice = (v, step, cap = Infinity) => Math.min(cap, Math.max(step, Math.ceil((v * 1.15) / step) * step));
    const round4 = (v) => { const t = Math.max(4, Math.ceil(v * 1.15)); return t + ((4 - (t % 4)) % 4); };

    const cpuTop = nice(peak((x) => x.cpu), 10, 100);
    const netTop = Math.max(1, Math.ceil(peak((x) => Math.max((x.net_rx || 0) / 1024, (x.net_tx || 0) / 1024)) * 1.15));
    const connTop = round4(peak((x) => Math.max(x.tcp || 0, x.udp || 0)));
    const procTop = round4(peak((x) => x.procs || 0));
    const long = (range.hours || 1) > 12;

    const legend = (items) =>
      items.length < 2
        ? ''
        : `<span class="cl">${items.map(([name, color]) => `<i style="background:${color}"></i>${escapeHtml(name)}`).join('')}</span>`;

    const panels = [
      ['网络速率', [['下行', '#4c9a5e', (x) => (x.net_rx || 0) / 1024], ['上行', '#4a86c8', (x) => (x.net_tx || 0) / 1024]], netTop, ' KB/s', (v) => (v >= 1024 ? `${(v / 1024).toFixed(2)} MB/s` : `${v.toFixed(1)} KB/s`)],
      ['TCP / UDP 连接', [['TCP', '#4a86c8', (x) => x.tcp], ['UDP', '#c4555f', (x) => x.udp]], connTop, '', (v) => String(v)],
      [server.procs ? `进程 · ${server.procs}` : '进程', [['进程', '#9b6fbf', (x) => x.procs]], procTop, '', (v) => String(v)],
      ['CPU', [['CPU', '#4a86c8', (x) => x.cpu]], cpuTop, '%', (v) => `${Number(v).toFixed(1)}%`],
      [server.memTotal ? `内存 · ${fmtBytes(server.memTotal)}` : '内存', [['内存', '#c9782f', (x) => x.mem_used]], server.memTotal || null, '', fmtBytes, fmtBytes],
      [server.diskTotal ? `硬盘 · ${fmtBytes(server.diskTotal)}` : '硬盘', [['硬盘', '#5aa860', (x) => x.disk_used]], server.diskTotal || null, '', fmtBytes, fmtBytes],
    ];

    box.innerHTML = `<div class="chart-grid">${panels
      .map(([title, ss], i) => `<section class="cpanel"><h5><span>${escapeHtml(title)}</span>${legend(ss)}</h5><canvas id="ch${i}" width="700" height="122"></canvas></section>`)
      .join('')}</div>`;

    panels.forEach(([, ss, top, unit, fmtv, axisfm], i) => {
      const canvas = box.querySelector(`#ch${i}`);
      const handle = drawLine(
        canvas,
        ss.map(([name, color, pick]) => ({ name, color, pts: rows.map((x) => [x.ts, pick(x)]) })),
        { unit, max: top || null, long, hover: true, format: fmtv, axisFormat: axisfm }
      );
      if (handle) this.chartHandles.push(handle);
    });
  }

  /** 网络延迟页：各探测点一张多线图 + 图例 */
  _drawLatency(box, payload, range) {
    const ping = payload.ping || [];
    const probes = payload.probes || {};
    const tasks = [...new Set(ping.map((p) => p.task_id))].sort((a, b) => a - b);
    const long = (range.hours || 1) > 12;

    if (!tasks.length) {
      box.innerHTML = '<p class="note">这台机器还没有 ping 探测任务。</p>';
      return;
    }

    box.innerHTML = `<section class="cpanel">
        <h5><span>网络延迟（${escapeHtml(range.label)} · ${tasks.length} 个探测点）</span></h5>
        <canvas id="ch-lat" width="700" height="260"></canvas>
      </section>
      <div class="chips" id="legend">${tasks
        .map((tid, i) => `<span class="chip"><b style="color:${PALETTE[i % PALETTE.length]}">■</b> ${escapeHtml(probes[tid] || '#' + tid)}</span>`)
        .join('')}</div>`;

    const handle = drawLine(
      box.querySelector('#ch-lat'),
      tasks.map((tid, i) => ({
        name: probes[tid] || `#${tid}`,
        color: PALETTE[i % PALETTE.length],
        pts: ping.filter((p) => p.task_id === tid).map((p) => [p.ts, p.latency]),
      })),
      {
        unit: 'ms',
        long,
        hover: true,
        format: (v) => (v == null || !isFinite(v) ? '无响应' : `${Math.round(v)} ms`),
      }
    );
    if (handle) this.chartHandles.push(handle);
  }

  /** 把焦点移进面板（role="dialog" 要有真实的键盘行为才成立） */
  _takeFocus() {
    if (!this._prevFocus) this._prevFocus = document.activeElement;
    const target = this.closeBtn || this.root;
    const grab = () => {
      if (!this.open) return;
      if (this.root?.contains(document.activeElement)) return;   // 已经进去了就别抢
      try { target?.focus?.({ preventScroll: true }); } catch { /* 老浏览器 */ }
    };
    grab();
    // 面板显隐是 0.2s 过渡，visibility 要到过渡中点才真的变 visible：
    // 这一刻 focus() 会被浏览器静默拒绝，所以过渡结束后再补一次
    clearTimeout(this._focusTimer);
    this._focusTimer = setTimeout(grab, 260);
  }

  show() {
    if (!this.root) return;
    this.root.classList.remove('hidden');
    this.root.classList.add('show');
    this.open = true;
    this.showList();
    this._takeFocus();
  }

  /** 直接打开某台机器的详情（从 3D 里点小鸡 / 按 E） */
  showDetailDirect(server) {
    if (!this.root) return;
    this.root.classList.remove('hidden');
    this.root.classList.add('show');
    this.open = true;
    this.showDetail(server);
    this._takeFocus();
  }

  hide() {
    this.root?.classList.remove('is-detail');
    this.root?.classList.remove('show');
    this.root?.classList.add('hidden');
    clearTimeout(this._focusTimer);
    this.open = false;
    this.view = 'list';
    this.selectedId = null;
    this._destroyCharts();
    this.detailCache.clear();
    // 关掉面板后焦点回到打开它的地方，别把键盘用户扔在 body 上
    const back = this._prevFocus;
    this._prevFocus = null;
    if (back && back !== document.body && document.contains(back) && typeof back.focus === 'function') {
      try { back.focus({ preventScroll: true }); } catch { /* 忽略 */ }
    }
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }
}

export { rangesFor, DEFAULT_RANGE_KEY, axisTime };
