/**
 * Monitor hub 数据源：读同源 /api/nodes + /api/ws，并按需拉 /api/nodes/{id}/metrics 拿三网延迟。
 *
 * hub 1.5.1 实测：
 *   /api/nodes              → { nodes: [ {id,name,online,cpu_cores,mem_total,disk_total,
 *                                month_used,traffic_limit,os,virt,cpu_name,
 *                                metrics:{cpu,load[3],mem_used,mem_total,disk_used,disk_total,
 *                                         net_rx,net_tx,uptime,tcp,udp,procs}} ] }
 *   /api/nodes/{id}/metrics → { probes:{taskId:名称}, ping:[{task_id,ts,latency,loss}], loss:{taskId:丢包%},
 *                               metrics:[{ts,cpu,mem_used,...}], step }
 *   ws /api/ws              → 同 /api/nodes 的 nodes 快照
 *
 * 只映射公开字段，不碰 IP / 密钥 / 探测目标地址。
 */

export const STATUS = {
  online: { label: '在线', color: 0x6fbf73, css: '#5aa860' },
  warn: { label: '繁忙', color: 0xe0a83c, css: '#c9902f' },
  offline: { label: '离线', color: 0xd9534f, css: '#c4493f' },
  unknown: { label: '未知', color: 0x9d9d92, css: '#8c8c80' },
};

/** 三网归类：探测点名字里带「电信 / 联通 / 移动」就归到对应运营商 */
const CARRIERS = [
  { key: 'ct', label: '电信', match: /电信|telecom/i },
  { key: 'cu', label: '联通', match: /联通|unicom/i },
  { key: 'cm', label: '移动', match: /移动|mobile/i },
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ratio = (a, b) => (num(a) !== null && num(b) ? (a / b) * 100 : null);
// 速率统一换算成 KB/s（字节/秒 → KB/s）；卡片与图表都按 KB/s 显示，>=1024 时再进 MB/s
const kbps = (bytes) => (num(bytes) === null ? null : bytes / 1024);

/* 三网延迟的刷新节奏：hub 的 /metrics 每次都要扫一遍保留期内的探测结果，
   只在「确实过期」时才取，避免每个 WS 推送都把全表重拉一遍。 */
const METRICS_TTL = 90_000;       // 拿到过数据：90 s 后才重取
const METRICS_RETRY = 20_000;     // 没拿到 / 失败：20 s 后重试（别每帧重打，会变成请求风暴）
const METRICS_CONCURRENCY = 4;    // 与 hub 的 HISTORY_GATE（4 个并发）对齐
const FRESH_WINDOW = 600;         // 三网样本只需最近 10 分钟
const WS_IDLE_MS = 10_000;        // 上游约定：10 s 没有帧就当断流，页面自己重连

function pickStatus(node, memPct = null) {
  if (!node.online) return 'offline';
  const m = node.metrics || {};
  const cpu = num(m.cpu) ?? 0;
  // 内存占比用 normalize 算好的那一份（总量可能来自 metrics.mem_total，也可能回落到节点的 mem_total）：
  // 两处口径必须一致，否则卡片画着 90% 却判「在线」
  const mem = num(memPct) ?? 0;
  const load = Array.isArray(m.load) ? num(m.load[0]) ?? 0 : 0;
  const cores = num(node.cpu_cores) || 1;
  if (cpu >= 80 || mem >= 88 || load / cores >= 1.2) return 'warn';
  return 'online';
}

/** hub 节点 → 卡片数据 */
export function normalize(node, index) {
  const m = node.metrics || {};
  const memTotal = num(m.mem_total) ?? num(node.mem_total);
  const memUsed = num(m.mem_used);
  const memPct = ratio(memUsed, memTotal);
  const diskTotal = num(m.disk_total) ?? num(node.disk_total);
  const diskUsed = num(m.disk_used);
  return {
    id: `node-${node.id ?? index}`,
    nodeId: node.id ?? index,
    name: node.name || `节点 ${node.id ?? index + 1}`,
    role: node.public_remark || node.group || '',
    status: pickStatus(node, memPct),
    hasMetrics: !!node.metrics,
    cpu: num(m.cpu),
    mem: memPct,
    // 没上报 mem_used 就别印「0 / 4G MB」——那是假的 0
    memText: memTotal && memUsed !== null ? `${Math.round(memUsed / 1048576)}/${Math.round(memTotal / 1048576)} MB` : '',
    memTotal,
    disk: ratio(diskUsed, diskTotal),
    diskTotal,
    swapTotal: num(m.swap_total) ?? num(node.swap_total),
    load: Array.isArray(m.load) ? num(m.load[0]) : null,
    loadAll: Array.isArray(m.load) && m.load.every((v) => num(v) !== null) ? m.load.map(Number) : null,
    cores: num(node.cpu_cores),
    uptimeSec: num(m.uptime),
    uptimeDays: num(m.uptime) === null ? null : Math.round((m.uptime / 86400) * 100) / 100,
    netIn: kbps(m.net_rx),
    netOut: kbps(m.net_tx),
    trafficLimit: num(node.traffic_limit),
    trafficUsed: num(node.month_used),
    totalIn: num(m.total_rx),
    totalOut: num(m.total_tx),
    dayRx: num(node.day_rx),
    dayTx: num(node.day_tx),
    tcp: num(m.tcp),
    udp: num(m.udp),
    procs: num(m.procs),
    lastSeenAgo: num(node.last_seen_ago),
    os: node.os || '',
    kernel: node.kernel || '',
    arch: node.arch || '',
    cpuName: node.cpu_name || '',
    virt: node.virt || '',
    expiresIn: num(node.expires_in),
    carriers: [],          // 三网延迟，由 fetchMetrics 填
    carriersAt: 0,         // 上次取三网数据的时间（ms）：刷新闸门用它，不看「有没有数据」
    carriersLoaded: false, // 拉过一次（哪怕是空）：hub 没配探测任务时不留「加载中…」
    avgLatency: null,
    avgLoss: null,
    note: '',
  };
}

/**
 * 从 /api/nodes/{id}/metrics 里算出「三网延迟 + 丢包」。
 * 只取最近 10 分钟内的样本，避免把几小时前的抖动算进去。
 *
 * 新鲜度用「最新样本 / 本机时钟」里较晚的那个做锚：访客的电脑慢 11 分钟，
 * 不能把刚采到的样本当成未来数据丢掉；快 1 小时，也不能把一小时前的旧值当现值。
 */
export function summarizeMetrics(payload, nowSec = Math.floor(Date.now() / 1000)) {
  const probes = payload?.probes || {};
  const ping = Array.isArray(payload?.ping) ? payload.ping : [];
  const lossMap = payload?.loss || {};
  const secOf = (t) => {
    const n = Number(t || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e11 ? n / 1000 : n;   // 毫秒时间戳也认（上游是秒，防一手其它实现）
  };
  const lossOf = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);              // loss 可能是 "2.5" 这种字符串
    return Number.isFinite(n) ? n : null;
  };

  let newest = 0;
  for (const p of ping) {
    if (!p) continue;
    const ts = secOf(p.ts);
    if (ts > newest) newest = ts;
  }
  const anchor = Math.max(newest, nowSec);

  // 每个 task 只保留最近样本
  const recent = new Map();
  for (const p of ping) {
    if (!p || p.task_id === undefined) continue;
    if (anchor - secOf(p.ts) > FRESH_WINDOW) continue;
    const arr = recent.get(p.task_id) || [];
    arr.push(p);
    recent.set(p.task_id, arr);
  }

  // 按运营商聚合（整条线路全超时也保留这一行：卡片要能显示「电信 100% 丢包」，
  // 抹掉它等于把最该看到的故障藏起来）
  const buckets = new Map();
  for (const [taskId, samples] of recent) {
    const label = String(probes[taskId] || taskId);
    const carrier = CARRIERS.find((c) => c.match.test(label));
    if (!carrier) continue;
    const ok = samples.filter((s) => num(s.latency) !== null && s.latency > 0);
    const loss = lossOf(lossMap[taskId]) ?? (100 * (samples.length - ok.length)) / samples.length;
    const b = buckets.get(carrier.key) || { key: carrier.key, label: carrier.label, latSum: 0, latN: 0, lossSum: 0, lossN: 0 };
    if (ok.length) {
      b.latSum += ok.reduce((a, s) => a + s.latency, 0) / ok.length;
      b.latN += 1;
    }
    b.lossSum += loss;
    b.lossN += 1;
    buckets.set(carrier.key, b);
  }

  const carriers = [...buckets.values()]
    .map((b) => ({
      key: b.key,
      label: b.label,
      latency: b.latN ? Math.round(b.latSum / b.latN) : null,
      loss: b.lossN ? Math.round((b.lossSum / b.lossN) * 10) / 10 : null,
    }))
    .sort((a, b) => CARRIERS.findIndex((c) => c.key === a.key) - CARRIERS.findIndex((c) => c.key === b.key));

  const withLatency = carriers.filter((c) => c.latency !== null && c.latency > 0);
  const losses = carriers.map((c) => c.loss).filter((v) => v !== null);
  return {
    carriers,
    avgLatency: withLatency.length
      ? Math.round(withLatency.reduce((a, c) => a + c.latency, 0) / withLatency.length)
      : null,
    avgLoss: losses.length ? Math.round((losses.reduce((a, b) => a + b, 0) / losses.length) * 10) / 10 : null,
  };
}

export class ServerFeed {
  constructor() {
    this.servers = [];
    this.updatedAt = null;
    this.denied = false;        // 站点关了公开页：访客拿到 401，要按「需要登录」显示，而不是「没有节点」
    this._listeners = [];
    this._deniedListeners = [];
    this._ws = null;
    this._retry = 0;
    this._closed = false;
    this._metricsInflight = new Set();
    this._lastFrame = 0;
    this._watch = null;
  }

  onChange(fn) {
    this._listeners.push(fn);
    if (this.servers.length) fn(this.servers, this.updatedAt);
    return this;
  }

  /** 公开页被关掉 / 重新打开时回调（参数 = 是否被拒） */
  onDenied(fn) {
    this._deniedListeners.push(fn);
    if (this.denied) fn(true);
    return this;
  }

  _setDenied(v) {
    if (this.denied === v) return;
    this.denied = v;
    for (const fn of this._deniedListeners) {
      try { fn(v); } catch (e) { console.warn(e); }
    }
  }

  _emit() {
    for (const fn of this._listeners) {
      try { fn(this.servers, this.updatedAt); } catch (e) { console.warn(e); }
    }
  }

  _apply(payload) {
    const nodes = payload.nodes || payload;
    if (!Array.isArray(nodes)) return;
    const prev = new Map(this.servers.map((s) => [s.id, s]));
    this.servers = nodes
      .filter((n) => n.public !== false)
      .map(normalize)
      .map((s) => {
        // 保留上一次算好的三网数据，避免刷新时卡片闪空
        const old = prev.get(s.id);
        return old
          ? {
              ...s,
              carriers: old.carriers,
              carriersAt: old.carriersAt,
              carriersLoaded: old.carriersLoaded,
              avgLatency: old.avgLatency,
              avgLoss: old.avgLoss,
            }
          : s;
      })
      .sort((a, b) => (a.status === 'offline' ? 1 : 0) - (b.status === 'offline' ? 1 : 0));
    this.updatedAt = new Date().toISOString();
    this._emit();
    this.refreshMetrics();
  }

  /** 该不该给这台机器重取三网数据（正常 90 s、失败 20 s，离线的保留旧值不动） */
  _metricsDue(server, now) {
    if (server.status === 'offline') return false;
    if (this._metricsInflight.has(server.id)) return false;
    const ttl = server.carriersLoaded ? METRICS_TTL : METRICS_RETRY;
    return now - (server.carriersAt || 0) >= ttl;
  }

  /**
   * 拉三网延迟：只在「确实过期」时取（每个 WS 推送都会调到这里）。
   * 并发 4 个（hub 的 HISTORY_GATE 就是 4）——串行 40 台要 10 轮往返，首屏太慢。
   */
  async refreshMetrics(force = false) {
    const now = Date.now();
    const queue = force
      ? this.servers.filter((s) => s.status !== 'offline' && !this._metricsInflight.has(s.id))
      : this.servers.filter((s) => this._metricsDue(s, now));
    if (!queue.length) return;

    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const server = queue[cursor++];
        this._metricsInflight.add(server.id);
        try {
          const res = await fetch(`/api/nodes/${server.nodeId}/metrics`, {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          });
          const target = this.servers.find((s) => s.id === server.id);
          if (!target) continue;
          target.carriersAt = Date.now();     // 失败也记一笔：别让每一帧都重打一遍
          if (!res.ok) continue;
          const summary = summarizeMetrics(await res.json());
          target.carriers = summary.carriers;
          target.carriersLoaded = true;
          target.avgLatency = summary.avgLatency;
          target.avgLoss = summary.avgLoss;
        } catch {
          /* 单台失败不影响别人 */
          const target = this.servers.find((s) => s.id === server.id);
          if (target) target.carriersAt = Date.now();
        } finally {
          this._metricsInflight.delete(server.id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(METRICS_CONCURRENCY, queue.length) }, worker));
    this._emit();
  }

  async reload() {
    try {
      const res = await fetch('/api/nodes', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        // 站点关了公开页：这不是「没有节点」，是「需要登录」
        this._setDenied(true);
        this.servers = [];
        this._emit();
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this._setDenied(false);
      this._apply(await res.json());
    } catch (err) {
      console.warn('[探针小镇] 读取 /api/nodes 失败：', err.message);
    }
  }

  _connect() {
    if (this._closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    } catch {
      this._fallback();
      return;
    }
    this._ws = ws;
    ws.addEventListener('open', () => {
      this._retry = 0;
      this._lastFrame = Date.now();     // 新连接从这一刻开始算空闲
      try { ws.send(JSON.stringify({ op: 'get' })); } catch { /* hub 会自己推 */ }
    });
    ws.addEventListener('message', (ev) => {
      this._lastFrame = Date.now();
      this._retry = 0;                  // 收到帧 = 链路确实活着，退避清零
      try { this._apply(JSON.parse(ev.data)); } catch { /* 非 JSON 帧忽略 */ }
    });
    ws.addEventListener('close', () => {
      this._ws = null;
      this._fallback();
    });
    ws.addEventListener('error', () => { /* close 里统一重连 */ });
  }

  /**
   * 空闲看门狗：上游约定「10 s 没有帧就当断流」。
   * 反代静默掐断（proxy_read_timeout）时浏览器收不到 close，没有它画面会永远停在最后一帧。
   */
  _startWatchdog() {
    if (this._watch) return;
    this._watch = setInterval(() => {
      const ws = this._ws;
      if (!ws || ws.readyState !== 1) return;   // 1 = OPEN
      if (Date.now() - this._lastFrame <= WS_IDLE_MS) return;
      try { ws.close(); } catch { /* 已经断了 */ }
    }, 5000);
  }

  /** 实时连接不稳时退回轮询，保证画面始终有数据 */
  _fallback() {
    if (this._closed) return;
    clearTimeout(this._pollTimer);
    const delay = Math.min(30000, 4000 * 2 ** this._retry++);
    this._pollTimer = setTimeout(() => {
      this.reload();
      if (!this._ws) this._connect();
    }, delay);
  }

  start() {
    this._closed = false;
    this.reload();
    this._connect();
    this._startWatchdog();
    return this;
  }

  stop() {
    this._closed = true;
    clearTimeout(this._pollTimer);
    clearInterval(this._watch);
    this._watch = null;
    try { this._ws?.close(); } catch { /* 已关闭 */ }
  }

  get summary() {
    const total = this.servers.length;
    const online = this.servers.filter((s) => s.status === 'online' || s.status === 'warn').length;
    // 离线节点的延迟是「最后一次看到」的旧值，不能算进平均
    const lat = this.servers
      .filter((s) => s.status !== 'offline')
      .map((s) => s.avgLatency)
      .filter((v) => typeof v === 'number');
    const avgLatency = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
    return { total, online, avgLatency };
  }
}
