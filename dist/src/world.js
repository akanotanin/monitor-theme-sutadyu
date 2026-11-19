import * as THREE from 'three';
import { MeshBatch, mulberry32 } from './util.js?v=1.8.6';
import {
  C, MAP, HOUSES, LAMPS, BENCHES, PLANTERS, CRATES, BARRELS, FENCES, SIGN, FOUNTAIN,
} from './config.js?v=1.8.6';
import { buildTerrain } from './terrain.js?v=1.8.6';
import { buildRiver } from './river.js?v=1.8.6';
import {
  buildHouse, buildFountain, buildSign, buildBench, buildLamp, buildCrate,
  buildBarrel, buildFence, buildPlanter,
} from './buildings.js?v=1.8.6';
import { buildFarm } from './farm.js?v=1.8.6';
import { buildNature } from './nature.js?v=1.8.6';
import { buildInhabitants } from './inhabitants.js?v=1.8.6';
import { addRectCollider } from './collision.js?v=1.8.6';

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

  // 面包房旁边的侧仓
  statics.addBox(-12.05, 1.08, -6.4, 1.65, 1.95, 2.55, 0xd6a76b);
  for (let i = 0; i < 3; i++) statics.addBox(-12.05, 2.15 + i * 0.24, -6.4, 2.05 - i * 0.45, 0.28, 2.9, i % 2 ? 0xc97551 : 0xb85f49);
  statics.addBox(-12.05, 0.92, -5.08, 0.68, 1.45, 0.12, 0x6f6650);
  addRectCollider(-12.05, -6.4, 1.7, 2.6);

  // 蓝顶小屋的凸窗
  statics.addBox(2.35, 1, -5.05, 1.25, 1.65, 0.95, 0xe4c795);
  statics.addBox(2.35, 1.9, -5.05, 1.55, 0.25, 1.25, 0x6f96a5);
  glows.addBox(2.35, 1.14, -4.53, 0.85, 0.92, 0.09, 0xf2e2b4);
  for (const x of [2.06, 2.35, 2.64]) statics.addBox(x, 1.14, -4.46, 0.06, 0.94, 0.05, 0xf3e3bd);
  statics.addBox(2.35, 0.43, -4.48, 1.4, 0.18, 0.4, 0x9b7655);
  addRectCollider(2.35, -5.05, 1.35, 1.05);

  // 青瓦人家的门廊
  statics.addBox(-10, 0.18, 7.55, 2.35, 0.26, 1.65, 0xb9a080);
  for (const x of [-10.9, -9.1]) {
    statics.addBox(x, 1.45, 8.1, 0.16, 2.5, 0.16, 0x76513d);
    addRectCollider(x, 8.1, 0.3, 0.3);
  }
  for (let i = 0; i < 4; i++) statics.addBox(-10, 2.7 + i * 0.2, 7.55, 2.65 - i * 0.48, 0.25, 1.95, i % 2 ? 0x7ba291 : 0x5f8c7d);

  // 河畔侧棚
  statics.addBox(1.45, 0.95, 9.1, 1.3, 1.65, 2, 0xa8b987);
  for (let i = 0; i < 3; i++) statics.addBox(1.45, 1.9 + i * 0.22, 9.1, 1.6 - i * 0.35, 0.25, 2.35, 0xca8555);
  statics.addBox(1.45, 0.8, 10.15, 0.55, 1.2, 0.1, 0x65859b);
  addRectCollider(1.45, 9.1, 1.4, 2.1);

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
    { x: -12.05, z: -6.4, r: 1.8 },
    { x: 2.35, z: -5.05, r: 1.5 },
    { x: -10, z: 7.55, r: 1.8 },
    { x: 1.45, z: 9.1, r: 1.8 },
    ...LAMPS.map(([x, z]) => ({ x, z, r: 0.9 })),
    ...PLANTERS.map(([x, z]) => ({ x, z, r: 1.3 })),
    ...CRATES.map(([x, z]) => ({ x, z, r: 0.9 })),
    { x: -9.6, z: 13.8, r: 5.2 }, // 农田区域
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

  addRectCollider(SIGN.x, SIGN.z, 1.95, 0.75);
  void MAP;

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
