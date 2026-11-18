// Walkability: "what you see is what you walk".
// Pure math + one optional GPU picking pass. Shared by the game and scripts/check-levels.js.
import * as THREE from 'three';

// True isometric pitch: one vertical unit looks exactly like one diagonal grid step,
// so blocks at different depths can line up perfectly on screen.
export const PITCH = Math.atan(1 / Math.SQRT2);
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // grid directions (dx, dz)

const STEP_TOL = 0.05; // world units on screen
// Fraction of a top face that must be unobstructed. A tile half-hidden behind a block's side still
// reads as walkable ground, so only mostly-covered tops count as gaps.
const VIS_THRESHOLD = 0.34;
// Sample offsets inside a top face. Chosen so no sample lies on a projected block edge
// at any isometric angle (frac(x) != frac(z), frac(x)+frac(z) != 1, neither is 0 or 0.5).
const SX = [0.1, 0.3, 0.4, 0.7, 0.9]; // no 0.5: stair slabs split tiles at the half
const SZ = [0.14, 0.34, 0.54, 0.74, 0.94];

const key = (x, y, z) => `${x},${y},${z}`;

export function viewBasis(yawDeg) {
  const t = (yawDeg * Math.PI) / 180, c = Math.cos(PITCH), s = Math.sin(PITCH);
  const v = [c * Math.sin(t), s, c * Math.cos(t)]; // unit vector pointing toward the camera
  const r = [Math.cos(t), 0, -Math.sin(t)]; // screen right
  const u = [v[1] * r[2] - v[2] * r[1], v[2] * r[0] - v[0] * r[2], v[0] * r[1] - v[1] * r[0]]; // screen up
  return { v, r, u };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const topCenter = (b) => [b.x + 0.5, b.y + 1, b.z + 0.5];
// Where the character stands: the middle of the top, or on a stair, the middle of its half-step slab.
export const standPoint = (b) => (b.slab ? [(b.slab[0] + b.slab[3]) / 2, b.slab[4], (b.slab[2] + b.slab[5]) / 2] : topCenter(b));

// Resolve block positions for a given plate state and pushed-block state.
// Each block gets a stable id (its index). `pushed` maps a push block's id to [x,y,z], or null once it fell off.
export function buildState(level, plates = [], pushed = {}, opts = {}) {
  const blocks = level.blocks.map((b, id) => ({ id, x: b.x, y: b.y, z: b.z, type: b.type, base: b }));
  (level.moving || []).forEach((m, i) => {
    if (!plates[i]) return;
    const members = new Set(m.blocks.map((p) => key(...p)));
    for (const b of blocks) {
      if (!members.has(key(b.base.x, b.base.y, b.base.z))) continue;
      if (m.dy) b.y += m.dy;
      if (m.rotate) {
        const [px, pz] = m.rotate.pivot;
        for (let t = 0; t < (m.rotate.turns || 1); t++) {
          const dx = b.x - px, dz = b.z - pz;
          b.x = px - dz; b.z = pz + dx;
        }
      }
    }
  });
  for (const [id, p] of Object.entries(pushed)) {
    const b = blocks[id];
    if (p) [b.x, b.y, b.z] = p;
    else b.gone = true;
  }
  const solid = blocks.filter((b) => !b.gone);
  const occupied = new Map(solid.map((b) => [key(b.x, b.y, b.z), b]));
  // Push blocks are walkable on top: shove one into a gap and it becomes a bridge.
  const tiles = solid.filter((b) => b.type !== 'decor' && !occupied.has(key(b.x, b.y + 1, b.z)));
  // A stair carries a half-height step slab on the side facing its upper tile (drawn in scene.js).
  // It is a real occluder and lifts that half of the stair's top, so visibility must see it too.
  for (const b of tiles) if (b.type === 'stair') {
    const hi = tiles.find((t) => t.y === b.y + 1 && Math.abs(t.x - b.x) + Math.abs(t.z - b.z) === 1);
    if (!hi) continue;
    const dx = hi.x - b.x, dz = hi.z - b.z;
    b.slab = [b.x + (dx > 0 ? 0.5 : 0), b.y + 1, b.z + (dz > 0 ? 0.5 : 0), b.x + (dx < 0 ? 0.5 : 1), b.y + 1.5, b.z + (dz < 0 ? 0.5 : 1)];
  }
  // Mist (world 5) only holds where something blocks the level's light: shade is solid ground.
  // `light` points toward the light; at 45° along a grid axis every shadow covers whole tiles.
  for (const b of solid) if (b.type === 'mist') b.shaded = !!level.light && isShaded(b, level.light, solid);
  const walk = tiles.filter((b) => b.type !== 'mist' || (b.shaded && opts.shade !== false));
  const minY = Math.min(...level.blocks.map((b) => b.y));
  return { blocks, solid, tiles: walk, occupied, minY };
}

export const PUSHABLE = ['push', 'lantern'];

// Walking into a push block (at the character's height, one tile over) shoves it one tile.
// If nothing holds it up it falls. A lantern block with the camera snapped (yawDeg set) falls the way it looks:
// straight down the screen, onto the first top drawn below it, at whatever depth that top really is.
// Plain push blocks, and lanterns under a free camera, fall straight down in 3D. Off the world either way when nothing catches it.
// The character steps into the freed spot when there is ground there. Returns null when the push is not possible.
export function tryPush(state, from, [dx, dz], yawDeg = null) {
  const b = state.occupied.get(key(from.x + dx, from.y + 1, from.z + dz));
  if (!b || !PUSHABLE.includes(b.type) || state.occupied.has(key(b.x, b.y + 1, b.z))) return null;
  const x = b.x + dx, z = b.z + dz;
  let y = b.y;
  if (state.occupied.has(key(x, y, z))) return null;
  const floor = state.occupied.get(key(from.x + dx, from.y, from.z + dz));
  // ponytail: mist shade is judged before the push; a push that moves the shade itself needs a recheck after.
  const step = floor && floor.type !== 'decor' && (floor.type !== 'mist' || floor.shaded) ? floor.id : null;
  let pos = null, via = null, missed = false;
  if (state.occupied.has(key(x, y - 1, z))) pos = [x, y, z];
  else if (yawDeg !== null && b.type === 'lantern') ({ pos, via, missed } = landOnScreen(state, b, [x, y, z], [from, floor], yawDeg));
  if (!pos) { // ordinary gravity
    while (y >= state.minY && !state.occupied.has(key(x, y - 1, z))) y--;
    pos = y < state.minY ? null : [x, y, z];
  }
  return { id: b.id, pos, via, step, missed };
}

// Which top is drawn straight below the falling block's base on screen? Tops of any block with nothing on
// them count (decor too), if they are visible with the falling block itself out of the way. Tops in `skip`
// (where the character is, or is about to step) can't catch it. Nearest on screen wins; same spot: front-most.
function landOnScreen(state, b, [x, y, z], skip, yawDeg) {
  const { v, r, u } = viewBasis(yawDeg);
  const solid = state.solid.filter((s) => s !== b);
  const occ = new Set(solid.map((s) => key(s.x, s.y, s.z)));
  const foot = [x + 0.5, y, z + 0.5], fx = dot(foot, r), fy = dot(foot, u);
  const cands = [];
  for (const t of solid) {
    if (occ.has(key(t.x, t.y + 1, t.z)) || skip.includes(t)) continue;
    const c = topCenter(t), tx = dot(c, r), ty = dot(c, u);
    if (Math.abs(tx - fx) > STEP_TOL || ty > fy + STEP_TOL) continue;
    // A top hidden behind a block it will only touch once the lantern sits on it still catches it; the drop
    // check below decides. `seen` tops are the ones a player reads as "right under it".
    const pts = facePoints(t);
    cands.push({ t, ty, d: dot(c, v), seen: topSeen(solid, t, v) });
  }
  // Highest on screen first; same height: front-most. It has to stay in plain view the whole way. Where it was
  // pushed to and the cell right above the landing top (`via`) look identical from this angle, so it swaps
  // there unseen and drops straight down that column, which must be uncovered all the way.
  const height = (ty) => Math.round((fy - ty) / u[1]);
  // Nearest in depth catches it: the fewest hidden view-line cells first (k = 0 is a real block straight below),
  // then the highest on screen. A top far behind or in front of the lantern can't catch it just because it's
  // drawn higher (L20 report: a top two cells back caught it instead of the block right below).
  for (const c of cands) c.k = c.t.y + 1 + height(c.ty) - y;
  cands.sort((a, c) => Math.abs(a.k) - Math.abs(c.k) || (Math.abs(a.ty - c.ty) > STEP_TOL ? c.ty - a.ty : c.d - a.d));
  // ponytail: samples whole-cell steps of the drop; a sliver covered only between two cells would slip through.
  // The swap to `via` moves it k cells along the view line (k > 0: toward the camera). It must go the way it was
  // pushed: pushed away but landing nearer reads as moving backwards (L13 315° report), pushed toward but landing
  // farther reads as poking out from behind whatever is in front (L17 report).
  const toward = (x - b.x) * Math.sign(v[0]) + (z - b.z) * Math.sign(v[2]) > 0;
  const clear = ({ t, ty, k }) => {
    if (toward ? k < 0 : k > 0) return false;
    if (!inPlainView(solid, [x, y, z], v)) return false;
    // Where it comes to rest only its top must show: nearer blocks may hide its sides, like a block dropped into a slot.
    for (let s = 0; s <= height(ty); s++) if (!inPlainView(solid, [t.x, t.y + 1 + s, t.z], v, s === 0)) return false;
    return true;
  };
  const hit = cands.find(clear);
  // missed: it fell past a top that looks like it's right under it (a level should never show this).
  const firstSeen = cands.find((c) => c.seen);
  const missed = !!firstSeen && cands.indexOf(firstSeen) < (hit ? cands.indexOf(hit) : Infinity);
  if (!hit) return { pos: null, via: null, missed };
  const { t } = hit;
  return { pos: [t.x, t.y + 1, t.z], via: [t.x, t.y + 1 + height(hit.ty), t.z], missed };
}

// Is a block at `pos` fully uncovered on screen? Samples its top and camera-facing sides; a block touching a
// side just hides that face, so it doesn't count as covering it.
const GRID = [0.15, 0.5, 0.85];
function inPlainView(solid, [x, y, z], v, topOnly = false) {
  const faces = [[(a, b) => [x + a, y + 1, z + b], null]];
  const sx = Math.sign(v[0]), sz = Math.sign(v[2]);
  if (sx) faces.push([(a, b) => [x + (sx > 0 ? 1 : 0), y + a, z + b], [x + sx, y, z]]);
  if (sz) faces.push([(a, b) => [x + a, y + b, z + (sz > 0 ? 1 : 0)], [x, y, z + sz]]);
  if (topOnly) {
    // Resting in a slot: the top shows, and each camera-facing side is
    //  'wall': the block touching it is there, or 'open': fully in view, or
    //  'far':  hidden by a nearer block drawn exactly where a touching block would be (same view line), so on
    //          screen it looks like a touching block. Whether being behind that block makes sense is the
    //          depth-follows-push rule's job (landOnScreen), not this one.
    // A side partly hidden by anything else ('bad') looks like it pokes out from behind a block.
    const hidden = (at) => GRID.some((a) => GRID.some((b) => rayBlocked(at(a, b), v, solid, null)));
    if (hidden(faces[0][0])) return false;
    const has = ([cx, cy, cz]) => solid.some((s) => s.x === cx && s.y === cy && s.z === cz);
    const onViewLine = ([cx, cy, cz]) => [1, 2, 3, 4, 5, 6, 7, 8].some((k) => has([cx + k * sx, cy + k, cz + k * sz]));
    const sides = faces.slice(1).map(([at, t]) => (has(t) ? 'wall' : !hidden(at) ? 'open' : onViewLine(t) ? 'far' : 'bad'));
    return !sides.includes('bad');
  }
  for (const [at, touch] of faces) {
    const others = touch ? solid.filter((s) => s.x !== touch[0] || s.y !== touch[1] || s.z !== touch[2]) : solid;
    for (const a of GRID) for (const b of GRID) if (rayBlocked(at(a, b), v, others, null)) return false;
  }
  return true;
}

export const plateIndex = (level, b) =>
  (level.moving || []).findIndex((m) => m.plate[0] === b.base.x && m.plate[1] === b.base.y && m.plate[2] === b.base.z);

// Real 3D adjacency: same height, or one step up onto/off a stair.
function realLink(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
  if (Math.abs(dx) + Math.abs(dz) !== 1) return null;
  if (dy === 0) return { dir: [dx, dz], stair: false };
  if ((dy === 1 && a.type === 'stair') || (dy === -1 && b.type === 'stair')) return { dir: [dx, dz], stair: true };
  return null;
}

// Slab test: does the ray from p toward the camera pass through the box [x0,y0,z0,x1,y1,z1]?
function boxHit(p, v, box) {
  let t0 = 1e-6, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(v[k]) < 1e-9) {
      if (p[k] <= box[k] || p[k] >= box[k + 3]) return false;
      continue;
    }
    let a = (box[k] - p[k]) / v[k], c = (box[k + 3] - p[k]) / v[k];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
  }
  return t1 - t0 > 1e-7; // grazing contact does not count
}

// Ray from p toward the camera: does it pass through another block or another stair's slab?
// A stair's own slab is part of its walkable surface, so seeing the slab counts as seeing the stair.
function rayBlocked(p, v, blocks, self) {
  for (const b of blocks) {
    if (b === self) continue;
    if (boxHit(p, v, [b.x, b.y, b.z, b.x + 1, b.y + 1, b.z + 1])) return true;
    if (b.slab && boxHit(p, v, b.slab)) return true;
  }
  return false;
}

// A top is in shade when most of its samples have no clear ray to the light.
function isShaded(b, light, solid) {
  const pts = facePoints(b);
  return pts.filter((p) => rayBlocked(p, light, solid, b)).length / pts.length >= 0.5;
}

// Top-face samples; on a stair, the half under its step slab is sampled on the slab's top.
function facePoints(b) {
  const pts = [];
  const s = b.slab;
  for (const sx of SX) for (const sz of SZ) {
    const x = b.x + sx, z = b.z + sz;
    pts.push([x, s && x > s[0] && x < s[3] && z > s[2] && z < s[5] ? s[4] : b.y + 1, z]);
  }
  return pts;
}

// Does a top read as visible (enough samples with a clear ray to the camera)? `solid` is the blocks that can cover it.
export function topSeen(solid, t, v) {
  const pts = facePoints(t);
  return pts.filter((p) => !rayBlocked(p, v, solid, t)).length / pts.length >= VIS_THRESHOLD;
}

// Headless visibility: ray-cast each top-face sample toward the camera.
export function analyticVisibility(state, yawDeg) {
  const { v } = viewBasis(yawDeg);
  const vis = new Map();
  for (const t of state.tiles) {
    const pts = facePoints(t);
    const seen = pts.filter((p) => !rayBlocked(p, v, state.solid, t)).length;
    vis.set(t.id, seen / pts.length >= VIS_THRESHOLD);
  }
  return vis;
}

// GPU visibility: ID-buffer pass. Top faces get a unique color, everything else draws black.
export function createPicker(renderer) {
  const rt = new THREE.WebGLRenderTarget(1, 1);
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  const occ = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const scene = new THREE.Scene();
  const ndc = new THREE.Vector3();
  let buf = new Uint8Array(4);

  return function pickVisibility(state, camera, width, height) {
    scene.clear();
    const mats = [];
    const tileIds = new Set(state.tiles.map((t) => t.id));
    for (const b of state.solid) {
      let top = occ;
      if (tileIds.has(b.id)) {
        const n = b.id + 1;
        top = new THREE.MeshBasicMaterial({ toneMapped: false });
        top.color.setRGB((n & 255) / 255, ((n >> 8) & 255) / 255, 0); // linear, no color conversion
        mats.push(top);
      }
      const m = new THREE.Mesh(geo, [occ, occ, top, occ, occ, occ]); // box groups: +x -x +y -y +z -z
      m.position.set(b.x, b.y, b.z);
      scene.add(m);
      if (b.slab) {
        const [x0, y0, z0, x1, y1, z1] = b.slab;
        const sm = new THREE.Mesh(geo, top); // every face of the slab reads as stair surface
        sm.scale.set(x1 - x0, y1 - y0, z1 - z0);
        sm.position.set(x0, y0, z0);
        scene.add(sm);
      }
    }
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
    rt.setSize(w, h);
    if (buf.length !== w * h * 4) buf = new Uint8Array(w * h * 4);
    const prevTarget = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    mats.forEach((m) => m.dispose());

    const vis = new Map();
    for (const t of state.tiles) {
      const pts = facePoints(t);
      let seen = 0;
      for (const p of pts) {
        ndc.set(p[0], p[1] + 1e-3, p[2]).project(camera);
        const px = Math.floor((ndc.x * 0.5 + 0.5) * w), py = Math.floor((ndc.y * 0.5 + 0.5) * h);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const i = (py * w + px) * 4;
        if (buf[i] + (buf[i + 1] << 8) === t.id + 1) seen++;
      }
      vis.set(t.id, seen / pts.length >= VIS_THRESHOLD);
    }
    return vis;
  };
}

// Two tops that line up on screen only read as one floor if the edge where they meet is in plain view.
// If a block's side covers that seam (often the destination block itself, seen from below), it looks like a
// wall, not a path. Samples sit just inside each top along the shared edge; most of them must be clear.
const SEAM = [-0.3, 0, 0.3], SEAM_IN = 0.12;
function seamClear(state, a, b, [dx, dz], v) {
  let clear = 0;
  for (const s of SEAM) {
    const ox = dz !== 0 ? s : 0, oz = dx !== 0 ? s : 0; // offset along the edge
    const pa = [a.x + 0.5 + dx * (0.5 - SEAM_IN) + ox, a.y + 1, a.z + 0.5 + dz * (0.5 - SEAM_IN) + oz];
    const pb = [b.x + 0.5 - dx * (0.5 - SEAM_IN) + ox, b.y + 1, b.z + 0.5 - dz * (0.5 - SEAM_IN) + oz];
    if (!rayBlocked(pa, v, state.solid, a) && !rayBlocked(pb, v, state.solid, b)) clear++;
  }
  return clear >= 2;
}

// Neighbor graph. yawDeg === null means "free camera": real adjacency only.
// Returns Map tileId -> [{ to, dir:[dx,dz], illusion }]
export function computeGraph(state, yawDeg, visibility) {
  const graph = new Map(state.tiles.map((t) => [t.id, []]));
  const add = (a, b, dir, illusion) => {
    const list = graph.get(a.id);
    if (!list.some((e) => e.dir[0] === dir[0] && e.dir[1] === dir[1])) list.push({ to: b.id, dir, illusion });
  };
  if (yawDeg === null) {
    for (const a of state.tiles) for (const b of state.tiles) {
      const l = realLink(a, b);
      if (l) add(a, b, l.dir, false);
    }
    return graph;
  }
  const { r, u } = viewBasis(yawDeg);
  const vis = state.tiles.filter((t) => visibility.get(t.id));
  const proj = new Map(vis.map((t) => { const c = topCenter(t); return [t.id, [dot(c, r), dot(c, u)]]; }));
  const steps = DIRS.map(([dx, dz]) => [dx * r[0] + dz * r[2], dx * u[0] + dz * u[2]]);
  const { v } = viewBasis(yawDeg);
  for (const a of vis) {
    const pa = proj.get(a.id);
    for (const b of vis) {
      if (a === b) continue;
      const pb = proj.get(b.id);
      DIRS.forEach((dir, i) => {
        if (Math.hypot(pb[0] - pa[0] - steps[i][0], pb[1] - pa[1] - steps[i][1]) < STEP_TOL && seamClear(state, a, b, dir, v)) {
          const l = realLink(a, b);
          add(a, b, dir, !(l && !l.stair));
        }
      });
    }
  }
  // Real stairs are not screen-aligned; keep them when both ends are visible.
  for (const a of vis) for (const b of vis) {
    const l = realLink(a, b);
    // Skip when a screen-aligned edge already reaches b: two keys for one step reads as a sideways slide.
    if (l && l.stair && !graph.get(a.id).some((e) => e.to === b.id)) add(a, b, l.dir, false);
  }
  return graph;
}

// Map W/A/S/D to grid directions for the current yaw (screen-relative).
// Keys are assigned in cyclic order so each gets a distinct direction; a tiny bias breaks
// the exact isometric tie (W = up-right).
export function keyDirs(yawDeg) {
  const { r, u } = viewBasis(yawDeg);
  const dirs = DIRS.map((d) => ({ d, a: Math.atan2(d[0] * u[0] + d[1] * u[2], d[0] * r[0] + d[1] * r[2]) }))
    .sort((p, q) => p.a - q.a);
  const keys = ['d', 'w', 'a', 's'];
  const target = [0, 90, 180, 270].map((x) => ((x - 2) * Math.PI) / 180);
  const diff = (x, y) => { const d = Math.abs(x - y) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
  let best = null, bestCost = Infinity;
  for (let s = 0; s < 4; s++) {
    let cost = 0;
    for (let k = 0; k < 4; k++) cost += diff(dirs[(k + s) % 4].a, target[k]);
    if (cost < bestCost) { bestCost = cost; best = s; }
  }
  const out = {};
  keys.forEach((k, i) => (out[k] = dirs[(i + best) % 4].d));
  return out;
}

export function nearestAngle(yawDeg, angles) {
  let best = null, bestD = Infinity;
  for (const a of angles) {
    const d = Math.abs((((yawDeg - a) % 360) + 540) % 360 - 180);
    if (d < bestD) { bestD = d; best = a; }
  }
  return { angle: best, dist: bestD };
}
