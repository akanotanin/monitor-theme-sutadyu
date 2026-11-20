/**
 * 主题引导：先读 Monitor hub 的接口，再加载小镇主模块。
 *
 * 顺序很重要：main.js 在模块求值时就要读配置（镜头高度、阴影开关等），
 * 静态 import 会提前求值，所以这里「await 拿到 → 再 dynamic import」。
 *
 * Monitor 主题约定（hub 1.6.0 起）：
 *   · /api/me                     → { authed, site_name, public_page, history_days }
 *   · /api/themes/<short>/config  → 主题设置（GET 读、PUT 写，一个站一份）
 *   · /api/nodes                  → 节点列表
 *   · ws /api/ws                  → 实时推送（发 {op:"get"} 要一份快照）
 *
 * 载入动画（src/loading.js）挂在最前面：它是纯 canvas、零依赖，先于 three 的
 * 模块图跑起来；进度用的是真实的等待节点，不是编出来的时间轴。
 */

const SHORT = 'sutadyu';

/* 载入动画先起：拿不到元素/画布时 mount() 返回 null，后面所有进度调用都变成空操作 */
let load = null;
try {
  const mod = await import('./src/loading.js?v=1.8.16');
  load = mod.mount();
} catch (err) {
  console.warn('[sutadyu] 载入动画未启动', err);
}
const step = (v) => { try { load?.set(v); } catch { /* 进度不参与主线 */ } };

step(0.12);
setTimeout(() => { try { document.body.classList.add('ld-ready'); } catch { /* 纯装饰 */ } }, 800);

const DEFAULTS = {
  viewHeight: '24',
  labelMode: 'auto',
  villagers: true,
  shadows: true,
  lowQuality: false,
};

const asBool = (v, d) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(s)) return true;
    if (['0', 'false', 'off', 'no', ''].includes(s)) return false;
  }
  return d;
};

const asView = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 14 && n <= 40 ? String(Math.round(n)) : d;
};

const LABEL_MODES = ['auto', 'near', 'always', 'dot'];

function pickSettings(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    viewHeight: asView(s.viewHeight, DEFAULTS.viewHeight),
    labelMode: LABEL_MODES.includes(s.labelMode) ? s.labelMode : DEFAULTS.labelMode,
    villagers: asBool(s.villagers, DEFAULTS.villagers),
    shadows: asBool(s.shadows, DEFAULTS.shadows),
    lowQuality: asBool(s.lowQuality, DEFAULTS.lowQuality),
  };
}

/**
 * 带超时的 GET：反代只建连不回包时，裸 fetch 会一直挂着——boot 卡在这里就等于整页空白，
 * 所以这两个请求都必须自己收尾（超时/失败都退回默认值，主模块照常加载）。
 */
async function getJson(url, ms = 8000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: ac.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 站名 + 历史保留天数：hub 的 /api/me 会给（站名只在拿不到时回退），历史天数给详情页生成时间档位 */
async function loadMe() {
  const json = await getJson('/api/me');
  return json && typeof json === 'object' ? json : null;
}

async function loadConfig() {
  const raw = await getJson(`/api/themes/${SHORT}/config`);
  return raw ? pickSettings(raw) : { ...DEFAULTS };
}

const [config, me] = await Promise.all([loadConfig(), loadMe()]);
step(0.42);
// 预览/验收用：?labelMode=auto|always|near|dot 直接切名牌档位（不动站点配置）
const forcedLabel = new URLSearchParams(location.search).get('labelMode');
if (LABEL_MODES.includes(forcedLabel)) config.labelMode = forcedLabel;
window.__SUTADYU_CONFIG__ = config;
window.__SUTADYU_ME__ = {
  siteName: (me && me.site_name) || '',
  historyDays: Number(me && me.history_days) > 0 ? Number(me && me.history_days) : 0,
  // 站点是否对访客开放：false 时 main.js 把「未发现服务器」换成「需要登录」
  publicPage: me ? me.public_page !== false : null,
  authed: !!(me && me.authed),
};
const siteName = window.__SUTADYU_ME__.siteName;
// 标签页标题：hub 给的站名（拿不到就保留 Monitor）
if (siteName) {
  document.title = siteName;
  const el = document.querySelector('.hud .hud-site');
  if (el) el.textContent = siteName;
}
// 左上角保持主题自己的标题（探针小镇），站名只用于标签页

// 进场效果：主模块首帧渲染完会调用这个钩子；找不到 #boot 也能工作（主题用 #loading 幕布）
const bootEl = document.getElementById('boot') || document.getElementById('loading');
let revealed = false;
const curtain = () => document.getElementById('boot') || document.getElementById('loading') || bootEl;
const reveal = () => {
  if (revealed) return;
  revealed = true;
  document.body.classList.add('world-ready');
  // 元素到揭幕这一刻再取一次：理论上 boot 阶段已拿住，但若有重入/提前移除也能兜住
  const el = curtain();
  el?.classList.add('done');
  setTimeout(() => el?.remove(), 1200);
};

/**
 * 首帧就绪 → 让载入动画把最后一段演完（开窗点灯、撒花、100%）再揭幕。
 * 载入动画没起来（老浏览器/模块异常）就直接揭幕，不能因为装饰拖住页面。
 */
let finishing = false;
const finish = () => {
  if (finishing || revealed) return;
  finishing = true;
  if (!load) { reveal(); return; }
  try { load.done(reveal); } catch { reveal(); }
};
window.__SUTADYU_BOOT_READY__ = finish;
// 兜底只兜「真的挂了」：主模块 import 抛错会走到下面的 catch 立刻揭幕；
// 这里再留一道很宽的上限，防止模块图永远不 resolve（网络半死）。
// 注意不要调小 —— 线上实测首帧要 8~10 秒，兜底太短会把幕布提前撤掉，
// 访客就对着空场景干等了。
setTimeout(finish, 25000);

try {
  await import('./src/main.js?v=1.8.16');
} catch (err) {
  // 主模块起不来：别把访客困在奶油色幕布上，直接揭幕（场景会是空的，但至少不假装在加载）
  console.error('[sutadyu] 小镇主模块加载失败', err);
  reveal();
}
