import * as THREE from 'three';
import { MeshBatch, mulberry32 } from './util.js';
import {
  C, P, MAP, FARM, HOUSES, LAMPS, BENCHES, PLANTERS, CRATES, BARRELS, FENCES, SIGN, FOUNTAIN,
} from './config.js';
import { buildTerrain } from './terrain.js';
import { buildRiver } from './river.js';
import {
  buildHouse, buildFountain, buildSign, buildBench, buildLamp, buildCrate,
  buildBarrel, buildFence, buildPlanter,
} from './buildings.js';
import { buildFarm } from './farm.js';
import { buildSmoke, buildFireflies } from './fx.js';
import { buildNature } from './nature.js';
import { buildInhabitants } from './inhabitants.js';
import { addRectCollider } from './collision.js';

/* ------------------------------------------------------------------ *
 * 把整个小镇拼起来
 * ------------------------------------------------------------------ */

export function buildWorld(scene) {
  const rng = mulberry32(20241117);
  const voxel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const glass = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

  const group = new THREE.Group();
  scene.add(group);
  const interactables = [];

  // ---- 地面 ----
  group.add(buildTerrain(voxel));

  // ---- 河与桥 ----
  const river = buildRiver(voxel);
  group.add(river.group);

  // ---- 建筑与家具 ----
  const statics = new MeshBatch();
  const glows = new MeshBatch();          // 喷泉 / 路灯等共用一批
  const houseSigns = [];
  const chimneySpots = [];
  /* ★每栋房子单独一批「窗光」+ 单独一个材质实例：
     原来是 5 栋房 + 喷泉 + 路灯全并进一张合并网格、共用一个材质，
     没法让「某一户」单独熄灯——而「哪台机器挂了，那户人家就黑着灯」
     正是这个主题最值钱的一条表达。多 5 个 draw call 换得这个能力，划算。 */
  const houseGlows = [];
  for (const house of HOUSES) {
    const own = new MeshBatch();
    const built = buildHouse(statics, own, house);
    if (built.signFace) houseSigns.push(built.signFace);
    if (built.chimney) chimneySpots.push(built.chimney);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const mesh = own.build(mat);
    group.add(mesh);
    houseGlows.push({ id: house.id, mesh, mat });
  }
  const house = (id) => HOUSES.find((h) => h.id === id);

  // 面包房旁边的侧仓（位置跟着房子走，放大 LAYOUT 时不会脱开）
  const bakery = house('bakery');
  const shedX = bakery.x - 3.05;
  const shedZ = bakery.z - 0.4;
  statics.addBox(shedX, 1.08, shedZ, 1.65, 1.95, 2.55, 0xd6a76b);
  for (let i = 0; i < 3; i++) statics.addBox(shedX, 2.15 + i * 0.24, shedZ, 2.05 - i * 0.45, 0.28, 2.9, i % 2 ? 0xc97551 : 0xb85f49);
  statics.addBox(shedX, 0.92, shedZ + 1.32, 0.68, 1.45, 0.12, 0x6f6650);
  addRectCollider(shedX, shedZ, 1.7, 2.6);

  // 蓝顶小屋的凸窗
  const blue = house('blue');
  const bayX = blue.x + 1.05;
  const bayZ = blue.z + 2.35;
  statics.addBox(bayX, 1, bayZ, 1.25, 1.65, 0.95, 0xe4c795);
  statics.addBox(bayX, 1.9, bayZ, 1.55, 0.25, 1.25, 0x6f96a5);
  glows.addBox(bayX, 1.14, bayZ + 0.52, 0.85, 0.92, 0.09, 0xf2e2b4);
  for (const x of [bayX - 0.29, bayX, bayX + 0.29]) statics.addBox(x, 1.14, bayZ + 0.59, 0.06, 0.94, 0.05, 0xf3e3bd);
  statics.addBox(bayX, 0.43, bayZ + 0.57, 1.4, 0.18, 0.4, 0x9b7655);
  addRectCollider(bayX, bayZ, 1.35, 1.05);

  // 青瓦人家的门廊
  const teal = house('teal');
  const porchX = teal.x;
  const porchZ = teal.z + 2.75;
  statics.addBox(porchX, 0.18, porchZ, 2.35, 0.26, 1.65, 0xb9a080);
  for (const x of [porchX - 0.9, porchX + 0.9]) {
    statics.addBox(x, 1.45, porchZ + 0.55, 0.16, 2.5, 0.16, 0x76513d);
    addRectCollider(x, porchZ + 0.55, 0.3, 0.3);
  }
  for (let i = 0; i < 4; i++) statics.addBox(porchX, 2.7 + i * 0.2, porchZ, 2.65 - i * 0.48, 0.25, 1.95, i % 2 ? 0x7ba291 : 0x5f8c7d);

  // 河畔侧棚
  const rsX = P(1.45);
  const rsZ = P(9.1);
  statics.addBox(rsX, 0.95, rsZ, 1.3, 1.65, 2, 0xa8b987);
  for (let i = 0; i < 3; i++) statics.addBox(rsX, 1.9 + i * 0.22, rsZ, 1.6 - i * 0.35, 0.25, 2.35, 0xca8555);
  statics.addBox(rsX, 0.8, rsZ + 1.05, 0.55, 1.2, 0.1, 0x65859b);
  addRectCollider(rsX, rsZ, 1.4, 2.1);

  // 广场喷泉
  const fountainJets = [];
  buildFountain(statics, glows, FOUNTAIN.x, FOUNTAIN.z, fountainJets);

  // 告示牌
  const signPanel = buildSign(statics, SIGN.x, SIGN.z);
  group.add(signPanel);

  // 长椅 / 路灯 / 花箱 / 木箱 / 木桶
  for (const [x, z, rot] of BENCHES) buildBench(statics, x, z, rot || 0);
  const lights = [];
  LAMPS.forEach(([x, z], i) => {
    const light = buildLamp(statics, glows, x, z, true);
    if (light) {
      light.position.set(x, 3.15, z);
      group.add(light);
      lights.push(light);
    }
  });
  for (const [x, z, w, d] of PLANTERS) buildPlanter(statics, x, z, w, d, rng, C.flowers[Math.floor(rng() * C.flowers.length)]);
  for (const [x, z, size, rot] of CRATES) buildCrate(statics, x, z, size, rot || 0);
  for (const [x, z] of BARRELS) buildBarrel(statics, x, z);
  for (const f of FENCES) buildFence(statics, f.x1, f.z1, f.x2, f.z2, f.n);

  const staticMesh = statics.build(voxel);
  staticMesh.castShadow = true;
  staticMesh.receiveShadow = true;
  group.add(staticMesh);

  const glowMesh = glows.build(glass);
  group.add(glowMesh);

  // ---- 农田 ----
  const farm = buildFarm(voxel, glass, rng, interactables);
  group.add(farm.group);

  // ---- 树木花草 ----
  const keepouts = [
    ...HOUSES.map((h) => ({ x: h.x, z: h.z, r: Math.max(h.width, h.depth) * 0.5 + 1.2 })),
    { x: FOUNTAIN.x, z: FOUNTAIN.z, r: 2.8 },
    { x: SIGN.x, z: SIGN.z, r: 1.4 },
    { x: shedX, z: shedZ, r: 1.8 },
    { x: bayX, z: bayZ, r: 1.5 },
    { x: porchX, z: porchZ, r: 1.8 },
    { x: rsX, z: rsZ, r: 1.8 },
    ...LAMPS.map(([x, z]) => ({ x, z, r: 0.9 })),
    ...PLANTERS.map(([x, z]) => ({ x, z, r: 1.3 })),
    ...CRATES.map(([x, z]) => ({ x, z, r: 0.9 })),
    { x: (FARM.x1 + FARM.x2) / 2, z: (FARM.z1 + FARM.z2) / 2, r: (FARM.x2 - FARM.x1) / 2 + 0.6 }, // 农田区域
  ];
  const nature = buildNature(voxel, keepouts);
  group.add(nature.group);
  for (const s of houseSigns) group.add(s);

  /* ---- 氛围粒子：烟囱冒烟 + 夜里的萤火虫 ----
     ?fx=0 关掉（验收做 A/B 对照、或弱设备想省一点时用） */
  const fxOff = new URLSearchParams(location.search).get('fx') === '0';
  const fxRng = mulberry32(24681357);
  const smoke = buildSmoke(chimneySpots, fxRng);
  smoke.group.visible = !fxOff;
  group.add(smoke.group);
  const fireflies = buildFireflies(26, {
    x1: MAP.x1 + 1.5, x2: MAP.x2 - 1.5, z1: MAP.z1 + 1.5, z2: MAP.z2 - 1.5,
  }, fxRng);
  fireflies.group.visible = !fxOff;
  group.add(fireflies.group);

  // ---- 村民 ----
  const inhabitants = buildInhabitants(voxel, interactables);
  group.add(inhabitants.group);

  // ---- 告示牌交互 ----
  interactables.push({
    kind: 'sign',
    x: SIGN.x,
    z: SIGN.z,
    anchorY: 2.75,
    radius: 2.15,
    prompt: '查看小镇介绍',
    available: () => true,
    interact: () => ({
      kind: 'notice',
      title: '本镇公告',
      lines: [
        '每只小鸡代表一台服务器，头顶卡片是它的实时负载。',
        '走近任意一只，按 E 可以看 CPU / 内存 / 磁盘的详情。',
        '按 Tab 打开探针列表，点一行就能把镜头带到那台机器。',
        '广场西边是菜园，桥东是树林，随意走走也无妨。',
      ],
    }),
  });

  // 告示牌的碰撞体由 buildings.buildSign 自己登记（1.9×0.7），这里别再注册一次

  // ---- 喷泉水花 ----
  const jetGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  const jetMat = new THREE.MeshStandardMaterial({ color: 0xbfe6e0, roughness: 0.4 });
  const jets = fountainJets.map((j) => {
    const mesh = new THREE.Mesh(jetGeo, jetMat);
    mesh.castShadow = false;
    group.add(mesh);
    return { ...j, mesh };
  });

  return {
    group,
    farm,
    inhabitants,
    nature,
    lights,
    houseSigns,
    houseGlows,
    river,
    smokeIntensity() { return smoke.chimneys.map((c) => +c.strength.toFixed(2)); },
    /* ---- 让镇子本身成为仪表盘 ----
       5 栋房子轮流「认领」机器（第 i 户 → 第 i%N 台），所以：
         离线 → 那户熄灯 + 停烟
         繁忙 → 烟冒得更凶
       灯色还能按负载做暖→橙的过渡。这比卡片更直观：一眼就能看出哪户黑着。
       ★不做全局警报（全城闪红）——那会非常吵，只让受影响那一户变化。 */
    /**
     * @param {Array} servers 当前机器列表
     * @param {number} lampLevel daylight 给的 0~1（白天 0 时窗灯本来就该暗）
     */
    syncHouses(servers, lampLevel = 1) {
      const list = Array.isArray(servers) ? servers : [];
      const alpha = lampLevel <= 0.02 ? 0.42 : 1;   // 白天窗光弱一点，但不全灭（不然房子像废弃）

      /* ★稳定绑定：houseIndex → serverId。
         不能用 list[i % list.length] 按下标取 —— hub 每次推送都把离线节点
         排到队尾（hub.js 的 sort），任何一台机器上下线都会让「哪户对应哪台」
         整体错位：挂掉的机器不一定黑它原本那户，反而把健康机器搞黑。
         规则：① 已在表的固定不变；② 空出来的户位优先分给还没上墙的机器（按 id 升序，
         保证同一批数据每次分配结果一致）；③ 机器被删走了就释放那个户位。
         ★没有 id 的数据退回按下标当键（调试口 probeHouses 就只给 status/name）：
           这种数据本来就没有身份可言，按位置绑定等价于旧行为，
           否则 undefined 会互相相等，五户全绑到第一台。 */
      const keyOf = (s, i) => (s && s.id !== undefined && s.id !== null ? s.id : `#${i}`);
      if (!this._houseBind) this._houseBind = [];        // [serverId|null] 长度 = houseGlows.length
      const houseN = houseGlows.length;
      while (this._houseBind.length < houseN) this._houseBind.push(null);

      const alive = new Set(list.map((s, i) => keyOf(s, i)));
      for (let i = 0; i < houseN; i++) {
        if (this._houseBind[i] !== null && !alive.has(this._houseBind[i])) this._houseBind[i] = null;
      }
      const bound = new Set(this._houseBind.filter(Boolean));
      const spare = list
        .map((s, i) => keyOf(s, i))
        .filter((k) => !bound.has(k))
        .sort((a, b) => String(a).localeCompare(String(b)));
      for (let i = 0; i < houseN && spare.length; i++) {
        if (this._houseBind[i] === null) this._houseBind[i] = spare.shift();
      }

      for (let i = 0; i < houseN; i++) {
        const hg = houseGlows[i];
        const srv = list.find((s, k) => keyOf(s, k) === this._houseBind[i]);
        if (!srv) { hg.mat.color.setRGB(alpha, alpha, alpha); continue; }
        const st = srv.status;
        if (st === 'offline' || st === 'unknown') {
          // ★熄灯要「够狠」才看得出来：只压到灰会读成「灯光偏冷」而不是「没人在」。
          //   ★注意 setRGB 是**线性空间**：0.055 线性 ≈ sRGB 0x42，看上去仍是灰灯。
          //   要视觉上真的黑，线性值得降到 0.008 这个量级（≈ sRGB 0x20 以下）。
          hg.mat.color.setRGB(0.008 * alpha, 0.010 * alpha, 0.016 * alpha);
        } else if (st === 'warn') {
          // 繁忙：偏橙，像屋里有炉火在烧
          hg.mat.color.setRGB(1.0 * alpha, 0.72 * alpha, 0.42 * alpha);
        } else {
          hg.mat.color.setRGB(alpha, alpha, alpha);
        }
        // 烟囱跟着同一台机器：离线不冒、繁忙冒得更急
        const lvl = (st === 'offline' || st === 'unknown') ? 0 : (st === 'warn' ? 1.75 : 1);
        smoke.setIntensity(i, lvl);
      }
      // 多出来没有房子对应的烟囱，正常冒
      for (let i = houseGlows.length; i < chimneySpots.length; i++) {
        smoke.setIntensity(i, list.length ? 1 : 0);
      }
    },
    interactables,
    update(dt, time, playerPos, lampLevel = 1) {
      river.update(time, dt);
      farm.update(time);
      nature.update(time);
      inhabitants.update(dt, time, playerPos);
      smoke.update(time);
      // 萤火虫只在夜里出来：lampLevel 由 daylight 给，白天是 0，正好当「天黑了没」用
      // ?fx=0 时传 0 让它整层收掉（否则 update 会把 visible 写回 true）
      fireflies.update(time, fxOff ? 0 : lampLevel);

      // 喷泉：小水柱往上冒再落回池里
      for (const j of jets) {
        const n = (time * 0.65 + j.phase) % 1;
        const r = 0.42 + n * 0.7;
        j.mesh.position.set(
          j.x + Math.cos(j.angle) * r,
          2.9 - n * 1.25 + Math.sin(n * Math.PI) * 0.25,
          j.z + Math.sin(j.angle) * r
        );
        j.mesh.scale.y = 0.12 + n * 0.2;
      }
      // 路灯：随昼夜明灭（白天熄灭），亮着时微微呼吸
      for (let i = 0; i < lights.length; i++) {
        const l = lights[i];
        // lampLevel 是 daylight 给的 0~1；≤0.02 时彻底关掉光源，省掉一次照明计算
        if (lampLevel <= 0.02) {
          if (l.visible) l.visible = false;
          continue;
        }
        if (!l.visible) l.visible = true;
        l.intensity = (1.15 + Math.sin(time * 1.3 + i) * 0.08) * lampLevel;
      }
    },
  };
}
