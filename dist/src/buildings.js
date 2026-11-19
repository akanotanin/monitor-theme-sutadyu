import * as THREE from 'three';
import { MeshBatch } from './util.js?v=1.8.6';
import { addRectCollider } from './collision.js?v=1.8.6';

/* ------------------------------------------------------------------ *
 * 建筑与家具：比例、层级、配色统一在一套小镇风格里
 * ------------------------------------------------------------------ */

const FOUNDATION = 0x97836a;

/** 假阴影（贴地的一层深色，代替 AO，让物件“落”在地上） */
function blob(batch, x, z, w, d) {
  batch.addBox(x + 0.2, 0.052, z + 0.25, w + 0.85, 0.025, d + 0.85, 0x314d46);
}

function addWindow(batch, glassBatch, x, y, z, shutter, scale, style = 0) {
  const r = scale;
  batch.addBox(x, y, z, 1.02 * r, 1.06 * r, 0.12, 0x624a38);
  glassBatch.addBox(x, y, z + 0.075, 0.76 * r, 0.8 * r, 0.08, 0xf2d8a4);
  batch.addBox(x, y - 0.22 * r, z + 0.125, 0.7 * r, 0.24 * r, 0.04, 0x9e8068);
  if (style !== 1) batch.addBox(x, y, z + 0.13, 0.08, 0.84 * r, 0.07, 0xf5e4bd);
  if (style === 2) {
    batch.addBox(x - 0.21 * r, y, z + 0.13, 0.8 * r, 0.06, 0.07, 0xf5e4bd);
    batch.addBox(x + 0.21 * r, y, z + 0.13, 0.8 * r, 0.06, 0.07, 0xf5e4bd);
  } else {
    batch.addBox(x, y, z + 0.13, 0.8 * r, 0.08, 0.07, 0xf5e4bd);
  }
  for (const s of [-1, 1]) batch.addBox(x + s * 0.69 * r, y, z + 0.02, 0.27 * r, 1.02 * r, 0.13, shutter);
  batch.addBox(x, y - 0.65 * r, z + 0.2, 1.35 * r, 0.25, 0.38, 0x76503a);
  for (let a = -2; a <= 2; a++) {
    batch.addBox(x + a * 0.22 * r, y - 0.46 * r, z + 0.28, 0.17, 0.22, 0.17, a % 2 ? 0xdd7a78 : 0xf1bf63);
    batch.addBox(x + a * 0.22 * r, y - 0.55 * r, z + 0.23, 0.07, 0.25, 0.07, 0x64814e);
  }
}

function addSideWindow(batch, glassBatch, x, y, z, shutter) {
  batch.addBox(x, y, z, 0.12, 1.08, 1.04, 0x624a38);
  glassBatch.addBox(x + 0.075, y, z, 0.08, 0.8, 0.78, 0xf2d8a4);
  batch.addBox(x + 0.125, y - 0.22, z, 0.04, 0.24, 0.7, 0x9e8068);
  batch.addBox(x + 0.13, y, z, 0.07, 0.84, 0.08, 0xf5e4bd);
  batch.addBox(x + 0.13, y, z, 0.07, 0.08, 0.82, 0xf5e4bd);
  for (const s of [-1, 1]) batch.addBox(x + 0.02, y, z + s * 0.69, 0.13, 1.02, 0.27, shutter);
}

/** 烟囱 + 三团飘烟 */
function addChimney(batch, x, z, roofTop, px, py, pz) {
  batch.addBox(x, roofTop - 0.32, z, 0.65, 2.05, 0.65, 0x9b6854);
  for (let i = 0; i < 4; i++) {
    batch.addBox(x, roofTop - 1.07 + i * 0.43, z + 0.34, 0.7, 0.08, 0.05, 0xc28b6a);
  }
  batch.addBox(x, roofTop + 0.74, z, 0.82, 0.2, 0.82, 0x745447);
  void px; void py; void pz;
}

/**
 * 一栋房子
 * @param {MeshBatch} batch 不发光部件
 * @param {MeshBatch} glass 发光部件（窗、灯）
 */
export function buildHouse(batch, glass, cfg) {
  const {
    x, z, width, depth, wall, roof, roofAlt, trim, door, shutter,
    awning = false, roofLayers = 6, roofRise = 0.29,
    dormer = false, gable = false, cabin = false, windowStyle = 0,
  } = cfg;
  const front = z + depth / 2;
  const cv = (v) => (typeof v === "string" ? parseInt(v.replace("#", ""), 16) : v);
  const wallC = cv(wall), roofC = cv(roof), roofAltC = cv(roofAlt), trimC = cv(trim);
  const doorC = cv(door), shutterC = cv(shutter);

  blob(batch, x, z, width, depth);
  batch.addBox(x, 0.18, z, width + 0.35, 0.36, depth + 0.35, FOUNDATION);
  batch.addBox(x, 1.73, z, width, 3.05, depth, wallC);
  batch.addBox(x, 0.47, front + 0.055, width, 0.22, 0.15, trimC);
  for (const s of [-1, 1]) {
    batch.addBox(x + s * (width / 2 - 0.12), 1.8, front + 0.055, 0.22, 2.85, 0.16, trimC);
    batch.addBox(x + s * (width / 2 - 0.12), 1.8, z - depth / 2 + 0.08, 0.22, 2.85, 0.18, trimC);
  }
  batch.addBox(x, 2.92, front + 0.06, width, 0.18, 0.16, trimC);

  // ---- 屋顶：一层层往里收，形成带瓦楞的坡顶 ----
  let roofTop = 3.24;
  for (let i = 0; i < roofLayers; i++) {
    const w = width + 1.05 - i * ((width + 0.35) / roofLayers);
    batch.addBox(x, 3.24 + i * roofRise, z, w, 0.27, depth + 1.05, i % 2 ? roofAltC : roofC);
    batch.addBox(x, 3.23 + i * roofRise, front + 0.56, w + 0.05, 0.1, 0.13, roofAltC);
    for (let t = z - depth / 2; t <= z + depth / 2; t += 0.62) {
      batch.addBox(x, 3.39 + i * roofRise, t, w - 0.12, 0.05, 0.07, roofAltC);
    }
    roofTop = 3.24 + i * roofRise;
  }
  const ridge = roofTop + 0.135;
  batch.addBox(x, ridge + 0.04, z, 0.42, 0.28, depth + 1.12, roofAltC);
  for (let t = z - depth / 2; t <= z + depth / 2; t += 0.62) {
    batch.addBox(x, ridge + 0.205, t, 0.48, 0.1, 0.48, roofC);
  }

  // ---- 老虎窗 / 山墙 ----
  if (dormer) {
    batch.addBox(x - width * 0.2, roofTop - 0.1, front - 0.1, 1.05, 0.95, 0.85, wallC);
    batch.addBox(x - width * 0.2, roofTop + 0.44, front - 0.08, 1.32, 0.22, 1.05, roofAltC);
    glass.addBox(x - width * 0.2, roofTop - 0.07, front + 0.36, 0.52, 0.56, 0.08, 0xffd88a);
    batch.addBox(x - width * 0.2, roofTop - 0.07, front + 0.42, 0.07, 0.58, 0.05, trimC);
  }
  if (gable) {
    batch.addBox(x, roofTop + 0.31, front + 0.64, 0.16, 1.2, 0.12, trimC);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        batch.addBox(x + s * (0.38 + i * 0.38), roofTop + 0.13 + i * 0.22, front + 0.64, 0.14, 0.65, 0.12, trimC);
      }
    }
  }

  // ---- 门 ----
  batch.addBox(x, 1.13, front + 0.12, 0.94, 1.94, 0.19, trimC);
  batch.addBox(x, 1.08, front + 0.23, 0.7, 1.78, 0.12, doorC);
  glass.addBox(x, 1.51, front + 0.3, 0.4, 0.43, 0.06, 0xf9cf82);
  glass.addBox(x + 0.22, 0.99, front + 0.33, 0.09, 0.09, 0.08, 0xf1c55f);
  batch.addBox(x, 0.17, front + 0.55, 1.25, 0.25, 0.85, 0xb6a082);
  batch.addBox(x, 0.075, front + 1, 1.48, 0.12, 0.45, 0xc6b291);

  // ---- 窗 ----
  if (width > 4.2) {
    addWindow(batch, glass, x - width * 0.29, 1.7, front + 0.09, shutterC, 0.86, windowStyle);
    addWindow(batch, glass, x + width * 0.29, 1.7, front + 0.09, shutterC, 0.86, windowStyle);
  } else {
    addWindow(batch, glass, x - width * 0.28, 1.7, front + 0.09, shutterC, 0.82, windowStyle);
  }
  addSideWindow(batch, glass, x + width / 2 + 0.06, 1.75, z + 0.15, shutterC);

  // ---- 烟囱 ----
  const chimneyX = x + width * 0.28;
  const chimneyZ = z - depth * 0.2;
  addChimney(batch, chimneyX, chimneyZ, roofTop);

  // ---- 雨棚（面包房）----
  if (awning) {
    for (let i = 0; i < 9; i++) {
      const ax = x - width * 0.43 + (i * width * 0.86) / 8;
      batch.addBox(ax, 2.65, front + 0.67, (width * 0.86) / 9 + 0.03, 0.16, 1.18, i % 2 ? 0xf8e2b0 : roofC);
      batch.addBox(ax, 2.48, front + 1.19, (width * 0.86) / 9 + 0.03, 0.28, 0.12, i % 2 ? 0xf8e2b0 : roofC);
    }
    for (const s of [-1, 1]) batch.addBox(x + s * width * 0.44, 1.32, front + 1.13, 0.11, 2.55, 0.11, trimC);
    batch.addBox(x + width / 2 + 0.5, 2.42, front - 0.45, 0.85, 0.72, 0.16, 0x76503a);
    batch.addBox(x + width / 2 + 0.5, 2.43, front - 0.34, 0.52, 0.28, 0.16, 0xe3aa57);
    batch.addBox(x + width / 2 + 0.35, 2.54, front - 0.23, 0.18, 0.12, 0.08, 0xf5d284);
  }

  // ---- 原木墙（木屋）----
  if (cabin) {
    for (let y = 0.72; y < 2.85; y += 0.38) {
      batch.addBox(x, y, front + 0.075, width - 0.18, 0.12, 0.1, y % 0.76 < 0.4 ? 0xa77b4f : 0x8d6747);
      batch.addBox(x + width / 2 + 0.075, y, z, 0.1, 0.12, depth - 0.15, 0x98704a);
    }
    for (let t = z - depth / 2 + 0.35; t < z + depth / 2; t += 0.65) {
      batch.addBox(x + width / 2 + 0.14, 0.72, t, 0.18, 0.24, 0.32, 0xc09562);
      batch.addBox(x + width / 2 + 0.14, 2.55, t, 0.18, 0.24, 0.32, 0xc09562);
    }
    batch.addBox(x, 0.2, front + 0.95, width + 0.65, 0.24, 1.65, 0x8b6543);
    for (let i = -3; i <= 3; i++) batch.addBox(x + i * 0.58, 0.34, front + 0.95, 0.08, 0.06, 1.58, 0xc0965e);
    for (const s of [-1, 1]) batch.addBox(x + s * width * 0.43, 1.43, front + 1.45, 0.18, 2.45, 0.18, 0x674b35);
    batch.addBox(x, 2.72, front + 0.85, width + 0.55, 0.2, 1.75, roofAltC);
    for (let i = -3; i <= 3; i++) batch.addBox(x + i * 0.55, 2.86, front + 0.85, 0.1, 0.08, 1.72, roofC);
    glass.addBox(x - 0.72, 1.85, front + 0.3, 0.28, 0.38, 0.25, 0xffd17a);
    // 门口木箱与小桌
    const rx = x + width / 2 + 0.85;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        batch.addBox(rx, 0.22 + i * 0.24, z - 0.9 + j * 0.32, 0.72, 0.22, 0.26, i % 2 ? 0x8a603e : 0xa47748);
      }
    }
    batch.addBox(rx + 0.85, 0.28, z + 0.3, 0.72, 0.5, 0.72, 0x7b5b3e);
    batch.addBox(rx + 0.85, 0.82, z + 0.3, 0.08, 0.85, 0.08, 0xa07b4d);
    batch.addBox(rx + 0.85, 1.18, z + 0.3, 0.42, 0.24, 0.12, 0x81908a);
  }

  addRectCollider(x, z, width + 0.5, depth + 0.5);
  return { roofTop };
}

/* ------------------------------------------------------------------ *
 * 广场喷泉
 * ------------------------------------------------------------------ */

export function buildFountain(batch, waterBatch, x, z, ripples) {
  batch.addBox(x, 0.07, z, 3.55, 0.14, 3.55, 0xa49482);
  batch.addBox(x, 0.19, z, 3.18, 0.3, 3.18, 0xb0a28a);
  batch.addBox(x, 0.39, z, 2.8, 0.28, 2.8, 0xd3c5a9);
  waterBatch.addBox(x, 0.54, z, 2.34, 0.12, 2.34, 0x3e9fa8);
  for (const s of [-1, 1]) {
    batch.addBox(x + s * 1.34, 0.65, z, 0.3, 0.58, 2.85, 0xc2b59a);
    batch.addBox(x, 0.65, z + s * 1.34, 2.85, 0.58, 0.3, 0xc2b59a);
    for (const t of [-1, 1]) {
      batch.addBox(x + s * 1.34, 1.02, z + t * 1.34, 0.38, 0.82, 0.38, 0xd9cdb4);
      batch.addBox(x + s * 1.34, 1.48, z + t * 1.34, 0.48, 0.14, 0.48, 0xefe1c2);
    }
  }
  batch.addBox(x, 0.96, z, 0.72, 1.3, 0.72, 0xa99a80);
  batch.addBox(x, 1.61, z, 1.32, 0.25, 1.32, 0xd1c3a5);
  waterBatch.addBox(x, 1.77, z, 1, 0.09, 1, 0x63b9b4);
  batch.addBox(x, 2.14, z, 0.34, 0.76, 0.34, 0xb6a88d);
  batch.addBox(x, 2.56, z, 0.62, 0.22, 0.62, 0xd8c9a8);
  batch.addBox(x, 2.79, z, 0.2, 0.36, 0.2, 0xd7b562);
  batch.addBox(x, 3.01, z + 0.08, 0.42, 0.2, 0.38, 0xe5c977);
  batch.addBox(x + 0.23, 3.02, z + 0.17, 0.18, 0.12, 0.24, 0xf1d98c);
  // 池边的石砖
  for (let i = -2; i <= 2; i++) {
    for (const s of [-1, 1]) {
      batch.addBox(x + i * 0.83, 0.125, z + s * 2.02, 0.56, 0.05, 0.22, 0xa68a72);
      batch.addBox(x + s * 2.02, 0.125, z + i * 0.83, 0.22, 0.05, 0.56, 0xa68a72);
    }
  }
  addRectCollider(x, z, 3.5, 3.5);
  // 环形小水柱
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ripples.push({ x: x + Math.cos(a) * 0.63, z: z + Math.sin(a) * 0.63, angle: a, phase: i / 12 });
  }
}

/* ------------------------------------------------------------------ *
 * 告示牌（带 canvas 文字）
 * ------------------------------------------------------------------ */

function makeTextTexture(text, bg = 0x6f4934, fg = 0xffe0a0) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const toCss = (n) => '#' + n.toString(16).padStart(6, '0');
  ctx.fillStyle = toCss(bg);
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = toCss(fg);
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 484, 164);
  ctx.fillStyle = toCss(fg);
  ctx.font = 'bold 96px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 101);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildSignTexture(text) {
  return makeTextTexture(text);
}

export function buildSign(batch, x, z) {
  batch.addBox(x, 0.11, z, 1.85, 0.2, 0.66, 0xb3a28a);
  for (const s of [-1, 1]) batch.addBox(x + s * 0.56, 0.87, z, 0.18, 1.65, 0.18, 0x76533a);
  batch.addBox(x, 1.52, z, 1.55, 1.02, 0.18, 0x9c7045);
  batch.addBox(x, 1.52, z + 0.12, 1.27, 0.77, 0.08, 0xefd8a4);
  batch.addBox(x + 0.18, 1.35, z + 0.18, 0.67, 0.055, 0.04, 0xb78a63);
  batch.addBox(x - 0.16, 1.22, z + 0.18, 0.7, 0.05, 0.04, 0xb78a63);
  batch.addBox(x, 2.09, z, 1.82, 0.18, 0.52, 0x7b8f59);
  batch.addBox(x, 2.22, z, 1.35, 0.12, 0.43, 0x91a66a);
  addRectCollider(x, z, 1.9, 0.7);
  const tex = makeTextTexture('公告', 0x6f4934, 0xffe0a0);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.56),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  );
  panel.position.set(x, 1.69, z + 0.2);
  panel.scale.set(1, 1, 1);
  return panel;
}

/* ------------------------------------------------------------------ *
 * 长椅 / 路灯 / 花箱 / 木箱 / 木桶 / 栅栏
 * ------------------------------------------------------------------ */

export function buildBench(batch, x, z, rot = 0) {
  const flipped = Math.abs(Math.sin(rot)) < 0.5;
  const col = x > 10 ? 0x8f6a43 : 0xa97b4a;
  const light = x > 10 ? 0xb18a54 : 0xc3955b;
  blob(batch, x, z, 1.9, 0.6);
  for (let i = -1; i <= 1; i++) {
    batch.addBox(flipped ? x : x + i * 0.15, 0.65, flipped ? z + i * 0.15 : z,
      flipped ? 1.9 : 0.13, 0.14, flipped ? 0.13 : 1.9, light);
  }
  const ax = flipped ? x : x - 0.23;
  const az = flipped ? z - 0.23 : z;
  for (const y of [0.98, 1.25]) {
    batch.addBox(ax, y, az, flipped ? 1.9 : 0.12, 0.16, flipped ? 0.12 : 1.9, col);
  }
  for (const s of [-1, 1]) {
    batch.addBox(flipped ? x + s * 0.68 : x, 0.34, flipped ? z : z + s * 0.68, 0.16, 0.62, 0.16, 0x675441);
    batch.addBox(flipped ? ax + s * 0.68 : ax, 0.99, flipped ? az : az + s * 0.68, 0.14, 0.82, 0.14, 0x675441);
    batch.addBox(flipped ? x + s * 0.78 : x - 0.23, 0.9, flipped ? z - 0.23 : z + s * 0.78,
      flipped ? 0.16 : 0.58, 0.12, flipped ? 0.58 : 0.16, col);
  }
  addRectCollider(x, z, flipped ? 1.9 : 0.7, flipped ? 0.7 : 1.9);
}

export function buildLamp(batch, glass, x, z, withLight = false) {
  batch.addBox(x, 0.15, z, 0.48, 0.28, 0.48, 0x7a7160);
  batch.addBox(x, 1.45, z, 0.16, 2.7, 0.16, 0x5f5847);
  batch.addBox(x, 2.77, z, 0.52, 0.12, 0.52, 0x6e5b45);
  glass.addBox(x, 3.13, z, 0.43, 0.64, 0.43, 0xffd894);
  batch.addBox(x, 3.13, z, 0.56, 0.72, 0.56, 0xd8c99b);
  // 灯笼外框
  for (const n of [-1, 1]) {
    batch.addBox(x + n * 0.24, 3.13, z, 0.07, 0.68, 0.49, 0x6c5943);
    batch.addBox(x, 3.13, z + n * 0.24, 0.49, 0.68, 0.07, 0x6c5943);
  }
  batch.addBox(x, 3.49, z, 0.66, 0.14, 0.66, 0x6b5a45);
  batch.addBox(x, 3.62, z, 0.4, 0.14, 0.4, 0x816a4c);
  batch.addBox(x, 3.76, z, 0.16, 0.18, 0.16, 0x5f5847);
  batch.addBox(x, 2.69, z, 0.34, 0.1, 0.34, 0x5f5847);
  addRectCollider(x, z, 0.5, 0.5);
  if (withLight) {
    return new THREE.PointLight(0xffc875, 1.2, 5.5, 2);
  }
  return null;
}

export function buildCrate(batch, x, z, size = 0.75, rot = 0) {
  blob(batch, x, z, size, size);
  batch.addBox(x, size / 2 + 0.08, z, size, size, size, 0xa87546, rot);
  batch.addBox(x, size / 2 + 0.08, z + size / 2 + 0.025, size + 0.05, 0.1, 0.07, 0x6e4d35, rot);
  batch.addBox(x, size / 2 + 0.08, z + size / 2 + 0.03, 0.09, size, 0.07, 0x795237, rot);
  for (const n of [size * 0.28, size * 0.72]) {
    batch.addBox(x, n + 0.08, z + size / 2 + 0.035, size * 0.82, 0.045, 0.05, 0xc18b54, rot);
    batch.addBox(x + size / 2 + 0.035, n + 0.08, z, 0.05, 0.045, size * 0.82, 0xb7834e, rot);
  }
  batch.addBox(x, size * 0.56 + 0.08, z + size / 2 + 0.07, 0.16, 0.18, 0.06, 0xd1b06b, rot);
  batch.addBox(x, size * 0.56 + 0.08, z + size / 2 + 0.105, 0.06, 0.08, 0.035, 0x6c6254, rot);
  batch.addBox(x, size + 0.11, z, size + 0.05, 0.09, size + 0.05, 0xc18c51, rot);
  addRectCollider(x, z, size + 0.1, size + 0.1, rot);
}

export function buildBarrel(batch, x, z) {
  blob(batch, x, z, 0.66, 0.66);
  batch.addBox(x, 0.49, z, 0.66, 0.85, 0.66, 0x9b6a42);
  batch.addBox(x, 0.27, z, 0.72, 0.12, 0.72, 0x625347);
  batch.addBox(x, 0.7, z, 0.72, 0.12, 0.72, 0x625347);
  batch.addBox(x, 0.94, z, 0.62, 0.09, 0.62, 0xbd8c54);
  addRectCollider(x, z, 0.72, 0.72);
}

export function buildFence(batch, x1, z1, x2, z2, n) {
  const axisX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  const len = Math.abs(axisX ? x2 - x1 : z2 - z1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    batch.addBox(x, 0.65, z, 0.18, 1.25, 0.18, 0x8a6544);
    batch.addBox(x, 1.31, z, 0.25, 0.12, 0.25, 0xb38a56);
  }
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  for (const y of [0.55, 0.98]) {
    batch.addBox(cx, y, cz, axisX ? len : 0.13, 0.14, axisX ? 0.13 : len, 0xb48a56);
  }
  addRectCollider(cx, cz, axisX ? len : 0.3, axisX ? 0.3 : len);
}

/** 花箱：木框 + 一丛花 */
export function buildPlanter(batch, x, z, w, d, rng, flowerColor) {
  blob(batch, x, z, w, d);
  batch.addBox(x, 0.14, z, w, 0.25, d, 0x866244);
  batch.addBox(x, 0.28, z, w - 0.22, 0.08, d - 0.22, 0x66523d);
  for (const s of [-1, 1]) {
    batch.addBox(x + s * (w / 2 - 0.06), 0.31, z, 0.12, 0.18, d, 0xa47a4e);
    batch.addBox(x, 0.31, z + s * (d / 2 - 0.06), w, 0.18, 0.12, 0xa47a4e);
  }
  const count = Math.min(10, Math.floor(w * d * 4));
  for (let i = 0; i < count; i++) {
    const fx = x + (rng() - 0.5) * (w - 0.4);
    const fz = z + (rng() - 0.5) * (d - 0.35);
    const h = 0.28 + rng() * 0.2;
    batch.addBox(fx, h / 2 + 0.05, fz, 0.055, h, 0.055, 0x547c4c);
    batch.addBox(fx - 0.1, h * 0.48 + 0.05, fz, 0.22, 0.08, 0.13, 0x6d9658, -0.35);
    batch.addBox(fx + 0.1, h * 0.65 + 0.05, fz + 0.03, 0.22, 0.08, 0.13, 0x7da363, 0.35);
    const col = i % 4 === 0 ? flowerColor : [0xf1bd58, 0xe88783, 0xb39aca][i % 3];
    batch.addBox(fx, h + 0.1, fz, 0.15, 0.13, 0.15, col);
    batch.addBox(fx, h + 0.19, fz, 0.06, 0.05, 0.06, 0xfdf2cf);
  }
  addRectCollider(x, z, w, d);
}

export { makeTextTexture };
