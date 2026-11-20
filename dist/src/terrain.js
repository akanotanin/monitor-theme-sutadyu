import * as THREE from 'three';
import { MeshBatch, mulberry32 } from './util.js?v=1.8.17';
import { C, MAP, RIVER, PATHS, LAYOUT } from './config.js?v=1.8.17';

/* ------------------------------------------------------------------ *
 * 地面：一块泥土基座 + 东西两块草地 + 河床 + 铺路砖
 * 地形比例：草地在 y=0，河面在 y=-0.22，地图边缘有一圈土埂。
 * 尺寸全部从 MAP / RIVER 推出来——放大 LAYOUT 时这里不用改。
 * ------------------------------------------------------------------ */

function addPaths(batch, rng) {
  for (const p of PATHS) {
    const stone = !!p.stone;
    batch.addBox(p.x, 0.035, p.z, p.w, 0.07, p.d, stone ? C.stoneBase : C.dirtPath);
    const a = stone ? 0.82 : 0.94;
    const cols = Math.floor(p.w / a);
    const rows = Math.floor(p.d / a);
    const palette = stone ? C.stoneTiles : C.pathTiles;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (!stone && rng() < 0.06) continue;
        const px = p.x - ((cols - 1) * a) / 2 + i * a;
        const pz = p.z - ((rows - 1) * a) / 2 + j * a;
        batch.addBox(
          px, 0.078 + rng() * 0.008, pz,
          a - 0.07, 0.045, a - 0.07,
          palette[Math.floor(rng() * palette.length)]
        );
      }
    }
  }
}

export function buildTerrain(voxelMaterial) {
  const rng = mulberry32(987654321);
  const batch = new MeshBatch();

  const W = MAP.x2 - MAP.x1;
  const D = MAP.z2 - MAP.z1;
  const baseW = W + 1.5;                 // 基座比地图大一圈：边上才有「立体模型」的土埂
  const baseD = D + 1.8;
  const left = -baseW / 2;
  const right = baseW / 2;
  const riverL = RIVER.centerX - RIVER.halfWidth - 0.02;
  const riverR = RIVER.centerX + RIVER.halfWidth + 0.02;

  // ---- 泥土基座 ----
  batch.addBox(0, -1.22, 0, baseW, 1.15, baseD, C.dirtBase);

  // ---- 东西两块草地（中间给河让位）----
  batch.addBox((left + riverL) / 2, -0.53, 0, riverL - left, 1.05, baseD, C.grassWest);
  batch.addBox((riverR + right) / 2, -0.53, 0, right - riverR, 1.05, baseD, C.grassEast);

  // ---- 河床 ----
  batch.addBox(RIVER.centerX, -0.69, 0, RIVER.halfWidth * 2, 0.18, baseD, C.riverbed);

  // ---- 地图边缘的土埂 ----
  const rimZ = baseD / 2 - 0.15;
  for (let t = left + 0.5; t <= right - 0.5; t += 1) {
    if (t > riverL - 0.2 && t < riverR + 0.2) continue;   // 河面上不铺土埂
    const col = C.edge[Math.floor(rng() * C.edge.length)];
    batch.addBox(t, -0.72, -rimZ, 0.96, 0.55, 0.35, col);
    batch.addBox(t, -0.72, rimZ, 0.96, 0.55, 0.35, col);
  }
  const rimX = baseW / 2 - 0.15;
  for (let t = -baseD / 2 + 0.9; t <= baseD / 2 - 0.9; t += 1) {
    const col = C.edge[Math.floor(rng() * 2)];
    batch.addBox(-rimX, -0.72, t, 0.35, 0.55, 0.96, col);
    batch.addBox(rimX, -0.72, t, 0.35, 0.55, 0.96, col);
  }

  // ---- 草地上的深浅色块，让大片绿不死板（数量随面积长）----
  const patches = Math.round(220 * LAYOUT * LAYOUT);
  for (let i = 0; i < patches; i++) {
    const x = MAP.x1 + 0.25 + rng() * (W - 0.5);
    const z = MAP.z1 + 0.1 + rng() * (D - 0.2);
    if (x > riverL - 0.3 && x < riverR + 0.3) continue;
    batch.addBox(
      x, 0.006, z,
      0.65 + rng() * 1.2, 0.012, 0.55 + rng() * 1.1,
      C.patch[Math.floor(rng() * C.patch.length)]
    );
  }

  // ---- 铺路 ----
  addPaths(batch, rng);

  const mesh = batch.build(voxelMaterial);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

export { MAP };
