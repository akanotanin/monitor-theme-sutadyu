/* ------------------------------------------------------------------ *
 * 一天里的光：把访客本地时间映射成一套光照参数
 *
 * 小镇原本永远停在「同一个下午」——太阳固定、背景固定、路灯整天亮着。
 * 这里按小时算出一个 0~1 的相位，插值出半球光 / 主光 / 背景与雾 / 路灯强度。
 *
 * ★关键取舍：太阳只做**方位角旋转 + 有限的高度变化**（仰角钳在 30°~70°）。
 *   真按物理让太阳落到地平线，影子会拉到几十个世界单位长，正交阴影相机的
 *   视锥装不下（会突然出现一片没影子的矩形），而且低角度下阴影锯齿严重。
 *   所以「夜」是靠**调暗 + 冷色**表达的，不是靠太阳真的落下去。
 *
 * ★这个文件是纯函数、零 three 依赖：check-daylight.mjs 直接 import 它做边界验证。
 * ------------------------------------------------------------------ */

/** 6 个关键帧：相位 0~1（0 = 00:00，0.5 = 12:00） */
const KEYS = [
  // 深夜：★别只靠压 hemiInt 来造夜。
  //   压 hemiInt（0.52）→ 实测 30.7% 画面 <20 亮度（死黑，草地读成一块黑）；
  //   抬到 1.15 → 暗部有细节了，但「正午 vs 深夜」的亮度差从 1.22 掉到 0.76，
  //   昼夜对比变弱、看着像「阴天」而不是「夜里」。
  //   最终口径：hemiInt 抬到 1.12 保暗部细节，夜里主要靠 **sunInt 压到 0.35**
  //   与冷色 bg/hemiSky 来区分昼夜——太阳几乎不投影，整场只剩环境光与路灯。
  { p: 0.00, hemiSky: '#4a6386', hemiGround: '#26323f', hemiInt: 1.12,
    sun: '#a8bcdc', sunInt: 0.35, bg: '#33405a', lamp: 1.00, elev: 34 },
  // 破晓
  { p: 0.23, hemiSky: '#ffd2a8', hemiGround: '#5f6f58', hemiInt: 1.05,
    sun: '#ffb07a', sunInt: 1.55, bg: '#e2c3a8', lamp: 0.85, elev: 30 },
  // 清晨
  { p: 0.33, hemiSky: '#fff0dc', hemiGround: '#536f78', hemiInt: 1.62,
    sun: '#ffdfb5', sunInt: 2.40, bg: '#dfe5d8', lamp: 0.18, elev: 42 },
  // 正午
  { p: 0.50, hemiSky: '#fffaf0', hemiGround: '#5b7880', hemiInt: 1.74,
    sun: '#fff2d8', sunInt: 2.62, bg: '#e4e9dc', lamp: 0.00, elev: 68 },
  // 午后
  { p: 0.68, hemiSky: '#fff0dc', hemiGround: '#536f78', hemiInt: 1.66,
    sun: '#ffdfb5', sunInt: 2.45, bg: '#dfe5d8', lamp: 0.10, elev: 46 },
  // 黄昏
  { p: 0.78, hemiSky: '#ffb98a', hemiGround: '#4f5a52', hemiInt: 1.18,
    sun: '#ff8a5c', sunInt: 1.70, bg: '#e6b48c', lamp: 0.88, elev: 30 },
  // 入夜
  { p: 0.86, hemiSky: '#7a6a86', hemiGround: '#33323f', hemiInt: 0.98,
    sun: '#ab98c4', sunInt: 0.85, bg: '#584c60', lamp: 1.00, elev: 30 },
  // 午夜之前回到深夜
  { p: 1.00, hemiSky: '#4a6386', hemiGround: '#26323f', hemiInt: 1.12,
    sun: '#a8bcdc', sunInt: 0.35, bg: '#33405a', lamp: 1.00, elev: 34 },
];

const hex2rgb = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgb2hex = (c) =>
  '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lerp = (a, b, t) => a + (b - a) * t;
const lerpColor = (a, b, t) => {
  const ca = hex2rgb(a);
  const cb = hex2rgb(b);
  return rgb2hex([lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]);
};

/**
 * 取某个相位的全套光照参数。
 * @param {number} phase 0~1（0 = 00:00）；超出范围会回绕
 * @returns {{hemiSky:string, hemiGround:string, hemiInt:number, sun:string,
 *            sunInt:number, bg:string, lamp:number, elev:number}}
 */
export function sampleAt(phase) {
  let p = Number(phase);
  if (!Number.isFinite(p)) p = 0.5;
  p = ((p % 1) + 1) % 1;

  // 找到夹住 p 的两个关键帧
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].p <= p) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const span = b.p - a.p;
  const t = span > 1e-6 ? (p - a.p) / span : 0;

  // ★用 smoothstep 而不是线性：线性插值在关键帧处会有折线感，
  //   按小时连续走的时候能看出「亮度突然拐弯」。smoothstep 让过渡像自然天光。
  const s = t * t * (3 - 2 * t);

  return {
    hemiSky: lerpColor(a.hemiSky, b.hemiSky, s),
    hemiGround: lerpColor(a.hemiGround, b.hemiGround, s),
    hemiInt: lerp(a.hemiInt, b.hemiInt, s),
    sun: lerpColor(a.sun, b.sun, s),
    sunInt: lerp(a.sunInt, b.sunInt, s),
    bg: lerpColor(a.bg, b.bg, s),
    lamp: lerp(a.lamp, b.lamp, s),
    elev: lerp(a.elev, b.elev, s),
  };
}

/** 本地时间（小时，0~24）→ 相位 */
export function phaseOf(date) {
  const d = date instanceof Date ? date : new Date();
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  return ((h / 24) % 1 + 1) % 1;
}

/**
 * 把主题设置翻译成相位。
 *   auto  → 跟访客本地时间走
 *   day   → 固定正午
 *   dusk  → 固定黄昏
 *   night → 固定深夜
 */
export const FIXED = { day: 0.5, dusk: 0.78, night: 0.02 };
export function resolvePhase(mode, date) {
  if (mode && mode !== 'auto' && Number.isFinite(FIXED[mode])) return FIXED[mode];
  return phaseOf(date);
}

/** 太阳在水平面上的方位角（弧度）：破晓偏东 → 正午居中 → 黄昏偏西
 *
 *  ★必须整圈连续。原来只在 0.23~0.78 之间线性插值、两端 clamp：
 *    p→1⁻ 得 +62°、p→0⁺ 得 -62°，午夜整点方位瞬间翻转 124°，
 *    全场影子会在一帧里换向（夜里 sunInt 虽低到 0.376，但阴影仍在，
 *    贴地看就是「影子突然跳到另一边」）。
 *
 *  这条曲线要同时满足三件事：
 *    ① p=0.5（正午）方位 = 0（正南，影子最短最正）
 *    ② p≈0.23 破晓 = -62°、p≈0.78 黄昏 = +62°（和原来的观感一致）
 *    ③ p=0 两侧极限相同（午夜不跳）
 *  用 sin 绕一整圈正好满足：sin 在 p=0.5 为 0，在 p=0.25/0.75 取 ±1，
 *  p=0 与 p=1 同为 0。峰值 62°，与原来的两端值对齐。
 */
export function sunAzimuth(phase) {
  const p = (((Number(phase) || 0) % 1) + 1) % 1;
  return Math.sin((p - 0.5) * Math.PI * 2) * (62 * Math.PI / 180);
}

export { KEYS };
