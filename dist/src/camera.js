import * as THREE from 'three';
import { MAP } from './config.js?v=1.8.8';
import { clamp, damp } from './util.js?v=1.8.8';

/* ------------------------------------------------------------------ *
 * 斜俯视正交镜头：视野高 26，机位沿着 (27,32,27) 方向
 * ------------------------------------------------------------------ */

const OFFSET = new THREE.Vector3(27, 32, 27);
const VIEW_HEIGHT = 23.5;

export class TownCamera {
  constructor(aspect = 16 / 9) {
    this.viewHeight = VIEW_HEIGHT;
    this.dir = OFFSET.clone().normalize();
    this.distance = OFFSET.length();

    this.camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 150);
    this.focus = new THREE.Vector3(MAP.x1, 0.85, MAP.z1);
    this._target = new THREE.Vector3();
    this._look = new THREE.Vector3();
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
  }

  snapTo(x, z) {
    this.focus.set(x, 0.85, z);
    this._apply();
  }

  update(dt, x, z, aheadX = 0, aheadZ = 0) {
    const tx = clamp(x + aheadX, MAP.x1 + 9, MAP.x2 - 9);
    const tz = clamp(z + aheadZ, MAP.z1 + 9, MAP.z2 - 9);
    this.focus.x = damp(this.focus.x, tx, 4.8, dt);
    this.focus.z = damp(this.focus.z, tz, 4.8, dt);
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
