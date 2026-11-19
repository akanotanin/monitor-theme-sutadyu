import * as THREE from 'three';
import { MeshBatch, mulberry32 } from './util.js?v=1.8.6';
import { C, MAP, TREES, BUSHES, isInRiver } from './config.js?v=1.8.6';
import { addCircleCollider } from './collision.js?v=1.8.6';

/* ------------------------------------------------------------------ *
 * 树、灌木、花草、蘑菇、石头、倒木、云、蝴蝶
 * 树冠是独立的 Group，会轻轻摇摆
 * ------------------------------------------------------------------ */

const LEAF_SETS = C.leaves.map((arr) => arr.map((h) => parseInt(h.slice(1), 16)));

function buildTreeCanopy(palette, seed) {
  const b = new MeshBatch();
  const r = mulberry32(seed);
  const pick = () => palette[Math.floor(r() * palette.length)];
  const boxes = [
    [0, 1.25, 0, 2.15, 1.6, 1.95],
    [-0.85, 0.75, 0.12, 1.45, 1.35, 1.55],
    [0.86, 0.76, -0.1, 1.5, 1.4, 1.55],
    [0.05, 0.72, 0.87, 1.75, 1.25, 1.35],
    [-0.05, 0.86, -0.87, 1.65, 1.35, 1.35],
    [-0.52, 1.72, -0.25, 1.25, 1.15, 1.25],
    [0.61, 1.63, 0.25, 1.2, 1.1, 1.2],
  ];
  boxes.forEach((u, d) => {
    const shade = u[1] < 1 ? 0 : u[1] < 1.7 ? 1 : u[1] < 2 ? 2 : 3;
    const color = palette[Math.min(palette.length - 1, shade)];
    b.addBox(u[0], u[1], u[2], u[3], u[4], u[5], color, (d % 2) * Math.PI / 2);
  });
  const extra = [[-0.72, 2.12, 0.28], [0.25, 2.24, -0.34], [0.82, 1.48, 0.56], [-0.96, 1.18, -0.45]];
  extra.forEach((u, d) => {
    b.addBox(u[0], u[1], u[2], 0.62, 0.48, 0.58, palette[(d + 2) % palette.length]);
  });
  return b.buildGeometry();
}

function addTree(trunkBatch, parent, x, z, scale, rng, withFruit) {
  const r = withFruit ? 0x84603d : 0x74543b;
  // 树干
  trunkBatch.addBox(x, 1.05 * scale, z, 0.64 * scale, 2.1 * scale, 0.64 * scale, r);
  trunkBatch.addBox(x + 0.22 * scale, 1.0 * scale, z + 0.33 * scale, 0.16 * scale, 1.3 * scale, 0.08 * scale, 0x9a7047);
  trunkBatch.addBox(x - 0.28 * scale, 0.18, z + 0.16 * scale, 0.5 * scale, 0.24, 0.34 * scale, 0x66503b);
  trunkBatch.addBox(x + 0.24 * scale, 0.16, z - 0.22 * scale, 0.48 * scale, 0.22, 0.35 * scale, 0x66503b);

  const variant = Math.abs(Math.floor(x * 13 + z * 7)) % 4;
  const palette = LEAF_SETS[variant];
  const g = new THREE.Group();
  const geo = buildTreeCanopy(palette, Math.abs(Math.floor(x * 31 + z * 17)) + 7);
  const mesh = new THREE.Mesh(geo, NATURE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  if (withFruit) {
    const fruitBatch = new MeshBatch();
    for (const [fx, fy, fz] of [[-0.8, 0.55, 0.9], [0.75, 0.7, 0.85], [-0.95, 0.8, -0.45], [0.45, 1.45, 0.82], [0.1, 0.4, -1]]) {
      fruitBatch.addBox(fx * scale, fy * scale, fz * scale, 0.24 * scale, 0.26 * scale, 0.24 * scale, 0xe8a04f);
    }
    const fruitMesh = fruitBatch.build(NATURE_MATERIAL);
    fruitMesh.castShadow = true;
    g.add(fruitMesh);
  }
  g.position.set(x, 2 * scale, z);
  g.scale.set(
    [0.86, 1.08, 0.94, 1.14][variant] * scale,
    [1.22, 0.9, 1.1, 0.82][variant] * scale,
    [0.88, 1.04, 1.12, 0.92][variant] * scale
  );
  g.rotation.y = (variant * Math.PI) / 2;
  parent.add(g);
  addCircleCollider(x, z, 0.55 * scale);
  void rng;
  return g;
}

let NATURE_MATERIAL = null;

export function buildNature(voxelMaterial, keepouts = []) {
  NATURE_MATERIAL = voxelMaterial;
  const rng = mulberry32(13572468);
  const group = new THREE.Group();
  const trunkBatch = new MeshBatch();
  const decorBatch = new MeshBatch();
  const swayers = [];

  const blocked = (x, z, pad = 0.6) =>
    Math.abs(x) > MAP.x2 - 0.4 || Math.abs(z) > MAP.z2 - 0.4 ||
    isInRiver(x, z) || isInRiver(x + pad, z) || isInRiver(x - pad, z) ||
    keepouts.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + pad);

  // ---- 固定的树 ----
  for (const [x, z, s] of TREES) {
    if (blocked(x, z)) continue;
    const g = addTree(trunkBatch, group, x, z, s, rng, rng() < 0.2);
    swayers.push({ group: g, phase: rng() * 6.28, amount: 0.012 + rng() * 0.012 });
  }

  // ---- 东边树林里的随机树 ----
  let placed = 0;
  for (let attempts = 0; attempts < 400 && placed < 22; attempts++) {
    const x = 12.2 + rng() * 8.5;
    const z = -16.8 + rng() * 33.4;
    if (x < 16.4 && Math.abs(z) < 4.1) continue;
    if (Math.abs(x - 15.2) < 2.75 && z < 1.8 && z > -10.2) continue;
    if (Math.abs(x - 16.3) < 5.5 && z > -14.5 && z < 1) continue;
    if (Math.hypot(x - 16, z - 5) < 5) continue;
    if (blocked(x, z)) continue;
    const s = 0.75 + rng() * 0.45;
    const g = addTree(trunkBatch, group, x, z, s, rng, placed % 8 === 0);
    swayers.push({ group: g, phase: rng() * 6.28, amount: 0.012 + rng() * 0.012 });
    placed++;
  }

  // ---- 灌木 ----
  const bushPalette = [0x547f58, 0x6d945e, 0x4f7961, 0x789c62];
  BUSHES.forEach(([x, z], i) => {
    const s = 0.75 + (i % 3) * 0.18;
    decorBatch.addBox(x, 0.32 * s, z, 0.9 * s, 0.62 * s, 0.8 * s, bushPalette[i % 4]);
    decorBatch.addBox(x - 0.35 * s, 0.22 * s, z + 0.12, 0.55 * s, 0.42 * s, 0.52 * s, bushPalette[(i + 1) % 4]);
    decorBatch.addBox(x + 0.32 * s, 0.24 * s, z - 0.14, 0.52 * s, 0.46 * s, 0.48 * s, bushPalette[(i + 2) % 4]);
    if (i % 3 === 0) decorBatch.addBox(x + 0.12, 0.66 * s, z + 0.24, 0.14, 0.14, 0.14, 0xe9b181);
    addCircleCollider(x, z, 0.45 * s);
  });

  // ---- 野花与草丛 ----
  const flowerPalette = C.flowers;
  for (let i = 0; i < 280; i++) {
    const x = -20.5 + rng() * 41;
    const z = -17.5 + rng() * 35;
    if ((x > 6.5 && x < 11.5) || blocked(x, z, 0.4)) continue;
    if (i % 3 === 0) {
      const color = flowerPalette[Math.floor(rng() * flowerPalette.length)];
      const s = 0.65 + rng() * 0.55;
      decorBatch.addBox(x, 0.17 * s, z, 0.06, 0.3 * s, 0.06, 0x547c4c);
      for (const [ox, oz] of [[-0.13, 0], [0.13, 0], [0, -0.13], [0, 0.13]]) {
        decorBatch.addBox(x + ox * s, 0.31 * s, z + oz * s, 0.15 * s, 0.11 * s, 0.15 * s, color);
      }
      decorBatch.addBox(x, 0.31 * s, z, 0.09 * s, 0.1 * s, 0.09 * s, 0xf6e3b4);
    } else {
      const g = C.grass[Math.floor(rng() * 3)];
      decorBatch.addBox(x, 0.17, z, 0.07, 0.3 + rng() * 0.2, 0.07, g);
      decorBatch.addBox(x + 0.12, 0.12, z + 0.06, 0.06, 0.23, 0.06, g);
    }
  }

  // ---- 石头（东边）----
  for (let i = 0; i < 18; i++) {
    const x = 12.3 + rng() * 8;
    const z = -16 + rng() * 32;
    if (Math.abs(z) < 1.8 || blocked(x, z, 0.3)) continue;
    const s = 0.35 + rng() * 0.45;
    decorBatch.addBox(x, 0.18, z, s, 0.32 + rng() * 0.3, s * 1.1, [0x8d8b79, 0xa09b84, 0x7d8172][i % 3]);
  }

  // ---- 蘑菇 ----
  for (let i = 0; i < 30; i++) {
    const x = 12.4 + ((i * 3.73) % 8.1);
    const z = -16 + ((i * 7.17) % 32);
    if (Math.abs(z) < 1.8 || blocked(x, z, 0.3)) continue;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      decorBatch.addBox(x + Math.cos(a) * 0.16, 0.27, z + Math.sin(a) * 0.16, 0.12, 0.5, 0.24, k % 2 ? 0x4f7c58 : 0x669361, (k * Math.PI) / 4);
    }
  }

  // ---- 倒木 ----
  for (const [x, z, rot] of [[19, 9, 0], [13, -12, 1.57], [19, -14, 0]]) {
    decorBatch.addBox(x, 0.34, z, 1.85, 0.55, 0.58, 0x6f5139, rot);
    decorBatch.addBox(x - 0.65, 0.37, z + 0.28, 0.18, 0.32, 0.18, 0x98704a);
    decorBatch.addBox(x + 0.93, 0.34, z, 0.08, 0.43, 0.44, 0xb08a5b, rot);
    addCircleCollider(x, z, 1.0);
  }

  // ---- 野餐草地（桥东）----
  decorBatch.addBox(16.3, 0.07, 5, 3.6, 0.09, 2.6, 0xd98478);
  for (let i = -3; i <= 3; i++) decorBatch.addBox(16.3 + i * 0.5, 0.125, 5, 0.1, 0.025, 2.55, 0xf4dfb4);
  for (let i = -2; i <= 2; i++) decorBatch.addBox(16.3, 0.13, 5 + i * 0.5, 3.55, 0.025, 0.09, 0xf4dfb4);
  decorBatch.addBox(14.95, 0.18, 4, 0.75, 0.24, 0.75, 0x8ea2b7);
  decorBatch.addBox(17.55, 0.18, 4, 0.75, 0.24, 0.75, 0xd6b068);
  for (const [x, z] of [[15.55, 4.65], [16.55, 5.65]]) {
    decorBatch.addBox(x, 0.17, z, 0.58, 0.08, 0.52, 0xf3ead2);
    decorBatch.addBox(x, 0.225, z, 0.36, 0.035, 0.3, 0xd9e0d2);
  }
  decorBatch.addBox(15.55, 0.35, 4.65, 0.58, 0.22, 0.26, 0xdfa45d);
  for (let i = -1; i <= 1; i++) decorBatch.addBox(15.55 + i * 0.17, 0.47, 4.65, 0.05, 0.04, 0.22, 0xf3cf83);
  for (const [x, z] of [[16.45, 5.6], [16.7, 5.48], [16.25, 5.72]]) {
    decorBatch.addBox(x, 0.34, z, 0.24, 0.26, 0.24, 0xc85f4e);
    decorBatch.addBox(x, 0.5, z, 0.06, 0.1, 0.06, 0x64804e);
  }

  // ---- 桥头石阶 ----
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = 15.2 - t;
    const y = 0.9 + t * 2.5;
    decorBatch.addBox(x, 0.095, y, 0.58 + (i % 2) * 0.12, 0.07, 0.42, i % 2 ? 0xc4b28e : 0xd5c29b);
  }

  const trunkMesh = trunkBatch.build(voxelMaterial);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  group.add(trunkMesh);

  const decorMesh = decorBatch.build(voxelMaterial);
  decorMesh.castShadow = true;
  decorMesh.receiveShadow = true;
  group.add(decorMesh);

  // ---- 蝴蝶 ----
  const butterflies = [];
  const butterflySpecs = [[-5.3, 1.2, 0xf1c863], [1.4, 1.1, 0xd894b3], [-12.7, 7.2, 0xf3dd8a], [18.4, 5.2, 0xb6a2dc], [-8.2, 12.2, 0xedaa65]];
  for (const [x, z, color] of butterflySpecs) {
    const g = new THREE.Group();
    const wingMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide });
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.24), wingMat);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.24), wingMat);
    left.position.x = -0.1;
    right.position.x = 0.1;
    g.add(left, right);
    g.position.set(x, 1, z);
    group.add(g);
    butterflies.push({ group: g, left, right, x, z, phase: rng() * 6.28, speed: 0.65 + rng() * 0.4 });
  }

  return {
    group,
    update(time) {
      for (const s of swayers) {
        s.group.rotation.z = Math.sin(time * 0.8 + s.phase) * s.amount;
        s.group.rotation.x = Math.cos(time * 0.63 + s.phase) * s.amount * 0.7;
      }
      for (const b of butterflies) {
        const n = time * b.speed + b.phase;
        b.group.position.set(b.x + Math.cos(n) * 0.65, 0.85 + Math.sin(n * 2.1) * 0.22, b.z + Math.sin(n) * 0.55);
        b.group.rotation.y = -n;
        b.left.rotation.z = Math.sin(time * 13 + b.phase) * 0.75;
        b.right.rotation.z = -Math.sin(time * 13 + b.phase) * 0.75;
      }
    },
  };
}
