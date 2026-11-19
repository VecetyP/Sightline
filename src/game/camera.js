// Orthographic orbit camera: free yaw rotation (RMB drag, Q/E) + ease-out snap to alignment angles.
import * as THREE from 'three';
import { viewBasis, nearestAngle } from './walkability.js';
import { save } from './save.js';

const KEY_SPEED = 100; // deg/s at sensitivity 1
const DRAG_SPEED = 0.35; // deg/px

export class CameraRig {
  constructor(dom) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.center = new THREE.Vector3();
    this.radius = 6;
    this.yaw = 45;
    this.angles = [45, 135, 225, 315];
    this.snapped = null; // alignment angle while settled on one
    this.enabled = false; // player input
    this.auto = 0; // deg/s auto-spin (home screen diorama)
    this.zoom = 1;
    this.offsetPx = 0; // shift the view right by this many screen pixels (home sidebar)
    this.onChange = () => {}; // (snappedAngle|null) whenever the walkable view changes
    this.onRotateInput = () => {};
    this.held = new Set();
    this.dragging = false;
    this.tween = null;

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 2 || !this.enabled) return;
      this.dragging = true;
      this.lastX = e.clientX;
      dom.setPointerCapture(e.pointerId);
      this.beginRotate();
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.yaw -= dx * DRAG_SPEED * save.settings.sensitivity * (save.settings.invertDrag ? -1 : 1);
    });
    const end = () => { if (this.dragging) { this.dragging = false; this.release(); } };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.7, 1.8);
      this.resize();
    }, { passive: false });
  }

  keyDown(k) {
    if (!this.enabled || (k !== 'q' && k !== 'e') || this.held.has(k)) return;
    this.held.add(k);
    this.beginRotate();
  }

  keyUp(k) {
    if (!this.held.delete(k)) return;
    if (!this.held.size && !this.dragging) this.release();
  }

  stopInput() {
    this.held.clear();
    if (this.dragging) { this.dragging = false; this.release(); }
  }

  beginRotate() {
    this.tween = null;
    this.onRotateInput();
    if (this.snapped !== null) { this.snapped = null; this.onChange(null); }
  }

  release() {
    const { angle, dist } = nearestAngle(this.yaw, this.angles);
    if (angle === null || dist > save.settings.snapThreshold) { this.onChange(null); return; }
    const delta = ((((angle - this.yaw) % 360) + 540) % 360) - 180;
    const ms = save.settings.reducedMotion ? 0 : 250;
    this.tween = { from: this.yaw, to: this.yaw + delta, t: 0, ms, angle };
    if (ms === 0) this.update(0);
  }

  // Ease back to a snapped angle (a turn the game refused, or undo restoring the view).
  turnTo(angle) {
    this.held.clear();
    this.dragging = false;
    if (this.snapped !== null) { this.snapped = null; this.onChange(null); }
    this.yaw = ((this.yaw % 360) + 360) % 360;
    const delta = ((((angle - this.yaw) % 360) + 540) % 360) - 180;
    const ms = save.settings.reducedMotion ? 0 : 300;
    this.tween = { from: this.yaw, to: this.yaw + delta, t: 0, ms, angle };
    if (ms === 0) this.update(0);
  }

  setLevel(center, radius, angles, startYaw) {
    this.center.copy(center);
    this.radius = radius;
    this.angles = angles;
    this.yaw = startYaw;
    this.tween = null;
    this.held.clear();
    this.dragging = false;
    const n = nearestAngle(startYaw, angles);
    this.snapped = n.dist < 1e-6 ? n.angle : null;
    this.resize();
    this.apply();
  }

  resize() {
    const aspect = innerWidth / innerHeight;
    const h = (this.radius * 1.05) / this.zoom;
    const half = Math.max(h, (this.radius * 1.05) / aspect / this.zoom);
    const dx = (this.offsetPx / innerWidth) * 2 * half * aspect;
    this.camera.left = -half * aspect - dx;
    this.camera.right = half * aspect - dx;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  apply() {
    const { v } = viewBasis(this.yaw);
    this.camera.position.set(this.center.x + v[0] * 60, this.center.y + v[1] * 60, this.center.z + v[2] * 60);
    this.camera.lookAt(this.center);
    this.camera.updateMatrixWorld();
  }

  get rotating() {
    return this.dragging || this.held.size > 0 || !!this.tween;
  }

  update(dt) {
    if (this.auto) this.yaw += this.auto * dt;
    if (this.held.size) {
      const dir = (this.held.has('q') ? 1 : 0) - (this.held.has('e') ? 1 : 0);
      this.yaw += dir * KEY_SPEED * save.settings.sensitivity * dt;
    }
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt * 1000;
      const k = tw.ms ? Math.min(1, tw.t / tw.ms) : 1;
      this.yaw = tw.from + (tw.to - tw.from) * (1 - Math.pow(1 - k, 3));
      if (k >= 1) {
        this.yaw = tw.angle;
        this.tween = null;
        this.snapped = tw.angle;
        this.apply();
        this.onChange(tw.angle);
      }
    }
    this.apply();
  }
}
