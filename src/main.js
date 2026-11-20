// Boot, screen router, and the play session (input, graph recompute, undo, plates, win).
import * as THREE from 'three';
import { World } from './game/scene.js';
import { CameraRig } from './game/camera.js';
import { Player } from './game/player.js';
import { buildState, computeGraph, createPicker, analyticVisibility, keyDirs, plateIndex, tryPush, hasTurntable, swingWay, edgesFrom } from './game/walkability.js';
import { save, recordWin, isBeaten } from './game/save.js';
import * as audio from './game/audio.js';
import { createUI } from './ui/screens.js';

const LEVELS = Object.values(import.meta.glob('./levels/*.json', { eager: true, import: 'default' })).sort((a, b) => a.id - b.id);

const canvas = document.getElementById('game');
const world = new World(canvas);
const rig = new CameraRig(canvas);
const player = new Player(world.fg);
const pick = createPicker(world.renderer);

// --- session state ---
let level = null, levelIdx = 0, plates = [], pushed = {}, state = null, graph = null, visibility = null;
let illusionStep = false; // the current move crosses an illusion seam
let tile = 0, history = [], moves = 0, mode = 'menu', buffered = null, debugOn = false, won = false, falling = false;
let hintsUsed = { turn: false, walk: false };
// Turntables (world 6) face the last snapped angle: `view`. A snap to a new angle waits in `pendingView` while
// anything is moving, then swings them round.
let view = 45, pendingView = null;

const ui = createUI(LEVELS, {
  play: () => startLevel(Math.max(0, LEVELS.findIndex((l) => !isBeaten(l.id)))),
  selectLevel: (id) => startLevel(LEVELS.findIndex((l) => l.id === id)),
  resume: () => ui.show('hud'),
  restart: () => startLevel(levelIdx),
  undo,
  pause: () => mode === 'play' && ui.show('pause'),
  home: () => toHome(),
  next: () => startLevel(Math.min(levelIdx + 1, LEVELS.length - 1)),
  replay: () => startLevel(levelIdx),
  settingsChanged: () => {
    audio.applyVolumes();
    document.body.classList.toggle('reduced', save.settings.reducedMotion);
  },
  screenChanged: (name) => {
    mode = name === 'hud' ? 'play' : ['pause', 'complete'].includes(name) ? name : 'menu';
    rig.enabled = mode === 'play';
    if (!rig.enabled) rig.stopInput();
    if (name === 'home' && !dioramaUp) showDiorama();
  },
});
document.body.classList.toggle('reduced', save.settings.reducedMotion);

// Home-screen preview, right of the sidebar: a slowly turning level where Pip wanders around.
// Every few seconds it fades to a different level. Pip only walks real paths, never illusions.
const DEMO_SECONDS = 12;
// Centre the preview in the space the menu leaves: right of the sidebar, or above it when it's a bottom sheet.
function placeDiorama() {
  const sb = document.querySelector('.sidebar'), sheet = matchMedia('(max-width: 720px)').matches;
  rig.offsetPx = sheet ? 0 : sb.offsetWidth / 2;
  rig.offsetPy = sheet ? sb.offsetHeight / 2 : 0;
}
let dioramaUp = false, demo = null, deck = [];
// Shuffled deck: every level shows once before any repeats, and never the same one back to back.
function nextDemo() {
  if (!deck.length) {
    deck = [...LEVELS.keys()].sort(() => Math.random() - 0.5);
    const last = deck.length - 1; // pop() takes from the end
    if (deck[last] === demo?.i && last > 0) [deck[0], deck[last]] = [deck[last], deck[0]];
  }
  return deck.pop();
}
function showDiorama(i = nextDemo()) {
  dioramaUp = true;
  level = null;
  const d = LEVELS[i];
  world.build(d);
  state = buildState(d, []);
  const start = d.blocks.findIndex((b) => b.type === 'start');
  player.place(state.blocks[start]);
  demo = { i, tile: start, prev: -1, wait: 1.2, left: DEMO_SECONDS, graph: computeGraph(state, null) };
  placeDiorama();
  rig.setLevel(world.center, world.radius * 1.15, d.angles, rig.yaw); // keep turning from where the last preview was
  rig.auto = save.settings.reducedMotion ? 2 : 7;
  world.debug.visible = false;
  ui.hud.debug('');
}

function updateDiorama(dt) {
  if (!dioramaUp || !demo) return;
  if ((demo.left -= dt) <= 0 && !demo.fading) {
    demo.fading = true;
    canvas.style.opacity = 0;
    const fading = demo;
    setTimeout(() => {
      if (dioramaUp && demo === fading) showDiorama(); // skip if a new preview started meanwhile
      canvas.style.opacity = 1;
    }, 500);
  }
  if (player.busy || (demo.wait -= dt) > 0) return;
  const opts = demo.graph.get(demo.tile) || [];
  const fwd = opts.filter((e) => e.to !== demo.prev); // prefer not to turn straight back
  const e = (fwd.length ? fwd : opts)[Math.floor(Math.random() * (fwd.length || opts.length))];
  demo.wait = 0.4 + Math.random() * 0.9;
  if (!e) return;
  demo.prev = demo.tile;
  demo.tile = e.to;
  player.moveTo(state.blocks[e.to], e.dir);
}

const toHome = () => ui.show('home');

function startLevel(i) {
  levelIdx = i;
  dioramaUp = false;
  canvas.style.opacity = 1;
  rig.offsetPx = rig.offsetPy = 0;
  level = LEVELS[i];
  plates = (level.moving || []).map(() => false);
  pushed = {};
  view = level.startAngle ?? 45;
  pendingView = null;
  world.build(level);
  rig.auto = 0;
  rig.setLevel(world.center, world.radius, level.angles, level.startAngle ?? 45);
  state = buildState(level, plates, pushed, { view });
  tile = level.blocks.findIndex((b) => b.type === 'start');
  player.place(state.blocks[tile]);
  history = [];
  moves = 0;
  won = false;
  falling = false;
  buffered = null;
  ui.hud.setLevel(level);
  ui.hud.setMoves(0, level.par);
  ui.hud.banner(`${level.id}. ${level.title}`);
  if (level.id === 1) {
    hintsUsed = { turn: false, walk: false };
    ui.hud.hints(matchMedia('(pointer: coarse)').matches ? [
      'Drag to turn the camera.',
      'Tap beside Pip to walk. Reach the glowing tile.',
    ] : [
      'Hold <kbd>Right mouse</kbd> and drag, or hold <kbd>Q</kbd> / <kbd>E</kbd>, to rotate the camera.',
      'Walk with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>. Reach the glowing tile.',
    ]);
  } else ui.hud.hints([]);
  ui.show('hud');
  recompute(false);
}

// Rebuild the walkability graph for the current view + plate + pushed-block state.
function recompute(announce = true) {
  if (!level) return;
  state = buildState(level, plates, pushed, { view });
  world.setShade(state);
  const yaw = rig.snapped;
  const before = graph;
  if (yaw === null) {
    visibility = null;
    graph = computeGraph(state, null);
  } else {
    rig.apply();
    const s = world.renderer.getPixelRatio();
    visibility = pick(state, rig.camera, innerWidth * s * 0.5, innerHeight * s * 0.5);
    graph = computeGraph(state, yaw, visibility);
    // Glow + chime for illusion edges that weren't walkable a moment ago.
    const fresh = new Set();
    for (const [a, edges] of graph) for (const e of edges) {
      if (e.illusion && !before?.get(a)?.some((x) => x.to === e.to)) { fresh.add(a); fresh.add(e.to); }
    }
    if (announce) {
      audio.chime();
      if (save.settings.alignHints && fresh.size) world.glowTiles([...fresh].map((id) => state.blocks[id]));
    }
  }
  if (debugOn) updateDebug();
}

function updateDebug() {
  world.debug.visible = debugOn;
  if (!debugOn || !state) return ui.hud.debug('');
  world.showGraph(state, graph, visibility);
  let text = `view: ${rig.snapped === null ? 'free (real adjacency only)' : rig.snapped + '° snapped'}\n`;
  let edges = 0, ill = 0;
  for (const list of graph.values()) for (const e of list) { edges++; if (e.illusion) ill++; }
  text += `edges: ${edges}  illusion: ${ill}\n`;
  if (visibility) {
    const ana = analyticVisibility(state, rig.snapped);
    const diff = state.tiles.filter((t) => ana.get(t.id) !== visibility.get(t.id)).length;
    text += `visible tops: ${[...visibility.values()].filter(Boolean).length}/${state.tiles.length}\nGPU vs ray-cast mismatches: ${diff}`;
  }
  ui.hud.debug(text);
}

rig.onChange = (a) => {
  if (a !== null && level && hasTurntable(level) && a !== view) return requestTurn(a);
  recompute(true);
};

const onSection = () => {
  const s = state.blocks[tile].section;
  return s !== undefined && level.moving[s].screen ? s : -1;
};

// The camera settled on a new angle: swing the turntables to face it, carrying Pip if he's on one.
function requestTurn(a) {
  if (player.busy || world.animating || falling || won) { pendingView = a; return; }
  pendingView = null;
  const from = view, next = buildState(level, plates, pushed, { view: a });
  const t = next.blocks[tile];
  // A half turn swings the way the camera went (+yaw turns the turntable +rotation.y), or the other way if blocked.
  const way = swingWay(level, state, from, a, tile, Math.sign(rig.travel) || -1);
  // It would swing into Pip, or land on him: refuse, back to where it was.
  if (next.occupied.has(`${t.x},${t.y + 1},${t.z}`) || way.phi === undefined) {
    audio.bump();
    return rig.turnTo(from);
  }
  view = a;
  const rider = onSection();
  recompute(false); // the new pose's graph; moves wait (world.animating) until the swing ends
  world.turnSections(level, from, view, way.phi, save.settings.reducedMotion, () => {
    if (rider >= 0) player.place(state.blocks[tile]);
    if (!state.tiles.some((x) => x.id === tile)) { // the swing took the shade from under Pip: fall, then turn back
      falling = true;
      buffered = null;
      audio.bump();
      return player.fall(() => {
        falling = false;
        setView(from);
        player.place(state.blocks[tile]);
      });
    }
    recompute(true);
    flush();
  }, rider >= 0 ? player.root : null, rider);
}

// Put the turntables (and the camera) back to face `a` at once: undo, or a turn that dropped Pip.
function setView(a) {
  pendingView = null;
  if (a !== view) {
    world.turnSections(level, view, a, swingWay(level, state, view, a).phi ?? 0, true);
    view = a;
  }
  if (rig.snapped !== a) rig.turnTo(a);
  recompute(false);
}
rig.onRotateInput = () => {
  if (level?.id === 1 && !hintsUsed.turn) { hintsUsed.turn = true; ui.hud.hideHint(0); }
};

function tryMove(key) {
  if (mode !== 'play' || won || falling) return;
  if (player.busy || world.animating || pendingView !== null) { buffered = key; return; }
  const dir = keyDirs(rig.yaw)[key];
  const edge = edgesFrom(graph, state, rig.snapped, visibility, tile).find((e) => e.dir[0] === dir[0] && e.dir[1] === dir[1]);
  if (level.id === 1 && !hintsUsed.walk) { hintsUsed.walk = true; ui.hud.hideHint(1); }
  if (!edge) return tryPushMove(dir);
  history.push({ tile, plates: [...plates], pushed: { ...pushed }, view });
  moves++;
  ui.hud.setMoves(moves, level.par);
  const target = state.blocks[edge.to];
  illusionStep = edge.illusion;
  player.moveTo(target, dir, () => arrive(edge.to));
}

// No walkable neighbor that way: maybe there's a push block to shove.
function tryPushMove(dir) {
  const r = tryPush(state, state.blocks[tile], dir, rig.snapped);
  if (!r) { player.bump(dir); audio.bump(); return; }
  history.push({ tile, plates: [...plates], pushed: { ...pushed }, view });
  moves++;
  ui.hud.setMoves(moves, level.par);
  pushed[r.id] = r.pos;
  audio.push();
  illusionStep = false;
  // Pip starts moving first, so an instant push (reduced motion) doesn't check the ground under Pip too early.
  if (r.step !== null) player.moveTo(state.blocks[r.step], dir, () => arrive(r.step));
  else player.bump(dir);
  world.pushBlock(r.id, r.pos, dir, save.settings.reducedMotion, () => { recompute(false); flush(); }, r.via);
}

function arrive(to) {
  tile = to;
  audio.step();
  const b = state.blocks[to];
  if (b.type === 'plate') {
    const i = plateIndex(level, b);
    plates[i] = !plates[i];
    audio.plate();
    world.pressPlate(to, plates[i]);
    world.setSection(i, plates[i], save.settings.reducedMotion, () => { recompute(false); flush(); });
    return;
  }
  if (b.type === 'goal') return win();
  flush();
}

function flush() {
  if (pendingView !== null && !won && !falling && !player.busy && !world.animating) return requestTurn(pendingView);
  // Shade (world 5) can leave the tile Pip stands on: Pip falls through and the move is taken back.
  if (!won && !falling && !player.busy && !world.animating && !state.tiles.some((t) => t.id === tile)) {
    falling = true;
    buffered = null;
    audio.bump();
    player.fall(() => { falling = false; rewind(); });
    return;
  }
  const k = buffered;
  buffered = null;
  if (k) tryMove(k);
}

function win() {
  won = true;
  player.celebrate();
  audio.arpeggio();
  recordWin(level.id, moves);
  setTimeout(() => ui.complete(level, moves, levelIdx < LEVELS.length - 1), save.settings.reducedMotion ? 300 : 1200);
}

function undo() {
  if (mode !== 'play' || won || player.busy || world.animating || !history.length) return;
  rewind();
}

function rewind() {
  const h = history.pop();
  tile = h.tile;
  h.plates.forEach((on, i) => {
    if (on !== plates[i]) {
      world.setSection(i, on, true);
      const pid = level.blocks.findIndex((b) => b.type === 'plate' && plateIndex(level, { base: b }) === i);
      world.pressPlate(pid, on);
    }
  });
  plates = h.plates;
  pushed = h.pushed;
  world.placePushBlocks(pushed);
  if (hasTurntable(level)) setView(h.view);
  moves = history.length;
  ui.hud.setMoves(moves, level.par);
  recompute(false);
  player.place(state.blocks[tile]);
}

// --- input ---
addEventListener('keydown', (e) => {
  audio.startAudio();
  const k = e.key.toLowerCase();
  if (e.key === 'F1') {
    e.preventDefault();
    debugOn = !debugOn;
    if (level) { recompute(false); updateDebug(); }
    return;
  }
  if (e.key === 'Escape') {
    if (mode === 'play') ui.show('pause');
    else if (mode === 'pause') ui.show('hud');
    else document.querySelector(`#${ui.current} [data-go="home"], #${ui.current} [data-act="settings-back"]`)?.click(); // Esc = Back on menus
    return;
  }
  // Space/Enter would otherwise "click" whichever button still has focus (e.g. Restart), replaying the level.
  if (e.key === ' ' || e.key === 'Enter') {
    if (mode === 'play' || mode === 'complete') { e.preventDefault(); document.activeElement?.blur(); }
    if (mode === 'complete') { if (levelIdx < LEVELS.length - 1) startLevel(levelIdx + 1); else ui.show('levels'); }
    if (mode === 'play' || mode === 'complete') return;
  }
  if (mode !== 'play') return;
  if ('wasd'.includes(k) && k.length === 1) tryMove(k);
  else if (k === 'q' || k === 'e') rig.keyDown(k);
  else if (k === 'z') undo();
  else if (k === 'r') startLevel(levelIdx);
});
// Touch: tap beside Pip, and he steps whichever of his four ways points most toward the tap.
rig.onTap = (x, y) => {
  if (mode !== 'play') return;
  const toScreen = (v) => { v.project(rig.camera); return [v.x * innerWidth, -v.y * innerHeight]; };
  const p = player.root.position, [px, py] = toScreen(p.clone());
  const tx = x * 2 - innerWidth - px, ty = y * 2 - innerHeight - py; // tap relative to Pip, same units
  let best = null, bestDot = -Infinity;
  for (const [k, d] of Object.entries(keyDirs(rig.yaw))) {
    const [sx, sy] = toScreen(p.clone().add(new THREE.Vector3(d[0], 0, d[1])));
    const dot = ((sx - px) * tx + (sy - py) * ty) / Math.hypot(sx - px, sy - py);
    if (dot > bestDot) { bestDot = dot; best = k; }
  }
  tryMove(best);
};
addEventListener('keyup', (e) => rig.keyUp(e.key.toLowerCase()));
addEventListener('pointerdown', () => audio.startAudio());
addEventListener('blur', () => rig.stopInput());
addEventListener('resize', onResize);

// --- loop ---
let last = performance.now();
function onResize() {
  if (dioramaUp) placeDiorama();
  world.resize();
  rig.resize();
  if (rig.snapped !== null) recompute(false);
}
function tick(dt) {
  const size = world.renderer.getSize(new THREE.Vector2());
  if (size.x !== innerWidth || size.y !== innerHeight) onResize(); // also catches missed resize events
  rig.update(dt);
  updateDiorama(dt);
  world.update(dt);
  player.update(dt);
  if (level) player.pointW(keyDirs(rig.yaw).w);
  else player.arrow.visible = false; // no controls on the home diorama
  if (level) ui.hud.compass(rig.yaw, level.angles, rig.snapped);
  if (debugOn && level) world.debug.visible = true;
  // Mid-step across an illusion, Pip's straight 3D path cuts through blocks, so draw Pip over the scene.
  // Standing still (or on a real step) Pip is depth-tested, so nearer blocks correctly hide him.
  const onTop = !!level && rig.snapped !== null && !rig.rotating && player.busy && illusionStep;
  world.render(rig.camera, onTop);
}
function frame() {
  const now = performance.now();
  tick(Math.min((now - last) / 1000, 0.05));
  last = now;
  requestAnimationFrame(frame);
}

toHome();
frame();

if (import.meta.env.DEV) window.__pf = { rig, start: startLevel, analyticVisibility, pick, get level() { return level; }, advance: (sec) => { for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60); }, world, get graph() { return graph; }, get tile() { return tile; }, get visibility() { return visibility; }, get state() { return state; }, get demo() { return demo; } };
