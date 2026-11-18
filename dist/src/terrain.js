import * as THREE from 'three';
import { MeshBatch, mulberry32 } from './util.js?v=1.8.4';
import { C, MAP, RIVER, PATHS } from './config.js?v=1.8.4';

/* ------------------------------------------------------------------ *
 * 地面：一块 44×38 的泥土基座 + 东西两块草地 + 河床 + 铺路砖
 * 地形比例：草地在 y=0，河面在 y=-0.22，地图边缘有一圈土埂。
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

  // ---- 泥土基座 ----
  batch.addBox(0, -1.22, 0, 44, 1.15, 38, C.dirtBase);

  // ---- 东西两块草地（中间给河让位）----
  batch.addBox(-7.43, -0.53, 0, 29.14, 1.05, 38, C.grassWest);
  batch.addBox(16.43, -0.53, 0, 11.14, 1.05, 38, C.grassEast);

  // ---- 河床 ----
  batch.addBox(RIVER.centerX, -0.69, 0, RIVER.halfWidth * 2, 0.18, 38, C.riverbed);

  // ---- 地图边缘的土埂，制造“立体模型”感 ----
  for (let t = -21.5; t <= 21.5; t += 1) {
    const col = C.edge[Math.floor(rng() * C.edge.length)];
    if (t < 6.8 || t > 11.2) {
      batch.addBox(t, -0.72, -18.85, 0.96, 0.55, 0.35, col);
      batch.addBox(t, -0.72, 18.85, 0.96, 0.55, 0.35, col);
    }
  }
  for (let t = -18; t <= 18; t += 1) {
    const col = C.edge[Math.floor(rng() * 2)];
    batch.addBox(-21.85, -0.72, t, 0.35, 0.55, 0.96, col);
    batch.addBox(21.85, -0.72, t, 0.35, 0.55, 0.96, col);
  }

  // ---- 草地上的深浅色块，让大片绿不死板 ----
  for (let i = 0; i < 220; i++) {
    const x = -21 + rng() * 42;
    const z = -18 + rng() * 36;
    if (x > 6.7 && x < 11.3) continue;
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
