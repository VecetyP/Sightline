// Web Audio synth: ambient pad, footstep plinks, snap chime, level-complete arpeggio. No asset files.
import { save } from './save.js';

let ctx, music, sfx, reverb, padTimer;
const PENTA = [0, 2, 4, 7, 9];
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function impulse(seconds) {
  const len = ctx.sampleRate * seconds, buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
  }
  return buf;
}

// Must be called from a user gesture (autoplay rules).
export function startAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  reverb = ctx.createConvolver();
  reverb.buffer = impulse(3.5);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  reverb.connect(wet).connect(ctx.destination);
  music = ctx.createGain();
  sfx = ctx.createGain();
  for (const g of [music, sfx]) { g.connect(ctx.destination); g.connect(reverb); }
  applyVolumes();
  playPad();
}

export function applyVolumes() {
  if (!ctx) return;
  music.gain.setTargetAtTime(save.settings.music * 0.22, ctx.currentTime, 0.2);
  sfx.gain.setTargetAtTime(save.settings.sfx * 0.5, ctx.currentTime, 0.05);
}

function tone(freq, start, dur, { type = 'sine', gain = 0.3, attack = 0.005, out = sfx } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + dur + 0.05);
}

const CHORDS = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]]; // Cmaj7 Am7 Fmaj7 G
let chordIdx = 0;
function playPad() {
  const t = ctx.currentTime, len = 8;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 900;
  filt.connect(music);
  for (const n of CHORDS[chordIdx]) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = hz(n);
      o.detune.value = det;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 2.5);
      g.gain.setValueAtTime(0.06, t + len - 1);
      g.gain.linearRampToValueAtTime(0, t + len + 2);
      o.connect(g).connect(filt);
      o.start(t);
      o.stop(t + len + 2.1);
    }
  }
  // A few soft melody notes drifting over the pad.
  for (let i = 0; i < 3; i++) {
    if (Math.random() < 0.5) continue;
    const n = 72 + PENTA[Math.floor(Math.random() * 5)];
    tone(hz(n), t + 1 + i * 2.2 + Math.random(), 2.5, { gain: 0.05, attack: 0.3, out: music });
  }
  chordIdx = (chordIdx + 1) % CHORDS.length;
  padTimer = setTimeout(playPad, len * 1000);
}

export function step() {
  if (!ctx) return;
  const n = 79 + PENTA[Math.floor(Math.random() * 5)];
  tone(hz(n), ctx.currentTime, 0.18, { gain: 0.12 });
  tone(hz(n + 12), ctx.currentTime, 0.08, { gain: 0.03 });
}

export function bump() {
  if (!ctx) return;
  tone(hz(52), ctx.currentTime, 0.12, { gain: 0.12, type: 'triangle' });
}

export function chime() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(hz(88), t, 1.2, { gain: 0.08 });
  tone(hz(95), t + 0.06, 1.4, { gain: 0.06 });
  tone(hz(88 + 24), t, 0.5, { gain: 0.015 });
}

export function plate() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(hz(60), t, 0.5, { gain: 0.15, type: 'triangle' });
  tone(hz(67), t + 0.1, 0.6, { gain: 0.1 });
}

export function arpeggio() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [72, 76, 79, 84, 88, 91].forEach((n, i) => tone(hz(n), t + i * 0.11, 1.2, { gain: 0.12 }));
  tone(hz(60), t, 2.5, { gain: 0.08, type: 'triangle', attack: 0.05 });
}

export function click() {
  if (!ctx) return;
  tone(hz(84), ctx.currentTime, 0.07, { gain: 0.05 });
}

export function push() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(hz(45), t, 0.25, { gain: 0.16, type: 'triangle', attack: 0.02 });
  tone(hz(57), t + 0.05, 0.2, { gain: 0.06, type: 'triangle' });
}
