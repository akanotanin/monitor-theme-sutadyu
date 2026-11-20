import * as THREE from 'three';
import { TownCamera } from './camera.js?v=1.8.15';
import { buildWorld } from './world.js?v=1.8.15';
import { Player } from './player.js?v=1.8.15';
import { InteractionManager } from './interact.js?v=1.8.15';
import { ui } from './ui.js?v=1.8.15';
import { clamp } from './util.js?v=1.8.15';
import { debugColliderCount, isWalkable, groundHeight } from './collision.js?v=1.8.15';
import { isInRiver, LAYOUT } from './config.js?v=1.8.15';
import { ServerFeed } from './hub.js?v=1.8.15';
import { ChickenHerd } from './chickens.js?v=1.8.15';
import { ProbeUI } from './probeui.js?v=1.8.15';
import { ServerCards } from './cards.js?v=1.8.15';
import { ProbePanel } from './panel.js?v=1.8.15';

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
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 4;
sun.shadow.blurSamples = 12;
scene.add(sun, sun.target);

const camRig = new TownCamera(window.innerWidth / window.innerHeight);
if (THEME.viewHeight) {
  const vh = Number(THEME.viewHeight);
  if (Number.isFinite(vh)) { camRig.viewHeight = vh; camRig.resize(window.innerWidth / window.innerHeight); }
}
const world = buildWorld(scene);
const playerMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
const player = new Player(playerMaterial);
scene.add(player.root);
camRig.snapTo(player.pos.x, player.pos.z);

if (THEME.villagers === false) {
  world.interactables = world.interactables.filter((i) => i.kind === 'server');
  world.inhabitants.group.visible = false;
  world.farm.group.visible = false;
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
feed.onChange((servers, updatedAt) => {
  const t0 = performance.now();
  herd.sync(servers);
  // 取最大值：WS 每 2 s 一帧都会刷新它，只有首帧那次才带 buildSlots 的成本
  herdSyncMs = Math.max(herdSyncMs, performance.now() - t0);
  probeUI.setSummary(feed.summary, updatedAt);
  serverCards.sync(servers);
  panel.setServers(servers);
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

/* ---- 鼠标：悬停高亮 + 点击看详情 ---- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0);
let pointerIn = false;
let hovered = null;
const canvasEl = renderer.domElement;
window.addEventListener('pointermove', (e) => {
  setPointerFromEvent(e);
  pointerIn = true;
});
canvasEl.addEventListener('pointerleave', () => { pointerIn = false; });
/** 当前指针位置下命中的那只小鸡（鼠标与触屏共用） */
function pickFromPointer() {
  if (!herd.items.length) return null;
  raycaster.setFromCamera(pointer, camRig.camera);
  const hits = raycaster.intersectObjects(herd.group.children, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o && !o.userData.serverId) o = o.parent;
    if (o?.userData.serverId) return herd.items.find((i) => i.server.id === o.userData.serverId) || null;
  }
  return null;
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
}

/* ------------------------------------------------------------------ *
 * 互动
 * ------------------------------------------------------------------ */

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
let elapsed = 0;
let frames = 0;
let fpsAccum = 0;
let fps = 0;
let autoTarget = null;

const QUALITY_PARAM = new URLSearchParams(location.search).get('quality');
let lowAccum = 0;
let lowQuality = THEME.lowQuality === true;

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

  frames++;
  fpsAccum += rawDt;
  if (fpsAccum > 0.5) {
    fps = Math.round(frames / fpsAccum);
    frames = 0;
    fpsAccum = 0;
  }
  if (QUALITY_PARAM !== 'high' && !lowQuality && elapsed > 5) {
    if (fps > 0 && fps < 26) {
      lowAccum += dt;
      if (lowAccum > 3) applyLowQuality();
    } else lowAccum = 0;
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
  if (lockItem) camRig.pin(lockItem.pos.x, lockItem.pos.z);
  else camRig.unpin();
  camRig.update(dt, player.pos.x, player.pos.z, aheadX, aheadZ);

  interaction.update(camRig.camera, player.pos, window.innerWidth, window.innerHeight, !panel.open);
  world.update(dt, elapsed, player.pos);
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
      fps,
    };
  },
  teleport(x, z) {
    player.teleport(x, z);
    camRig.snapTo(x, z);
    autoTarget = null;
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
  probe(x, z, r = player.radius) {
    return { walkable: isWalkable(x, z, r), water: isInRiver(x, z), ground: groundHeight(x, z) };
  },
  crops() {
    return world.farm.crops.map((c) => ({
      x: +c.position.x.toFixed(2), z: +c.position.z.toFixed(2),
      type: c.type, state: c.mature ? 'mature' : 'immature',
    }));
  },
  npcs() {
    return world.inhabitants.npcs.map((n) => ({ id: n.def.id, name: n.def.name, x: n.def.x, z: n.def.z }));
  },
  setAutopilot(x, z) { autoTarget = { x, z }; return { target: autoTarget }; },
  stopAutopilot() { autoTarget = null; },
  setViewHeight(h) {
    // 调试接口也要钳制：h=0/负数会让正交相机的上下边界重合（整屏黑）
    camRig.viewHeight = clamp(Number(h) || camRig.viewHeight, 10, 60);
    camRig.resize(window.innerWidth / window.innerHeight);
    return { viewHeight: camRig.viewHeight };
  },
  cards: serverCards,
  panel,          // 验收/调试：直接驱动列表（模拟 WS 推送、检查节点复用）
};
window.__TOWN__ = api;

requestAnimationFrame(frame);
