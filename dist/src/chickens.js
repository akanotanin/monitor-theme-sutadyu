import * as THREE from 'three';
import { MeshBatch } from './util.js?v=1.8.16';
import { STATUS } from './hub.js?v=1.8.16';
import { isWalkable, groundHeight } from './collision.js?v=1.8.16';
import { MAP, isOnBridge } from './config.js?v=1.8.16';

/* ------------------------------------------------------------------ *
 * 探针小鸡：一只鸡 = 一台服务器
 * 体型控制在小镇里不突兀（站高约 0.6，约玩家的 1/3）
 * ------------------------------------------------------------------ */

const PALETTES = [
  { body: 0xf5f0e6, wing: 0xe6dfd2, tail: 0xd8cfc0 }, // 白羽
  { body: 0xb5793a, wing: 0xa3682c, tail: 0x8a5522 }, // 黄褐
  { body: 0x4a4740, wing: 0x3a3833, tail: 0x2e2c28 }, // 乌骨
  { body: 0xe0b34a, wing: 0xd0a038, tail: 0xb98a2c }, // 油鸡金
  { body: 0x9b7a5e, wing: 0x8a6a52, tail: 0x74573f }, // 麻鸡
];
const COMB = 0xc93434;
const BEAK = 0xd98a2b;
const LEG = 0xd9a441;
const EYE = 0x2b2622;

/* 自动生成点位的间距约束（超出手工点位时用）：
   SLOT_MIN_GAP = 卡宽 6.0 —— 比这更近的两点，屏上必有一张卡被防叠收成状态点；
   FLOOR 是塞不下时的放宽底线，避免机器多时把鸡挤到地图角落重叠。 */
const SLOT_MIN_GAP = 6.0;
const SLOT_MIN_GAP_FLOOR = 4.0;

/** 小鸡的固定落脚点：分布在镇子各处，互不拥挤（相邻点间距 ≥ 6.6 = 一张紧凑卡的宽度，
    否则头顶卡片天然叠在一起——「防叠」逻辑只有在点位本身够散时才成立） */
export const CHICKEN_SLOTS = [
  { x: -4.8, z: -5.6, r: 1.8 },   // 广场西南草地
  { x: -12.8, z: -12.5, r: 1.6 }, // 面包房南侧草地
  { x: 4.8, z: -3.2, r: 1.6 },    // 蓝顶小屋北侧
  { x: -5.6, z: 10.8, r: 1.7 },   // 青瓦人家与菜园之间
  { x: -1.4, z: 16.6, r: 1.6 },   // 菜园门口的土路旁
  { x: 7.2, z: 6.8, r: 1.5 },     // 河边草地（桥西）
  { x: 16.8, z: -9.0, r: 1.5 },   // 桥东土路旁
  { x: 22.7, z: -15.3, r: 1.6 },  // 东南树林边
  { x: 16.2, z: 5.9, r: 1.6 },    // 野餐草地旁
  { x: 23.25, z: 0, r: 1.4 },     // 东边林间（1.8.7 重铺后原 25.2/2.6 落在树里）
];

/**
 * 按服务器数量备好落脚点：前 10 个是手工点位；超出的在**整张地图**里做
 * 「最远点采样」——每只新鸡都落在离已有全部点位最远的候选点上，
 * 天然铺满全图、不会挤成一圈（数量少时也一样散得开）。
 */
export function buildSlots(count) {
  const slots = CHICKEN_SLOTS.slice(0, Math.min(count, CHICKEN_SLOTS.length));
  if (count <= slots.length) return slots;
  let seed = 20261118;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // 每个新点位试多少个候选：谁离大家最远选谁。
  // 1.8.15 起河判定带上了半径（河岸不能站），候选比之前少，前 48 个点要用更多候选才稳得住
  // 「40 台以内 ≥6.0」；之后间距本来就要逐级放宽，用 96 个就够（不必为 200 台白付 300 万次距离）。
  // ★按 slots.length 取值，前缀依旧稳定：前 N 个点与 buildSlots(N) 完全一致。
  const CAND = slots.length < 48 ? 320 : 96;
  // 生成点位之间的最小间距：一张卡宽（6.0）。两点挨得比卡还近，屏上必有一张被收成
  // 状态点（卡片防叠是 6.6），跟「每个点都够散」的承诺不一致。机器太多、地图塞不下
  // 时按 6% 逐级放宽到 4.0（60 台那种密度下 6.0 已不可能），宁可略挤也别把鸡甩到地图角落重叠。
  let minGap = SLOT_MIN_GAP;
  let guard = 0;
  while (slots.length < count && guard < 4000) {
    guard++;
    let best = null;
    let bestD2 = -1;                      // 用平方距离比较（免掉内层的 Math.hypot，200 台能省一半时间）
    for (let t = 0; t < CAND; t++) {
      // 候选框从当前地图推：1.8.7 把镇子放大后，写死的 ±19/±16 只盖住中间 70%×66%
      const x = MAP.x1 + 1.4 + rand() * (MAP.x2 - MAP.x1 - 2.8);
      const z = MAP.z1 + 1.4 + rand() * (MAP.z2 - MAP.z1 - 2.8);
      if (!isWalkable(x, z, 0.85)) continue;   // 留足净空：漫游半径内别撞墙/进水
      let dmin2 = Infinity;
      for (const s of slots) {
        const ddx = s.x - x;
        const ddz = s.z - z;
        const dd = ddx * ddx + ddz * ddz;
        if (dd < dmin2) dmin2 = dd;
      }
      if (dmin2 > bestD2) { bestD2 = dmin2; best = { x, z }; }
    }
    if (!best) break;                     // 候选全不可走（几乎不会发生）
    const bestD = Math.sqrt(bestD2);
    if (bestD < minGap) {
      if (minGap > SLOT_MIN_GAP_FLOOR) {
        minGap = Math.max(SLOT_MIN_GAP_FLOOR, minGap * 0.94);
        continue;                         // 这一轮不算数：放宽下限重抽
      }
      // 已经放到最松还是塞不下：只能收下这个最近的点，机器总得有地方站
    }
    slots.push({ x: +best.x.toFixed(2), z: +best.z.toFixed(2), r: 1.0, gen: true });
  }
  return slots;
}

function part(batch, shade, material) {
  const mesh = batch.build(material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 造一只小鸡（本地坐标：脚底 y=0，正面朝 +z）
 * @returns {{ root: THREE.Group, head: THREE.Group, leftLeg: THREE.Group, rightLeg: THREE.Group,
 *             leftWing: THREE.Mesh, rightWing: THREE.Mesh, ring: THREE.Mesh, height: number }}
 */
export function buildChicken(material, paletteIndex = 0, scale = 0.85) {
  const pal = PALETTES[Math.abs(paletteIndex) % PALETTES.length];
  const root = new THREE.Group();

  // ---- 身体 ----
  const bodyBatch = new MeshBatch();
  bodyBatch.addBox(0, 0.33, 0, 0.44, 0.32, 0.52, pal.body); // 躯干
  bodyBatch.addBox(0, 0.2, 0.04, 0.34, 0.14, 0.42, pal.wing); // 腹部
  bodyBatch.addBox(0, 0.44, -0.3, 0.22, 0.26, 0.16, pal.tail, 0); // 尾羽
  bodyBatch.addBox(0, 0.56, -0.32, 0.12, 0.12, 0.1, pal.tail, 0); // 尾尖
  const body = part(bodyBatch, pal, material);
  root.add(body);

  // ---- 翅膀 ----
  const wingBatch = new MeshBatch();
  wingBatch.addBox(0, 0, 0, 0.07, 0.2, 0.3, pal.wing);
  const wingGeo = wingBatch.buildGeometry();
  const leftWing = new THREE.Mesh(wingGeo, material);
  const rightWing = new THREE.Mesh(wingGeo, material);
  leftWing.position.set(-0.235, 0.36, -0.02);
  rightWing.position.set(0.235, 0.36, -0.02);
  for (const w of [leftWing, rightWing]) { w.castShadow = true; w.receiveShadow = true; root.add(w); }

  // ---- 头（可摆动/点头）----
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.24);
  const headBatch = new MeshBatch();
  headBatch.addBox(0, 0.11, 0.03, 0.24, 0.26, 0.24, pal.body); // 头
  headBatch.addBox(0, 0.27, 0.0, 0.06, 0.1, 0.2, COMB); // 鸡冠
  headBatch.addBox(0, 0.24, 0.1, 0.05, 0.06, 0.06, COMB);
  headBatch.addBox(0, 0.06, 0.18, 0.1, 0.07, 0.13, BEAK); // 喙
  headBatch.addBox(0, -0.01, 0.16, 0.06, 0.09, 0.05, COMB); // 肉垂
  headBatch.addBox(-0.07, 0.14, 0.15, 0.035, 0.045, 0.03, EYE);
  headBatch.addBox(0.07, 0.14, 0.15, 0.035, 0.045, 0.03, EYE);
  head.add(part(headBatch, pal, material));
  root.add(head);

  // ---- 腿 ----
  const legBatch = new MeshBatch();
  legBatch.addBox(0, -0.09, 0, 0.055, 0.18, 0.055, LEG);
  legBatch.addBox(0, -0.185, 0.03, 0.1, 0.05, 0.14, LEG);
  const legGeo = legBatch.buildGeometry();
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  leftLeg.position.set(-0.1, 0.19, 0);
  rightLeg.position.set(0.1, 0.19, 0);
  for (const [g, leg] of [[legGeo, leftLeg], [legGeo, rightLeg]]) {
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    leg.add(m);
    root.add(leg);
  }

  // ---- 状态光环（贴地圆圈）----
  const ringBatch = new MeshBatch();
  const segments = 12;
  const r = 0.34;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    ringBatch.addBox(
      Math.cos(mid) * r, 0.012, Math.sin(mid) * r,
      (Math.PI * 2 * r) / segments + 0.04, 0.02, 0.075,
      0xffffff,
      -mid + Math.PI / 2
    );
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x6fbf73, transparent: true, opacity: 0.55, depthWrite: false });
  const ring = new THREE.Mesh(ringBatch.buildGeometry(), ringMat);
  ring.renderOrder = 2;
  root.add(ring);

  const shadowBatch = new MeshBatch();
  shadowBatch.addBox(0, 0.004, 0.06, 0.5, 0.01, 0.62, 0x314d46);
  const shadow = shadowBatch.build(new THREE.MeshBasicMaterial({
    color: 0x314d46, transparent: true, opacity: 0.16, depthWrite: false,
  }));
  root.add(shadow);

  root.scale.setScalar(scale);
  return { root, head, leftLeg, rightLeg, leftWing, rightWing, ring, height: 0.72 * scale };
}

/* ------------------------------------------------------------------ *
 * 一群小鸡：每台服务器一只，会自己在窝边溜达、啄地
 * ------------------------------------------------------------------ */

export class ChickenHerd {
  constructor(material, interactables) {
    this.material = material;
    this.items = [];
    this.interactables = interactables;
    this.group = new THREE.Group();
    this._byId = new Map();
    this._rng = 20261118;
    this._slots = null;
    this._slotsFor = 0;            // 槽位表是按多少台建的：建不满（超过生成上限）时别每帧重跑
    this._usedSlots = new Set();   // 已被占用的槽位下标
  }

  _rand() {
    this._rng = (this._rng * 1664525 + 1013904223) >>> 0;
    return this._rng / 4294967296;
  }

  /**
   * 备好至少 n 个槽位。buildSlots 有 4000 次尝试的上限（机器再多也建不满），
   * 所以记住「已经按多少台试过」——否则机器数 > 产出数时，sync() 的
   * `this._slots.length < servers.length` 恒真，每帧都会重跑一次整表（32 s 级冻结）。
   */
  _ensureSlots(n) {
    const want = Math.max(n, CHICKEN_SLOTS.length);
    if (!this._slots || want > this._slotsFor) {
      this._slots = buildSlots(want);
      this._slotsFor = want;
    }
    return this._slots;
  }

  /**
   * 领一个空闲槽位。槽位要跟「服务器」绑定，不能跟数组下标走：
   * 列表按在线状态重排后下标会整体前移，新来的机器会站到别人头上（两只鸡永久重合）。
   */
  _takeSlot() {
    let i = 0;
    while (this._usedSlots.has(i)) i++;
    this._usedSlots.add(i);
    this._ensureSlots(i + 1);
    return i;
  }

  /** 与服务器列表同步：新来的生一只鸡，消失的收走 */
  sync(servers) {
    // 槽位表一次建够：只靠 _takeSlot 里的按需重建，首帧会跑 buildSlots(10)+buildSlots(11)+…+buildSlots(N)，
    // 成本 O(N²)（实测 100 台 0.5 s、200 台 3.3 s 主线程冻结，且全部发生在首帧之前）。
    // buildSlots 的前缀是稳定的，一次建到 N 与逐个追加得到的前 N 个点位完全相同。
    this._ensureSlots(servers.length);
    const seen = new Set();
    servers.forEach((server) => {
      seen.add(server.id);
      let item = this._byId.get(server.id);
      if (!item) {
        const slotIndex = this._takeSlot();
        item = this._spawn(server, slotIndex);
        item.slotIndex = slotIndex;
        this._byId.set(server.id, item);
        this.items.push(item);
      }
      item.server = server;
      item.ring.material.color.setHex(STATUS[server.status]?.color ?? 0x9d9d92);
      item.root.visible = true;
    });
    // 移除已经不存在的
    for (const [id, item] of [...this._byId]) {
      if (seen.has(id)) continue;
      this._byId.delete(id);
      this._usedSlots.delete(item.slotIndex);
      const i = this.items.indexOf(item);
      if (i >= 0) this.items.splice(i, 1);
      this.group.remove(item.root);
      const j = this.interactables.indexOf(item.interactable);
      if (j >= 0) this.interactables.splice(j, 1);
    }
  }

  _spawn(server, index) {
    const slots = this._slots && this._slots.length ? this._slots : CHICKEN_SLOTS;
    const slot = slots[index % slots.length];
    let x;
    let z;
    if (slot.gen) {
      // 后补的槽位本身已经散开，只做一点点抖动
      const a = (index * 2.399963229728653) % (Math.PI * 2);
      const d = 0.15 + (index % 3) * 0.22;
      x = slot.x + Math.cos(a) * d;
      z = slot.z + Math.sin(a) * d;
    } else {
      // 手工点位的抖动要小：相邻点位只隔 6.65（= 一张卡宽 6.0 的余量），
      // 抖太开会把两张卡在静止时就压到一起
      const angle = (index / Math.max(1, CHICKEN_SLOTS.length)) * Math.PI * 2 + 0.7;
      const dist = 0.12 + (index % 3) * 0.06;
      x = slot.x + Math.cos(angle) * dist;
      z = slot.z + Math.sin(angle) * dist;
    }

    // 出生抖动不能把鸡抖进水里/障碍里（河岸边的槽位中心离水缘可能只有半个身位）。
    // 抖歪了就退回槽位中心：槽位本身是按 0.85（手工点是 1.8）净空选出来的。
    if (!isWalkable(x, z, 0.28)) {
      x = slot.x;
      z = slot.z;
    }

    const body = buildChicken(this.material, index, 1.02 + ((index * 7) % 3) * 0.04);
    body.root.position.set(x, 0, z);
    body.root.rotation.y = this._rand() * Math.PI * 2;
    // 鼠标射线沿父链找这个标记（main.js 的 updateHover）——没有它悬停/点击整条链路都是空的
    body.root.userData.serverId = server.id;
    this.group.add(body.root);

    const interactable = {
      kind: 'server',
      serverId: server.id,
      x, z,
      anchorY: 1.02,
      radius: 1.7,
      prompt: `查看 ${server.name}`,
      available: () => true,
      interact: () => ({ kind: 'server', server: item.server }),
    };

    const item = {
      server,
      id: server.id,
      root: body.root,
      head: body.head,
      leftLeg: body.leftLeg,
      rightLeg: body.rightLeg,
      leftWing: body.leftWing,
      rightWing: body.rightWing,
      ring: body.ring,
      height: body.height,
      home: { x, z },              // 出生点（带抖动）：遛弯围着它转
      slotHome: { x: slot.x, z: slot.z },  // 分配到的槽位中心（调试/验收读）
      baseY: 0,                    // 落脚高度（桥面比草地高）：更新里平滑跟到脚下地面
      radius: slot.r,
      pos: { x, z },
      target: { x, z },
      facing: body.root.rotation.y,
      phase: this._rand() * Math.PI * 2,
      wait: this._rand() * 2,
      peck: 0,
      speed: 0.5 + this._rand() * 0.35,
      interactable,
    };
    this.interactables.push(interactable);
    return item;
  }

  /** 高亮/选中 */
  setHighlight(item, on) {
    if (!item) return;
    item.ring.material.opacity = on ? 0.95 : 0.55;
    item.ring.scale.setScalar(on ? 1.12 : 1);
  }

  update(dt, time, playerPos) {
    for (const c of this.items) {
      const offline = c.server.status === 'offline' || c.server.status === 'unknown';
      const busy = c.server.status === 'warn';
      const speed = offline ? 0 : c.speed * (busy ? 1.35 : 1);

      if (!offline) {
        // 选一个落脚点（挑可走的位置，别漫游进墙里/河里）
        c.wait -= dt;
        if (c.wait <= 0) {
          let picked = false;
          for (let tries = 0; tries < 4 && !picked; tries++) {
            const a = this._rand() * Math.PI * 2;
            const r = 0.3 + this._rand() * c.radius;
            const tx = c.home.x + Math.cos(a) * r;
            const tz = c.home.z + Math.sin(a) * r;
            if (isWalkable(tx, tz, 0.28)) {
              c.target.x = tx;
              c.target.z = tz;
              picked = true;
            }
          }
          // 4 次都挑不到可走点：保留上一个目标（它至少是验证过的可走点），
          // 绝不能把最后一次的「不可走」候选留在 target 里——那样小鸡会径直走进河里站着。
          c.wait = 1.6 + this._rand() * 3.6;
        }
        const dx = c.target.x - c.pos.x;
        const dz = c.target.z - c.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.08) {
          const step = Math.min(speed * dt, dist);
          const nx = c.pos.x + (dx / dist) * step;
          const nz = c.pos.z + (dz / dist) * step;
          // 每一小步都过碰撞：只验目标点不够——两点之间可能隔着灌木/树干/河水，
          // 直线走过去照样穿模（200 台规模下可复现；小鸡没有「贴墙滑」的语义，撞上就停）
          if (isWalkable(nx, nz, 0.28)) {
            c.pos.x = nx;
            c.pos.z = nz;
            c.facing = Math.atan2(dx, dz);
            c.phase += dt * 11;
            const swing = 0.55;
            c.leftLeg.rotation.x = Math.sin(c.phase) * swing;
            c.rightLeg.rotation.x = -Math.sin(c.phase) * swing;
            c.root.position.y = c.baseY + Math.abs(Math.sin(c.phase)) * 0.035;
            c.head.rotation.x = Math.sin(c.phase * 0.5) * 0.06;
          } else {
            // 路被挡住：停一下、很快重挑目标（不硬挤，也别把非法点留着）
            c.wait = 0.2 + this._rand() * 0.5;
            c.leftLeg.rotation.x *= 0.9;
            c.rightLeg.rotation.x *= 0.9;
            c.root.position.y += (c.baseY - c.root.position.y) * Math.min(1, dt * 12);
          }
        } else {
          // 站定：左顾右盼 + 偶尔啄地
          c.leftLeg.rotation.x *= 0.9;
          c.rightLeg.rotation.x *= 0.9;
          c.root.position.y += (c.baseY - c.root.position.y) * Math.min(1, dt * 12);
          c.facing += Math.sin(time * 0.6 + c.phase) * 0.006;
          if (this._rand() < dt * 0.55) c.peck = 0.42;
        }
        if (c.peck > 0) {
          c.peck -= dt;
          const t = Math.max(0, c.peck) / 0.42;
          c.head.rotation.x = Math.sin((1 - t) * Math.PI) * 0.9;
        }
        // 偶尔扇一下翅膀
        const flap = Math.max(0, Math.sin(time * 0.9 + c.phase * 3) - 0.94) * 12;
        c.leftWing.rotation.z = flap;
        c.rightWing.rotation.z = -flap;
      } else {
        // 离线：蹲下来不动
        c.root.position.y = c.baseY - 0.05;
        c.head.rotation.x = 0.28 + Math.sin(time * 0.7 + c.phase) * 0.03;
        c.leftLeg.rotation.x *= 0.9;
        c.rightLeg.rotation.x *= 0.9;
        c.leftWing.rotation.z = 0.1;
        c.rightWing.rotation.z = -0.1;
      }

      // 落脚高度：草地 0（小鸡脚底 -0.02，正好贴草面），桥面按桥板高度抬起来。
      // ★别直接用 groundHeight()：那是给玩家用的（含 0.1 的鞋底偏移），小鸡照抄会浮在草上。
      const surfaceY = isOnBridge(c.pos.x, c.pos.z) ? groundHeight(c.pos.x, c.pos.z) : 0;
      c.baseY += (surfaceY - c.baseY) * Math.min(1, dt * 12);
      if (offline) c.root.position.y = c.baseY - 0.05;

      c.root.position.x = c.pos.x;
      c.root.position.z = c.pos.z;
      c.facing += Math.sin(time * 0.5 + c.phase) * 0.0004;
      c.root.rotation.y = c.facing;

      // 同步给交互系统（小鸡会走，坐标要跟着变）
      c.interactable.x = c.pos.x;
      c.interactable.z = c.pos.z;
      c.interactable.prompt = `查看 ${c.server.name}`;

      // 玩家靠近时把光环点亮一点
      const d = Math.hypot(playerPos.x - c.pos.x, playerPos.z - c.pos.z);
      const near = d < 2.4;
      const baseOpacity = c.server.status === 'offline' ? 0.4 : 0.5;
      c.ring.material.opacity = near ? 0.9 : baseOpacity;
    }
  }
}
