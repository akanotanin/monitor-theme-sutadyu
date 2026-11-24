/* ------------------------------------------------------------------ *
 * 小镇的声音（默认关；用 WebAudio 现场合成，不下载任何音频文件）
 *
 * 为什么合成而不是放 mp3：
 *   主题包现在 3.3 MB，加几段可循环的环境音很容易再涨 1 MB 以上，
 *   而这些声音需要「跟着状态变」（夜里才有虫鸣、采摘才有鸡叫），
 *   采样文件很难做出这种连续变化。合成只花几百字节代码。
 *
 * 三条硬规矩：
 *   1. 默认不出声 —— 访客没点过按钮之前，一个音符都不放。
 *   2. AudioContext 必须在用户手势里创建/恢复（浏览器自动播放策略）。
 *   3. 一旦关掉就把 context 挂起（不是静音），真的省 CPU。
 * ------------------------------------------------------------------ */

let ctx = null;
let master = null;
let enabled = false;
let started = false;

/* 各声部的音量，随时调 */
const MIX = { birds: 0.5, crickets: 0.42, chime: 0.7, cluck: 0.55 };

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  return ctx;
}

/** 一小段带包络的音（用来做鸟叫/鸡叫/铃声） */
function blip({ freq, dur, type = 'sine', gain = 0.2, slideTo = null, when = 0 }) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
  // 快起慢落，像自然的声音而不是「嘀」一声
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  /* ★必须断开并释放：osc.stop() 只让源节点结束，挂在活着的 master 上的
     OscillatorNode/GainNode 仍算「在链上」。环境音每 2.6~4.2 秒来一次、
     每次 2~3 个节点，不清理会随挂机时间无限累积。 */
  osc.onended = () => {
    try { osc.disconnect(); } catch { /* 已断开 */ }
    try { g.disconnect(); } catch { /* 已断开 */ }
  };
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 鸟叫：两三个快速上滑，白天随机响 */
function birdChirp() {
  const base = 1900 + Math.random() * 900;
  const n = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    blip({
      freq: base * (0.9 + Math.random() * 0.25),
      dur: 0.07 + Math.random() * 0.05,
      type: 'sine',
      gain: MIX.birds * 0.16,
      slideTo: base * (1.5 + Math.random() * 0.5),
      when: i * 0.085,
    });
  }
}

/** 虫鸣：夜里的高频短促脉冲，比鸟叫更密更轻 */
function cricketChirp() {
  const base = 3200 + Math.random() * 800;
  for (let i = 0; i < 3; i++) {
    blip({
      freq: base,
      dur: 0.03,
      type: 'triangle',
      gain: MIX.crickets * 0.10,
      when: i * 0.055,
    });
  }
}

/** 鸡叫：下滑的「咯」 */
function cluck() {
  blip({ freq: 780, dur: 0.11, type: 'sawtooth', gain: MIX.cluck * 0.12, slideTo: 360 });
  blip({ freq: 620, dur: 0.09, type: 'sawtooth', gain: MIX.cluck * 0.09, slideTo: 300, when: 0.1 });
}

/** 状态变化的小铃（离线 → 一个下行二音；恢复 → 上行二音） */
function chime(up) {
  const a = up ? 660 : 880;
  const b = up ? 990 : 587;
  blip({ freq: a, dur: 0.16, type: 'sine', gain: MIX.chime * 0.13 });
  blip({ freq: b, dur: 0.22, type: 'sine', gain: MIX.chime * 0.11, when: 0.13 });
}

/* ---- 环境音的调度：不是循环播放，而是「每隔一会儿随机来一下」 ---- */
let ambTimer = 0;
let pending = [];   // { at: 秒, fn }

function tickEnvironment(dt, night) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  ambTimer += dt;
  const gap = night > 0.5 ? 2.6 : 4.2;     // 夜里虫鸣更密
  if (ambTimer >= gap) {
    ambTimer = 0;
    // 每次随机挑一个声部
    if (night > 0.5) {
      if (Math.random() < 0.8) cricketChirp();
    } else if (Math.random() < 0.65) {
      birdChirp();
    }
  }
}

export const sound = {
  get enabled() { return enabled; },
  get supported() { return !!(window.AudioContext || window.webkitAudioContext); },

  /** 用户点了「开声音」：必须在手势回调里调用 */
  enable() {
    if (!this.supported) return false;
    ensureCtx();
    if (!ctx) return false;
    /* ★resume() 是异步的，且可能被浏览器继续拦着。
       同步返回 true 会让按钮显示「已开启」但一点声都没有（tickEnvironment 要求
       ctx.state === 'running'）。这里先乐观地置 enabled，随后以真实 state 为准。 */
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        if (ctx.state !== 'running') enabled = false;
      }).catch(() => { enabled = false; });
    }
    enabled = true;
    started = true;
    return true;
  },

  disable() {
    enabled = false;
    if (ctx && ctx.state === 'running') ctx.suspend();
  },

  toggle() {
    if (enabled) { this.disable(); return false; }
    return this.enable();
  },

  /** 每帧：驱动环境音 */
  update(dt, night) {
    if (!enabled) return;
    tickEnvironment(dt, night);
  },

  /** 验收用：把内部状态摊开 */
  state() {
    return {
      enabled,
      supported: this.supported,
      ctxState: ctx ? ctx.state : 'none',
      sampleRate: ctx ? ctx.sampleRate : 0,
    };
  },

  /** 采摘：一声鸡叫 */
  playCluck() { if (enabled && ctx) cluck(); },
  /** 机器掉线/恢复 */
  playStatus(up) { if (enabled && ctx) chime(!!up); },
};
