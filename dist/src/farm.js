import * as THREE from 'three';
import { MeshBatch } from './util.js?v=1.8.12';
import { C, FARM, LAYOUT } from './config.js?v=1.8.12';
import { addRectCollider } from './collision.js?v=1.8.12';

/* ------------------------------------------------------------------ *
 * 农田：一垄垄翻好的土 + 四种作物 + 稻草人 + 农具
 * ------------------------------------------------------------------ */

const CROP_COLORS = {
  pumpkin: '#e89a43',
  cabbage: '#8fb974',
  sunflower: '#f2bf4e',
  turnip: '#aa5b75',
};

const CROP_NAMES = {
  pumpkin: '金色南瓜',
  cabbage: '脆叶卷心菜',
  sunflower: '太阳花',
  turnip: '甜菜根',
};

function buildCropGeometry(type) {
  const b = new MeshBatch();
  const box = (x, y, z, w, h, d, hex) => b.addBox(x, y, z, w, h, d, parseInt(hex.slice(1), 16));
  if (type === 'pumpkin') {
    box(0, 0.29, 0, 0.62, 0.52, 0.58, '#e89a43');
    box(-0.28, 0.28, 0, 0.18, 0.43, 0.48, '#f2ac4f');
    box(0.28, 0.28, 0, 0.18, 0.43, 0.48, '#cc7d38');
    box(0, 0.61, 0, 0.12, 0.22, 0.12, '#66804a');
    box(0.42, 0.12, 0.15, 0.48, 0.08, 0.12, '#6f914f');
  } else if (type === 'cabbage') {
    box(0, 0.3, 0, 0.5, 0.48, 0.5, '#8fb974');
    for (const u of [-1, 1]) {
      box(u * 0.25, 0.22, 0, 0.28, 0.3, 0.52, '#6f9f65');
      box(0, 0.22, u * 0.25, 0.52, 0.3, 0.28, '#7dab69');
    }
    box(0, 0.48, 0, 0.3, 0.2, 0.3, '#b3ce88');
  } else if (type === 'sunflower') {
    box(0, 0.62, 0, 0.09, 1.2, 0.09, '#62834b');
    box(-0.18, 0.47, 0, 0.35, 0.12, 0.24, '#7b9e58');
    box(0, 1.22, 0.02, 0.34, 0.34, 0.2, '#795036');
    for (const [u, d] of [[-0.27, 0], [0.27, 0], [0, -0.27], [0, 0.27], [-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
      box(u, 1.22 + d, 0, 0.23, 0.23, 0.15, '#f2bf4e');
    }
  } else {
    box(0, 0.24, 0, 0.4, 0.42, 0.4, '#aa5b75');
    box(0, 0.5, 0, 0.1, 0.35, 0.1, '#65844c');
    box(-0.16, 0.62, 0, 0.3, 0.14, 0.24, '#82a65f');
    box(0.16, 0.68, 0, 0.3, 0.14, 0.24, '#749755');
    for (const u of [-1, 1]) {
      box(u * 0.34, 0.13, 0.12, 0.38, 0.12, 0.28, '#6d9658');
      box(u * 0.18, 0.18, -0.24, 0.32, 0.12, 0.24, '#7da563');
    }
  }
  return b.buildGeometry();
}

const geoCache = new Map();
function cropGeo(type) {
  if (!geoCache.has(type)) geoCache.set(type, buildCropGeometry(type));
  return geoCache.get(type);
}

export function buildFarm(voxelMaterial, unlitMaterial, rng, interactables) {
  const group = new THREE.Group();
  // 整块农田跟着小镇一起等比放大（地块、作物、稻草人一起长），
  // 否则围栏放大而田垄不变，田里会空出一圈秃地
  group.scale.setScalar(LAYOUT);
  const batch = new MeshBatch();
  const crops = [];
  let harvestCount = 0;

  // ---- 翻好的土垄 ----
  for (let x = -13.6; x <= -5.8; x += 1.3) {
    batch.addBox(x, 0.105, 13.65, 0.96, 0.16, 6, 0x74543d);
    for (let z = 11.15; z <= 16.2; z += 0.55) {
      batch.addBox(x, 0.2, z, 0.82, 0.09, 0.14, 0x96704a);
    }
  }

  // ---- 稻草人 ----
  const sx = -13.5;
  const sz = 16.65;
  batch.addBox(sx, 0.12, sz, 0.72, 0.22, 0.72, 0x6b5a40);
  batch.addBox(sx, 0.32, sz, 0.34, 0.34, 0.34, 0x8a7048);
  batch.addBox(sx, 1.15, sz, 0.14, 2.25, 0.14, 0x76543a);
  batch.addBox(sx, 1.55, sz, 1.55, 0.13, 0.13, 0x76543a);
  batch.addBox(sx, 1.48, sz, 0.68, 0.72, 0.35, 0x7893a0);
  batch.addBox(sx + 0.18, 1.42, sz + 0.19, 0.22, 0.22, 0.05, 0xd5b077);
  batch.addBox(sx, 2.11, sz, 0.5, 0.48, 0.46, 0xe7bd83);
  batch.addBox(sx, 2.4, sz, 0.92, 0.12, 0.7, 0xa87845);
  batch.addBox(sx, 2.57, sz, 0.56, 0.28, 0.51, 0xb78b50);
  for (const s of [-1, 1]) {
    batch.addBox(sx + s * 0.88, 1.55, sz, 0.34, 0.22, 0.28, 0xd5b46c);
    batch.addBox(sx + s * 1.02, 1.55, sz, 0.1, 0.3, 0.1, 0xc4a25b);
  }
  batch.addBox(sx - 0.13, 2.15, sz + 0.24, 0.06, 0.07, 0.04, 0x544137);
  batch.addBox(sx + 0.13, 2.15, sz + 0.24, 0.06, 0.07, 0.04, 0x544137);
  for (let i = -2; i <= 2; i++) batch.addBox(sx + i * 0.055, 2 + Math.abs(i % 2) * 0.025, sz + 0.245, 0.035, 0.045, 0.03, 0x8c6c52);

  // ---- 农具：水渠、干草、独轮车、木桶 ----
  batch.addBox(-14.08, 0.075, 13.6, 0.3, 0.1, 5.8, 0x568f91);
  for (const z of [10.75, 16.45]) batch.addBox(-14.08, 0.16, z, 0.46, 0.24, 0.42, 0x9b9177);

  batch.addBox(-5.35, 0.35, 16.55, 0.46, 0.5, 0.52, 0x6f9ca2);
  batch.addBox(-5.35, 0.64, 16.55, 0.32, 0.1, 0.34, 0x9fc0b8);
  batch.addBox(-5.03, 0.42, 16.55, 0.38, 0.14, 0.18, 0x6f9ca2);
  batch.addBox(-5.7, 0.48, 16.55, 0.12, 0.48, 0.42, 0x587c82);

  batch.addBox(-3.85, 0.72, 16.35, 1.25, 0.14, 0.16, 0x86603e);
  for (const x of [-4.4, -3.3]) batch.addBox(x, 0.65, 16.35, 0.14, 1.25, 0.14, 0x765237);
  batch.addBox(-3.72, 0.83, 16.47, 0.08, 1.4, 0.08, 0xa48051);
  batch.addBox(-3.72, 1.47, 16.47, 0.45, 0.09, 0.08, 0x758078);
  for (const x of [-3.9, -3.72, -3.54]) batch.addBox(x, 1.36, 16.47, 0.06, 0.28, 0.06, 0x758078);

  batch.addBox(-15.45, 0.35, 11, 1.15, 0.65, 1, 0x8b6543);
  batch.addBox(-15.45, 0.72, 11, 0.95, 0.12, 0.82, 0x665440);
  for (let i = 0; i < 5; i++) batch.addBox(-15.8 + i * 0.18, 0.84, 11, 0.12, 0.2, 0.5, 0xb69a5c);

  addRectCollider(sx * LAYOUT, sz * LAYOUT, 0.8 * LAYOUT, 0.8 * LAYOUT);
  addRectCollider(-15.45 * LAYOUT, 11 * LAYOUT, 1.2 * LAYOUT, 1.1 * LAYOUT);
  addRectCollider(-3.72 * LAYOUT, 16.4 * LAYOUT, 1.4 * LAYOUT, 0.5 * LAYOUT);

  const propMesh = batch.build(voxelMaterial);
  propMesh.castShadow = true;
  propMesh.receiveShadow = true;
  group.add(propMesh);

  // ---- 作物 ----
  const patchGeo = new THREE.BoxGeometry(0.8, 0.045, 0.72);
  const patchMat = new THREE.MeshStandardMaterial({ color: 0x594233, roughness: 0.95 });
  const sproutGeo = new THREE.BoxGeometry(0.18, 0.24, 0.18);
  const sproutMat = new THREE.MeshStandardMaterial({ color: 0x83a65e, roughness: 0.9 });

  const places = [];
  const types = ['pumpkin', 'cabbage', 'sunflower', 'turnip'];
  [-13.55, -11, -8.45, -5.9].forEach((x, i) => {
    [11.25, 13.55, 15.85].forEach((z, j) => {
      const immature = (i === 3 && j === 2) || (i === 1 && j === 1) || (i === 2 && j === 0);
      places.push({ x, z, type: types[(i + j) % 4], mature: !immature });
    });
  });
  [-12.3, -9.75, -7.2].forEach((x, i) => {
    [11.25, 15.85].forEach((z, j) => {
      places.push({ x, z, type: types[(i + j + 1) % 4], mature: false });
    });
  });

  for (const p of places) {
    const root = new THREE.Group();
    root.position.set(p.x, 0.12, p.z);
    const produce = new THREE.Group();
    const mesh = new THREE.Mesh(cropGeo(p.type), voxelMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    produce.add(mesh);
    const s = 1.15 + (Math.abs(Math.floor(p.z * 7 + p.x * 5)) % 4) * 0.09;
    produce.scale.setScalar(p.mature ? s : 0.7);
    root.add(produce);

    const sprout = new THREE.Mesh(sproutGeo, sproutMat);
    sprout.position.y = 0.12;
    sprout.visible = !p.mature;
    sprout.castShadow = true;
    root.add(sprout);

    const patch = new THREE.Mesh(patchGeo, patchMat);
    patch.position.y = 0.002;
    patch.visible = false;
    patch.receiveShadow = true;
    root.add(patch);

    group.add(root);

    const crop = {
      type: p.type,
      name: CROP_NAMES[p.type],
      root,
      produce,
      sprout,
      patch,
      position: new THREE.Vector3(p.x * LAYOUT, 0, p.z * LAYOUT),
      mature: p.mature,
      phase: rng() * 6.28,
      harvested: false,
    };
    crops.push(crop);

    if (p.mature) {
      interactables.push({
        kind: 'crop',
        x: p.x * LAYOUT, z: p.z * LAYOUT, anchorY: 1.35 * LAYOUT,
        radius: 1.45 * LAYOUT,
        prompt: `采摘${crop.name}`,
        available: () => crop.mature,
        interact: () => {
          if (!crop.mature) return null;
          crop.mature = false;
          crop.produce.visible = false;
          crop.sprout.visible = true;
          crop.patch.visible = true;
          crop.harvested = true;
          harvestCount++;
          return {
            kind: 'toast',
            text: `采到了 1 份${crop.name} · 竹篮里已有 ${harvestCount} 份收成`,
            extra: { kind: 'say', name: '丰收时刻', text: `${crop.name}还带着阳光的温度。把这份小小的丰收放进竹篮吧！` },
          };
        },
        ref: crop,
      });
    }
  }

  return {
    group,
    crops,
    get harvestCount() { return harvestCount; },
    update(time) {
      for (const crop of crops) {
        if (crop.mature) {
          crop.produce.rotation.z = Math.sin(time * 1.3 + crop.phase) * 0.018;
        }
      }
    },
  };
}

export { CROP_COLORS };
