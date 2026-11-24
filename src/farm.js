import * as THREE from 'three';
import { MeshBatch } from './util.js';
import { C, FARM, LAYOUT } from './config.js';
import { addRectCollider } from './collision.js';

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

  /* ---- 作物重生的节律：由「这台机器在线多久」决定 ----
     ★原来摘完就 `mature=false` 永久荒着，只有刷新页面才回来。
       现在一次采摘会种下新一轮：**机器在线越久，田越肥沃、长得越快**。
       30 天以上 → 40 秒；刚开机 → 150 秒；离线节点按 0 天算（最慢）。
       这样「在线时长」这个本来只在详情页里的数字，变成了看得见的种地反馈。 */
  const REGROW_FAST_DAYS = 30;
  const REGROW_MIN_SEC = 40;
  const REGROW_MAX_SEC = 150;
  function regrowSeconds(server) {
    const days = server && Number.isFinite(server.uptimeSec) ? server.uptimeSec / 86400 : 0;
    const t = Math.max(0, Math.min(1, days / REGROW_FAST_DAYS));
    return REGROW_MAX_SEC - (REGROW_MAX_SEC - REGROW_MIN_SEC) * t;
  }

  /** 长成了：把产物显回来、嫩芽收掉、土色补丁抹平 */
  function becomeMature(crop) {
    crop.mature = true;
    crop.regrowAt = 0;
    crop.regrowMs = 0;
    crop.produce.visible = true;
    crop.produce.scale.setScalar(crop.baseScale);
    crop.sprout.visible = false;
    crop.sprout.scale.y = 1;
    crop.patch.visible = false;
  }

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
      baseScale: p.mature ? s : 0.7,
      // 重生用：归属哪台机器（slots 模块按顺序分配）、何时长好、总时长
      slotIndex: crops.length,
      regrowAt: 0,
      regrowMs: 0,
      server: null,
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
          const sec = regrowSeconds(crop.server);
          crop.mature = false;
          crop.produce.visible = false;
          crop.sprout.visible = true;
          crop.patch.visible = true;
          crop.harvested = true;
          crop.regrowMs = sec * 1000;
          crop.regrowAt = performance.now() + crop.regrowMs;
          crop.sprout.scale.y = 0.35;
          harvestCount++;
          // 归到的那台机器在线越久，这一轮长得越快——把 uptime 变成看得见的种地反馈
          const owner = crop.server && crop.server.name ? crop.server.name : null;
          /* ★只有当 uptime 是有限值时才能说「连轴转了 N 天」。
             原来写 (uptimeSec || 0)/86400 再 Math.max(1, …)：离线节点或没有 metrics
             的机器 uptimeSec 为 null，除法得 0，被兜成「1 天」——一句话凭空
             给机器编了 1 天在线时长，而同一份数据算重生时长时是按 0 天算的 150 秒，
             两处自相矛盾。这里与 regrowSeconds() 同口径：拿不到就不说天数。 */
          const days = Number.isFinite(crop.server?.uptimeSec)
            ? Math.max(1, Math.round(crop.server.uptimeSec / 86400))
            : 0;
          const why = owner && days > 0
            ? `${owner} 已经连轴转了 ${days} 天，田里的土正肥`
            : '土还松着，过一会儿又会冒芽';
          return {
            kind: 'toast',
            text: `采到了 1 份${crop.name} · 竹篮里已有 ${harvestCount} 份收成`,
            extra: {
              kind: 'say',
              name: '丰收时刻',
              text: `${crop.name}还带着阳光的温度。${why}，约 ${Math.round(sec)} 秒后又能摘一轮。`,
            },
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
    /** 每块地现在的状态（验收/调试用） */
    snapshot() {
      return crops.map((c) => ({
        name: c.name,
        mature: !!c.mature,
        harvested: !!c.harvested,
        server: c.server ? c.server.name : null,
        leftMs: c.regrowAt ? Math.max(0, Math.round(c.regrowAt - performance.now())) : 0,
      }));
    },
    /** 把节点列表绑到作物上：第 i 株归第 i 台机器（没有的就不绑，按最慢算） */
    bindServers(servers) {
      const list = Array.isArray(servers) ? servers : [];
      for (const crop of crops) {
        crop.server = list.length ? list[crop.slotIndex % list.length] : null;
      }
    },
    update(time) {
      const now = performance.now();
      for (const crop of crops) {
        if (crop.mature) {
          crop.produce.rotation.z = Math.sin(time * 1.3 + crop.phase) * 0.018;
          continue;
        }
        // 正在长：嫩芽从 35% 长到满高，长满就换回成熟形态
        if (crop.regrowAt > 0) {
          const left = crop.regrowAt - now;
          if (left <= 0) {
            becomeMature(crop);
            continue;
          }
          const p = 1 - left / Math.max(1, crop.regrowMs);   // 0→1
          crop.sprout.scale.y = 0.35 + 0.65 * p;
          crop.sprout.scale.x = 0.7 + 0.3 * p;
          crop.sprout.scale.z = 0.7 + 0.3 * p;
          crop.sprout.rotation.z = Math.sin(time * 2.1 + crop.phase) * 0.05 * (1 - p);
        }
      }
    },
  };
}

export { CROP_COLORS };
