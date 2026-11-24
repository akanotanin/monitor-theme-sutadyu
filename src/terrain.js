import * as THREE from 'three';
import { MeshBatch, mulberry32 } from './util.js';
import { C, MAP, RIVER, PATHS, LAYOUT } from './config.js';

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
  /* 岛的「裙边」：地图外再铺一圈低饱和草地，让镜头贴边时看到的是延伸的田野，
     而不是这块板子的切边 + 空背景。
     为什么不做「把视口夹在板子里」：标准档（视高 24）的视口在地面的脚印就有
     56.6 世界单位，比地图短边（47.1）还大——夹取会退化成「锁死中心」，
     整座镇子不能跟手。所以改成把**地面铺得比视口更大**，边界永远在屏幕外。 */
  const APRON = 46;
  const groundW = W + APRON * 2;
  const groundD = D + APRON * 2;
  const baseW = W + 1.5;                 // 基座比地图大一圈：边上才有「立体模型」的土埂
  const baseD = D + 1.8;
  const left = -baseW / 2;
  const right = baseW / 2;
  const riverL = RIVER.centerX - RIVER.halfWidth - 0.02;
  const riverR = RIVER.centerX + RIVER.halfWidth + 0.02;

  /* ---- 外圈田野 + 台地过渡 ----
     原来只有一块平田（顶面 y≈-1.18），而镇内草地顶面在 y≈0：中间是一圈 0.53 高、
     笔直的泥土崖，四周又是规整的矩形直角，远看就像「蛋糕放在盘子上」。

     ★台阶落差不能拍小：45° 正交下世界落差 h 在屏幕上只有 h×0.766×37.5 px，
       降 0.16 只等于 4.6 px——肉眼完全看不出「有台地」（我第一版就是 0.16，被当成平的）。
       这里每级降 0.34 ≈ 9.8 px，才读得出层级；并且每级边缘留一圈土色断面，
       让「这是坡」有明确的视觉线索，而不是靠几阶相似绿色的色差去猜。

       镇内草地 y=0
       └ 土色裙边 -0.10（0.6 宽）
         └ 台地一 -0.44（外扩 3.0）
           └ 台地二 -0.78（外扩 6.5）
             └ 田野   -1.10
     总落差 1.10（屏幕约 32 px），比原来的 0.53 更深，但分成两段+裙边就不像断崖。 */
  batch.addBox(0, -1.56, 0, groundW, 0.92, groundD, 0x6c8f66);          // 田野（顶面 -1.10）

  /* ---- 台地一/二与贴镇边的土色裙边 ----
     ★★必须给河让路：水面在 y=-0.22，而内圈台地的草面 -0.10、土坡 -0.20 都比它高——
       一整块横跨全图的板子会把河**完全盖住**，访客看到的就是「河变成绿地了」。
       所以每级台地都拆成「河西 / 河东 + 两端补实」三块：
       河只存在于 |z| ≤ RIVER_Z 的范围内，超出这一段的缺口要填回去，
       否则外圈台地上会留下一条干沟。 */
  const RIVER_Z = (MAP.z2 - MAP.z1) / 2 + 0.95;   // 与 river.js 的水面长度一致

  /** 一级台地：草面 + 外沿一圈更低的土色坡面
     ★断面必须比草体**低**，否则会被埋在两块草之间完全看不见（第一版就是同高，白做）。
       几何：草体顶 = topY；土坡顶 = topY - 0.10，从草体边缘再往外挑 0.55。
       这样从下一级看上来，先看到 0.10 厚的草沿，再看到土色的坡立面。 */
  const step = (margin, topY, grass, soil) => {
    const w = baseW + margin * 2;
    const d = baseD + margin * 2;
    const layers = [
      { y: topY - 0.10 - 0.5, h: 1.0, x0: -(w + 1.1) / 2, x1: (w + 1.1) / 2, d: d + 1.1, col: soil },
      { y: topY - 0.5, h: 1.0, x0: -w / 2, x1: w / 2, d, col: grass },
    ];
    for (const L of layers) {
      const leftW = riverL - L.x0;
      if (leftW > 0.01) batch.addBox(L.x0 + leftW / 2, L.y, 0, leftW, L.h, L.d, L.col);
      const rightW = L.x1 - riverR;
      if (rightW > 0.01) batch.addBox(riverR + rightW / 2, L.y, 0, rightW, L.h, L.d, L.col);
      const cap = L.d / 2 - RIVER_Z;
      if (cap > 0.01) {
        const cw = riverR - riverL;
        const cx = (riverL + riverR) / 2;
        for (const s of [-1, 1]) {
          batch.addBox(cx, L.y, s * (RIVER_Z + cap / 2), cw, L.h, cap, L.col);
        }
      }
    }
  };
  step(6.5, -0.78, 0x6f9268, 0x7d6247);   // 台地二
  step(3.0, -0.44, 0x749768, 0x866a4d);   // 台地一
  step(0.6, -0.10, 0x78a06c, 0x8c6f50);   // 贴镇边的土色裙边

  /* ---- 交界处的一圈「树篱 + 杂物」 ----
     ★这是让衔接不突兀的主力手段，不是台阶。
       原因：45° 正交下垂直落差被压扁（每级 0.34 只合 9.8px），而两阶草的色差只有
       几个色阶——视觉模型连着三轮都判定「完全平坦」。真正读得出层次的是**遮挡**：
       在镇边外侧 0.5~7 的带状区域里种一圈高矮不一的树与灌木，让草地的边线被
       树冠切成参差，眼睛才会认为「这里是坡」。
     ★注意这些盒子并进的是 terrain 的合并网格，那张网格 castShadow=false
       （147×147 的地形整张塞进 shadow pass 太贵），所以它们**不投阴影**，
       层次完全靠遮挡与色差成立。别照着下面这句去调阴影参数。 */
  /** 站在田野上时脚下的高度：跟着台地走，别让树浮空/陷进土里（与上面 step 的 topY 保持一致） */
  const fieldY = (x, z) => {
    const mx = Math.abs(x) - baseW / 2;
    const mz = Math.abs(z) - baseD / 2;
    const m = Math.max(mx, mz);
    if (m <= 0.6) return -0.10;      // 土色裙边
    if (m <= 3.0) return -0.44;      // 台地一
    if (m <= 6.5) return -0.78;      // 台地二
    return -1.10;                    // 田野
  };

  const hedgeColors = [0x4f7350, 0x5d8358, 0x6b9159, 0x53805f];
  const hedgeRing = (count) => {
    for (let i = 0; i < count; i++) {
      // 沿「镇边矩形」均匀撒点：按周长参数化，四边都能覆盖
      const t = i / count;
      const per = 2 * (baseW + baseD);
      let d = t * per;
      let x, z;
      if (d < baseW) { x = -baseW / 2 + d; z = -baseD / 2; }
      else if ((d -= baseW) < baseD) { x = baseW / 2; z = -baseD / 2 + d; }
      else if ((d -= baseD) < baseW) { x = baseW / 2 - d; z = baseD / 2; }
      else { d -= baseW; x = -baseW / 2; z = baseD / 2 - d; }
      // 往外挪 0.4~6.5（跨过台地），并沿边线抖动，把直角啃出参差
      const out = 0.4 + rng() * 6.1;
      const jitter = (rng() - 0.5) * 3.4;
      const nx = x === baseW / 2 ? x + out : x === -baseW / 2 ? x - out : x + jitter;
      const nz = z === baseD / 2 ? z + out : z === -baseD / 2 ? z - out : z + jitter;
      const base = fieldY(nx, nz);
      const s = 0.9 + rng() * 0.9;
      const col = hedgeColors[Math.floor(rng() * hedgeColors.length)];
      const tall = rng() < 0.45;
      batch.addBox(
        nx, base + (tall ? 0.85 : 0.32) * s, nz,
        (tall ? 1.7 : 1.05) * s, (tall ? 1.7 : 0.66) * s, (tall ? 1.6 : 1.0) * s,
        col
      );
    }
  };
  hedgeRing(56);

  /* 外圈的稀疏植被：远看是连片的野地，不是一块刷了绿的板。
     为了让「镇边 + 台地」那几圈直线不显眼，植被允许跨过边线生长：
     镇外 0~2 的范围内会冒出几丛，把直角啃出参差。

     ★数量要克制：这些方块并进 terrain 那个巨大的合并网格，首帧建几何的成本
       会体现在 herdSyncMs 上（实测 420 个多点 → 697 ms，基线 238 ms）。
       所以不铺地面条纹（73 个盒子、远看也只是一层噪点），改成「成簇的树丛」。 */
  const OUT = 2.2;   // 允许越界多少：把边线打散
  const outsideMap = (x, z) =>
    x < MAP.x1 - OUT || x > MAP.x2 + OUT || z < MAP.z1 - OUT || z > MAP.z2 + OUT;
  const bushColors = [0x5d8358, 0x6b9159, 0x53805f, 0x749a63];
  for (let i = 0; i < 78; i++) {
    const cx = (rng() - 0.5) * (groundW - 10);
    const cz = (rng() - 0.5) * (groundD - 10);
    if (!outsideMap(cx, cz)) continue;
    const near = Math.max(Math.abs(cx) / (W / 2 + APRON * 0.55), Math.abs(cz) / (D / 2 + APRON * 0.55));
    // 贴着镇子的一圈留一半空地：太密会像围栏、也不给「远看还有乡下」留呼吸
    if (near < 1.05 && rng() < 0.45) continue;
    // 一簇 3~5 个盒子：矮灌木围着两棵高一点的，远看是树丛而不是孤零零的方块
    const n = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * 2.2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!outsideMap(x, z)) continue;
      const base = fieldY(x, z);
      const tall = k < 2 && rng() < 0.75;
      const s = 0.75 + rng() * 0.7;
      const col = bushColors[Math.floor(rng() * bushColors.length)];
      batch.addBox(
        x, base + (tall ? 0.68 : 0.3) * s, z,
        (tall ? 1.5 : 0.95) * s, (tall ? 1.35 : 0.62) * s, (tall ? 1.4 : 0.9) * s,
        col
      );
    }
  }

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

  /* ---- 草地上的深浅色块，让大片绿不死板 ----
     ★原来是 220 个随机位置的盒子，**顶端全落在 y = 0.012**：两两重叠时上表面
       严格共面 → z-fighting，走到那一带就能看见方块在闪（访客截图里的浅绿色
       菱形闪烁就是这个）。
       改成「网格对齐、互不重叠」：每个色块占一个格子、只占格子的一部分，
       这样任意两块都不可能相交，同一高度也就绝不会共面。顺带分布更耐看。 */
  const CELL = 1.9;
  const pCols = Math.floor(W / CELL);
  const pRows = Math.floor(D / CELL);
  for (let ci = 0; ci < pCols; ci++) {
    for (let cj = 0; cj < pRows; cj++) {
      if (rng() > 0.55) continue;                       // 只铺一半多一点的格子，避免糊成一片
      const cx = MAP.x1 + CELL * (ci + 0.5);
      const cz = MAP.z1 + CELL * (cj + 0.5);
      const w = CELL * (0.42 + rng() * 0.40);           // ≤0.82 格，留出空隙
      const d = CELL * (0.40 + rng() * 0.38);
      const jx = (rng() - 0.5) * (CELL - w) * 0.9;      // 在格子内抖动，保证仍不出格
      const jz = (rng() - 0.5) * (CELL - d) * 0.9;
      /* ★必须按色块的**实际横向范围**判断有没有压到河面，不能只看格子中心。
         水面在 y=-0.22、色块顶面在 y=0.012——压在河上的色块会整块盖住水面，
         访客看到的就是「河变成绿地了」。旧写法只看中心，格子中心在岸边、
         色块本体却能伸进河道 1~2 个单位，这条一直在悄悄发生。 */
      const left = cx + jx - w / 2;
      const right = cx + jx + w / 2;
      if (right > riverL - 0.06 && left < riverR + 0.06) continue;
      batch.addBox(
        cx + jx, 0.006, cz + jz,
        w, 0.012, d,
        C.patch[Math.floor(rng() * C.patch.length)]
      );
    }
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
