import * as THREE from 'three';
import { createCharacter, animateIdle, animateWalk } from './character.js';
import { dampAngle } from './util.js';
import { NPCS } from './config.js';
import { addCircleCollider } from './collision.js';

/* ------------------------------------------------------------------ *
 * 三位村民：露露、阿禾、诺亚
 * ------------------------------------------------------------------ */

function hexToInt(hex, fallback) {
  if (typeof hex === 'number') return hex;
  if (typeof hex === 'string' && hex.startsWith('#')) return parseInt(hex.slice(1), 16);
  return fallback;
}

export function buildInhabitants(material, interactables) {
  const group = new THREE.Group();
  const npcs = [];

  for (const def of NPCS) {
    const rig = createCharacter(material, {
      shirt: hexToInt(def.shirt, 0xd98578),
      pants: hexToInt(def.pants, 0x6d8294),
      accent: hexToInt(def.accent, 0xf3cf7d),
      hair: hexToInt(def.hair, 0x71503d),
      hat: def.hat ? hexToInt(def.hat, 0xc99a58) : undefined,
      skirt: def.id === 'lulu',
      rod: def.id === 'ahe',
      staff: def.id === 'noah',
    });
    rig.root.position.set(def.x, 0.09, def.z);
    rig.root.rotation.y = Math.atan2(-def.x, -def.z) + 0.4;
    group.add(rig.root);

    const npc = {
      def,
      rig,
      baseFacing: rig.root.rotation.y,
      lineIndex: 0,
      phase: Math.random() * Math.PI * 2,
      nextLine() {
        const line = def.lines[this.lineIndex % def.lines.length];
        this.lineIndex++;
        return { kind: 'say', name: def.name, text: line };
      },
    };
    npcs.push(npc);
    addCircleCollider(def.x, def.z, 0.4);

    interactables.push({
      kind: 'villager',
      x: def.x,
      z: def.z,
      anchorY: 2.55,
      radius: 1.95,
      prompt: `和${def.name}聊聊`,
      available: () => true,
      interact: () => npc.nextLine(),
      ref: npc,
    });
  }

  return {
    group,
    npcs,
    /**
     * 让某个村民去一趟指定位置（掉线时「去看看那户人家」）。
     * @param {number} idx 第几个村民
     * @param {{x:number,z:number}} dest 目标（房子门口）
     * @param {number} ms 走过去最长用时；到点自动结束
     * @returns {boolean} 是否成功派出
     */
    sendTo(idx, dest, ms = 9000) {
      const npc = npcs[idx];
      if (!npc || !dest) return false;
      npc.errand = {
        from: { x: npc.rig.root.position.x, z: npc.rig.root.position.z },
        to: { x: dest.x, z: dest.z },
        t0: performance.now(),
        ms,
      };
      return true;
    },
    /** 派出去的村民回自己原来的位置 */
    recall(idx) {
      const npc = npcs[idx];
      if (!npc) return;
      // 已经在自己家就不用再召回
      const dx = npc.rig.root.position.x - npc.def.x;
      const dz = npc.rig.root.position.z - npc.def.z;
      if (dx * dx + dz * dz < 0.04) { npc.errand = null; return; }
      npc.errand = {
        from: { x: npc.rig.root.position.x, z: npc.rig.root.position.z },
        to: { x: npc.def.x, z: npc.def.z },
        t0: performance.now(),
        ms: 9000,
      };
    },
    /** 走过去守着（到点停住，不自动结束；由 recall 召回） */
    hold(idx) {
      const npc = npcs[idx];
      if (npc && npc.errand) npc.errand.hold = true;
    },
    errandOf(idx) {
      const n = npcs[idx];
      if (!n || !n.errand) return null;
      const p = n.errand;
      return { from: p.from, to: p.to, left: Math.max(0, p.ms - (performance.now() - p.t0)) };
    },
    update(dt, time, playerPos) {
      const now = performance.now();
      for (const npc of npcs) {
        // ---- 跑腿：沿直线移过去，走完就停在目的地 ----
        if (npc.errand) {
          const e = npc.errand;
          const k = Math.min(1, (now - e.t0) / e.ms);
          // easeInOut，起步和停下都不突兀
          const t = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          const nx = e.from.x + (e.to.x - e.from.x) * t;
          const nz = e.from.z + (e.to.z - e.from.z) * t;
          npc.rig.root.position.x = nx;
          npc.rig.root.position.z = nz;
          const dx = e.to.x - nx;
          const dz = e.to.z - nz;
          if (dx * dx + dz * dz > 0.01) {
            npc.rig.root.rotation.y = dampAngle(npc.rig.root.rotation.y, Math.atan2(dx, dz), 6, dt);
          }
          // 走路时腿要动起来（原来是原地 idle）
          // animateWalk(rig, phase, 幅度, 时间)：phase 用「累计路程」推，走起来才像走路
          npc.walkPhase = (npc.walkPhase || 0) + dt * (k < 1 ? 11 : 2);
          animateWalk(npc.rig, npc.walkPhase, k < 1 ? 1 : 0.25, time);
          /* ★走完必须结束这趟跑腿：否则 errand 永远挂着，
             update 每帧都走这个分支 → 村民再也回不到 idle、也不会被玩家靠近吸引。
             ★判据是「到点」而不是「到家」：原来只在目的地等于自己家、
               距离 < 0.25 时才清 errand，于是「去别处跑一趟」这种一次性差事
               永远结束不了（验收口 probeErrand(idx, 任意点) 一调就能复现村民原地抽搐）。
               现在 hold=true 表示「守在门口等 recall」，其余一律到点即收工。 */
          if (k >= 1) {
            if (e.hold) {
              // 守着：停在目标点，只做 idle 呼吸（由 recall 明确召回）
              npc.rig.root.position.x = e.to.x;
              npc.rig.root.position.z = e.to.z;
              animateIdle(npc.rig, time, npc.phase);
            } else {
              npc.errand = null;   // 一次性差事：走完就交差
            }
          }
          continue;
        }
        const dx = playerPos.x - npc.def.x;
        const dz = playerPos.z - npc.def.z;
        const near = dx * dx + dz * dz < 16;
        const target = near ? Math.atan2(dx, dz) : npc.baseFacing;
        npc.rig.root.rotation.y = dampAngle(npc.rig.root.rotation.y, target, 4.5, dt);
        animateIdle(npc.rig, time, npc.phase);
      }
    },
  };
}
