#!/usr/bin/env node
/**
 * 预览图专用 mock：**中性数据**
 *
 * ★为什么单独一份：preview.png 会随主题包公开发布到互联网。
 *   之前那张图是用带真实机器别名的数据集截的（真实内网主机名 + CPU%/流量），
 *   等于把主机名和运营数据一起公开出去。这里所有名字都是通用地名 + 编号，
 *   数值也是编的，跟任何真实机器都不对应。
 *
 * ★字段必须严格照 hub 1.5.1 的真实形状（见 src/hub.js 顶部注释）：
 *   /api/nodes → { nodes: [ { id, name, online, cpu_cores, mem_total, disk_total,
 *                             country, os, virt, cpu_name, month_used, traffic_limit,
 *                             day_rx, day_tx, last_seen_ago,
 *                             metrics: { cpu, load[3], mem_used, mem_total,
 *                                        disk_used, disk_total, net_rx, net_tx,
 *                                        uptime, tcp, udp, procs } } ] }
 *   第一次写成扁平字段且没包 nodes，结果 6 台全被判 offline（在线 0/6）。
 *
 * 用法：
 *   node tools/preview-mock.mjs --port 5361 &
 *   node tools/shot-preview.mjs http://127.0.0.1:5361/ preview.png --no-prompt
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DIST = path.join(ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const NOW = Date.now();

/**
 * 六台机器。名字全用「城市 · 编号」的中性写法。
 * country 故意混三种情况，让预览图同时体现这些边界都被处理好了：
 *   jp/sg/de —— 正常
 *   uk       —— ISO 里英国是 GB，后台误填 UK；靠 FLAG_ALIAS 归一
 *   ''       —— 没填，退小地球
 */
const NODES = [
  { name: 'Tokyo · A1', country: 'jp', online: true, cores: 4, memG: 4, diskG: 40,
    cpu: 24.6, memPct: 41.2, diskPct: 18.4, upDays: 23, tcp: 42, udp: 8, procs: 96,
    netK: [1240, 420], monthG: 412, limitG: 500, os: 'Debian 12', virt: 'kvm' },
  { name: 'Osaka · B2', country: 'jp', online: true, cores: 2, memG: 2, diskG: 20,
    cpu: 8.1, memPct: 22.7, diskPct: 33.9, upDays: 51, tcp: 28, udp: 4, procs: 71,
    netK: [310, 110], monthG: 128, limitG: 300, os: 'Debian 12', virt: 'kvm' },
  { name: 'Singapore · C1', country: 'sg', online: true, cores: 8, memG: 8, diskG: 80,
    cpu: 61.3, memPct: 58.4, diskPct: 47.2, upDays: 12, tcp: 118, udp: 22, procs: 214,
    netK: [3820, 1060], monthG: 890, limitG: 2000, os: 'Debian 13', virt: 'kvm' },
  { name: 'Frankfurt · D3', country: 'de', online: true, cores: 1, memG: 1, diskG: 10,
    cpu: 3.4, memPct: 12.1, diskPct: 9.8, upDays: 87, tcp: 12, udp: 2, procs: 38,
    netK: [80, 50], monthG: 42, limitG: 100, os: 'Alpine 3.20', virt: 'lxc' },
  { name: 'London · E4', country: 'uk', online: true, cores: 2, memG: 4, diskG: 40,
    cpu: 17.9, memPct: 29.5, diskPct: 62.1, upDays: 6, tcp: 34, udp: 6, procs: 83,
    netK: [940, 280], monthG: 71, limitG: 400, os: 'Ubuntu 24.04', virt: 'kvm' },
  /* 没填国家（→ 小地球兜底）+ 离线（→ 灰色卡片），一张图同时覆盖两个边界 */
  { name: 'Sydney · F5', country: '', online: false, cores: 2, memG: 2, diskG: 20,
    cpu: null, memPct: null, diskPct: null, upDays: null, tcp: null, udp: null, procs: null,
    netK: [null, null], monthG: 8, limitG: 200, os: 'Debian 12', virt: 'kvm' },
];

const GB = 1024 ** 3;

function toNode(n, i) {
  const memTotal = n.memG * GB;
  const diskTotal = n.diskG * GB;
  const has = n.online && n.cpu !== null;
  return {
    id: i + 1,
    name: n.name,
    country: n.country,
    group: '',
    public_remark: '',
    online: n.online,
    cpu_cores: n.cores,
    cpu_name: 'vCPU',
    mem_total: memTotal,
    disk_total: diskTotal,
    swap_total: 0,
    os: n.os,
    virt: n.virt,
    kernel: '6.1.0-21-amd64',
    arch: 'x86_64',
    traffic_limit: n.limitG * GB,
    month_used: n.monthG * GB,
    day_rx: n.monthG * GB * 0.04,
    day_tx: n.monthG * GB * 0.016,
    last_seen_ago: n.online ? 0 : 86400,
    expires_in: 86400 * 210,
    /* metrics 只在有数据时给：hub.js 用 hasMetrics = !!node.metrics 决定数值栏
       显示真实值还是「—」，离线节点不给 metrics 才符合真实情况 */
    metrics: has
      ? {
          cpu: n.cpu,
          load: [
            (n.cpu / 100) * n.cores * 0.9,
            (n.cpu / 100) * n.cores * 0.7,
            (n.cpu / 100) * n.cores * 0.5,
          ],
          mem_used: (memTotal * n.memPct) / 100,
          mem_total: memTotal,
          disk_used: (diskTotal * n.diskPct) / 100,
          disk_total: diskTotal,
          net_rx: n.netK[0] * 1000,
          net_tx: n.netK[1] * 1000,
          total_rx: n.monthG * GB * 2.4,
          total_tx: n.monthG * GB * 0.9,
          uptime: n.upDays * 86400,
          tcp: n.tcp,
          udp: n.udp,
          procs: n.procs,
          swap_used: 0,
        }
      : undefined,
  };
}

/** 历史序列（详情页折线图用）：编一组平滑走线，与任何真实机器无关 */
function series(seedStr, base, spread, n = 90) {
  let s = 7;
  for (const ch of seedStr) s = (s * 31 + ch.charCodeAt(0)) % 100000;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out = [];
  let v = base;
  const stepMs = 120e3;
  const t0 = NOW - n * stepMs;
  for (let i = 0; i < n; i++) {
    v += (rnd() - 0.5) * spread;
    v = Math.max(0, Math.min(100, v));
    out.push({ ts: Math.round((t0 + i * stepMs) / 1000), cpu: +v.toFixed(2) });
  }
  return out;
}

function metricsHistory(id) {
  const n = NODES[id - 1];
  if (!n || !n.online) return { probes: {}, ping: [], loss: {}, metrics: [], step: 120 };
  const memTotal = n.memG * GB;
  const base = series(n.name + 'cpu', n.cpu ?? 5, 16);
  return {
    probes: { 1: '电信', 2: '联通', 3: '移动' },
    ping: [
      { task_id: 1, ts: Math.floor(NOW / 1000) - 30, latency: 28 + id * 3, loss: 0 },
      { task_id: 2, ts: Math.floor(NOW / 1000) - 30, latency: 41 + id * 5, loss: 0.4 },
      { task_id: 3, ts: Math.floor(NOW / 1000) - 30, latency: 52 + id * 4, loss: 0 },
    ],
    loss: { 1: 0, 2: 0.4, 3: 0 },
    metrics: base.map((p, i) => ({
      ts: p.ts,
      cpu: p.cpu,
      mem_used: (memTotal * (n.memPct ?? 20)) / 100,
      mem_total: memTotal,
      disk_used: (n.diskG * GB * (n.diskPct ?? 20)) / 100,
      disk_total: n.diskG * GB,
      net_rx: (n.netK[0] ?? 100) * 1000 * (0.6 + ((i * 7) % 10) / 12),
      net_tx: (n.netK[1] ?? 40) * 1000 * (0.6 + ((i * 5) % 10) / 12),
      uptime: (n.upDays ?? 1) * 86400,
      tcp: n.tcp ?? 10,
      udp: n.udp ?? 2,
      procs: n.procs ?? 50,
      load: [p.cpu / 100, p.cpu / 120, p.cpu / 140],
    })),
    step: 120,
  };
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveStatic(p, res) {
  let rel = p.replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  const full = path.join(DIST, rel);
  if (!full.startsWith(DIST)) return json(res, { error: 'forbidden' }, 403);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    const idx = path.join(DIST, 'index.html');
    if (fs.existsSync(idx)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(idx));
    }
    return json(res, { error: 'not found' }, 404);
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(fs.readFileSync(full));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);

  if (p === '/api/status') {
    return json(res, {
      authed: false,
      public_page: true,
      site_name: 'Probe Town',   // ★中性站名
      history_days: 30,
      version: '1.5.1',
    });
  }
  if (p === '/api/nodes') {
    return json(res, { nodes: NODES.map(toNode) });
  }
  const mm = p.match(/^\/api\/nodes\/(\d+)\/metrics$/);
  if (mm) return json(res, metricsHistory(Number(mm[1])));
  if (p.startsWith('/api/')) return json(res, {});

  return serveStatic(p, res);
});

const port = Number((() => {
  const i = process.argv.indexOf('--port');
  return i > 0 ? process.argv[i + 1] : 5361;
})());

server.listen(port, '127.0.0.1', () => {
  console.log(`preview-mock 已启动 http://127.0.0.1:${port}/  （${NODES.length} 台中性机器，无真实机器名）`);
});
