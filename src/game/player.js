// The character ("Pip"): a round little figure with a leaf cap and a scarf.
// Handles visuals and move tweening; the session in main.js owns tile logic and undo history.
import * as THREE from 'three';
import { standPoint } from './walkability.js';
import { save } from './save.js';

const MOVE_MS = 180;

export class Player {
  constructor(scene) {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // bob / hop / spin
    this.root.add(this.body);
    this.root.scale.setScalar(1.3);
    scene.add(this.root);

    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const cream = lam('#FFF8EE'), cocoa = new THREE.MeshBasicMaterial({ color: '#5B4A3F' });
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), cream);
    torso.scale.set(1, 1.08, 1);
    torso.position.y = 0.22;
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 10, 24), lam('#E7B7B9'));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.3;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.04), lam('#E7B7B9'));
    tail.position.set(0.08, 0.24, -0.17);
    tail.rotation.z = 0.3;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), lam('#B7CBB0'));
    cap.position.y = 0.4;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), lam('#9DBB94'));
    leaf.position.set(0.02, 0.56, 0);
    leaf.rotation.z = -0.5;
    const eye = new THREE.SphereGeometry(0.022, 8, 8);
    const e1 = new THREE.Mesh(eye, cocoa), e2 = new THREE.Mesh(eye, cocoa);
    e1.position.set(-0.065, 0.27, 0.185);
    e2.position.set(0.065, 0.27, 0.185);
    const cheek = new THREE.CircleGeometry(0.03, 12), pink = new THREE.MeshBasicMaterial({ color: '#F2A9A8' });
    const c1 = new THREE.Mesh(cheek, pink), c2 = new THREE.Mesh(cheek, pink);
    c1.position.set(-0.11, 0.22, 0.17);
    c2.position.set(0.11, 0.22, 0.17);
    c1.rotation.y = -0.5;
    c2.rotation.y = 0.5;
    this.body.add(torso, scarf, tail, cap, leaf, e1, e2, c1, c2);

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshBasicMaterial({ color: '#5B4A3F', transparent: true, opacity: 0.16, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.root.add(this.shadow);

    // Small ground triangle showing where W walks. Pointing direction is set every frame.
    const tri = new THREE.Shape([new THREE.Vector2(0, 0.12), new THREE.Vector2(-0.1, -0.05), new THREE.Vector2(0.1, -0.05)]);
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshBasicMaterial({ color: '#5B4A3F', transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    arrow.rotation.x = Math.PI / 2; // shape +Y -> world +Z, lying flat
    arrow.position.set(0, 0.015, 0.4);
    this.arrow = new THREE.Group();
    this.arrow.add(arrow);
    this.root.add(this.arrow);

    this.tween = null;
    this.spin = 0;
    this.time = 0;
  }

  place(block) {
    const c = standPoint(block);
    this.root.position.set(c[0], c[1], c[2]);
    this.tween = null;
    this.body.position.y = 0;
  }

  face(dir) {
    this.body.rotation.y = Math.atan2(dir[0], dir[1]);
  }

  get busy() {
    return !!this.tween;
  }

  // Straight 3D lerp: orthographic projection is affine, so on screen this is a normal one-tile
  // step even when the destination is at a different depth. Arrival snaps to the real tile.
  moveTo(block, dir, done) {
    const c = standPoint(block);
    this.face(dir);
    const from = this.root.position.clone(), to = new THREE.Vector3(c[0], c[1], c[2]);
    // A real step up or down (onto or off a stair's half-step) would cut through the higher edge; hop over it.
    const dy = Math.abs(to.y - from.y), flat = Math.hypot(to.x - from.x, to.z - from.z);
    const real = dy > 0 && dy <= 1 && flat <= 1.3;
    this.tween = { from, to, t: 0, done, hop: real ? 0.55 : 0 };
  }

  bump(dir) {
    if (this.tween) return;
    this.face(dir);
    this.tween = { from: this.root.position.clone(), to: this.root.position.clone(), t: 0, bump: dir };
  }

  // Drop straight down out of the world (the shade under Pip went away).
  fall(done) {
    const from = this.root.position.clone();
    this.tween = { from, to: from.clone().setY(from.y - 6), t: 0, done, ms: 650, fall: true };
  }

  pointW(dir) {
    this.arrow.rotation.y = Math.atan2(dir[0], dir[1]);
  }

  celebrate() {
    this.spin = 1;
  }

  update(dt) {
    this.time += dt;
    const reduced = save.settings.reducedMotion;
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + (dt * 1000) / (tw.ms || MOVE_MS));
      const k = tw.fall ? tw.t * tw.t : tw.t;
      this.root.position.lerpVectors(tw.from, tw.to, k);
      if (tw.hop) this.root.position.y += Math.sin(k * Math.PI) * tw.hop;
      if (tw.bump) {
        const s = Math.sin(k * Math.PI) * 0.08;
        this.root.position.x += tw.bump[0] * s;
        this.root.position.z += tw.bump[1] * s;
      }
      this.body.position.y = reduced || tw.fall ? 0 : Math.sin(k * Math.PI) * 0.18;
      if (k >= 1) {
        this.tween = null;
        this.body.position.y = 0;
        tw.done && tw.done();
      }
    } else if (!reduced) {
      this.body.position.y = Math.abs(Math.sin(this.time * 2.2)) * 0.025;
    }
    if (this.spin > 0) {
      this.spin = Math.max(0, this.spin - dt / 1.1);
      const k = 1 - this.spin;
      this.body.rotation.y += dt * (reduced ? 0 : 14) * (1 - k);
      this.body.position.y = reduced ? 0 : Math.sin(k * Math.PI) * 0.35;
    }
    this.arrow.visible = !this.tween && this.spin === 0;
    const sq = this.tween ? 1 : 1 + Math.sin(this.time * 4.4) * (reduced ? 0 : 0.015);
    this.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  }
}
