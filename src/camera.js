import * as THREE from 'three';
import { MAP } from './config.js';
import { damp } from './util.js';

/* ------------------------------------------------------------------ *
 * 斜俯视正交镜头：视野高 26，机位沿着 (27,32,27) 方向
 *
 * 贴边露白（1.9.0 修）：老写法把 focus 夹在「地图边留 9 格」里，而 16:9 的
 * 视野半宽就有 21.3 世界单位——余量比视野还小，夹取形同虚设，走到边上时
 * 屏幕会露出大片空背景（实测最坏一帧 22.6%）。
 *
 * 现在的口径：terrain 在地图外铺了一圈田野（APRON），视口的**地面脚印**
 * 必须整块落在田野内。田野比标准档视口（56.6 世界单位）大得多，所以夹取
 * 既真的管用、又不会把镜头锁死在中心——走路照样跟手。
 * ------------------------------------------------------------------ */

const OFFSET = new THREE.Vector3(27, 32, 27);
const VIEW_HEIGHT = 23.5;
const FOCUS_Y = 0.85;

/* 与 terrain.js 同步：地图外加 APRON 宽的田野。这里多留 2 的余量，
   因为雾与抗锯齿会在边沿吃掉一两个像素。
   ★APRON 不能拍脑袋：要够宽到「最费视口的组合」也能把镜头跟到地图四边。
     最费的是手机横屏 + 远景 30（脚印最宽）：40 时差 2.18、42 时差 0.18、
     44 才刚够。取 46 留 3.82 的裕量，覆盖 桌面/笔电/手机竖横/平板/2K × 三档。
     改这个数必须跑 `node tools/check-camera.mjs`（会验这些组合）。 */
const APRON = 46;
const GROUND = {
  w: (MAP.x2 - MAP.x1) + APRON * 2,
  d: (MAP.z2 - MAP.z1) + APRON * 2,
  pad: 2,
};

export class TownCamera {
  constructor(aspect = 16 / 9) {
    this.viewHeight = VIEW_HEIGHT;
    this.dir = OFFSET.clone().normalize();
    this.distance = OFFSET.length();

    this.camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 150);
    this.focus = new THREE.Vector3(MAP.x1, FOCUS_Y, MAP.z1);
    this._look = new THREE.Vector3();
    this._pin = null;
    this._cruiseSpeed = 0;      // 0 = 不走巡游速率（正常跟随）
    this._returning = false;

    /* 与 three 的 lookAt 同一套基向量：X = normalize(up × dir)、Y = dir × X。
       夹取直接用它们把视口四角射到地面，不再预先量包围盒。 */
    const up = new THREE.Vector3(0, 1, 0);
    this._axisX = new THREE.Vector3().crossVectors(up, this.dir).normalize();
    this._axisY = new THREE.Vector3().crossVectors(this.dir, this._axisX);

    this.resize(aspect);
  }

  resize(aspect) {
    const h = this.viewHeight;
    const w = h * aspect;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
    this._clampFocus();
  }

  snapTo(x, z) {
    this.focus.set(x, FOCUS_Y, z);
    this._clampFocus();
    this._apply();
    /* ★瞬移是「镜头已经到位」：把巡游回位状态一起清掉。
       不清的话下一帧 update 会用 0.6 的慢速率去追玩家，看起来像卡住。 */
    this._returning = false;
    this._cruiseSpeed = 0;
  }

  /** 钉住镜头（详情页打开时用）：update() 里的玩家坐标不再生效，直到 unpin() */
  pin(x, z) {
    this._pin = { x, z };
    this._cruiseSpeed = 0;      // 详情页钉住用正常速率，别继承巡游的慢速
    this._returning = false;
  }

  /**
   * 闲置巡游：把镜头慢慢带到一个点。
   * ★必须走 pin 这条路（= 不跟玩家），并且**不瞬跳**——update() 里的 damp 会平滑过去。
   *   直接调用 snapTo 会让镜头「啪」地跳一下，看着像闪屏。
   */
  cruiseTo(x, z) {
    this._pin = { x, z };
    this._cruiseSpeed = 0.35;         // 巡游途中焦点移动的速率（比手动的 4.8 小一个量级，才像"飘"）
  }

  /** 结束巡游：交回玩家控制
   *  ★回位也不能用 4.8——巡游焦点可能离玩家十几米，4.8 的速度看着像瞬移。
   *   这里用一个很慢的回归速率（1.6），让它像镜头自己「飘」回去。 */
  cruiseEnd() {
    if (!this._pin) return;
    this._pin = null;
    this._returning = true;
  }

  unpin() {
    /* 与 pin()/snapTo() 语义保持一致：清 _pin 的同时必须把巡游的慢速和
       回位标记一起复位，否则解除钉住后镜头会带着 0.35（巡游）或 0.6（回位）
       的慢速继续跟随玩家，看起来像黏住了。 */
    this._pin = null;
    this._cruiseSpeed = 0;
    this._returning = false;
  }

  /**
   * 把 focus 夹到「视口的地面脚印整块落在田野内」的可行域。
   *
   * 正交镜头把视口四角射到地面 y=0，得到四个落点；每个落点相对 focus 的
   * 偏移（i,j）是常数（只跟转角、视高、aspect 有关）。要求
   *     focus + 偏移 ∈ [田野矩形]
   * 于是 focus 的可行域 = 田野矩形 ∩ 四条「负向平移」的交，逐轴取区间即可。
   * 这里**不能**用视口的屏幕 AABB 去近似：45° 俯视下视口落地是斜的平行四边形，
   * AABB 比真实脚印大一圈，会让边角处仍然露白（第一版就是这么错的）。
   */
  _clampFocus() {
    const W = this.camera.right - this.camera.left;
    const H = this.camera.top - this.camera.bottom;
    if (!(W > 0 && H > 0)) return;

    const ax = this._axisX;
    const ay = this._axisY;
    // 视口角 (u,v) → 地面落点偏移：只保留 (x,z) 分量
    //   p = u*ax + v*ay + dir*t，t 由 y=0 反解
    const dir = this.dir;
    const tOf = (v) => (FOCUS_Y + v * ay.y) / -dir.y;
    const offs = [];
    for (const u of [-W / 2, W / 2]) {
      for (const v of [-H / 2, H / 2]) {
        const t = tOf(v);
        offs.push([
          u * ax.x + v * ay.x + dir.x * t,
          u * ax.z + v * ay.z + dir.z * t,
        ]);
      }
    }
    const minOx = Math.min(...offs.map((o) => o[0]));
    const maxOx = Math.max(...offs.map((o) => o[0]));
    const minOz = Math.min(...offs.map((o) => o[1]));
    const maxOz = Math.max(...offs.map((o) => o[1]));

    const gx1 = -GROUND.w / 2 + GROUND.pad;
    const gx2 = GROUND.w / 2 - GROUND.pad;
    const gz1 = -GROUND.d / 2 + GROUND.pad;
    const gz2 = GROUND.d / 2 - GROUND.pad;

    this.focus.x = Math.min(gx2 - maxOx, Math.max(gx1 - minOx, this.focus.x));
    this.focus.z = Math.min(gz2 - maxOz, Math.max(gz1 - minOz, this.focus.z));
    // 脚印比田野还大（视高被调到极端）：没有可动空间，锁在地图正中
    if (gx1 - minOx > gx2 - maxOx) this.focus.x = 0;
    if (gz1 - minOz > gz2 - maxOz) this.focus.z = 0;
  }

  update(dt, x, z, aheadX = 0, aheadZ = 0) {
    const px = this._pin ? this._pin.x : x + aheadX;
    const pz = this._pin ? this._pin.z : z + aheadZ;
    /* 速率分三档（注意 damp 的 λ 越大越快，1-exp(-λdt)）：
       巡游途中 0.35（很慢地飘）、刚结束回位 0.6（十几米也要走 5 秒以上才不晕）、
       正常跟人 4.8。★我一开始把回位设成 1.6，实测 0.7 秒跨 12 个世界单位，
         看着就是瞬移——这就是为什么它必须比手动速率**小一个量级**。 */
    let rate = 4.8;
    if (this._pin && this._cruiseSpeed) rate = this._cruiseSpeed;
    else if (this._returning) rate = 0.6;
    this.focus.x = damp(this.focus.x, px, rate, dt);
    this.focus.z = damp(this.focus.z, pz, rate, dt);
    // 回位到足够近就恢复正常跟随
    if (this._returning) {
      const dx = this.focus.x - (x + aheadX);
      const dz = this.focus.z - (z + aheadZ);
      if (dx * dx + dz * dz < 0.35) this._returning = false;
    }
    this._clampFocus();
    this._apply();
  }

  _apply() {
    const f = this.focus;
    this.camera.position.set(
      f.x + this.dir.x * this.distance,
      f.y + this.dir.y * this.distance,
      f.z + this.dir.z * this.distance
    );
    this._look.set(f.x, f.y, f.z);
    this.camera.lookAt(this._look);
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
  }
}
