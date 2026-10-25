/** Small per-device settings in localStorage. Every access is guarded: storage can be missing or blocked. */

export type ThemePref = 'system' | 'light' | 'dark';
export type KeepAwakeMode = 'auto' | 'video';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not saved; the app still works for this visit.
  }
}

export function getThemePref(): ThemePref {
  const v = read('theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function setThemePref(pref: ThemePref) {
  write('theme', pref === 'system' ? null : pref);
  applyTheme(pref);
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12110f' : '#f6f3ee');
}

export function getKeepAwakeMode(): KeepAwakeMode {
  return read('keepAwake') === 'video' ? 'video' : 'auto';
}

export function setKeepAwakeMode(mode: KeepAwakeMode) {
  write('keepAwake', mode === 'auto' ? null : mode);
}

/** Ingredient ticks on "Before you start", kept until cooking begins. */
export function getGathered(recipeId: string): string[] {
  try {
    const v = JSON.parse(read(`gathered:${recipeId}`) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setGathered(recipeId: string, ids: string[] | null) {
  write(`gathered:${recipeId}`, ids && ids.length ? JSON.stringify(ids) : null);
}
