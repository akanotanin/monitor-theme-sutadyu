import * as THREE from 'three';
import { MeshBatch, mulberry32 } from './util.js?v=1.8.16';
import {
  C, P, FARM, HOUSES, LAMPS, BENCHES, PLANTERS, CRATES, BARRELS, FENCES, SIGN, FOUNTAIN,
} from './config.js?v=1.8.16';
import { buildTerrain } from './terrain.js?v=1.8.16';
import { buildRiver } from './river.js?v=1.8.16';
import {
  buildHouse, buildFountain, buildSign, buildBench, buildLamp, buildCrate,
  buildBarrel, buildFence, buildPlanter,
} from './buildings.js?v=1.8.16';
import { buildFarm } from './farm.js?v=1.8.16';
import { buildNature } from './nature.js?v=1.8.16';
import { buildInhabitants } from './inhabitants.js?v=1.8.16';
import { addRectCollider } from './collision.js?v=1.8.16';

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
  const glows = new MeshBatch();
  for (const house of HOUSES) buildHouse(statics, glows, house);
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
    const light = buildLamp(statics, glows, x, z, i < 2);
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
    interactables,
    update(dt, time, playerPos) {
      river.update(time);
      farm.update(time);
      nature.update(time);
      inhabitants.update(dt, time, playerPos);

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
      // 路灯微微呼吸
      for (let i = 0; i < lights.length; i++) {
        lights[i].intensity = 1.15 + Math.sin(time * 1.3 + i) * 0.08;
      }
    },
  };
}
