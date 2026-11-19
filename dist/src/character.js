import * as THREE from 'three';
import { MeshBatch } from './util.js?v=1.8.14';

/* ------------------------------------------------------------------ *
 * 方块小人：总高约 2.2，头大、四肢短
 * 本地坐标：脚底 y=0，正面朝 +z
 * ------------------------------------------------------------------ */

const SKIN = 0xefb88e;
const SHOE = 0x654b3b;

function part(colorHexes, material) {
  const b = new MeshBatch();
  for (const [x, y, z, w, h, d, hex] of colorHexes) b.addBox(x, y, z, w, h, d, hex);
  const m = b.build(material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * @param {THREE.Material} material
 * @param {{shirt?:number,pants?:number,accent?:number,hair?:number,hat?:number,
 *          skirt?:boolean,rode?:boolean,staff?:boolean,backpack?:boolean}} opt
 */
export function createCharacter(material, opt = {}) {
  const shirt = opt.shirt ?? 0xe8eee0;
  const pants = opt.pants ?? 0x607d86;
  const accent = opt.accent ?? 0xc56f50;
  const hair = opt.hair ?? 0x654b3d;
  const scale = opt.scale ?? 1;

  const root = new THREE.Group();
  const visual = new THREE.Group();
  root.add(visual);

  // ---- 腿（带轴心，便于摆动）----
  const makeLeg = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.19, 0.48, 0);
    pivot.add(part([
      [0, -0.22, 0, 0.27, 0.46, 0.31, pants],
      [0.07, -0.43, 0, 0.16, 0.31, 0.43, SHOE],
    ], material));
    return pivot;
  };
  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);
  visual.add(leftLeg, rightLeg);

  // ---- 躯干 ----
  const torso = part([
    [0, 0.87, 0, 0.76, 0.72, 0.48, shirt],
    [0, 1.02, 0.255, 0.42, 0.25, 0.04, accent],
  ], material);
  visual.add(torso);

  // ---- 手臂 ----
  const makeArm = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.49, 1.12, 0);
    pivot.add(part([
      [0, -0.26, 0, 0.24, 0.57, 0.29, shirt],
      [0, -0.57, 0, 0.22, 0.18, 0.25, SKIN],
    ], material));
    return pivot;
  };
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);
  visual.add(leftArm, rightArm);

  // ---- 头 ----
  const headParts = [
    [0, 1.55, 0, 0.74, 0.7, 0.68, SKIN],
    [0, 1.91, -0.02, 0.8, 0.18, 0.72, hair],
    [-0.34, 1.7, -0.03, 0.16, 0.43, 0.71, hair],
    [0.34, 1.73, -0.05, 0.14, 0.36, 0.68, hair],
    [0, 1.67, -0.34, 0.69, 0.5, 0.13, hair],
    [0, 1.82, 0.3, 0.6, 0.14, 0.12, hair],
    [-0.18, 1.59, 0.35, 0.09, 0.12, 0.055, 0x453b35],
    [0.18, 1.59, 0.35, 0.09, 0.12, 0.055, 0x453b35],
    [-0.29, 1.45, 0.35, 0.12, 0.07, 0.045, 0xdf8e7e],
    [0.29, 1.45, 0.35, 0.12, 0.07, 0.045, 0xdf8e7e],
    [0, 1.4, 0.36, 0.12, 0.045, 0.04, 0xb66f60],
  ];
  if (opt.hat !== undefined) {
    headParts.push(
      [0, 2.02, 0, 1.03, 0.12, 0.9, opt.hat],
      [0, 2.19, -0.03, 0.7, 0.3, 0.65, opt.hat],
      [0, 2.08, 0.34, 0.72, 0.1, 0.08, accent]
    );
  }
  if (opt.skirt) {
    headParts.push(
      [-0.45, 1.83, -0.08, 0.28, 0.3, 0.32, hair],
      [0.45, 1.83, -0.08, 0.28, 0.3, 0.32, hair]
    );
  }
  const head = part(headParts, material);
  visual.add(head);

  // ---- 服饰小配件 ----
  const extras = [];
  if (opt.skirt) {
    extras.push([0, 0.62, 0, 0.88, 0.42, 0.58, 0xc97570]);
    extras.push([0, 1.2, 0.29, 0.54, 0.1, 0.05, 0xf3cf7d]);
  }
  if (opt.backpack) {
    extras.push([0, 0.96, -0.35, 0.62, 0.62, 0.25, 0xa66c45]);
    extras.push([0, 1.03, -0.5, 0.42, 0.14, 0.08, 0xdfad63]);
    extras.push([0, 0.65, 0, 0.84, 0.22, 0.56, 0xd8e1d1]);
    extras.push([0, 1.2, 0.28, 0.54, 0.13, 0.06, 0xc56f50]);
  }
  if (opt.staff) {
    extras.push([0.68, 0.97, 0.05, 0.08, 1.65, 0.08, 0x8b6844]);
    extras.push([0.68, 1.78, 0.05, 0.5, 0.09, 0.09, 0x78827a]);
  }
  if (opt.rod) {
    extras.push([0.68, 0.97, 0.05, 0.08, 1.65, 0.08, 0x76563b]);
    extras.push([0.76, 1.69, 0.08, 0.25, 0.09, 0.09, 0x76563b]);
  }
  if (extras.length) visual.add(part(extras, material));

  root.scale.setScalar(scale);
  const shadow = new MeshBatch();
  shadow.addBox(0, -0.035, 0, 0.82, 0.02, 0.65, 0x314d46);
  const shadowMesh = shadow.build(new THREE.MeshBasicMaterial({
    color: 0x314d46, transparent: true, opacity: 0.18, depthWrite: false,
  }));
  shadowMesh.renderOrder = 1;
  root.add(shadowMesh);

  return { root, visual, head, leftArm, rightArm, leftLeg, rightLeg, shadow: shadowMesh };
}

export function animateWalk(rig, phase, s, time) {
  const swing = 0.55 * s;
  rig.leftLeg.rotation.x = Math.sin(phase) * swing;
  rig.rightLeg.rotation.x = -Math.sin(phase) * swing;
  rig.leftArm.rotation.x = -Math.sin(phase) * swing * 0.75;
  rig.rightArm.rotation.x = Math.sin(phase) * swing * 0.75;
  rig.visual.position.y = Math.abs(Math.sin(phase)) * 0.055 * s + Math.sin(time * 2) * 0.006;
  void rig.head;
}

export function animateIdle(rig, time, phase = 0) {
  const b = Math.sin(time * 1.6 + phase);
  rig.visual.position.y = b * 0.014;
  rig.leftLeg.rotation.x = 0;
  rig.rightLeg.rotation.x = 0;
  rig.leftArm.rotation.x = b * 0.045;
  rig.rightArm.rotation.x = -b * 0.045;
  rig.leftArm.rotation.z = 0.04;
  rig.rightArm.rotation.z = -0.04;
  void rig.head;
}
