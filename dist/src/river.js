import * as THREE from 'three';
import { MeshBatch, mulberry32 } from './util.js?v=1.8.14';
import { C, MAP, RIVER, BRIDGE } from './config.js?v=1.8.14';
import { addRectCollider, addRectColliderMinMax } from './collision.js?v=1.8.14';

/* ------------------------------------------------------------------ *
 * 溪流 + 木桥 + 河边的石头、芦苇、睡莲、小鸭
 * ------------------------------------------------------------------ */

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vWave;
  void main() {
    vec3 p = position;
    float w1 = sin(p.z * 1.6 + uTime * 1.1) * 0.02;
    float w2 = sin(p.x * 4.2 - uTime * 1.6 + p.z * 0.7) * 0.012;
    p.y += w1 + w2;
    vWave = w1 + w2;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vWave;
  void main() {
    float across = abs(vUv.x - 0.5) * 2.0;
    vec3 deep = vec3(0.10, 0.42, 0.46);
    vec3 shallow = vec3(0.30, 0.66, 0.63);
    float flow = sin(vUv.y * 40.0 - uTime * 0.7) * 0.5 + 0.5;
    float sparkle = pow(flow, 16.0) * 0.22;
    vec3 col = mix(deep, shallow, 0.30 + across * 0.45 + vWave * 3.0);
    col += vec3(1.0, 0.99, 0.92) * sparkle;
    float edge = 1.0 - smoothstep(0.0, 0.06, min(vUv.x, 1.0 - vUv.x));
    col = mix(col, vec3(0.62, 0.80, 0.78), edge * 0.45);
    gl_FragColor = vec4(col, 0.92);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildWater() {
  const geo = new THREE.PlaneGeometry(RIVER.halfWidth * 2 + 0.04, MAP.z2 - MAP.z1 + 1.8, 8, 90);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(RIVER.centerX, RIVER.waterY, 0);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}

function buildBridge(batch) {
  const { x1, x2, z1, z2 } = BRIDGE;
  const deckY = 0.23;
  const cx = (x1 + x2) / 2;
  const half = (x2 - x1) / 2;
  // 桥面木板
  for (let x = x1; x <= x2 + 0.01; x += 0.42) {
    batch.addBox(x, deckY, 0, 0.38, 0.18, 3.08, C.woodLight[Math.floor(Math.abs(x * 7) % 3)]);
    batch.addBox(x, 0.325, z1 + 0.42, 0.07, 0.025, 0.07, 0x675441);
    batch.addBox(x, 0.325, z2 - 0.42, 0.07, 0.025, 0.07, 0x675441);
  }
  // 两侧栏杆（跟着桥长走，别写死）
  for (const s of [-1, 1]) {
    const z = s * 1.55;
    batch.addBox(cx, 0.76, z, half * 2 + 0.25, 0.16, 0.16, C.woodDark);
    batch.addBox(cx, 1.17, z, half * 2 + 0.25, 0.14, 0.14, C.woodMid);
    for (let x = x1; x <= x2 + 0.1; x += 1.18) {
      batch.addBox(x, 0.75, z, 0.2, 1.28, 0.2, 0x6f533b);
      batch.addBox(x, 1.43, z, 0.29, 0.13, 0.29, 0xb58c57);
    }
    addRectColliderMinMax(x1 - 0.1, z - 0.16, x2 + 0.1, z + 0.16);
  }
  // 桥头踏石
  batch.addBox(x1 - 0.23, 0.11, 0, 0.48, 0.17, 2.9, 0xb69a6f);
  batch.addBox(x2 + 0.23, 0.11, 0, 0.48, 0.17, 2.9, 0xb69a6f);
}

/** 河岸边的小石头、芦苇、睡莲 */
function buildBanks(batch, rng) {
  const bankL = RIVER.centerX - RIVER.halfWidth - 0.12;   // 岸石贴在水边
  const bankR = RIVER.centerX + RIVER.halfWidth + 0.12;
  for (let z = MAP.z1 - 0.4; z <= MAP.z2 + 0.4; z += 1) {
    batch.addBox(bankL, -0.13, z, 0.42, 0.42, 0.96, C.bankStone[Math.floor(rng() * 3)]);
    batch.addBox(bankR, -0.13, z, 0.42, 0.42, 0.96, C.bankStone[Math.floor(rng() * 3)]);
    if (Math.abs(z) > 2.1 && rng() < 0.42) {
      const x = rng() > 0.5 ? bankL - 0.25 : bankR + 0.25;
      batch.addBox(x, 0.22, z, 0.08, 0.58 + rng() * 0.3, 0.08, 0x698553);
      batch.addBox(x + 0.13, 0.14, z + 0.14, 0.07, 0.4, 0.07, 0x809b57);
      batch.addBox(x, 0.52, z, 0.13, 0.27, 0.13, 0x96704c);
    }
  }
  // 水边的睡莲（相对河心摆放，河挪了它们跟着挪）
  const lilies = [
    [RIVER.centerX - 0.85, -5.5], [RIVER.centerX + 0.65, 4.2],
    [RIVER.centerX - 0.65, 11.8], [RIVER.centerX + 0.75, -12.4],
  ];
  for (const [x, z] of lilies) {
    batch.addBox(x, -0.18, z, 0.48, 0.045, 0.42, 0x5c8e68);
    batch.addBox(x + 0.16, -0.13, z + 0.08, 0.18, 0.12, 0.18, 0xe7a5ae);
  }
}

/** 小河上漂的小鸭子 */
function buildDuck(material, x, z) {
  const g = new THREE.Group();
  const b = new MeshBatch();
  b.addBox(0, 0.13, 0, 0.52, 0.34, 0.68, 0xdfc78f);
  b.addBox(0, 0.39, 0.25, 0.34, 0.38, 0.34, 0xf1dfb3);
  b.addBox(0, 0.37, 0.52, 0.3, 0.14, 0.25, 0xd98b3e);
  b.addBox(-0.11, 0.46, 0.41, 0.07, 0.075, 0.045, 0x403c35);
  b.addBox(0.11, 0.46, 0.41, 0.07, 0.075, 0.045, 0x403c35);
  const mesh = b.build(material);
  mesh.castShadow = true;
  g.add(mesh);
  g.position.set(x, RIVER.waterY, z);
  g.rotation.y = z > 0 ? 0 : Math.PI;
  g.userData.startZ = z;
  return g;
}

export function buildRiver(voxelMaterial) {
  const rng = mulberry32(20241117);
  const group = new THREE.Group();

  const water = buildWater();
  group.add(water);

  const batch = new MeshBatch();
  buildBridge(batch);
  buildBanks(batch, rng);
  const mesh = batch.build(voxelMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // 水面上的细碎波纹
  const rippleBatch = new MeshBatch();
  const rippleSeeds = [];
  for (let i = 0; i < 26; i++) {
    const w = 0.35 + rng() * 0.7;
    const d = 0.08 + rng() * 0.14;
    const x = RIVER.centerX - 1.2 + rng() * 2.4;
    const z = MAP.z1 + rng() * (MAP.z2 - MAP.z1);
    rippleBatch.addBox(x, 0.01, z, w, 0.018, d, 0x83bdb6);
    rippleSeeds.push({ z, speed: 0.32 + rng() * 0.35, x });
  }
  const rippleMesh = rippleBatch.build(new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false,
  }));
  rippleMesh.position.y = RIVER.waterY;
  rippleMesh.renderOrder = 4;
  group.add(rippleMesh);

  const cx = RIVER.centerX;
  const ducks = [buildDuck(voxelMaterial, cx - 0.35, 5.4), buildDuck(voxelMaterial, cx + 0.45, -7.2)];
  for (const d of ducks) group.add(d);

  return {
    group,
    update(time) {
      water.material.uniforms.uTime.value = time;
      // 波纹沿河缓慢流动：整体轻微平移，靠 shader 已经足够，这里只做微动
      rippleMesh.position.x = Math.sin(time * 0.4) * 0.05;
      for (let i = 0; i < ducks.length; i++) {
        const d = ducks[i];
        const start = d.userData.startZ;
        d.position.z = start + Math.sin(time * 0.16 + i * 1.7) * 2.2;
        d.position.y = RIVER.waterY + Math.sin(time * 1.6 + i) * 0.025;
        d.rotation.z = Math.sin(time * 1.1 + i) * 0.04;
      }
    },
  };
}

export { WATER_FRAG };
