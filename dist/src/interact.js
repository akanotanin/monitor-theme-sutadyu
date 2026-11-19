import * as THREE from 'three';
import { ui } from './ui.js?v=1.8.7';

/* ------------------------------------------------------------------ *
 * 互动管理：找出最近的可交互对象，把按键提示投到屏幕对应位置
 * ------------------------------------------------------------------ */

export class InteractionManager {
  constructor(interactables) {
    this.items = interactables;
    this.current = null;
    this._anchor = new THREE.Vector3();
  }

  update(camera, playerPos, width, height, enabled = true) {
    if (!enabled || ui.noticeOpen) {
      this.current = null;
      ui.hidePrompt();
      return null;
    }

    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.available || !it.available()) continue;
      const dx = it.x - playerPos.x;
      const dz = it.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d > it.radius) continue;
      // 小鸡（server）让一让：贴着村民时优先说人话
      const score = d - (it.kind === 'server' ? 0 : 0.35);
      if (score < bestDist) {
        bestDist = score;
        best = it;
      }
    }

    this.current = best;
    if (!best) {
      ui.hidePrompt();
      return null;
    }

    this._anchor.set(best.x, best.anchorY ?? 2.0, best.z);
    const screen = ui.projectToScreen(this._anchor, camera, width, height);
    if (!screen) {
      ui.hidePrompt();
      return best;
    }
    ui.showPrompt(best.prompt, screen.x, screen.y);
    return best;
  }

  /** 按下 E 时触发，返回给 main 处理的结果对象 */
  interact() {
    if (!this.current) return null;
    return this.current.interact ? this.current.interact() : null;
  }
}
