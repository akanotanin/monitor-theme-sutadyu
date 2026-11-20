import { MAP, WALKWAYS, isInRiver, isOnBridge, groundHeightAt } from './config.js?v=1.8.16';

/* ------------------------------------------------------------------ *
 * 碰撞登记表（矩形 / 圆），玩家按轴移动时统一查询
 * ------------------------------------------------------------------ */

const rects = [];
const circles = [];

export function addRectCollider(cx, cz, w, d, rotY = 0) {
  if (Math.abs(rotY) < 1e-4) {
    rects.push({ x1: cx - w / 2, z1: cz - d / 2, x2: cx + w / 2, z2: cz + d / 2 });
    return;
  }
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  const hw = (w * c + d * s) / 2;
  const hd = (w * s + d * c) / 2;
  rects.push({ x1: cx - hw, z1: cz - hd, x2: cx + hw, z2: cz + hd });
}

export function addRectColliderMinMax(x1, z1, x2, z2) {
  rects.push({
    x1: Math.min(x1, x2), z1: Math.min(z1, z2),
    x2: Math.max(x1, x2), z2: Math.max(z1, z2),
  });
}

export function addCircleCollider(cx, cz, r) {
  circles.push({ x: cx, z: cz, r });
}

export function debugColliderCount() {
  return { rects: rects.length, circles: circles.length };
}

function hitsSolid(x, z, r) {
  for (let i = 0; i < rects.length; i++) {
    const b = rects[i];
    if (x > b.x1 - r && x < b.x2 + r && z > b.z1 - r && z < b.z2 + r) return true;
  }
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const dx = x - c.x;
    const dz = z - c.z;
    const rr = c.r + r;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

export function isOnWalkway(x, z) {
  for (let i = 0; i < WALKWAYS.length; i++) {
    const w = WALKWAYS[i];
    if (x > w.x1 && x < w.x2 && z > w.z1 && z < w.z2) return w;
  }
  return null;
}

export function groundHeight(x, z) {
  return groundHeightAt(x, z);
}

/**
 * 这个位置能不能站人
 * @param {number} x
 * @param {number} z
 * @param {number} r 角色半径
 */
export function isWalkable(x, z, r = 0.34) {
  if (x < MAP.x1 + r || x > MAP.x2 - r || z < MAP.z1 + r || z > MAP.z2 - r) return false;
  if (hitsSolid(x, z, r)) return false;
  if (isOnWalkway(x, z) || isOnBridge(x, z)) return true;
  // 河判定带上角色半径：纯点测会让「半个身子悬在水面上」也算可走（1.8.15 的小鸡就踩过这个坑）
  if (isInRiver(x, z, r)) return false;
  return true;
}
