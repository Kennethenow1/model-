const STORAGE_KEY = 'world-model-marble-worlds';

/**
 * Local store for generated Marble worlds (per story section).
 * Persists in localStorage and can load a committed JSON cache from /worlds-cache.json.
 */
export function createWorldStore() {
  let cache = loadFromLocal();

  function loadFromLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  }

  async function hydrateFromPublicFile() {
    try {
      const res = await fetch('/worlds-cache.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      cache = { ...data, ...cache };
      save();
    } catch {
      // optional file
    }
  }

  function get(sceneId) {
    return cache[sceneId] ?? null;
  }

  function set(sceneId, worldRecord) {
    cache[sceneId] = worldRecord;
    save();
    return worldRecord;
  }

  function all() {
    return { ...cache };
  }

  function clear() {
    cache = {};
    localStorage.removeItem(STORAGE_KEY);
  }

  /** Download a JSON file you can save as public/worlds-cache.json */
  function downloadCacheFile() {
    const blob = new Blob([JSON.stringify(cache, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'worlds-cache.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return {
    hydrateFromPublicFile,
    get,
    set,
    all,
    clear,
    downloadCacheFile,
  };
}

/**
 * Normalize a Marble API world payload into our stored record.
 */
export function toWorldRecord(sceneId, promptMeta, world) {
  const splats = world?.assets?.splats ?? {};
  const spz =
    splats.spz_urls?.['500k'] ||
    splats.spz_urls?.['100k'] ||
    splats.spz_urls?.full_res ||
    null;

  return {
    sceneId,
    worldId: world.id,
    displayName: promptMeta.displayName,
    prompt: promptMeta.textPrompt,
    model: promptMeta.model,
    worldMarbleUrl: world.world_marble_url ?? null,
    spzUrl: spz,
    spzUrls: splats.spz_urls ?? null,
    thumbnailUrl: world.assets?.thumbnail_url ?? null,
    panoUrl: world.assets?.imagery?.pano_url ?? null,
    caption: world.assets?.caption ?? null,
    semantics: splats.semantics_metadata ?? null,
    generatedAt: new Date().toISOString(),
    raw: world,
  };
}
