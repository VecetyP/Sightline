// localStorage progress + settings. Every access is guarded: storage can be unavailable.
const KEY = 'petalfold.save.v1'; // old project name; kept so existing progress survives the rename

export const DEFAULT_SETTINGS = {
  music: 0.5,
  sfx: 0.7,
  sensitivity: 1,
  snapThreshold: 12,
  invertDrag: false,
  alignHints: true,
  reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
};

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY)) || {};
    let progress = d.progress || {};
    // Layout 2 added a 4th level to worlds 2-4 (new ids 8, 12, 16), so old ids from 8 up moved.
    // Old 13 and 17 were redesigned, so their old bests don't apply.
    if (d.layout !== 2) progress = Object.fromEntries(Object.entries(progress).filter(([k]) => k !== '13' && k !== '17')
      .map(([k, v]) => [+k + (k >= 8) + (k >= 11) + (k >= 14), v]));
    return { layout: 2, progress, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
  } catch {
    return { layout: 2, progress: {}, settings: { ...DEFAULT_SETTINGS } };
  }
}

export const save = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage blocked: keep playing */ }
}

export const isBeaten = (id) => !!save.progress[id];
export const isUnlocked = (id, levels) => id === levels[0].id || isBeaten(id) || isBeaten(levels[levels.findIndex((l) => l.id === id) - 1]?.id);

export function recordWin(id, moves) {
  const p = save.progress[id];
  if (!p || moves < p.best) save.progress[id] = { best: moves };
  persist();
}
