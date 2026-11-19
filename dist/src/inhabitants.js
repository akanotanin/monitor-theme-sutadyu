import * as THREE from 'three';
import { createCharacter, animateIdle } from './character.js?v=1.8.8';
import { dampAngle } from './util.js?v=1.8.8';
import { NPCS } from './config.js?v=1.8.8';
import { addCircleCollider } from './collision.js?v=1.8.8';

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
    update(dt, time, playerPos) {
      for (const npc of npcs) {
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
