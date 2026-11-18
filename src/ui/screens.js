// HTML overlay screens: home, level select, settings, credits, HUD, pause, complete.
import './style.css';
import { save, persist, isBeaten, isUnlocked } from '../game/save.js';
import { THEMES } from '../game/scene.js';
import { click } from '../game/audio.js';

const $ = (sel, root = document) => root.querySelector(sel);

export function createUI(levels, h) {
  const ui = $('#ui');
  ui.innerHTML = `
  <section class="screen" id="home">
    <aside class="sidebar">
      <h1 class="title">Sightline</h1>
      <div class="menu">
        <button class="primary" data-act="play">Play</button>
        <button data-go="levels">Level Select</button>
        <button data-go="settings">Settings</button>
        <button data-go="credits">Credits</button>
      </div>
    </aside>
  </section>

  <section class="screen dim" id="levels">
    <div class="panel">
      <h2 style="text-align:center">Choose a level</h2>
      <div class="tabs"></div>
      <div class="cards"></div>
      <div style="text-align:center;margin-top:22px"><button class="ghost" data-go="home">Back</button></div>
    </div>
  </section>

  <section class="screen dim" id="settings">
    <div class="panel">
      <h2>Settings</h2>
      <div class="settings-rows"></div>
      <div style="text-align:center;margin-top:16px"><button class="primary" data-act="settings-back">Done</button></div>
    </div>
  </section>

  <section class="screen dim" id="credits">
    <div class="panel credits" style="text-align:center">
      <h2>Credits</h2>
      <p>Sightline: a small perspective puzzle.</p>
      <p>Built with Three.js and Vite. Font: Nunito.</p>
      <p class="muted">Every sound is generated live with the Web Audio API.</p>
      <div style="margin-top:18px"><button class="ghost" data-go="home">Back</button></div>
    </div>
  </section>

  <section class="screen" id="hud">
    <div class="hud-top">
      <div class="hud-name"></div>
      <div class="hud-moves"></div>
      <div class="hud-btns">
        <button class="icon" data-act="undo" title="Undo (Z)" aria-label="Undo">&#8630;</button>
        <button class="icon" data-act="restart" title="Restart (R)" aria-label="Restart">&#8635;</button>
        <button class="icon" data-act="pause" title="Pause (Esc)" aria-label="Pause">&#10074;&#10074;</button>
      </div>
    </div>
    <svg class="compass" viewBox="-40 -40 80 80"></svg>
    <div class="hints"></div>
    <div class="banner"></div>
    <div id="debug"></div>
  </section>

  <section class="screen dim" id="pause">
    <div class="panel" style="text-align:center;min-width:300px">
      <h2>Paused</h2>
      <div class="menu" style="margin:16px auto 0">
        <button class="primary" data-act="resume">Resume</button>
        <button data-act="restart">Restart</button>
        <button data-act="settings-from-pause">Settings</button>
        <button data-go="levels">Level Select</button>
        <button data-act="home">Home</button>
      </div>
    </div>
  </section>

  <section class="screen dim" id="complete">
    <div class="petals"></div>
    <div class="panel complete-panel">
      <h2>Level complete!</h2>
      <div class="stars"></div>
      <div class="menu">
        <button class="primary" data-act="next">Next Level</button>
        <button data-act="replay">Replay</button>
        <button data-go="levels">Level Select</button>
      </div>
    </div>
  </section>`;

  const screens = [...ui.querySelectorAll('.screen')];
  let current = null, settingsBack = 'home', world = 1;

  function show(name) {
    current = name;
    if (name === 'levels') renderLevels();
    if (name === 'settings') renderSettings();
    for (const s of screens) {
      // The HUD stays visible under pause / complete.
      const on = s.id === name || (s.id === 'hud' && (name === 'pause' || name === 'complete'));
      s.classList.toggle('active', on);
    }
    h.screenChanged(name);
  }

  ui.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    click();
    if (b.dataset.go) return show(b.dataset.go);
    const act = b.dataset.act;
    if (act === 'settings-back') return show(settingsBack);
    if (act === 'settings-from-pause') { settingsBack = 'pause'; return show('settings'); }
    if (b.dataset.level) return h.selectLevel(+b.dataset.level);
    if (b.dataset.world) { world = +b.dataset.world; return renderLevels(); }
    h[act] && h[act]();
  });
  $('[data-go="settings"]', ui).addEventListener('click', () => (settingsBack = 'home'), true);

  function renderLevels() {
    $('.tabs', ui).innerHTML = Object.keys(THEMES).map(Number)
      .map((w) => `<button data-world="${w}" class="${w === world ? 'on' : ''}">${w} · ${THEMES[w].name}</button>`)
      .join('');
    $('.cards', ui).innerHTML = levels
      .filter((l) => l.world === world)
      .map((l) => {
        const open = isUnlocked(l.id, levels), done = isBeaten(l.id), best = save.progress[l.id]?.best;
        const badge = done ? `<span class="badge ${best <= l.par ? 'gold' : ''}">${best <= l.par ? '★ ' : ''}${best} moves${best <= l.par ? ' · perfect' : ''}</span>` : '';
        return `<button class="card ${open ? '' : 'locked'} ${done ? 'done' : ''}" ${open ? `data-level="${l.id}"` : 'disabled'}>
          ${badge}<span class="num">${l.id}</span><span class="name">${open ? l.title : `&#128274; Finish level ${l.id - 1}`}</span></button>`;
      })
      .join('');
  }

  const SETTINGS = [
    ['music', 'Music volume', 'range', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'],
    ['sfx', 'Sound effects', 'range', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'],
    ['sensitivity', 'Camera turn speed', 'range', 0.4, 2, 0.1, (v) => v.toFixed(1) + '×'],
    ['snapThreshold', 'Snap range', 'range', 4, 25, 1, (v) => v + '°'],
    ['invertDrag', 'Invert drag direction', 'checkbox'],
    ['alignHints', 'Show compass and path highlights', 'checkbox'],
    ['reducedMotion', 'Reduced motion', 'checkbox'],
  ];
  function renderSettings() {
    const rows = $('.settings-rows', ui);
    rows.innerHTML = SETTINGS.map(([k, label, type, min, max, step, fmt]) =>
      type === 'range'
        ? `<label class="row">${label}<span class="ctl"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${save.settings[k]}"><output>${fmt(save.settings[k])}</output></span></label>`
        : `<label class="row">${label}<input type="checkbox" data-k="${k}" ${save.settings[k] ? 'checked' : ''}></label>`,
    ).join('');
    rows.oninput = (e) => {
      const k = e.target.dataset.k, def = SETTINGS.find((s) => s[0] === k);
      save.settings[k] = def[2] === 'range' ? +e.target.value : e.target.checked;
      if (def[2] === 'range') e.target.nextElementSibling.textContent = def[6](save.settings[k]);
      persist();
      h.settingsChanged();
    };
  }

  // --- HUD ---
  const hud = {
    setLevel(l) {
      $('.hud-name', ui).innerHTML = `${l.id}. ${l.title}<small>${THEMES[l.world].name}</small>`;
    },
    setMoves(m, par) {
      $('.hud-moves', ui).innerHTML = `${m} <span>moves · par ${par}</span>`;
    },
    compass(yaw, angles, snapped) {
      const svg = $('.compass', ui);
      svg.classList.toggle('off', !save.settings.alignHints);
      const notch = angles.map((a) => {
        const t = ((a - yaw) * Math.PI) / 180, x = Math.sin(t) * 30, y = -Math.cos(t) * 30;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${snapped === a ? 6 : 4}" fill="${snapped === a ? '#E7B7B9' : '#C9B9A8'}"/>`;
      });
      svg.innerHTML = `<circle r="36" fill="rgba(255,250,242,.85)"/><circle r="30" fill="none" stroke="#E8D9C0" stroke-width="2"/>
        ${notch.join('')}<path d="M0 -22 L5 -10 L-5 -10 Z" fill="#5B4A3F"/><circle r="3" fill="#5B4A3F"/>`;
    },
    hints(list) {
      $('.hints', ui).innerHTML = list.map((t, i) => `<div class="hint" data-hint="${i}">${t}</div>`).join('');
    },
    hideHint(i) {
      $(`[data-hint="${i}"]`, ui)?.classList.add('gone');
    },
    banner(title) {
      const b = $('.banner', ui);
      b.textContent = title;
      b.classList.add('show');
      clearTimeout(b._t);
      b._t = setTimeout(() => b.classList.remove('show'), 2400);
    },
    debug(text) {
      const d = $('#debug', ui);
      d.style.display = text ? 'block' : 'none';
      d.textContent = text || '';
    },
  };

  function complete(level, moves, hasNext) {
    const gold = moves <= level.par;
    $('.stars', ui).innerHTML = `<b>${moves}</b> moves · par ${level.par}${gold ? '<span class="gold-mark">★ Perfect: fewest possible moves</span>' : ''}`;
    $('[data-act="next"]', ui).style.display = hasNext ? '' : 'none';
    const petals = $('.petals', ui);
    petals.innerHTML = '';
    const n = save.settings.reducedMotion ? 0 : 36;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'petal';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = ['#E7B7B9', '#F2C6A8', '#F7F0E3', '#B7CBB0'][i % 4];
      p.style.animationDuration = 3 + Math.random() * 3 + 's';
      p.style.animationDelay = Math.random() * 1.5 + 's';
      p.style.setProperty('--dx', (Math.random() - 0.5) * 200 + 'px');
      p.style.setProperty('--rot', Math.random() * 720 + 'deg');
      petals.appendChild(p);
    }
    show('complete');
  }

  return { show, hud, complete, get current() { return current; } };
}
