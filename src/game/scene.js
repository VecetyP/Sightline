// Three.js scene: renderer, lights, level building, moving sections, snap glow, debug graph overlay.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { topCenter, buildState } from './walkability.js';

const LANTERN = '#EDB85C';

export const THEMES = {
  1: { name: 'Morning Garden', side: '#B7CBB0', top: '#F7F0E3', decor: '#8FAF8C', accent: '#E7B7B9', sky: ['#F7F0E3', '#F2DCC6'] },
  2: { name: 'Tea House', side: '#F2C6A8', top: '#EFE3CE', decor: '#D9897E', accent: '#B7CBB0', sky: ['#F7EDE0', '#F2C6A8'] },
  3: { name: 'Cloud Library', side: '#A9BFD1', top: '#ECE7F4', decor: '#B9A7D3', accent: '#F2C6A8', sky: ['#EEF0F5', '#D9D3EA'] },
  4: { name: 'Lantern Hill', side: '#C3B6D6', top: '#F4ECDF', decor: '#8F82A8', accent: '#A9BFD1', sky: ['#ECE6F1', '#CBBFDB'] },
  5: { name: 'Sun Court', side: '#E2C48F', top: '#F6EEDC', decor: '#B98E66', accent: '#C9A7C7', sky: ['#FBF1DE', '#F3D3A8'] },
  6: { name: 'Paper Theatre', side: '#9CC9C1', top: '#F3EEE6', decor: '#C98BA0', accent: '#F2D49B', sky: ['#EEF5F2', '#CFE6E0'] },
};
// Mist (world 5): pale and see-through-looking in sunlight, it firms into stone where shade falls on it.
const MIST = { lit: '#DCE8F2', glow: '#CFE2F5' };

// Soft round white blot for wisps and the sun (made once, on first use).
let softTex = null;
function soft() {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (softTex = new THREE.CanvasTexture(c));
}

// A shaft of sunlight from a lit mist top toward the light, fading out along its length.
const beamMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { k: { value: 0 } },
  vertexShader: 'varying float t; void main() { t = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform float k; varying float t; void main() { gl_FragColor = vec4(1.0, 0.93, 0.75, k * 0.2 * (1.0 - t) * (1.0 - t)); }',
});

const baseGeo = new RoundedBoxGeometry(1, 1, 1, 3, 0.08);

function blockGeometry(side, top, jitter) {
  const g = baseGeo.clone();
  const n = g.attributes.normal, colors = new Float32Array(n.count * 3);
  const s = new THREE.Color(side), t = new THREE.Color(top).offsetHSL(0, 0, jitter);
  for (let i = 0; i < n.count; i++) {
    const c = n.getY(i) > 0.6 ? t : s;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.fg = new THREE.Scene(); // the character lives here so it can be drawn on top of the illusion
    for (const sc of [this.scene, this.fg]) {
      sc.add(new THREE.HemisphereLight('#FFF6EA', '#C9B29A', 1.5));
    }
    this.sun = new THREE.DirectionalLight('#FFF1DF', 2.1);
    this.sun.position.set(6, 14, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.intensity = 0.35;
    this.sun.shadow.bias = -0.002;
    this.scene.add(this.sun, this.sun.target);
    const fsun = new THREE.DirectionalLight('#FFF1DF', 2.1);
    fsun.position.set(10, 16, 3);
    this.fg.add(fsun);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.glows = [];
    this.debug = new THREE.Group();
    this.debug.visible = false;
    this.debug.renderOrder = 999;
    this.scene.add(this.debug);
    this.time = 0;
  }

  build(level) {
    this.root.clear();
    this.level = level;
    const theme = THEMES[level.world];
    document.documentElement.style.setProperty('--sky-a', theme.sky[0]);
    document.documentElement.style.setProperty('--sky-b', theme.sky[1]);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.meshes = [];
    this.groups = (level.moving || []).map((m) => {
      const g = new THREE.Group();
      const piv = m.rotate ? m.rotate.pivot : [0, 0];
      g.position.set(piv[0] + 0.5, 0, piv[1] + 0.5);
      g.userData = { m, pivot: g.position.clone(), anim: null, on: false };
      this.root.add(g);
      return g;
    });
    const memberOf = (b) => (level.moving || []).findIndex((m) => m.blocks.some((p) => p[0] === b.x && p[1] === b.y && p[2] === b.z));
    const state = buildState(level, []);
    const rnd = (i) => (Math.sin(i * 91.7) * 43758.5) % 1;

    level.blocks.forEach((b, id) => {
      const gi = memberOf(b);
      const blocker = b.type === 'decor' || b.type === 'push' || b.type === 'lantern';
      // Decor: dark all over (never walkable). Push: dark sides, walkable cream top with arrows.
      // Lantern: a push block with glowing gold sides; it falls onto whatever is drawn below it.
      const mist = b.type === 'mist';
      const side = b.type === 'lantern' ? LANTERN : blocker ? theme.decor : gi >= 0 ? theme.accent : theme.side;
      const top = b.type === 'decor' ? theme.decor : theme.top;
      const mesh = mist
        ? new THREE.Mesh(blockGeometry('#E8E8E8', '#FFFFFF', 0), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: MIST.glow }))
        : new THREE.Mesh(blockGeometry(side, top, rnd(id) * 0.03), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      const parent = gi >= 0 ? this.groups[gi] : this.root;
      mesh.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5).sub(gi >= 0 ? parent.position : new THREE.Vector3());
      parent.add(mesh);
      this.meshes[id] = mesh;
      if (b.type === 'goal') this.addGoal(mesh);
      if (b.type === 'plate') this.addPlate(mesh, theme);
      if (b.type === 'stair') this.addStair(mesh, b, state, theme);
      if (blocker) this.addDecor(mesh, theme, b.type !== 'decor', b.type === 'lantern');
      if (mist) this.addMist(mesh, theme);
    });
    this.setShade(state, true);
    this.pushAnims = [];

    // Fit light + shadow camera to the level.
    const box = new THREE.Box3();
    level.blocks.forEach((b) => box.expandByPoint(new THREE.Vector3(b.x, b.y, b.z)).expandByPoint(new THREE.Vector3(b.x + 1, b.y + 1, b.z + 1)));
    this.center = box.getCenter(new THREE.Vector3());
    this.radius = Math.max(4, box.getSize(new THREE.Vector3()).length() * 0.5);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -this.radius - 2;
    sc.right = sc.top = this.radius + 2;
    sc.far = 80;
    sc.updateProjectionMatrix();
    this.sun.target.position.copy(this.center);
    // Shade levels aim the sun along the level's light so the drawn shadows are the walkable ones.
    const L = level.light ? new THREE.Vector3(...level.light).setLength(20) : new THREE.Vector3(10, 16, 3);
    this.sun.position.copy(this.center).add(L);
    this.sun.shadow.intensity = level.light ? 0.85 : 0.35;
    // The sun itself, off in the light's direction; drawn first so every block covers it.
    if (level.light) {
      const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: '#FFE7B0', depthTest: false, depthWrite: false, transparent: true }));
      sun.renderOrder = -1;
      sun.scale.setScalar(3.2);
      sun.position.copy(this.center).add(new THREE.Vector3(...level.light).setLength(this.radius + 4));
      this.root.add(sun);
    }
  }

  addMist(mesh, theme) {
    const plane = (mat) => {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), mat);
      q.rotation.x = -Math.PI / 2;
      q.position.y = 0.503;
      mesh.add(q);
      return q;
    };
    const stone = plane(new THREE.MeshLambertMaterial({ color: theme.top, transparent: true, opacity: 0 }));
    stone.receiveShadow = true;
    const shimmer = plane(new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false }));
    // Lit: a sunbeam pours onto it and wisps drift off it. Shaded: plain stone.
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1, 0.86).translate(0, 0.5, 0), beamMat());
    const dir = new THREE.Vector3(...this.level.light).normalize();
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    beam.scale.set(1, 4, 1);
    beam.position.y = 0.5;
    beam.renderOrder = 2;
    mesh.add(beam);
    const wisps = [0, 1, 2].map((i) => {
      const w = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: '#FFFFFF', transparent: true, depthWrite: false, opacity: 0 }));
      w.userData.phase = i / 3;
      mesh.add(w);
      return w;
    });
    mesh.userData.mist = { stone, shimmer, beam, wisps, lit: new THREE.Color(MIST.lit), stoneSide: new THREE.Color(theme.side), k: 0, to: 0 };
  }

  // Show which mist tops are solid right now (fades unless instant).
  setShade(state, instant = false) {
    for (const b of state.blocks) {
      const m = b.type === 'mist' && this.meshes[b.id]?.userData.mist;
      if (!m) continue;
      m.to = b.shaded ? 1 : 0;
      if (instant) m.k = m.to;
    }
  }

  addGoal(mesh) {
    const g = new THREE.Group();
    g.position.y = 0.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: '#FFE3A8', transparent: true, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.38, 40), new THREE.MeshBasicMaterial({ color: '#FFF0C8', transparent: true, opacity: 0.45, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.02;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), new THREE.MeshLambertMaterial({ color: '#FFD9A0', emissive: '#FFB98A', emissiveIntensity: 0.6 }));
    gem.position.y = 0.55;
    g.add(ring, halo, gem);
    g.userData.goal = { ring, gem, halo };
    mesh.add(g);
    this.goal = g;
  }

  addPlate(mesh, theme) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.06, 32), new THREE.MeshLambertMaterial({ color: theme.accent }));
    p.position.y = 0.52;
    p.receiveShadow = true;
    mesh.add(p);
    mesh.userData.plate = p;
  }

  addStair(mesh, b, state, theme) {
    const hi = state.tiles.find((t) => t.y === b.y + 1 && Math.abs(t.x - b.x) + Math.abs(t.z - b.z) === 1);
    if (!hi) return;
    const s = new THREE.Mesh(new RoundedBoxGeometry(1, 0.5, 0.5, 2, 0.06), new THREE.MeshLambertMaterial({ color: theme.top }));
    s.castShadow = true;
    s.position.set((hi.x - b.x) * 0.25, 0.75, (hi.z - b.z) * 0.25);
    if (hi.x !== b.x) s.rotation.y = Math.PI / 2;
    mesh.add(s);
  }

  addDecor(mesh, theme, pushable, lantern) {
    // Decor (not walkable): dark block with a dot grid on top.
    // Push blocks: walkable top with four outward arrows.
    // Marks sit flush on the top face so occlusion still matches the walkability model.
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(lantern ? LANTERN : theme.decor).offsetHSL(0, 0, -0.16), side: THREE.DoubleSide });
    const flat = (geo, x, z, rot = 0) => {
      const d = new THREE.Mesh(geo, m);
      d.rotation.set(-Math.PI / 2, 0, rot);
      d.position.set(x, 0.502, z);
      mesh.add(d);
    };
    if (!pushable) {
      const dot = new THREE.CircleGeometry(0.06, 16);
      for (const x of [-0.25, 0, 0.25]) for (const z of [-0.25, 0, 0.25]) flat(dot, x, z);
      return;
    }
    const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0.1), new THREE.Vector2(-0.1, -0.03), new THREE.Vector2(0.1, -0.03)]));
    // Shape +Y maps to world -Z after the -90° tilt; spin each arrow to point outward.
    flat(tri, 0, -0.27, 0);
    flat(tri, 0.27, 0, -Math.PI / 2);
    flat(tri, 0, 0.27, Math.PI);
    flat(tri, -0.27, 0, Math.PI / 2);
    flat(new THREE.CircleGeometry(0.07, 16), 0, 0);
  }

  // Slide a push block one tile along dir, then let it drop to `pos` (or off the world when null).
  pushBlock(id, pos, dir, instant, done, via = null) {
    const mesh = this.meshes[id];
    const from = mesh.position.clone();
    const mid = from.clone().add(new THREE.Vector3(dir[0], 0, dir[1]));
    const end = pos ? new THREE.Vector3(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5) : mid.clone().setY(mid.y - 14);
    // A lantern caught on screen swaps to `via` (the cell above its landing that looks the same from this angle)
    // and drops straight down from there.
    const top = via ? new THREE.Vector3(via[0] + 0.5, via[1] + 0.5, via[2] + 0.5) : mid;
    if (instant) { this.placeOne(id, pos); return done(); }
    this.pushAnims.push({ mesh, from, mid, top, end, t: 0, fall: 0, gone: !pos, done });
  }

  placeOne(id, pos) {
    const mesh = this.meshes[id];
    mesh.visible = !!pos;
    if (pos) mesh.position.set(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5);
  }

  // Instantly put every push block where `pushed` says (base position when not listed).
  placePushBlocks(pushed) {
    this.pushAnims = [];
    this.level.blocks.forEach((b, id) => {
      if (b.type === 'push' || b.type === 'lantern') this.placeOne(id, id in pushed ? pushed[id] : [b.x, b.y, b.z]);
    });
  }

  // Animate a moving section to its on/off state. Calls done() when settled.
  setSection(i, on, instant, done) {
    const g = this.groups[i];
    if (!g) return done && done();
    const m = g.userData.m;
    const from = { y: g.position.y, r: g.rotation.y };
    const turns = m.rotate ? (((m.rotate.turns || 1) % 4) + 4) % 4 : 0; // 3 turns animates as -1
    const to = { y: on && m.dy ? m.dy : 0, r: on && m.rotate ? (-Math.PI / 2) * (turns === 3 ? -1 : turns) : 0 };
    g.userData.on = on;
    g.userData.anim = instant ? null : { from, to, t: 0, done };
    if (instant) { g.position.y = to.y; g.rotation.y = to.r; done && done(); }
  }

  // Swing every turntable (world 6) by `phi` (from swingWay, which the solver's swing checks use too), from facing
  // `from` to facing the snapped angle `view`. `rider` (Pip) is carried round its pivot on section `riderSection`.
  turnSections(level, from, view, phi, instant, done, rider = null, riderSection = -1) {
    const list = this.groups.filter((g) => g.userData.m.screen);
    if (!list.length) return done && done();
    let left = list.length;
    const one = () => --left === 0 && done && done();
    for (const g of list) {
      // Always relative to where it is now: its rotation keeps accumulating, so rebuilding the end angle from the
      // pose (wrapped to one circle) made it spin the long way round after a few turns the same way.
      const d = phi;
      const to = { y: g.position.y, r: g.rotation.y + d };
      const ride = rider && this.groups.indexOf(g) === riderSection ? { obj: rider, p0: rider.position.clone(), r0: g.rotation.y } : null;
      if (instant || Math.abs(d) < 1e-6) {
        g.rotation.y = to.r;
        if (ride) this.carry(g, ride);
        one();
        continue;
      }
      g.userData.anim = { from: { y: g.position.y, r: g.rotation.y }, to, t: 0, done: one, ride };
    }
  }

  // Keep a rider (Pip) on a turning section: rotate his position round the pivot by how far it has turned.
  carry(g, { obj, p0, r0 }) {
    const p = p0.clone().sub(g.userData.pivot).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y - r0);
    obj.position.set(g.userData.pivot.x + p.x, p0.y, g.userData.pivot.z + p.z);
  }

  get animating() {
    return (this.groups || []).some((g) => g.userData.anim) || (this.pushAnims || []).some((a) => !a.finished);
  }

  pressPlate(id, down) {
    const p = this.meshes[id]?.userData.plate;
    if (p) p.position.y = down ? 0.505 : 0.52;
  }

  // Brief soft glow on tiles joined by an illusion connection.
  glowTiles(blocks) {
    for (const g of this.glows) this.scene.remove(g);
    this.glows = blocks.map((b) => {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92), new THREE.MeshBasicMaterial({ color: '#FFF4D6', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      q.rotation.x = -Math.PI / 2;
      const c = topCenter(b);
      q.position.set(c[0], c[1] + 0.012, c[2]);
      q.userData.t = 0;
      this.scene.add(q);
      return q;
    });
  }

  showGraph(state, graph, visibility) {
    this.debug.clear();
    const pos = [], col = [];
    const real = new THREE.Color('#4A7BB7'), ill = new THREE.Color('#E0457B');
    for (const [a, edges] of graph) for (const e of edges) {
      if (e.to < a && graph.get(e.to)?.some((x) => x.to === a)) continue;
      const pa = topCenter(state.blocks[a]), pb = topCenter(state.blocks[e.to]);
      pos.push(...pa, ...pb);
      const c = e.illusion ? ill : real;
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    lines.renderOrder = 999;
    const dots = state.tiles.filter((t) => !visibility || visibility.get(t.id)).flatMap(topCenter);
    const pts = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(dots, 3)),
      new THREE.PointsMaterial({ color: '#2E5A88', size: 7, sizeAttenuation: false, depthTest: false }),
    );
    pts.renderOrder = 999;
    this.debug.add(lines, pts);
  }

  update(dt) {
    this.time += dt;
    if (this.goal) {
      const { ring, gem, halo } = this.goal.userData.goal;
      gem.position.y = 0.55 + Math.sin(this.time * 2) * 0.06;
      gem.rotation.y += dt;
      ring.scale.setScalar(1 + Math.sin(this.time * 2.4) * 0.05);
      halo.material.opacity = 0.35 + Math.sin(this.time * 2.4) * 0.12;
    }
    for (const g of this.groups || []) {
      const a = g.userData.anim;
      if (!a) continue;
      a.t = Math.min(1, a.t + dt / 0.6);
      const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      g.position.y = a.from.y + (a.to.y - a.from.y) * k;
      g.rotation.y = a.from.r + (a.to.r - a.from.r) * k;
      if (a.ride) this.carry(g, a.ride);
      if (a.t >= 1) { g.userData.anim = null; a.done && a.done(); }
    }
    this.pushAnims = (this.pushAnims || []).filter((a) => {
      if (a.t < 1) {
        a.t = Math.min(1, a.t + dt / 0.18);
        a.mesh.position.lerpVectors(a.from, a.mid, 1 - (1 - a.t) ** 2);
        return true;
      }
      a.fall += dt;
      const k = Math.min(1, (15 * a.fall * a.fall) / Math.max(0.01, a.top.distanceTo(a.end))); // gravity
      a.mesh.position.lerpVectors(a.top, a.end, k);
      if (k < 1) return true;
      if (a.gone) a.mesh.visible = false;
      a.finished = true; // so `animating` is already false inside done()
      a.done();
      return false;
    });
    for (const mesh of this.meshes || []) {
      const m = mesh.userData.mist;
      if (!m) continue;
      m.k += Math.sign(m.to - m.k) * Math.min(Math.abs(m.to - m.k), dt / 0.35);
      const lit = 1 - m.k, seed = mesh.position.x * 1.7 + mesh.position.z;
      m.stone.material.opacity = m.k;
      mesh.material.color.copy(m.lit).lerp(m.stoneSide, m.k);
      mesh.material.emissiveIntensity = 0.45 * lit;
      m.shimmer.material.opacity = lit * (0.3 + Math.sin(this.time * 1.6 + seed) * 0.2);
      m.beam.material.uniforms.k.value = lit;
      for (const w of m.wisps) { // rise, spread and fade, on a loop
        const t = (this.time * 0.25 + w.userData.phase + seed * 0.13) % 1;
        w.position.set(Math.sin(t * 6 + seed) * 0.2, 0.55 + t * 0.7, Math.cos(t * 5 + seed) * 0.2);
        w.scale.setScalar(0.35 + t * 0.5);
        w.material.opacity = lit * Math.sin(t * Math.PI) * 0.55;
      }
    }
    this.glows = this.glows.filter((q) => {
      q.userData.t += dt;
      const t = q.userData.t / 0.9;
      q.material.opacity = Math.sin(Math.min(1, t) * Math.PI) * 0.55;
      if (t >= 1) { this.scene.remove(q); q.geometry.dispose(); q.material.dispose(); return false; }
      return true;
    });
  }

  render(camera, charOnTop) {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, camera);
    if (charOnTop) r.clearDepth();
    r.render(this.fg, camera);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
  }
}
