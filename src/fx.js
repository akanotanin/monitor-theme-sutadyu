import * as THREE from 'three';
import { makeGlowTexture } from './util.js';

/* ------------------------------------------------------------------ *
 * 氛围粒子：烟囱的烟 + 夜里的萤火虫
 *
 * ★两个都是「一直写在注释里、从来没有画出来」的效果：
 *   - buildings.js 的 addChimney 收了烟囱坐标却 `void px, py, pz`
 *   - util.js 的 makeGlowTexture 注释写着「用于花粉 / 萤火虫粒子」，但零引用
 *   这里把它们真正接上。
 *
 * 性能：全部用 Sprite（每张一次 draw call，但数量很少），烟约 5×7=35 张、
 *       萤火虫 26 张，合计 60 出头。相比 terrain 那个合并网格可以忽略。
 * ------------------------------------------------------------------ */

/** 烟：从一个口往上飘，越飘越大越淡，到顶重来
 *  ★每个烟囱可以单独「关掉」或「烧旺」：离线那户不冒烟，繁忙那户冒得更急更浓。 */
export function buildSmoke(spots, rng) {
  const group = new THREE.Group();
  const tex = makeGlowTexture(48);
  const perChimney = 7;
  const puffs = [];
  const chimneys = [];

  for (const spot of spots) {
    const mine = [];
    for (let i = 0; i < perChimney; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xf2ece0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 3;
      group.add(sprite);
      const puff = {
        sprite,
        mat,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        // 相位错开，别让七团烟同步冒
        phase: (i / perChimney) + rng() * 0.12,
        drift: (rng() - 0.5) * 0.5,
        wobble: rng() * 6.28,
      };
      puffs.push(puff);
      mine.push(puff);
    }
    chimneys.push({ puffs: mine, speed: 1, strength: 1 });
  }

  return {
    group,
    chimneys,
    /** 每个烟囱的强度：0 = 完全不冒（离线），>1 = 更急更浓（繁忙） */
    setIntensity(index, level) {
      const c = chimneys[index];
      if (!c) return;
      c.strength = Math.max(0, Math.min(2, level));
    },
    update(time) {
      for (const p of puffs) {
        p.sprite.visible = false;   // 先收起，下面按各自烟囱的强度决定谁亮
      }
      for (const c of chimneys) {
        if (c.strength <= 0.02) continue;
        const speed = 0.26 * c.strength;
        for (const p of c.puffs) {
          const n = (time * speed + p.phase) % 1;          // 0→1 一生的进度
          const rise = n * (2.5 + c.strength * 0.6);
          p.sprite.visible = true;
          p.sprite.position.set(
            p.x + p.drift * n + Math.sin(time * 0.8 + p.wobble) * 0.14 * n,
            p.y + rise,
            p.z + Math.cos(time * 0.7 + p.wobble) * 0.14 * n
          );
          const s = (0.30 + n * 1.05) * (0.85 + c.strength * 0.22);   // 越飘越大
          p.sprite.scale.set(s, s, 1);
          // 淡入很快、淡出很慢，读起来才像烟而不是一串圆点
          const peak = 0.42 * Math.min(1.6, c.strength);
          p.mat.opacity = n < 0.18 ? (n / 0.18) * peak : peak * (1 - (n - 0.18) / 0.82);
        }
      }
    },
  };
}

/** 萤火虫：夜里在树丛附近打转；白天整层收掉，不浪费绘制 */
export function buildFireflies(count, bounds, rng) {
  const group = new THREE.Group();
  const tex = makeGlowTexture(48);
  const bugs = [];

  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: 0xfff0a8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 4;
    group.add(sprite);
    bugs.push({
      sprite,
      mat,
      cx: bounds.x1 + rng() * (bounds.x2 - bounds.x1),
      cz: bounds.z1 + rng() * (bounds.z2 - bounds.z1),
      radius: 0.9 + rng() * 2.1,
      speed: 0.18 + rng() * 0.26,
      phase: rng() * Math.PI * 2,
      blink: 0.7 + rng() * 1.5,
      blinkPhase: rng() * 6.28,
      y: 0.55 + rng() * 1.15,
    });
  }

  return {
    group,
    /** night = 0 白天整层隐藏，1 夜里最亮 */
    update(time, night = 0) {
      const vis = night > 0.05;
      if (group.visible !== vis) group.visible = vis;
      if (!vis) return;
      for (const b of bugs) {
        const a = time * b.speed + b.phase;
        b.sprite.position.set(
          b.cx + Math.cos(a) * b.radius,
          b.y + Math.sin(time * 0.9 + b.phase) * 0.28,
          b.cz + Math.sin(a * 0.8) * b.radius
        );
        // 一闪一闪：亮度和尺寸一起呼吸
        const blink = 0.45 + 0.55 * Math.max(0, Math.sin(time * b.blink + b.blinkPhase));
        b.mat.opacity = night * blink * 0.85;
        const s = 0.16 + blink * 0.1;
        b.sprite.scale.set(s, s, 1);
      }
    },
  };
}
