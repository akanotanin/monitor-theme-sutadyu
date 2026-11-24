import * as THREE from 'three';
import { MeshBatch, mulberry32, damp } from './util.js';
import { C, MAP, RIVER, BRIDGE } from './config.js';
import { addRectCollider, addRectColliderMinMax } from './collision.js';

/* ------------------------------------------------------------------ *
 * 溪流 + 木桥 + 河边的石头、芦苇、睡莲、小鸭
 * ------------------------------------------------------------------ */

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  varying vec2 vUv;
  varying float vWave;
  varying vec3 vWorld;
  void main() {
    vec3 p = position;
    // 流速快 -> 波也跑得急一点，但幅度不变（不然流量一大河就翻涌，太吵）
    float w1 = sin(p.z * 1.6 + uTime * (1.1 * uFlow)) * 0.02;
    float w2 = sin(p.x * 4.2 - uTime * (1.6 * uFlow) + p.z * 0.7) * 0.012;
    p.y += w1 + w2;
    vWave = w1 + w2;
    vUv = uv;
    // ★桥下遮蔽要在「世界坐标」里算：UV 的中心/朝向经过 rotateX 之后很容易搞反，
    //   直接拿世界 xz 判断跟配置里的 BRIDGE 数值是同一套坐标，不会错。
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  uniform float uNight;   // 0 = 正午，1 = 深夜（由昼夜相位驱动）
  uniform float uLamp;    // 0 = 白天路灯全灭，1 = 深夜全亮
  // 桥在河面上的遮蔽区（世界 xz 矩形 + 柔化半径）
  uniform float uBridgeX1;
  uniform float uBridgeX2;
  uniform float uBridgeZ1;
  uniform float uBridgeZ2;
  uniform float uAoStrength;   // 桥下遮蔽强度：1 = 正常，0 = 关闭（A/B 对比与降级用）
  varying vec2 vUv;
  varying float vWave;
  varying vec3 vWorld;
  void main() {
    float across = abs(vUv.x - 0.5) * 2.0;
    vec3 deep = vec3(0.10, 0.42, 0.46);
    vec3 shallow = vec3(0.30, 0.66, 0.63);
    // 水纹跑得快慢 = 全站实时带宽；流量大时波光也更密
    float flow = sin(vUv.y * 40.0 - uTime * (0.7 * uFlow)) * 0.5 + 0.5;
    // ★白天的高光项在夜里要按比例收掉，否则它们仍是全图最亮的点
    float sparkle = pow(flow, 16.0) * (0.14 + 0.16 * uFlow) * (1.0 - uNight * 0.85);
    vec3 col = mix(deep, shallow, 0.30 + across * 0.45 + vWave * 3.0);
    col += vec3(1.0, 0.99, 0.92) * sparkle;
    float edge = 1.0 - smoothstep(0.0, 0.06, min(vUv.x, 1.0 - vUv.x));
    // 岸线那圈提亮是白天的"浅滩"，夜里同样要收
    col = mix(col, vec3(0.62, 0.80, 0.78), edge * 0.45 * (1.0 - uNight * 0.8));

    /* ---- 桥下遮蔽（伪 AO）----
       ★为什么不接 three 的 shadow map：水面是 ShaderMaterial，要收阴影得手工接
         shadowmap 的一整套 uniform 与 include，移动端上容易出问题。
         而桥的位置是固定的（配置里的 BRIDGE），直接按世界矩形算一块柔和的暗带
         成本几乎为零，视觉上「桥压在水面上」这件事就够了。
       ★边缘用 smoothstep 柔化，硬边会看着像贴了张黑色贴纸。
       ★桥比河宽，所以暗带会一直铺到岸线——正好符合"桥整个跨过河面"。 */
    /* ★边缘柔化半径不能太大：桥沿河方向只有 3.08 单位（z ∈ -1.54..1.54），
       之前 soft=0.72 把两端各吃掉 0.72，剩下的满值区只剩 1.6 单位，
       在 45° 正交投影里只有十来个像素——实测遮罩峰值根本到不了 1，AO 看着若有若无。
       这里收到 0.28，让桥下真的有块满值区，同时边缘仍有 0.56 单位的过渡。 */
    float soft = 0.28;
    float inX = smoothstep(uBridgeX1 - soft, uBridgeX1 + soft, vWorld.x)
              * (1.0 - smoothstep(uBridgeX2 - soft, uBridgeX2 + soft, vWorld.x));
    float inZ = smoothstep(uBridgeZ1 - soft, uBridgeZ1 + soft, vWorld.z)
              * (1.0 - smoothstep(uBridgeZ2 - soft, uBridgeZ2 + soft, vWorld.z));
    // 边缘再乘一道渐隐：水面在桥的左右两端慢慢接到亮水，避免出现一条直线
    float underBridge = inX * inZ;
    underBridge *= smoothstep(0.0, 0.10, underBridge);   // 二次收边，边界更软
    underBridge *= uAoStrength;
    /* 桥下：压暗 + 略降饱和（阴影里水色更沉，不是单纯变黑）。
       ★这几个数是"极端值 → 回调"试出来的：
         0.20/0.34 时肉眼完全看不出（截图差分也淹没在 UI/动画噪声里）；
         0.55/0.75 时是一片明显暗块，像盖了块布。
         0.32/0.50 是能看见但不抢眼的位置——桥有了落水感，又不至于像污渍。 */
    float shade = 1.0 - underBridge * 0.32;
    col = mix(col, col * vec3(0.55, 0.67, 0.82), underBridge * 0.50) * shade;
    // 桥缘那一线稍暗（接触感），很轻就行
    float rim = smoothstep(0.0, 0.10, underBridge) * (1.0 - smoothstep(0.18, 0.55, underBridge));
    col *= 1.0 - rim * 0.05;

    /* ---- 夜色：水比草地更暗 ----
       ★ShaderMaterial 不接手场景光照，所以水得自己跟着昼夜走。
       ★目标不是「压暗一点」，而是让水/草亮度比从白天的 1.0 降到 1.2 左右：
         夜里没有直射月光时，水面本来就该比岸边草地暗。
       实测（1400×900，站河边截图后按色相分类统计）：
         原始版本  夜 2.46x  ← 水是草的两倍半，像一条自发光灯带
         混 0.82   夜 1.77x  ← 仍明显偏亮
         混 0.92   夜 1.28x  ← 定稿；白天 1.00x、黄昏 1.10x，三档递进自然
       改这几个数请重跑同一套对比，别凭感觉。 */
    vec3 nightTint = vec3(0.030, 0.048, 0.078);   // 深夜水面本色：比夜色背景更暗
    col = mix(col, nightTint, uNight * 0.92);
    // 月光：只在河心偏一侧留一道很淡的冷光，其余全暗
    float moonPath = pow(max(0.0, 1.0 - across * 0.85), 2.2);
    float moonSpark = pow(flow, 9.0) * moonPath * 0.30;
    col += vec3(0.42, 0.52, 0.72) * moonSpark * uNight;
    /* 岸边路灯的暖光：只在夜里、且只沿两侧浅滩渗一点进来。
       ★uLamp 原来只声明不参与运算（死 uniform），注释承诺的「夜里水会映一点暖光」
         没有实现。这里接上：越靠岸（across→1）越暖，河心不受影响，
         否则整条河会变成一条橙色带。 */
    float bankWarm = smoothstep(0.35, 1.0, across) * uLamp * uNight;
    col += vec3(0.30, 0.20, 0.09) * bankWarm * 0.55;

    gl_FragColor = vec4(col, 0.92 + uNight * 0.05);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildWater() {
  const geo = new THREE.PlaneGeometry(RIVER.halfWidth * 2 + 0.04, MAP.z2 - MAP.z1 + 1.8, 8, 90);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    // uFlow 是「流速倍率」：由全站实时带宽驱动（0.7~2.4）
    // uNight / uLamp 是昼夜：ShaderMaterial 不接场景光照，天色得自己传进来
    // uBridge* 是桥在水面的遮蔽矩形：位置固定，直接按配置传，不走 shadow map
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uNight: { value: 0 },
      uLamp: { value: 0 },
      uBridgeX1: { value: BRIDGE.x1 },
      uBridgeX2: { value: BRIDGE.x2 },
      uBridgeZ1: { value: BRIDGE.z1 },
      uBridgeZ2: { value: BRIDGE.z2 },
      uAoStrength: { value: 1 },
    },
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
  // 目标流速倍率：由 syncFlow() 设定，update 里平滑逼近
  let flowTarget = 1;

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
    /**
     * 全站实时总带宽 -> 河水流速（0.7~2.4 倍）。
     * ★这是「数据即景观」最直接的一条：流量大的时候，河真的流得更急。
     * @param {number} bytesPerSec 全站 netIn+netOut 合计（字节/秒）
     */
    syncFlow(bytesPerSec) {
      const b = Number.isFinite(bytesPerSec) ? Math.max(0, bytesPerSec) : 0;
      // 1 MB/s 以下基本是常速；10 MB/s 达到上限
      const t = Math.min(1, Math.log10(1 + b / 65536) / Math.log10(1 + 160));
      flowTarget = 0.7 + t * 1.7;
    },
    get flow() { return +water.material.uniforms.uFlow.value.toFixed(2); },
    get flowTargetNow() { return +flowTarget.toFixed(2); },
    /**
     * 把昼夜喂给水面 shader。
     * ★ShaderMaterial 不吃场景光照，白天看着正常的水到了夜里还是白天那个亮青，
     *   会成为全图最亮的东西（像一条自发光灯带）。所以这里显式传进去。
     * @param {number} night 0=正午 1=深夜
     * @param {number} lamp  0=路灯全灭 1=全亮（夜里水会映一点暖光）
     */
    syncNight(night, lamp) {
      const n = Number.isFinite(night) ? Math.min(1, Math.max(0, night)) : 0;
      water.material.uniforms.uNight.value = n;
      water.material.uniforms.uLamp.value = Number.isFinite(lamp) ? Math.min(1, Math.max(0, lamp)) : 0;
    },
    get night() { return +water.material.uniforms.uNight.value.toFixed(3); },
    /** 桥下遮蔽强度（1=开 / 0=关）。验收做 A/B 对比用，也可以给低画质档关掉 */
    setAo(v) {
      const s = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
      water.material.uniforms.uAoStrength.value = s;
      return s;
    },
    get ao() { return +water.material.uniforms.uAoStrength.value.toFixed(2); },
    update(time, dt) {
      water.material.uniforms.uTime.value = time;
      /* 流速平滑逼近目标：数据每 2 秒推一次，直接赋值会让水面「一跳一跳」。
         ★必须用 damp(λ, dt) 而不是「每帧固定乘 0.045」：固定系数在 120fps 下
           约 0.18 秒到位、30fps 下要 0.7 秒，同一个效果在不同机器上快慢差 4 倍。
           damp 是指数逼近，与帧率无关（和主题其它地方同一口径）。 */
      const u = water.material.uniforms.uFlow;
      u.value = damp(u.value, flowTarget, 2.2, Number.isFinite(dt) && dt > 0 ? dt : 0.016);
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
