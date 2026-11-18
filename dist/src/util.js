import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * 数学小工具
 * ------------------------------------------------------------------ */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** 与帧率无关的平滑跟随 */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 确定性伪随机（同一格子永远同一个值），用于地块颜色变化 */
export function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/** 可复现的随机数发生器 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 取两个角度之间的最短差 */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(a, b, lambda, dt) {
  return a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
}

/* ------------------------------------------------------------------ *
 * MeshBatch：把成千上万个小方块合并成一次 draw call。
 * 每个方块写入 24 个顶点 + 36 个索引，并带顶点色。
 * ------------------------------------------------------------------ */

const _boxGeo = new THREE.BoxGeometry(1, 1, 1);
const _boxPos = _boxGeo.getAttribute('position').array;
const _boxNor = _boxGeo.getAttribute('normal').array;
const _boxIdx = _boxGeo.getIndex().array;

const _m4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scaleV = new THREE.Vector3();
const _posV = new THREE.Vector3();
const _normalM = new THREE.Matrix3();
const _tmpN = new THREE.Vector3();
const _color = new THREE.Color();

export class MeshBatch {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
    this.vertCount = 0;
  }

  get isEmpty() {
    return this.vertCount === 0;
  }

  /** 颜色统一按 sRGB 写入（THREE 会自动转到线性工作空间） */
  _pushColor(hex) {
    _color.setHex(hex);
    const { r, g, b } = _color;
    for (let i = 0; i < 24; i++) this.col.push(r, g, b);
  }

  /**
   * 追加一个长方体
   * @param {number} cx 中心 x
   * @param {number} cy 中心 y
   * @param {number} cz 中心 z
   * @param {number} sx 宽 (x)
   * @param {number} sy 高 (y)
   * @param {number} sz 深 (z)
   * @param {number} hex 颜色
   * @param {number} rotY 绕 y 轴旋转
   */
  addBox(cx, cy, cz, sx, sy, sz, hex, rotY = 0) {
    _posV.set(cx, cy, cz);
    _euler.set(0, rotY, 0);
    _quat.setFromEuler(_euler);
    _scaleV.set(sx, sy, sz);
    _m4.compose(_posV, _quat, _scaleV);
    _normalM.getNormalMatrix(_m4);

    const base = this.vertCount;
    _color.setHex(hex);
    const cr = _color.r, cg = _color.g, cb = _color.b;
    for (let i = 0; i < 24; i++) {
      const x = _boxPos[i * 3];
      const y = _boxPos[i * 3 + 1];
      const z = _boxPos[i * 3 + 2];
      _posV.set(x, y, z).applyMatrix4(_m4);
      this.pos.push(_posV.x, _posV.y, _posV.z);

      _tmpN.set(_boxNor[i * 3], _boxNor[i * 3 + 1], _boxNor[i * 3 + 2]).applyMatrix3(_normalM).normalize();
      this.nor.push(_tmpN.x, _tmpN.y, _tmpN.z);

      this.col.push(cr, cg, cb);
    }
    for (let i = 0; i < _boxIdx.length; i++) this.idx.push(base + _boxIdx[i]);
    this.vertCount += 24;
    return this;
  }

  /** 底部在 y 上的方块（更好摆放） */
  addBoxAt(x, yBase, z, sx, sy, sz, hex, rotY = 0) {
    return this.addBox(x, yBase + sy / 2, z, sx, sy, sz, hex, rotY);
  }

  /**
   * 追加一个棱柱（圆柱近似），用于灯柱、木桶、树干等
   * @param {number} cx 中心 x
   * @param {number} yBase 底面 y
   * @param {number} cz 中心 z
   * @param {number} radius 半径
   * @param {number} height 高
   * @param {number} sides 边数
   * @param {number} hex 颜色
   * @param {number} rotY 旋转
   * @param {number} [topR] 顶部半径（可做成圆台）
   */
  addPrism(cx, yBase, cz, radius, height, sides, hex, rotY = 0, topR = radius) {
    const base = this.vertCount;
    const top = yBase + height;
    _color.setHex(hex);
    const r = _color.r, g = _color.g, b = _color.b;

    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = rotY + (i / sides) * Math.PI * 2;
      ring.push([Math.cos(a), Math.sin(a)]);
    }

    // 侧面
    for (let i = 0; i < sides; i++) {
      const [c0, s0] = ring[i];
      const [c1, s1] = ring[(i + 1) % sides];
      const ax = cx + c0 * radius, az = cz + s0 * radius;
      const bx = cx + c1 * radius, bz = cz + s1 * radius;
      const tx = cx + c0 * topR, tz = cz + s0 * topR;
      const ux = cx + c1 * topR, uz = cz + s1 * topR;
      const nx = (c0 + c1) / 2, nz = (s0 + s1) / 2;
      const nl = Math.hypot(nx, nz) || 1;
      const verts = [
        [ax, yBase, az], [bx, yBase, bz], [ux, top, uz],
        [ax, yBase, az], [ux, top, uz], [tx, top, tz],
      ];
      for (const v of verts) {
        this.pos.push(v[0], v[1], v[2]);
        this.nor.push(nx / nl, 0, nz / nl);
        this.col.push(r, g, b);
      }
      this.vertCount += 6;
    }

    // 顶面 / 底面
    for (const isTop of [true, false]) {
      const y = isTop ? top : yBase;
      const rr = isTop ? topR : radius;
      const ny = isTop ? 1 : -1;
      const centerIdx = this.vertCount;
      this.pos.push(cx, y, cz);
      this.nor.push(0, ny, 0);
      this.col.push(r, g, b);
      this.vertCount += 1;
      for (let i = 0; i < sides; i++) {
        const a0 = rotY + (i / sides) * Math.PI * 2;
        const a1 = rotY + ((i + 1) / sides) * Math.PI * 2;
        this.pos.push(cx + Math.cos(a0) * rr, y, cz + Math.sin(a0) * rr);
        this.pos.push(cx + Math.cos(a1) * rr, y, cz + Math.sin(a1) * rr);
        this.nor.push(0, ny, 0, 0, ny, 0);
        this.col.push(r, g, b, r, g, b);
        this.vertCount += 2;
        if (isTop) this.idx.push(centerIdx, centerIdx + 1 + i * 2, centerIdx + 2 + i * 2);
        else this.idx.push(centerIdx, centerIdx + 2 + i * 2, centerIdx + 1 + i * 2);
      }
    }
    return this;
  }

  /** 生成 BufferGeometry */
  buildGeometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  /** 生成 Mesh */
  build(material) {
    return new THREE.Mesh(this.buildGeometry(), material);
  }
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 用 canvas 画一张竖向渐变的天空贴图，省去外部素材 */
export function makeSkyTexture(colors) {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  colors.forEach(([stop, color]) => grad.addColorStop(stop, color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** 圆形柔光贴图（用于花粉 / 萤火虫粒子） */
export function makeGlowTexture(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,246,220,0.75)');
  grad.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 点到折线的最短距离 */
export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = 0;
    if (lenSq > 1e-6) t = clamp(((x - ax) * dx + (z - az) * dz) / lenSq, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}
