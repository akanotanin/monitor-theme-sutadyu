import * as THREE from 'three';
import { createCharacter, animateWalk, animateIdle } from './character.js?v=1.8.4';
import { isWalkable, groundHeight } from './collision.js?v=1.8.4';
import { damp, dampAngle } from './util.js?v=1.8.4';
import { PLAYER_START } from './config.js?v=1.8.4';

export const PLAYER_RADIUS = 0.34;
const WALK_SPEED = 4.15;

/* ------------------------------------------------------------------ *
 * 玩家：镜头相对移动 + 分轴碰撞 + 走路动画
 * ------------------------------------------------------------------ */

export class Player {
  constructor(material) {
    this.rig = createCharacter(material, {
      shirt: 0xe8eee0,
      pants: 0x607d86,
      accent: 0xc56f50,
      hair: 0x654b3d,
      backpack: true,
    });
    this.root = this.rig.root;
    this.radius = PLAYER_RADIUS;
    this.pos = new THREE.Vector3(PLAYER_START.x, 0, PLAYER_START.z);
    this.vel = new THREE.Vector3();
    this.phase = 0;
    this.facing = Math.PI * 0.25;
    this.visualY = 0.09;
    this.speed = 0;
    this.root.position.set(PLAYER_START.x, this.visualY, PLAYER_START.z);
    this.root.rotation.y = this.facing;
  }

  teleport(x, z) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.root.position.set(x, groundHeight(x, z), z);
  }

  update(dt, moveDir, running, time, frozen = false) {
    const maxSpeed = running ? WALK_SPEED * 1.55 : WALK_SPEED;
    const moving = !frozen && moveDir.lengthSq() > 1e-4;

    const tx = moving ? moveDir.x * maxSpeed : 0;
    const tz = moving ? moveDir.z * maxSpeed : 0;
    this.vel.x = damp(this.vel.x, tx, moving ? 16 : 20, dt);
    this.vel.z = damp(this.vel.z, tz, moving ? 16 : 20, dt);

    const nx = this.pos.x + this.vel.x * dt;
    if (isWalkable(nx, this.pos.z, this.radius)) this.pos.x = nx;
    else this.vel.x = 0;

    const nz = this.pos.z + this.vel.z * dt;
    if (isWalkable(this.pos.x, nz, this.radius)) this.pos.z = nz;
    else this.vel.z = 0;

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.25) {
      this.facing = dampAngle(this.facing, Math.atan2(this.vel.x, this.vel.z), 14, dt);
    }

    const gy = groundHeight(this.pos.x, this.pos.z);
    this.visualY = damp(this.visualY, gy, 14, dt);
    this.root.position.set(this.pos.x, this.visualY, this.pos.z);
    this.root.rotation.y = this.facing;

    if (this.speed > 0.2) {
      this.phase += dt * 10;
      animateWalk(this.rig, this.phase, Math.min(1.2, this.speed / WALK_SPEED), time);
    } else {
      animateIdle(this.rig, time);
    }
    return this.speed;
  }
}
