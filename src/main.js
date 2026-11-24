import * as THREE from 'three';
import { TownCamera } from './camera.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { InteractionManager } from './interact.js';
import { ui } from './ui.js';
import { clamp, smoothstep } from './util.js';
import { debugColliderCount, isWalkable, groundHeight } from './collision.js';
import { isInRiver, LAYOUT, MAP, RIVER, FOUNTAIN, HOUSES } from './config.js';
import { ServerFeed, STATUS } from './hub.js';
import { ChickenHerd } from './chickens.js';
import { ProbeUI } from './probeui.js';
import { ServerCards } from './cards.js';
import { ProbePanel } from './panel.js';
import { resolvePhase, sampleAt, sunAzimuth } from './daylight.js';
import { sound } from './sound.js';

/* ------------------------------------------------------------------ *
 * 渲染器 / 场景 / 光照 —— 统一在这里初始化
 * ------------------------------------------------------------------ */

/* 主题配置：由 boot.js 预先写进 window.__SUTADYU_CONFIG__ */
const THEME = window.__SUTADYU_CONFIG__ || {};
// 名牌档位：auto = 宽屏常驻、窄屏自动收成「靠近才展开」；其余按设置原样
const LABEL_SETTING = ['always', 'near', 'dot', 'auto'].includes(THEME.labelMode) ? THEME.labelMode : 'auto';
const NARROW_VIEW = 700;   // 与 CSS 断点同口径
const pickCardMode = () => (LABEL_SETTING === 'auto' ? (window.innerWidth < NARROW_VIEW ? 'near' : 'always') : LABEL_SETTING);
let CARD_MODE = pickCardMode();

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
if (THEME.lowQuality) {
  renderer.setPixelRatio(1);
} else {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
}
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = THEME.shadows !== false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#dfe5d8');
// 雾是「相机深度」的事，相机没放大 → 近端保持 48；远端随地图放大留一点余量（阴影范围另算）
scene.fog = new THREE.Fog('#dfe5d8', 48, 100 + 10 * (LAYOUT - 1));

const hemi = new THREE.HemisphereLight('#fff0dc', '#536f78', 1.65);
scene.add(hemi);
const fill = new THREE.DirectionalLight('#c3d5e6', 0.3);
fill.position.set(14, 22, -12);
scene.add(fill);
const sun = new THREE.DirectionalLight('#ffdfb5', 2.45);
sun.castShadow = THEME.shadows !== false;
sun.position.set(-20, 30, 16);
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -29 * LAYOUT;
sun.shadow.camera.right = 29 * LAYOUT;
sun.shadow.camera.top = 29 * LAYOUT;
sun.shadow.camera.bottom = -29 * LAYOUT;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 85 * LAYOUT;
sun.shadow.bias = -0.0007;
/* ★normalBias 必须显著大于「一个阴影贴图像素」。
   阴影相机跨度 ±29×LAYOUT≈±37.7，2048 贴图 → 单像素 ≈ 0.037 世界单位；
   原来 normalBias=0.035 正好卡在这个量级，平地上会长出深色细条纹弧面
   （访客截图里草地上那片「半透明圆形网纹」就是它，是阴影自遮挡 acne，不是色块共面）。
   抬到 0.09（≈2.5 像素）把这层干涉纹消掉。 */
sun.shadow.normalBias = 0.09;
/* ★这两行原来是 shadow.radius=4 / blurSamples=12，在 PCFSoftShadowMap 下是纯空转：
   PCF_SOFT 分支只用 texelSize、根本不读 shadowRadius，
   blurSamples 只用于 VSM 的双向模糊 define。
   （three 源码：shadowmap_pars_fragment 的 `#elif defined(SHADOWMAP_TYPE_PCF_SOFT)`
   分支里没有 shadowRadius；blurSamples 只在 VSM 路径生成 materialVertical。）
   想真的更柔只有两条路：调大 mapSize（更贵）或换 VSMShadowMap（有漏光、多一趟 pass）。
   这里选择什么都不做，删掉误导性的旋钮。 */
scene.add(sun, sun.target);

/* ---- 一天里的光 ----
   主题设置 daylight 可以是 auto / day / dusk / night（见 daylight.js）。
   这里每帧（其实每 ~30 秒一次就够，见 tickDaylight）把四个光照对象的参数刷一遍。
   ★不按物理让太阳真的落下去：低角度会把影子拉到几十个世界单位，正交阴影相机
     的视锥装不下，会出现「突然一块区域没影子」。夜是靠调暗 + 冷色做的。 */
const DAYLIGHT_MODE = typeof THEME.daylight === 'string' ? THEME.daylight : 'auto';
let daylightPhase = resolvePhase(DAYLIGHT_MODE, new Date());
let daylightLamp = 0;
const SUN_RADIUS = 34;   // 太阳绕原点的水平半径（决定影子方向）

/** 把一套光照参数应用到场景；lamp 系数留给 world.update 去点亮路灯 */
/* ★这两个必须在 applyDaylight 之前声明。
   原来 world 在 157 行才 const、lastServers 在 189 行才 let，而 applyDaylight
   在 125 行就被调用了一次 —— 那时两者都在 TDZ，`world && ...` 直接抛
   ReferenceError 被 try/catch 静默吞掉（注释写「用 typeof 兜住」但代码里没有 typeof）。
   后果不只是第一次调用白跑：163 行那次「建好世界后再套一遍光照」里读 lastServers
   同样在 TDZ，于是 syncHouses 那次也没生效，只有水面 syncNight 侥幸成功。 */
let world = null;
let lastServers = null;

function applyDaylight(light) {
  hemi.color.set(light.hemiSky);
  hemi.groundColor.set(light.hemiGround);
  hemi.intensity = light.hemiInt;
  sun.color.set(light.sun);
  sun.intensity = light.sunInt;
  scene.background.set(light.bg);
  if (scene.fog) scene.fog.color.set(light.bg);
  daylightLamp = light.lamp;
  /* 水面的夜色系数：直接用 lamp（路灯亮度）当"天黑程度"。
     ★为什么不用 phase 算：lamp 的曲线本身就是「天亮灭灯、天黑点灯」，
       拿它当 night 最省事，而且和路灯、窗灯用的是同一个真相，
       不会出现「路灯已经全亮、河还是白天色」这种自相矛盾。
     ★这里必须是连续函数。曾经写成 `daylightLamp * (daylightLamp > 0.9 ? 1 : 0.55)`，
       而 lamp 在黄昏段是连续爬升的（0.88 → 1.00），跨过 0.9 时系数 0.55→1.0 阶跃，
       nightLevel 从 0.495 直接跳到 0.900 —— 水面在一帧内由"微暗"变"全黑"。
       改成 smoothstep 之后整条曲线在任何相位都不跳变。 */
  const nightK = 0.55 + 0.45 * smoothstep(0.55, 1.0, daylightLamp);
  const nightLevel = Math.min(1, daylightLamp * nightK);
  if (world && world.river && world.river.syncNight) world.river.syncNight(nightLevel, daylightLamp);
  // 窗灯亮度跟着昼夜走，重新套一遍「哪户黑着灯」
  // ★world/lastServers 已在 applyDaylight 之前声明，这里不再有 TDZ，也就不需要 try/catch
  //   把真实错误一起吃掉（原来那个空 catch 掩盖了「建好世界后这次没生效」的事实）。
  if (world && world.syncHouses && lastServers) world.syncHouses(lastServers, daylightLamp);
  // 太阳方位：破晓在东、黄昏在西；仰角由 daylight 钳好，影子不会拉出相机
  const az = sunAzimuth(daylightPhase);
  const elevRad = light.elev * (Math.PI / 180);
  const horiz = Math.cos(elevRad) * SUN_RADIUS;
  sun.position.set(
    Math.sin(az) * horiz,
    Math.sin(elevRad) * SUN_RADIUS,
    -Math.cos(az) * horiz
  );
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();
}
applyDaylight(sampleAt(daylightPhase));

/* 时间不必每帧算，但必须跟**墙上时间**走，而不是累加帧 dt：
   dt 被钳在 0.05s（main 的 frame 里），标签页挂起时 rAF 停摆、回来时只补一帧。
   之前按 dt 累加的话，开着页面几小时再回来，小镇仍停在几小时前的光——
   而访客的预期是「我这儿几点了，小镇就该几点」。所以这里只拿 dt 当节流，
   相位一律从 new Date() 现算。10 秒刷一次，肉眼完全看不出跳变。 */
let lastDaylightMs = Date.now();
const DAYLIGHT_TICK_MS = 10000;
function tickDaylight() {
  if (DAYLIGHT_MODE !== 'auto') return;
  const now = Date.now();
  if (now - lastDaylightMs < DAYLIGHT_TICK_MS) return;
  lastDaylightMs = now;
  const next = resolvePhase(DAYLIGHT_MODE, new Date(now));
  if (Math.abs(next - daylightPhase) < 1e-6) return;
  daylightPhase = next;
  applyDaylight(sampleAt(daylightPhase));
}

// 从后台切回前台时立刻校正一次，不用等下一个 10 秒窗口
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || DAYLIGHT_MODE !== 'auto') return;
  lastDaylightMs = 0;
  tickDaylight();
});

const camRig = new TownCamera(window.innerWidth / window.innerHeight);
if (THEME.viewHeight) {
  const vh = Number(THEME.viewHeight);
  if (Number.isFinite(vh)) { camRig.viewHeight = vh; camRig.resize(window.innerWidth / window.innerHeight); }
}
world = buildWorld(scene);
/* ★世界建好之后必须把当前光照再套一遍。
   applyDaylight 在上面（第 122 行）已经跑过一次，那时 world 还没创建，
   里面所有 `world.*`（水面夜色、窗灯）都被 try/catch 吞掉了；
   而固定档（?daylight=night）的 tickDaylight 会直接 return，永远不会补这一下。
   结果就是：夜里草地暗了，河却还是白天那个亮青——像一条自发光的灯带。 */
applyDaylight(sampleAt(daylightPhase));
const playerMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
const player = new Player(playerMaterial);
scene.add(player.root);
camRig.snapTo(player.pos.x, player.pos.z);

if (THEME.villagers === false) {
  world.interactables = world.interactables.filter((i) => i.kind === 'server');
  world.inhabitants.group.visible = false;
  world.farm.group.visible = false;
  // ★农场被关掉时不要把作物挂到机器上：看不见的地块没必要跟着数据跑
  world.farm.bindServers = () => {};
}
const interaction = new InteractionManager(world.interactables);

/* ---- 探针层：每台服务器一只小鸡 ---- */
const probeUI = new ProbeUI();
const herd = new ChickenHerd(playerMaterial, world.interactables);
scene.add(herd.group);
const serverCards = new ServerCards(scene);
serverCards.setMode(CARD_MODE);
const panel = new ProbePanel();
const feed = new ServerFeed();
// 打开面板时让主循环强制刷一轮三网（用户想看「现在」的延迟；冷却 30 s 防反复开关）
panel.onOpen = () => feed.refreshMetrics(true);
let herdSyncMs = 0;   // 历史最大一次 herd.sync 的耗时：验收量首帧建镇成本用（WS 每帧都会刷新它，取最后一次会读到廉价那次）
let prevOnlineCount = null;   // 上一帧在线数，用来触发「掉线/恢复」的提示音
feed.onChange((servers, updatedAt) => {
  const t0 = performance.now();
  lastServers = servers;
  herd.sync(servers);
  // 取最大值：WS 每 2 s 一帧都会刷新它，只有首帧那次才带 buildSlots 的成本
  herdSyncMs = Math.max(herdSyncMs, performance.now() - t0);
  probeUI.setSummary(feed.summary, updatedAt);
  serverCards.sync(servers);
  panel.setServers(servers);
  // 作物按顺序归属到机器：采摘后的重生速度取那台机器的在线时长
  world.farm.bindServers(servers);
  // 镇子本身也是仪表盘：某台挂了，它那户就熄灯、停烟
  world.syncHouses(servers, daylightLamp);
  // 有机器掉线/恢复时轻轻响一声（只在用户开过声音时）
  if (prevOnlineCount !== null) {
    const nowOnline = servers.filter((s) => s.status === 'online').length;
    if (nowOnline !== prevOnlineCount) sound.playStatus(nowOnline > prevOnlineCount);
  }
  prevOnlineCount = servers.filter((s) => s.status === 'online').length;
  // 掉线是事件：派个村民去那户门口看看
  syncErrands(servers);
  // 河水流速 = 全站实时总带宽（数据即景观最直接的一条）
  const totalBps = servers.reduce((a, s) => a + (s.netIn || 0) * 1024 + (s.netOut || 0) * 1024, 0);
  world.river.syncFlow(totalBps);
});
feed.start();
/* 站点关了公开页：/api/nodes 会给 401。这不是「没有节点」，右上角与列表都要说清楚，
   否则站长主动关掉公开页之后，访客看到的是「未发现服务器」——两拨人都被误导。 */
const applyDenied = (denied) => {
  probeUI.setDenied(denied);
  panel.setDenied(denied);
  if (denied) {
    herd.sync([]);
    serverCards.sync([]);
    world.farm.bindServers([]);
  }
};
feed.onDenied(applyDenied);
const ME = window.__SUTADYU_ME__ || {};
if (ME.publicPage === false && ME.authed === false) applyDenied(true);
document.querySelector('.probe-bar .pp-open')?.addEventListener('click', () => panel.toggle());

/* ---- 「卡片」总开关：一键收起/展开所有小鸡头顶的服务器卡片 ----
   访客本机偏好，存 localStorage（不动站点配置，也不影响别的访客）。 */
const cardsToggle = document.querySelector('.probe-bar .pp-cards');
let cardsOn = true;
try { cardsOn = localStorage.getItem('sutadyu.cards') !== '0'; } catch (err) { /* 隐私模式：用默认值 */ }
const applyCardsToggle = () => {
  serverCards.setEnabled(cardsOn);
  if (!cardsToggle) return;
  cardsToggle.setAttribute('aria-pressed', cardsOn ? 'true' : 'false');
  cardsToggle.title = cardsOn ? '隐藏小鸡头顶的服务器卡片' : '显示小鸡头顶的服务器卡片';
};
cardsToggle?.addEventListener('click', () => {
  cardsOn = !cardsOn;
  try { localStorage.setItem('sutadyu.cards', cardsOn ? '1' : '0'); } catch (err) { /* 同上 */ }
  applyCardsToggle();
});
applyCardsToggle();
panel.onPick = (server) => {
  const item = herd.items.find((i) => i.server.id === server.id);
  if (!item) return;
  // 列表里点卡片：把镜头带过去，详情已经在面板里展开了
  camRig.snapTo(item.pos.x, item.pos.z);
  probeUI.showDetail(server);
};

/* ---- 掉线是事件，不是灰点 ----
   第一次发现某台机器掉线时，派一个村民走到「认领这户」的房子门口守着；
   机器恢复了，他再走回自己的位置。
   ★必须记住「已经派过」，否则 WS 每 2 秒推一帧会把同一个事件重复触发，
     村民会被反复重置起点、原地抽搐。 */
const errandState = new Map();   // serverId -> { house: index, npc: index }
let errandNpcCursor = 0;

/** 找一个「现在没活」的村民；全都在跑腿就返回 -1（这不是错误，下次推送再看） */
function pickIdleNpc() {
  const npcs = world.inhabitants.npcs;
  for (let k = 0; k < npcs.length; k++) {
    const idx = (errandNpcCursor + k) % npcs.length;
    if (!npcs[idx].errand) {
      errandNpcCursor = (idx + 1) % npcs.length;
      return idx;
    }
  }
  return -1;
}

function syncErrands(servers) {
  /* ★空列表也要走清理：节点被删除 / 公开页 401 导致 servers=[] 时，
     旧 key 永远不会进下面那个「恢复」分支，对应村民会带着 hold=true
     永久钉在门口（update 里 errand 分支每帧 continue，再也不会 idle）。 */
  if (!Array.isArray(servers) || !servers.length) {
    for (const [, st] of errandState) world.inhabitants.recall(st.npc);
    errandState.clear();
    return;
  }
  const houses = world.houseGlows.length;
  const npcCount = world.inhabitants.npcs.length;
  if (!houses || !npcCount) return;

  for (let i = 0; i < houses; i++) {
    const srv = servers[i % servers.length];
    const dead = srv.status === 'offline' || srv.status === 'unknown';
    const key = srv.id;
    const sent = errandState.get(key);

    if (dead && !sent) {
      /* ★必须挑一个「真的空着」的村民，不能 游标++ % npcCount。
         5 户人家、3 个村民：第四台掉线时会与第一台共用 npc0，
         sendTo 会直接覆写 npc.errand，先派的那户静默失去守卫，
         而 errandState 里两条记录仍都指向他 —— 任何一台恢复都会把
         另一台仍在故障的门口的人叫走。 */
      const npcIdx = pickIdleNpc();
      if (npcIdx < 0) continue;   // 人手不够，下帧再试
      const h = HOUSES[i];
      // 站到「这户」门前偏一点，不要挡住门本身
      const door = { x: h.x + 1.15, z: h.z + h.depth / 2 + 1.05 };
      if (world.inhabitants.sendTo(npcIdx, door, 11000)) {
        world.inhabitants.hold(npcIdx);   // 到了就守在门口，等机器恢复再召回
        errandState.set(key, { house: i, npc: npcIdx });
      }
    } else if (!dead && sent) {
      world.inhabitants.recall(sent.npc);
      errandState.delete(key);
    }
  }
}

/* ---- 指针设备判定：触屏 / 鼠标 ----
   ?touch=1 / ?touch=0 只是给桌面预览与无头验收临时开关触屏档（不动设备本身）。 */
const TOUCH_PARAM = new URLSearchParams(location.search).get('touch');
const isTouch = TOUCH_PARAM === '1' ? true
  : TOUCH_PARAM === '0' ? false
    : matchMedia('(pointer: coarse)').matches
      || (matchMedia('(hover: none)').matches && 'ontouchstart' in window);
if (isTouch) document.body.classList.add('touch');

/* ------------------------------------------------------------------ *
 * 小地图（触屏档）
 *
 * 竖屏 390×844 下正交相机的可见世界宽度只有约 11 个单位，而地图宽 55——
 * 也就是**只能看到全图的 20%**，访客完全不知道别的机器在哪个方向。
 * 缩小镜头（调大 viewHeight）能看更多，但卡片与文字会一起变小，不可取。
 * 所以给一张小地图：把所有小鸡按状态色画成点、玩家画成亮点，点一下就走过去。
 * ------------------------------------------------------------------ */
const minimapEl = document.getElementById('minimap');
const minimapCv = document.getElementById('minimap-cv');
let minimapCtx = minimapCv ? minimapCv.getContext('2d') : null;
let minimapAcc = 0;

function drawMinimap() {
  if (!minimapCtx) return;
  const S = minimapCv.width;
  const W = MAP.x2 - MAP.x1;
  const D = MAP.z2 - MAP.z1;
  const k = Math.min(S / W, S / D);
  const ox = (S - W * k) / 2;
  const oz = (S - D * k) / 2;
  const px = (x) => ox + (x - MAP.x1) * k;
  const pz = (z) => oz + (z - MAP.z1) * k;

  minimapCtx.clearRect(0, 0, S, S);
  // 草地底
  minimapCtx.fillStyle = '#cfe0c0';
  minimapCtx.fillRect(ox, oz, W * k, D * k);
  // 河
  minimapCtx.fillStyle = '#a8cfd8';
  minimapCtx.fillRect(
    px(RIVER.centerX - RIVER.halfWidth), oz,
    RIVER.halfWidth * 2 * k, D * k
  );
  // 广场
  minimapCtx.fillStyle = 'rgba(196, 182, 160, 0.85)';
  minimapCtx.fillRect(px(FOUNTAIN.x) - 9, pz(FOUNTAIN.z) - 9, 18, 18);

  // 小鸡：状态色点；离线画成空心
  for (const item of herd.items) {
    const st = item.server.status;
    const col = STATUS[st]?.css || '#9d9d92';
    const cxp = px(item.pos.x);
    const czp = pz(item.pos.z);
    minimapCtx.beginPath();
    minimapCtx.arc(cxp, czp, 4.2, 0, Math.PI * 2);
    if (st === 'offline') {
      minimapCtx.strokeStyle = col;
      minimapCtx.lineWidth = 2;
      minimapCtx.stroke();
    } else {
      minimapCtx.fillStyle = col;
      minimapCtx.fill();
    }
  }

  // 玩家：白心 + 深色描边，任何底色上都看得见
  const ppx = px(player.pos.x);
  const ppz = pz(player.pos.z);
  minimapCtx.beginPath();
  minimapCtx.arc(ppx, ppz, 5.4, 0, Math.PI * 2);
  minimapCtx.fillStyle = '#ffffff';
  minimapCtx.fill();
  minimapCtx.lineWidth = 2.4;
  minimapCtx.strokeStyle = '#4a3527';
  minimapCtx.stroke();
}

if (minimapEl && minimapCtx) {
  const jumpFromEvent = (ev) => {
    const r = minimapCv.getBoundingClientRect();
    const S = minimapCv.width;
    const W = MAP.x2 - MAP.x1;
    const D = MAP.z2 - MAP.z1;
    const k = Math.min(S / W, S / D);
    const ox = (S - W * k) / 2;
    const oz = (S - D * k) / 2;
    const cx = (ev.clientX - r.left) / r.width * S;
    const cy = (ev.clientY - r.top) / r.height * S;
    const wx = MAP.x1 + (cx - ox) / k;
    const wz = MAP.z1 + (cy - oz) / k;
    // 只落在能走的地方；走不了就就近找一格
    let tx = wx;
    let tz = wz;
    if (!isWalkable(tx, tz, 0.34)) {
      let found = false;
      for (let ring = 1; ring <= 6 && !found; ring++) {
        for (let a = 0; a < 12 && !found; a++) {
          const ang = (a / 12) * Math.PI * 2;
          const nx = wx + Math.cos(ang) * ring * 0.9;
          const nz = wz + Math.sin(ang) * ring * 0.9;
          if (isWalkable(nx, nz, 0.34)) { tx = nx; tz = nz; found = true; }
        }
      }
      if (!found) return;
    }
    player.pos.set(tx, player.pos.y, tz);
    player.root.position.set(tx, player.pos.y, tz);
    camRig.snapTo(tx, tz);
    drawMinimap();
  };
  minimapEl.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    jumpFromEvent(ev);
  });
  minimapEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); drawMinimap(); }
  });
}

const canvasEl = renderer.domElement;

/* ------------------------------------------------------------------ *
 * 明信片模式 + 闲置巡游
 *
 * 明信片：一键收起所有 UI 和卡片，只留小镇本身（P 键或点画面切换）。
 * 巡游：一段时间没操作就让镜头慢慢绕着镇子走一圈，一有动静立刻回位。
 *       挂机/展厅场景特别出效果，但★必须尊重 prefers-reduced-motion——
 *       对晕动敏感的人，镜头自己动是灾难。
 * ------------------------------------------------------------------ */
let postcardOn = false;
let lastActivityAt = Date.now();
let lastHarvestCount = 0;   // 用来判断「刚才那一下是不是采摘」→ 播鸡叫
let cruiseT = 0;            // 巡游相位
let cruising = false;
// 上一帧玩家位置：位置一动就说明有人在走，巡游让位
const cruiseAnchor = { x: 0, z: 0 };
let cruiseIdleMs = 30000;   // 30 秒没操作开始巡游
// 验收用：?cruise=<毫秒> 临时改闲置阈值（0 = 立刻开始），桌面调试也方便
{
  const raw = new URLSearchParams(location.search).get('cruise');
  /* ★Number(null) === 0，所以必须先判 null 再转数字。
     不然没传参数时阈值会被设成 0 → 每帧都判定「闲置够了」→ 镜头一直在巡游，
     玩家一走就被抢（check-theme 的贴边断言 gap 3.22 就是这么来的）。 */
  if (raw !== null) {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0) cruiseIdleMs = v;
  }
}
const REDUCE_MOTION_UI = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

const postcardHint = document.getElementById('postcard-hint');
let hintTimer = 0;

function setPostcard(on) {
  postcardOn = !!on;
  document.body.classList.toggle('postcard', postcardOn);
  // 明信片模式下手动把卡片矩阵关掉（它们不是 DOM，CSS 管不到）
  if (postcardOn) {
    serverCards.setEnabled(false);
    if (postcardHint) {
      postcardHint.classList.add('show');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => postcardHint.classList.remove('show'), 2600);
    }
  } else {
    // 回来自动恢复「卡片」的总开关（读者自己关过的那种偏好不再动，这里只保证不会是明信片压的）
    serverCards.setEnabled(true);
  }
}
function togglePostcard() { setPostcard(!postcardOn); }

/* ---- 声音开关（默认关；偏好存本机，刷新不忘） ---- */
const soundBtn = document.getElementById('sound-btn');
let soundPref = false;
try { soundPref = localStorage.getItem('sutadyu.sound') === '1'; } catch { /* 隐私模式 */ }
if (soundBtn) {
  soundBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    // ★必须在用户手势里调用 enable()，否则 AudioContext 会被浏览器挂起
    const on = sound.toggle();
    soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    try { localStorage.setItem('sutadyu.sound', on ? '1' : '0'); } catch { /* 同上 */ }
  });
  // 上次开过就别自动开（浏览器不允许），但把按钮状态摆对，点一下即可恢复
  if (soundPref) soundBtn.title = '声音（点一下打开）';
}

/** 点一下画面也能从明信片模式出来（手机上没键盘） */
canvasEl.addEventListener('pointerdown', () => {
  if (postcardOn) setPostcard(false);
});

function noteActivity() { lastActivityAt = Date.now(); cruising = false; }
window.addEventListener('pointerdown', noteActivity, { passive: true });
window.addEventListener('keydown', noteActivity, { passive: true });
window.addEventListener('wheel', noteActivity, { passive: true });

/**
 * 闲置巡游：一段没操作后让镜头沿一条很缓的椭圆绕着镇子走。
 * ★只动镜头焦点（camRig 的 focus），不动玩家——玩家还站在原地，
 *   一按键就平滑回到玩家身上，不会「人被传走了」。
 */
function tickCruise(dt) {
  if (REDUCE_MOTION_UI) return false;
  // 面板打开 / 明信片模式不巡游
  if (panel.open || postcardOn) { cruising = false; return false; }
  /* ★玩家自己动了就一定让位。
     巡游的意义是「没人管的时候给个好看的镜头」，玩家一旦走位（键盘、摇杆、点小地图、
     代码 teleport）这个前提就不成立了。只看「最后操作时间」不够——按键事件在无头环境
     里不一定有，而且持续按住走的时候也不会反复触发 keydown。 */
  if (player.pos.x !== cruiseAnchor.x || player.pos.z !== cruiseAnchor.z) {
    cruiseAnchor.x = player.pos.x;
    cruiseAnchor.z = player.pos.z;
    lastActivityAt = Date.now();
    if (cruising) { cruising = false; camRig.cruiseEnd(); }
    return false;
  }
  const idleFor = Date.now() - lastActivityAt;
  if (idleFor < cruiseIdleMs) { cruising = false; return false; }
  cruising = true;
  cruiseT += dt * 0.055;                      // 一圈约 2 分钟，很慢
  const rx = 15.5;
  const rz = 12.5;
  camRig.cruiseTo(Math.cos(cruiseT) * rx, Math.sin(cruiseT) * rz);
  return true;
}


const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0);
let pointerIn = false;
let hovered = null;
let hoverSig = '';   // 上一次 updateHover 的「指针+镜头」签名，没变就跳过 raycast
window.addEventListener('pointermove', (e) => {
  // 触屏没有「悬停」：手指抬起后上一次的位置会一直留在 pointer 里，
  // 于是那只小鸡永远亮着、光标也一直是 pointer。只让鼠标改悬停态。
  if (e.pointerType && e.pointerType !== 'mouse') return;
  setPointerFromEvent(e);
  pointerIn = true;
});
canvasEl.addEventListener('pointerleave', () => { pointerIn = false; });
/** 当前指针位置下命中的那只小鸡（鼠标与触屏共用）
 *
 *  1.9.0 起卡片也能点：卡片在屏幕上占 225×80 px，是小鸡本体（约 40×40）的
 *  11 倍面积，却是块死区——只剩「精确点到小鸡」才开得了详情，触屏上尤其难。
 *  拾取顺序按 Pointer 语义走「最上层」：先查卡片（它 depthTest=false、
 *  renderOrder 30+，永远画在最上面），没有再落到小鸡。
 *
 *  ★ three r169 的 raycast 不检查 visible：被收成状态点/淡出的卡片照样会被
 *    Raycaster 命中，所以这里必须自己按「真的看得见」过滤，否则会出现
 *    「点空白处弹出某台机器的详情」。
 */
function cardAtPointer() {
  const hits = raycaster.intersectObjects(serverCards.group.children, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o && !o.userData.cardId) o = o.parent;
    if (!o) continue;
    const item = herd.items.find((i) => i.server.id === o.userData.cardId);
    if (!item) continue;
    // 只有「实打实显示着」的那一条才吃点击：卡片与状态点是互斥的两条精灵，
    // 点卡片时 sprite 亮、点状态点时 dot 亮。★不能只看 sprite——收成状态点后
    // sprite 是隐藏的，若只判 sprite 就会让「点状态点」完全失效（自审抓到）。
    const card = serverCards.cards.get(o.userData.cardId);
    if (!card) continue;
    const cardOn = card.sprite.visible && (card.op * (card.clipOp ?? 1)) > 0.5;
    const dotOn = card.dot.visible && (card.dotEff ?? card.dotOp) > 0.5;
    /* ★必须按「命中的是哪一条精灵」判，不能笼统地「卡片或点有一个亮就放行」：
       three 的 raycast 不检查 visible/opacity，收起后的卡片 sprite（6.0×2.13 世界单位、
       约 225×80 px）仍然完整参与求交。只判 dotOn 的话，点它上方几十像素的空白处
       也会命中那张隐形卡片并弹出详情（实测 60px 外都能中）。 */
    const hitObj = hit.object;
    const hitIsPad = !!hitObj.userData.hitPad;
    const hitIsDot = hitObj === card.dot;
    let ok;
    if (hitIsPad) ok = dotOn;             // 命中盒：跟状态点同显隐
    else if (hitIsDot) ok = dotOn;
    else ok = cardOn;                     // 卡片本体：必须是真的在显示
    if (!ok) continue;
    return item;
  }
  return null;
}

function chickAtPointer() {
  if (!herd.items.length) return null;
  const hits = raycaster.intersectObjects(herd.group.children, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o && !o.userData.serverId) o = o.parent;
    if (o?.userData.serverId) return herd.items.find((i) => i.server.id === o.userData.serverId) || null;
  }
  return null;
}

function pickFromPointer() {
  if (!herd.items.length) return null;
  raycaster.setFromCamera(pointer, camRig.camera);
  return cardAtPointer() || chickAtPointer();
}

function setPointerFromEvent(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

canvasEl.addEventListener('pointerdown', (e) => {
  // 只认左键/触屏：右键、中键不该开详情（右键菜单才是用户的意图）
  if (e.button !== 0) return;
  // 触屏点按只有 down/up、没有 move：这里必须自己拾取，不能等 hovered
  setPointerFromEvent(e);
  pointerIn = true;   // 否则下一帧 updateHover 立刻把刚点亮的高亮清掉
  // 触屏没有「移开」这回事：点完得自己把悬停态放掉，否则那只鸡会一直亮着
  if (e.pointerType && e.pointerType !== 'mouse') setTimeout(() => { pointerIn = false; }, 600);
  const hit = pickFromPointer();
  if (!hit) return;
  if (hit !== hovered) {
    herd.setHighlight(hovered, false);
    hovered = hit;
    herd.setHighlight(hit, true);
  }
  panel.showDetailDirect(hit.server);
  probeUI.showDetail(hit.server);
});

function updateHover() {
  /* ★指针没动、镜头也没动时不必重算。
     原来是每帧无条件 pickFromPointer()：它对 serverCards.group.children
     （每台机器 3 个 Sprite：卡片/状态点/命中盒）+ herd.group 做全量 raycast，
     200 台机器就是每帧 600 次 Sprite.raycast，指针静止时全在做无用功。
     ★但只判指针不够：镜头是 damp 跟随的，鼠标不动而玩家/巡游让画面滑过去时，
       指针底下的东西会变。所以把「镜头焦点的量化位置」也算进签名，
       两者都没变才跳过（量化到 0.02 世界单位，肉眼不可辨，避免 damp 尾段每帧都算脏）。 */
  const fx = Math.round(camRig.focus?.x * 50) || 0;
  const fz = Math.round(camRig.focus?.z * 50) || 0;
  const sig = `${pointer.x.toFixed(4)},${pointer.y.toFixed(4)},${pointerIn ? 1 : 0},${fx},${fz}`;
  if (sig === hoverSig) return;
  hoverSig = sig;

  const next = pointerIn ? pickFromPointer() : null;
  if (next !== hovered) {
    herd.setHighlight(hovered, false);
    herd.setHighlight(next, true);
    hovered = next;
    canvasEl.style.cursor = next ? 'pointer' : 'default';
  }
}

/* ------------------------------------------------------------------ *
 * 键盘
 * ------------------------------------------------------------------ */

const keys = Object.create(null);
const BLOCK = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'Tab']);

window.addEventListener('keydown', (e) => {
  // 面板内部放行 Tab 与 Space：键盘用户要能走到「返回 / 关闭 / 页签 / 时间档」，并真的按下去
  const insidePanel = !!panel.root?.contains(document.activeElement);
  const passthrough = insidePanel && (e.code === 'Tab' || e.code === 'Space');
  if (BLOCK.has(e.code) && !passthrough) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Tab') {
    if (insidePanel) return;
    panel.toggle();
    return;
  }
  if (e.code === 'KeyE') handleInteract();
  else if (e.code === 'KeyP') togglePostcard();
  else if (e.code === 'Escape') {
    if (panel.open && panel.view === 'detail') panel.showList();
    else if (panel.open) panel.hide();
    else if (ui.noticeOpen) ui.hideNotice();
    else if (probeUI.current) probeUI.hideDetail();
    else if (ui.dialogueOpen) ui.hideDialogue();
  }
}, { passive: false });

window.addEventListener('keyup', (e) => { keys[e.code] = false; }, { passive: false });
window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });

const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const moveVec = new THREE.Vector3();

function updateMoveVector() {
  _right.setFromMatrixColumn(camRig.camera.matrixWorld, 0);
  _right.y = 0;
  _right.normalize();
  _fwd.setFromMatrixColumn(camRig.camera.matrixWorld, 2).multiplyScalar(-1);
  _fwd.y = 0;
  _fwd.normalize();
  const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  const iz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
  moveVec.set(0, 0, 0);
  if (ix !== 0) moveVec.addScaledVector(_right, ix);
  if (iz !== 0) moveVec.addScaledVector(_fwd, iz);
  if (moveVec.lengthSq() > 1e-6) moveVec.normalize();
  // 触屏摇杆：叠加在键盘之上（外接键盘的平板两边都能用）。
  // 摇杆给的是「相对镜头的方向 + 0~1 的力度」，所以用相机右/前基向量合成，
  // 不能直接当世界坐标用——斜俯视镜头下那样会往右上偏。
  if (stickVec.x !== 0 || stickVec.y !== 0) {
    moveVec.addScaledVector(_right, stickVec.x).addScaledVector(_fwd, stickVec.y);
    if (moveVec.lengthSq() > 1) moveVec.normalize();
  }
}

/* ------------------------------------------------------------------ *
 * 触屏：左下摇杆走位 + 右下动作键（等同键盘 E）
 *
 * 手机上本没有任何输入入口：WASD / E / Tab / Esc 都是键盘专属，访客只能干看。
 * 这里补摇杆与动作键；列表、卡片开关顶栏已有按钮，面板自带返回/关闭，
 * 所以 Tab / Esc 不再造第二份。
 * ------------------------------------------------------------------ */

const stickVec = { x: 0, y: 0 };   // 摇杆输出：x 向右、y 向前，长度 0~1
let stickPointer = null;

const stickEl = document.getElementById('stick');
const knobEl = document.getElementById('stick-knob');
const actBtn = document.getElementById('t-act');
const touchLayer = document.getElementById('touch');

/** 松开摇杆：清方向、复位摇杆头（面板/公告打开时也要强制归零，别让残留方向继续推玩家） */
function releaseStick() {
  stickPointer = null;
  stickVec.x = 0; stickVec.y = 0;
  if (knobEl) knobEl.style.transform = '';
  stickEl?.classList.remove('drag');
}

if (isTouch && stickEl && knobEl && actBtn && touchLayer) {
  touchLayer.classList.remove('hidden');
  touchLayer.setAttribute('aria-hidden', 'false');

  const DEAD = 0.16;   // 死区：手指轻抖不该让角色一点点挪
  const setStick = (e) => {
    const r = stickEl.getBoundingClientRect();
    const half = r.width / 2;
    let dx = (e.clientX - (r.left + half)) / half;
    let dy = (e.clientY - (r.top + half)) / half;
    const d = Math.hypot(dx, dy) || 0;
    const k = d > 1 ? 1 / d : 1;            // 超出圆盘按边缘算
    dx *= k; dy *= k;
    const eff = d < DEAD ? 0 : Math.min(1, (d - DEAD) / (1 - DEAD));
    stickVec.x = dx * eff;
    stickVec.y = -dy * eff;                 // 屏幕 y 向下 →「前」是 -y
    // 摇杆头跟手：行程 = 盘半径 - 拇指半径
    const reach = Math.max(0, half - 27);
    knobEl.style.transform = `translate(${dx * eff * reach}px, ${dy * eff * reach}px)`;
  };

  stickEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stickPointer = e.pointerId;
    stickEl.classList.add('drag');
    // 指针捕获：手指滑出圆盘也继续跟，否则一甩出边界角色就停
    try { stickEl.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器 */ }
    setStick(e);
    e.preventDefault();
  });
  stickEl.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    setStick(e);
    e.preventDefault();
  });
  stickEl.addEventListener('pointerup', (e) => { if (e.pointerId === stickPointer) releaseStick(); });
  stickEl.addEventListener('pointercancel', (e) => { if (e.pointerId === stickPointer) releaseStick(); });
  stickEl.addEventListener('lostpointercapture', () => releaseStick());

  // 动作键 = 键盘 E：靠近小鸡 / 村民 / 告示牌 / 作物时开详情、说话、采摘
  actBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleInteract();
  });
}

/** 每帧同步动作键的可用态（互动对象是 interaction.update 算出来的） */
function syncTouchAction() {
  if (!isTouch || !actBtn) return;
  // 面板是整屏浮层：摇杆/动作键必须一起收起，否则会盖在九格与图表上（触屏档专用，鼠标档不变）
  const covered = !!panel.open;
  if (document.body.classList.contains('panel-open') !== covered) {
    document.body.classList.toggle('panel-open', covered);
  }
  const cur = interaction.current;
  const on = !!cur;
  if (actBtn.classList.contains('on') !== on) actBtn.classList.toggle('on', on);
  // 按钮文字跟着最近的东西走：小鸡=详情、村民=对话、告示牌=公告、作物=采摘
  const label = !cur ? '互动'
    : cur.kind === 'server' ? '详情'
      : cur.kind === 'villager' ? '对话'
        : cur.kind === 'sign' ? '公告'
          : cur.kind === 'crop' ? '采摘' : '互动';
  const lab = actBtn.firstElementChild;
  if (lab && lab.textContent !== label) lab.textContent = label;
  const title = cur ? cur.prompt : '靠近小鸡或村民再互动';
  if (actBtn.title !== title) actBtn.title = title;
  actBtn.setAttribute('aria-label', title);
}

function handleInteract() {
  // 面板开着时玩家是冻结的，E 不能穿透到底层：否则盯着 A 机器的详情页按 E，
  // 会把详情悄悄切到身边那只鸡（还可能在后层弹对话/收菜）。空格/返回键都有自己的路径。
  if (panel.open) return null;
  if (ui.noticeOpen) {
    ui.hideNotice();
    ui.hidePrompt();
    return null;
  }
  const result = interaction.interact();
  if (!result) return null;
  if (result.kind === 'say') {
    ui.say(result.name, result.text);
  } else if (result.kind === 'notice') {
    ui.showNotice(result.title, result.lines);
  } else if (result.kind === 'server') {
    panel.showDetailDirect(result.server);
    probeUI.showDetail(result.server);
  } else if (result.kind === 'toast') {
    ui.toast(result.text);
    if (result.extra?.kind === 'say') ui.say(result.extra.name, result.extra.text);
    // 采摘一声鸡叫：用「收成数变了」判断，比匹配文案可靠
    if (world.farm.harvestCount > lastHarvestCount) {
      lastHarvestCount = world.farm.harvestCount;
      sound.playCluck();
    }
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * 尺寸 / 主循环
 * ------------------------------------------------------------------ */

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // 低画质（设置项 / 帧率自降）只认 1 倍：resize 不能把它悄悄改回 1.8 倍
  renderer.setPixelRatio(lowQuality ? 1 : Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setSize(w, h, false);
  camRig.resize(w / h);
}
window.addEventListener('resize', resize);

let lastTime = performance.now();
let elapsed = 0;        // 动画时钟（被钳到 50 ms/帧，慢机上会落后于墙钟——这是刻意的）
let elapsedReal = 0;    // 真实墙钟秒数（帧率评估用它，别拿动画时钟当秒表）
let frames = 0;
let fpsAccum = 0;
let fps = 0;
let autoTarget = null;

const QUALITY_PARAM = new URLSearchParams(location.search).get('quality');
let lowAccum = 0;
let lowQuality = THEME.lowQuality === true;

/**
 * 帧率自降的判定（纯函数，便于离线验证边界；main 的帧循环只负责喂数据）。
 * 规则：启动 5 秒后才开始看；窗口帧率 < 26 就累加**真实经过时间**，
 * 连续 3 秒低于阈值才降档（避免一次 GC / 切标签页就误降）。帧率回到 26 以上清零。
 * @param {{realDt:number, fps:number, elapsedReal:number}} s
 * @returns {boolean} 是否应该降档
 */
export function shouldDropQuality(s) {
  if (!(s.elapsedReal > 5)) return false;
  if (!(s.fps > 0) || s.fps >= 26) { lowAccum = 0; return false; }
  // 封顶 1 s：切标签页回来 rawDt 可能是几十秒，不能一帧就判定「一直很卡」；
  // 但也不能压得太狠——1 fps 设备每帧 1 秒，封 0.5 s 会让它要 6 帧（≈6 秒）才凑够 3。
  lowAccum += Math.min(1, Math.max(0, s.realDt));
  return lowAccum > 3;
}

/** 验收用：把累加器清零（check-theme 里连测多个场景时用） */
export function resetQualityMeter() { lowAccum = 0; }

function applyLowQuality() {
  if (lowQuality) return;
  lowQuality = true;
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  sun.castShadow = false;
  scene.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) m.needsUpdate = true;
  });
  console.log('[sutadyu] 帧率偏低，已自动降低画质');
}

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  const dt = Math.min(0.05, Math.max(0.0001, rawDt));
  elapsed += dt;
  elapsedReal += Math.max(0, rawDt);

  frames++;
  fpsAccum += rawDt;
  if (fpsAccum > 0.5) {
    fps = Math.round(frames / fpsAccum);
    frames = 0;
    fpsAccum = 0;
  }
  if (QUALITY_PARAM !== 'high' && !lowQuality) {
    if (shouldDropQuality({ realDt: rawDt, fps, elapsedReal })) applyLowQuality();
  }

  // 面板/公告是模态的：触屏摇杆不能在后层继续推着玩家（第二根手指压在摇杆上的场景）
  if (ui.noticeOpen || panel.open) {
    if (stickPointer !== null) releaseStick(); else if (stickVec.x || stickVec.y) { stickVec.x = 0; stickVec.y = 0; }
  }
  updateMoveVector();
  if (autoTarget) {
    const dx = autoTarget.x - player.pos.x;
    const dz = autoTarget.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) { autoTarget = null; moveVec.set(0, 0, 0); }
    else moveVec.set(dx / d, 0, dz / d);
  }

  player.update(dt, moveVec, !!(keys.ShiftLeft || keys.ShiftRight), elapsed, ui.noticeOpen || panel.open);

  const aheadX = clamp(player.vel.x * 0.25, -1.5, 1.5);
  const aheadZ = clamp(player.vel.z * 0.25, -1.5, 1.5);
  // 面板停在某台机器的详情页时，镜头钉在它身上（README 承诺「镜头同时带到那台机器」）
  const lockItem = panel.open && panel.view === 'detail' && panel.selectedId
    ? herd.items.find((i) => i.server.id === panel.selectedId)
    : null;
  /* ★巡游必须早于 pin/cruiseEnd：下面这段在非巡游时每帧调 cruiseEnd()，
     巡游要是排在它后面，_pin 会立刻被清掉，镜头根本走不起来。 */
  const cruiseWanted = tickCruise(dt);
  // 声音：环境音跟着昼夜（夜里虫鸣、白天鸟叫）；关着时 update 直接返回
  sound.update(dt, daylightLamp);
  if (lockItem) camRig.pin(lockItem.pos.x, lockItem.pos.z);
  else if (!cruiseWanted) camRig.cruiseEnd();
  camRig.update(dt, player.pos.x, player.pos.z, aheadX, aheadZ);

  interaction.update(camRig.camera, player.pos, window.innerWidth, window.innerHeight, !panel.open);
  syncTouchAction();
  // 每帧的昼夜推进（auto 档每 10 秒才真正重算一次，相位按墙上时间现算）
  tickDaylight();
  // 小地图：只在触屏档画，200ms 一次足够（每帧重画是白烧 CPU）
  if (isTouch && minimapCtx) {
    minimapAcc += dt;
    if (minimapAcc > 0.2) { minimapAcc = 0; drawMinimap(); }
  }
  world.update(dt, elapsed, player.pos, daylightLamp);
  herd.update(dt, elapsed, player.pos);
  // 交互对象自己带 serverId：按名字子串反查会在 web / web-2 这种前缀名上认错鸡
  const prompted = interaction.current && interaction.current.kind === 'server'
    ? interaction.current.serverId ?? null
    : null;
  // 名牌交给 3D 卡片层；这里只同步「当前提示的是哪只鸡」，供卡片让位
  probeUI.setFocused(hovered ? hovered.server.id : null, prompted);
  // 头顶卡片：常驻档每帧都要跟随；透明度/尺寸过渡交给 dt（切档不再跳变）
  // 智能档的宽窄判定放帧里做：不依赖 resize 事件（无头/手机旋转都跟手）
  const modeNow = pickCardMode();
  if (modeNow !== CARD_MODE) {
    CARD_MODE = modeNow;
    serverCards.setMode(modeNow);
  }
  serverCards.update(herd.items, player.pos, probeUI.focusedId, dt, camRig.camera);
  updateHover();

  renderer.render(scene, camRig.camera);

  if (!api.ready) {
    api.ready = true;
    // 顺序要紧：先把揭幕钩子发出去，再做收尾。收尾要是出错（如冷加载时 #loading
    // 已被兜底移除），异常绝不能吞掉揭幕、也不能打断渲染循环
    window.__SUTADYU_BOOT_READY__?.();
    try { ui.hideLoading(); } catch (err) { /* 收尾问题不打断渲染 */ }
    console.log('[sutadyu] 场景已就绪', JSON.stringify(api.debug()));
  }
}

/* ------------------------------------------------------------------ *
 * 调试接口
 * ------------------------------------------------------------------ */

const api = {
  ready: false,
  // 版本号只有一个来源：index.html 的 <meta name="theme-version">（与 theme.json 同步）
  version: document.querySelector('meta[name="theme-version"]')?.content || '0.0.0',
  debug() {
    const nearest = interaction.current;
    return {
      player: {
        x: +player.pos.x.toFixed(3),
        z: +player.pos.z.toFixed(3),
        y: +player.visualY.toFixed(3),
        speed: +player.speed.toFixed(2),
      },
      camera: { x: +camRig.focus.x.toFixed(2), z: +camRig.focus.z.toFixed(2) },
      nearest: nearest ? { kind: nearest.kind, prompt: nearest.prompt } : null,
      promptVisible: ui.promptVisible,
      promptText: document.querySelector('#prompt-text')?.textContent ?? '',
      dialogue: {
        open: ui.dialogueOpen,
        name: document.querySelector('#speaker')?.textContent ?? '',
        text: document.querySelector('#dialogue-text')?.textContent ?? '',
      },
      notice: ui.noticeOpen,
      noticeTitle: document.querySelector('#notice h2')?.textContent ?? '',
      toast: document.querySelector('#toast')?.textContent ?? '',
      harvest: world.farm.harvestCount,
      servers: feed.servers.length,
      online: feed.summary.online,
      chickens: herd.items.length,
      herdSyncMs: +herdSyncMs.toFixed(1),
      chickenList: herd.items.map((i) => ({
        id: i.server.id, name: i.server.name, x: +i.pos.x.toFixed(2), z: +i.pos.z.toFixed(2),
        y: +i.root.position.y.toFixed(3),
        // 槽位中心（不走位）：验收要量「落脚点够不够散」，实时坐标会被溜达糊掉
        sx: i.slotHome ? +i.slotHome.x.toFixed(2) : null, sz: i.slotHome ? +i.slotHome.z.toFixed(2) : null,
      })),
      serverCard: panel.view === 'detail',
      panelOpen: panel.open,
      panelView: panel.view,
      panelSelected: panel.selectedId,
      cards: serverCards.cards.size,
      cardsInfo: serverCards.debugInfo(),
      serverCardName: probeUI.current ? probeUI.current.name : '',
      serverUpdatedAt: feed.updatedAt,
      colliders: debugColliderCount(),
      interactables: world.interactables.length,
      autoTarget: autoTarget ? { x: +autoTarget.x.toFixed(2), z: +autoTarget.z.toFixed(2) } : null,
      render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
      lowQuality,
      schema: THEME,
      daylight: {
        mode: DAYLIGHT_MODE,
        phase: +daylightPhase.toFixed(4),
        lamp: +daylightLamp.toFixed(3),
        hemiInt: +hemi.intensity.toFixed(3),
        sunInt: +sun.intensity.toFixed(3),
        bg: '#' + scene.background.getHexString(),
        sunPos: { x: +sun.position.x.toFixed(1), y: +sun.position.y.toFixed(1), z: +sun.position.z.toFixed(1) },
        lampsOn: world.lights.filter((l) => l.visible).length,
      },
      fps,
      postcard: postcardOn,
      cruising,
      // 河水流速（跟着全站带宽走）
      riverFlow: { now: world.river.flow, target: world.river.flowTargetNow },
      riverNight: world.river.night,
      riverAo: world.river.ao,
      // 作物：收成计数 + 每块地现在长什么样
      harvestCount: world.farm.harvestCount,
      crops: world.farm.snapshot(),
      // 相机焦点（巡游验收要看它真的在动）
      camFocus: { x: +camRig.focus.x.toFixed(2), z: +camRig.focus.z.toFixed(2) },
      signs: world.houseSigns.map((s) => s.userData.signText),
      houses: world.houseGlows.map((h, i) => {
        /* ★状态一律从 lastServers（feed 的原始顺序）读，和 world.syncHouses 用同一个来源。
           之前这里读 herd.items，而 herd 内部会因为增删重排顺序 → 两处映射对不上，
           表现为「第 0 台离线，暗的却是第 5 户」。 */
        const src = (lastServers && lastServers.length) ? lastServers : [];
        const live = src.length ? src[i % src.length] : null;
        return {
          id: h.id,
          color: '#' + h.mat.color.getHexString(),
          server: live ? live.name : null,
          status: live ? live.status : null,
          chimney: world.smokeIntensity()[i] ?? null,
        };
      }),
      chimneyStrength: world.smokeIntensity ? world.smokeIntensity() : null,
      farm: {
        crops: world.farm.crops.length,
        mature: world.farm.crops.filter((c) => c.mature).length,
        growing: world.farm.crops.filter((c) => !c.mature && c.regrowAt > 0).length,
        harvestCount: world.farm.harvestCount,
        // 每株的归属机器与当前该长多久（验收重生节律用）
        slots: world.farm.crops.map((c) => ({
          type: c.type,
          mature: c.mature,
          regrowMs: Math.round(c.regrowMs),
          server: c.server ? c.server.name : null,
          uptimeDays: c.server && Number.isFinite(c.server.uptimeSec)
            ? Math.round((c.server.uptimeSec / 86400) * 10) / 10 : null,
        })),
      },
    };
  },
  teleport(x, z) {
    player.teleport(x, z);
    camRig.snapTo(x, z);
    autoTarget = null;
    /* ★瞬移是「玩家动过了」：把巡游彻底关掉并刷新冷却。
       光调 snapTo 不够——下一帧 tickCruise 会重新 pin 到巡游椭圆上；
       光调 cruiseAnchor 同步也不够——同步后玩家位置与 anchor 相等，反而不算「动过」。 */
    cruising = false;
    camRig.cruiseEnd();
    cruiseAnchor.x = x;
    cruiseAnchor.z = z;
    lastActivityAt = Date.now();
    return api.debug();
  },
  interact() { return handleInteract(); },
  setKey(code, down) { keys[code] = down; },
  /** 每张可见卡片在屏幕上的矩形（无头验收「贴边收卡」用） */
  cardBounds() {
    const vh = camRig.camera.top - camRig.camera.bottom;
    const ppwu = window.innerHeight / vh;
    const out = [];
    for (const [id, c] of serverCards.cards) {
      if (!c.sprite.visible || c.sprite.material.opacity < 0.15) continue;
      const p = c.sprite.position;
      const v = new THREE.Vector3(p.x, p.y, p.z).project(camRig.camera);
      const w = c.w * ppwu;
      const h = c.h * ppwu;
      out.push({
        id,
        x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth - w / 2),
        y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight - h / 2),
        w: Math.round(w),
        h: Math.round(h),
      });
    }
    return out;
  },
  /** 某只小鸡在屏幕上的落点（无头验收鼠标悬停/点击用） */
  screenOf(id) {
    const item = herd.items.find((i) => i.server.id === id);
    if (!item) return null;
    const v = new THREE.Vector3(item.pos.x, item.height * 0.6, item.pos.z).project(camRig.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  },
  /** 状态点在屏幕上的中心与半径（收录/验收点状态点用；别拿小鸡位置加减猜测） */
  dotScreenOf(id) {
    const card = serverCards.cards.get(id);
    if (!card || !card.dot) return null;
    const p = card.dot.position;
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camRig.camera);
    const vh = camRig.camera.top - camRig.camera.bottom;
    const ppwu = vh > 0 ? window.innerHeight / vh : 0;
    // 画布里圆占 sprite 的比例：drawDot 的半径 23 / 设计宽 84
    const rPx = (card.dot.scale.x * (23 / 84)) * ppwu;
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      r: +rPx.toFixed(1),
    };
  },
  /** 卡片 sprite 中心在屏幕上的落点（验收「隐形卡片不该吃点击」用）。
      ★不能用「世界 y 差 ÷ 视高 × 屏高」估：斜俯视下世界 Y 还要乘 camUp.y≈0.766，
        直接拿 y 差换算会偏，把指针放到卡片矩形之外（踩过）。这里一律走真实投影。 */
  cardScreenOf(id) {
    const card = serverCards.cards.get(id);
    if (!card) return null;
    const p = card.sprite.position;
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camRig.camera);
    const vh = camRig.camera.top - camRig.camera.bottom;
    const ppwu = vh > 0 ? window.innerHeight / vh : 0;
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      w: +(card.sprite.scale.x * ppwu).toFixed(1),
      h: +(card.sprite.scale.y * ppwu).toFixed(1),
      visible: card.sprite.visible,
      op: +card.op.toFixed(3),
    };
  },
  probe(x, z, r = player.radius) {
    return { walkable: isWalkable(x, z, r), water: isInRiver(x, z), ground: groundHeight(x, z) };
  },
  crops() {
    return world.farm.crops.map((c) => ({
      x: +c.position.x.toFixed(2), z: +c.position.z.toFixed(2),
      type: c.type, state: c.mature ? 'mature' : 'immature',
    }));
  },
  /** 农场内部状态（验收重生动画用）：嫩芽的可见性与高度 */
  cropDetail(i = 0) {
    const c = world.farm.crops[i];
    if (!c) return null;
    return {
      type: c.type,
      mature: c.mature,
      regrowMs: Math.round(c.regrowMs),
      leftMs: c.regrowAt ? Math.max(0, Math.round(c.regrowAt - performance.now())) : 0,
      sproutVisible: c.sprout.visible,
      sproutY: +c.sprout.scale.y.toFixed(3),
      produceVisible: c.produce.visible,
      produceScale: +c.produce.scale.x.toFixed(3),
      server: c.server ? c.server.name : null,
    };
  },
  npcs() {
    return world.inhabitants.npcs.map((n) => ({
      id: n.def.id, name: n.def.name, x: n.def.x, z: n.def.z,
      // 实时位置：验收「派村民走过去」要看这个（def 是原始站位，不会变）
      rx: +n.rig.root.position.x.toFixed(2),
      rz: +n.rig.root.position.z.toFixed(2),
      errand: !!n.errand,
    }));
  },
  /** 直接派/召回村民（验收用） */
  probeErrand(idx, dest, ms) {
    if (dest === null) { world.inhabitants.recall(idx); return 'recalled'; }
    return world.inhabitants.sendTo(idx, dest, ms || 3000) ? 'sent' : 'failed';
  },
  /** 声音状态（验收用） */
  soundState() {
    return sound.state();
  },
  /** 桥下遮蔽开关（验收 A/B 用；1=开 0=关） */
  setRiverAo(v) {
    const s = world.river.setAo(v);
    return { ao: s };
  },
  /** 直接设河水流速（验收用；参数是「字节/秒」） */
  probeFlow(bytesPerSec) {
    world.river.syncFlow(bytesPerSec);
    return { now: world.river.flow, target: world.river.flowTargetNow };
  },
  /** 直接把一组假状态套到房子/烟囱上（★会污染 lastServers，仅限一次性演示，验完要重载） */
  probeHouses(statuses) {
    const arr = (statuses || []).map((s, i) => ({ status: s, name: `probe-${i}` }));
    world.syncHouses(arr, daylightLamp);
    world.farm.bindServers(arr);
    return world.houseGlows.map((h) => '#' + h.mat.color.getHexString());
  },
  /** 房子↔机器的稳定绑定（验收用）：给 [{id,status}]，返回每户配色。
   *  用它对比「同一批机器换顺序」前后配色是否保持 —— 稳定绑定下必须一模一样。 */
  probeHousesById(list) {
    const arr = (list || []).map((x) => ({ id: x.id, name: x.id, status: x.status }));
    world.syncHouses(arr, daylightLamp);
    return world.houseGlows.map((h) => '#' + h.mat.color.getHexString());
  },
  setAutopilot(x, z) { autoTarget = { x, z }; return { target: autoTarget }; },
  stopAutopilot() { autoTarget = null; },
  /** 触屏控件的运行时状态（验收用：真实手势要打到 DOM 上，这里只读数） */
  touch: {
    get enabled() { return !!(isTouch && stickEl && !touchLayer?.classList.contains('hidden')); },
    get stick() { return { x: +stickVec.x.toFixed(3), y: +stickVec.y.toFixed(3) }; },
    get knob() { return knobEl?.style.transform || ''; },
    get act() {
      return {
        on: !!actBtn?.classList.contains('on'),
        label: actBtn?.firstElementChild?.textContent || '',
        near: interaction.current ? interaction.current.kind : null,
      };
    },
    release() { releaseStick(); return this.stick; },
  },
  setViewHeight(h) {
    // 调试接口也要钳制：h=0/负数会让正交相机的上下边界重合（整屏黑）
    camRig.viewHeight = clamp(Number(h) || camRig.viewHeight, 10, 60);
    camRig.resize(window.innerWidth / window.innerHeight);
    return { viewHeight: camRig.viewHeight };
  },
  cards: serverCards,
  herd,           // 验收/调试：卡片层的 update(items, …) 需要真实的 items（含 server 引用）
  panel,          // 验收/调试：直接驱动列表（模拟 WS 推送、检查节点复用）
};
window.__TOWN__ = api;

requestAnimationFrame(frame);
