// Level-select thumbnails, rendered once from the real level data (so they never go stale) on a
// throwaway canvas, then cached as image URLs.
import * as THREE from 'three';
import { World } from './scene.js';
import { viewBasis } from './walkability.js';

const W = 320, H = 240;
let cache = null;

export function levelThumbs(levels) {
  if (cache) return cache;
  cache = new Map();
  const canvas = document.createElement('canvas');
  const world = new World(canvas);
  world.renderer.setPixelRatio(1);
  world.renderer.setSize(W, H, false);
  const root = document.documentElement.style;
  const sky = [root.getPropertyValue('--sky-a'), root.getPropertyValue('--sky-b')]; // build() repaints the page sky
  const cam = new THREE.OrthographicCamera();
  for (const level of levels) {
    world.build(level);
    const { v, r, u } = viewBasis(level.startAngle ?? 45);
    // Frame every block corner tightly on screen.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const c = world.center;
    for (const b of level.blocks) for (let i = 0; i < 8; i++) {
      const p = [b.x + (i & 1) - c.x, b.y + ((i >> 1) & 1) - c.y, b.z + ((i >> 2) & 1) - c.z];
      const sx = p[0] * r[0] + p[1] * r[1] + p[2] * r[2], sy = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const pad = 0.6, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const half = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / (W / H)) + pad;
    Object.assign(cam, { left: mx - half * (W / H), right: mx + half * (W / H), top: my + half, bottom: my - half, near: 0.1, far: 200 });
    cam.updateProjectionMatrix();
    cam.position.set(c.x + v[0] * 60, c.y + v[1] * 60, c.z + v[2] * 60);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    world.render(cam, false);
    world.render(cam, false); // a fresh context's first frame can come out black
    cache.set(level.id, canvas.toDataURL('image/png'));
  }
  root.setProperty('--sky-a', sky[0]);
  root.setProperty('--sky-b', sky[1]);
  world.renderer.dispose();
  world.renderer.forceContextLoss();
  return cache;
}
