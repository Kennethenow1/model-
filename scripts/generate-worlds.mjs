/**
 * Generate Marble worlds for ocean + desert, write public/worlds-cache.json.
 * Usage: node scripts/generate-worlds.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const API = 'https://api.worldlabs.ai/marble/v1';

function loadEnvKey() {
  const text = readFileSync(resolve(root, '.env'), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*WLT_API_KEY\s*=\s*(.+)\s*$/);
    if (!m) continue;
    return m[1].trim().replace(/^['"]|['"]$/g, '');
  }
  throw new Error('WLT_API_KEY not found in .env');
}

const PROMPTS = {
  ocean: {
    id: 'ocean',
    displayName: 'Stormy Ocean',
    model: 'marble-1.1',
    textPrompt:
      'A stormy open ocean at night, heavy rain, dark choppy waves, ' +
      'low storm clouds, distant lightning illuminating the horizon, ' +
      'wet atmosphere, cinematic immersive environment, no people, no text',
  },
  desert: {
    id: 'desert',
    displayName: 'Desert',
    model: 'marble-1.1',
    textPrompt:
      'An endless sun-baked desert of soft rolling dunes under a harsh ' +
      'bright sky, heat haze, sparse dry air, warm golden sand, ' +
      'cinematic immersive environment, no people, no text',
  },
};

const apiKey = loadEnvKey();
if (!apiKey || apiKey.length < 16 || apiKey.includes('your_key_here')) {
  throw new Error('WLT_API_KEY does not look valid');
}
console.log(`API key loaded (len ${apiKey.length}). Starting generation…`);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'WLT-Api-Key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateOne(prompt) {
  console.log(`\n▶ Generating "${prompt.displayName}"…`);
  const op = await api('/worlds:generate', {
    method: 'POST',
    body: {
      display_name: prompt.displayName,
      model: prompt.model,
      world_prompt: {
        type: 'text',
        text_prompt: prompt.textPrompt,
      },
    },
  });

  const operationId = op.operation_id;
  console.log(`  operation: ${operationId}`);

  while (true) {
    await sleep(8000);
    const current = await api(`/operations/${operationId}`);
    const status = current.metadata?.progress?.status ?? (current.done ? 'DONE' : '…');
    const desc = current.metadata?.progress?.description ?? '';
    console.log(`  ${status}${desc ? ` — ${desc}` : ''}`);

    if (current.error) {
      throw new Error(JSON.stringify(current.error));
    }
    if (current.done) {
      const worldId = current.metadata?.world_id || current.response?.id;
      const world = worldId
        ? await api(`/worlds/${worldId}`).catch(() => current.response)
        : current.response;

      const splats = world?.assets?.splats ?? {};
      const spz =
        splats.spz_urls?.['500k'] ||
        splats.spz_urls?.['100k'] ||
        splats.spz_urls?.full_res ||
        null;

      return {
        sceneId: prompt.id,
        worldId: world.id,
        displayName: prompt.displayName,
        prompt: prompt.textPrompt,
        model: prompt.model,
        worldMarbleUrl: world.world_marble_url ?? null,
        spzUrl: spz,
        spzUrls: splats.spz_urls ?? null,
        thumbnailUrl: world.assets?.thumbnail_url ?? null,
        panoUrl: world.assets?.imagery?.pano_url ?? null,
        caption: world.assets?.caption ?? null,
        semantics: splats.semantics_metadata ?? null,
        generatedAt: new Date().toISOString(),
      };
    }
  }
}

const cachePath = resolve(root, 'public/worlds-cache.json');
let cache = {};
try {
  cache = JSON.parse(readFileSync(cachePath, 'utf8'));
} catch {
  cache = {};
}

for (const id of ['ocean', 'desert']) {
  if (cache[id]?.spzUrl) {
    console.log(`\n✓ "${id}" already cached — skipping`);
    continue;
  }
  cache[id] = await generateOne(PROMPTS[id]);
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  console.log(`  saved ${id} → world ${cache[id].worldId}`);
}

writeFileSync(cachePath, JSON.stringify(cache, null, 2));
console.log(`\nDone. Cache written to public/worlds-cache.json`);
for (const id of ['ocean', 'desert']) {
  console.log(`  ${id}: ${cache[id]?.worldId ?? 'MISSING'} spz=${!!cache[id]?.spzUrl}`);
}
