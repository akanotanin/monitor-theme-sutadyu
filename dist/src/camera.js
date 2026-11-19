import * as THREE from 'three';
import { MAP } from './config.js?v=1.8.13';
import { clamp, damp } from './util.js?v=1.8.13';

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

  /** 钉住镜头（详情页打开时用）：update() 里的玩家坐标不再生效，直到 unpin() */
  pin(x, z) {
    this._pin = { x, z };
  }

  unpin() {
    this._pin = null;
  }

  update(dt, x, z, aheadX = 0, aheadZ = 0) {
    const px = this._pin ? this._pin.x : x + aheadX;
    const pz = this._pin ? this._pin.z : z + aheadZ;
    // 钉住时允许贴到地图边（详情页要看边上的机器），跟随时才留 9 格的余量
    const margin = this._pin ? 2 : 9;
    const tx = clamp(px, MAP.x1 + margin, MAP.x2 - margin);
    const tz = clamp(pz, MAP.z1 + margin, MAP.z2 - margin);
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
