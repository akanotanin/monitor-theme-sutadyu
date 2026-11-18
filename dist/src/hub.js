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

function pickStatus(node) {
  if (!node.online) return 'offline';
  const m = node.metrics || {};
  const cpu = num(m.cpu) ?? 0;
  const mem = ratio(m.mem_used, m.mem_total) ?? 0;
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
  const diskTotal = num(m.disk_total) ?? num(node.disk_total);
  const diskUsed = num(m.disk_used);
  return {
    id: `node-${node.id ?? index}`,
    nodeId: node.id ?? index,
    name: node.name || `节点 ${node.id ?? index + 1}`,
    role: node.public_remark || node.group || '',
    status: pickStatus(node),
    hasMetrics: !!node.metrics,
    cpu: num(m.cpu),
    mem: ratio(memUsed, memTotal),
    memText: memTotal ? `${Math.round((memUsed || 0) / 1048576)}/${Math.round(memTotal / 1048576)} MB` : '',
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
    carriersLoaded: false, // 拉过一次（哪怕是空）：hub 没配探测任务时不留「加载中…」
    avgLatency: null,
    avgLoss: null,
    note: '',
  };
}

/**
 * 从 /api/nodes/{id}/metrics 里算出「三网延迟 + 丢包」。
 * 只取最近 10 分钟内的样本，避免把几小时前的抖动算进去。
 */
export function summarizeMetrics(payload, nowSec = Math.floor(Date.now() / 1000)) {
  const probes = payload?.probes || {};
  const ping = Array.isArray(payload?.ping) ? payload.ping : [];
  const lossMap = payload?.loss || {};

  // 每个 task 只保留最近样本
  const recent = new Map();
  for (const p of ping) {
    if (!p || p.task_id === undefined) continue;
    if (nowSec - Number(p.ts || 0) > 600) continue;
    const arr = recent.get(p.task_id) || [];
    arr.push(p);
    recent.set(p.task_id, arr);
  }

  // 按运营商聚合
  const buckets = new Map();
  for (const [taskId, samples] of recent) {
    const label = String(probes[taskId] || taskId);
    const carrier = CARRIERS.find((c) => c.match.test(label));
    if (!carrier) continue;
    const ok = samples.filter((s) => num(s.latency) !== null && s.latency > 0);
    if (!ok.length) continue;
    const lat = ok.reduce((a, s) => a + s.latency, 0) / ok.length;
    const loss = num(lossMap[taskId]) ?? (100 * (samples.length - ok.length)) / samples.length;
    const b = buckets.get(carrier.key) || { key: carrier.key, label: carrier.label, latency: 0, loss: 0, n: 0 };
    b.latency += lat;
    b.loss += loss;
    b.n += 1;
    buckets.set(carrier.key, b);
  }

  const carriers = [...buckets.values()]
    .map((b) => ({
      key: b.key,
      label: b.label,
      latency: Math.round(b.latency / b.n),
      loss: Math.round((b.loss / b.n) * 10) / 10,
    }))
    .sort((a, b) => CARRIERS.findIndex((c) => c.key === a.key) - CARRIERS.findIndex((c) => c.key === b.key));

  const withLatency = carriers.filter((c) => c.latency > 0);
  return {
    carriers,
    avgLatency: withLatency.length
      ? Math.round(withLatency.reduce((a, c) => a + c.latency, 0) / withLatency.length)
      : null,
    avgLoss: carriers.length
      ? Math.round((carriers.reduce((a, c) => a + c.loss, 0) / carriers.length) * 10) / 10
      : null,
  };
}

export class ServerFeed {
  constructor() {
    this.servers = [];
    this.updatedAt = null;
    this.origin = 'monitor-hub';
    this._listeners = [];
    this._ws = null;
    this._retry = 0;
    this._closed = false;
    this._metricsInflight = new Set();
  }

  onChange(fn) {
    this._listeners.push(fn);
    if (this.servers.length) fn(this.servers, this.updatedAt);
    return this;
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
        return old ? { ...s, carriers: old.carriers, carriersLoaded: old.carriersLoaded, avgLatency: old.avgLatency, avgLoss: old.avgLoss } : s;
      })
      .sort((a, b) => (a.status === 'offline' ? 1 : 0) - (b.status === 'offline' ? 1 : 0));
    this.updatedAt = new Date().toISOString();
    this._emit();
    this.refreshMetrics();
  }

  /** 拉每台机器的三网延迟（并发限流，每轮只补没数据的） */
  async refreshMetrics(force = false) {
    for (const server of this.servers) {
      if (server.status === 'offline') continue;
      if (!force && (server.carriers.length || server.carriersLoaded)) continue;
      if (this._metricsInflight.has(server.id)) continue;
      this._metricsInflight.add(server.id);
      try {
        const res = await fetch(`/api/nodes/${server.nodeId}/metrics`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) continue;
        const summary = summarizeMetrics(await res.json());
        const target = this.servers.find((s) => s.id === server.id);
        if (!target) continue;
        target.carriers = summary.carriers;
        target.carriersLoaded = true;
        target.avgLatency = summary.avgLatency;
        target.avgLoss = summary.avgLoss;
      } catch {
        /* 单台失败不影响别人 */
      } finally {
        this._metricsInflight.delete(server.id);
      }
    }
    this._emit();
  }

  async reload() {
    try {
      const res = await fetch('/api/nodes', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
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
      try { ws.send(JSON.stringify({ op: 'get' })); } catch { /* hub 会自己推 */ }
    });
    ws.addEventListener('message', (ev) => {
      try { this._apply(JSON.parse(ev.data)); } catch { /* 非 JSON 帧忽略 */ }
    });
    ws.addEventListener('close', () => {
      this._ws = null;
      this._fallback();
    });
    ws.addEventListener('error', () => { /* close 里统一重连 */ });
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
    return this;
  }

  stop() {
    this._closed = true;
    clearTimeout(this._pollTimer);
    try { this._ws?.close(); } catch { /* 已关闭 */ }
  }

  get summary() {
    const total = this.servers.length;
    const online = this.servers.filter((s) => s.status === 'online' || s.status === 'warn').length;
    const lat = this.servers.map((s) => s.avgLatency).filter((v) => typeof v === 'number');
    const avgLatency = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
    return { total, online, avgLatency };
  }
}
