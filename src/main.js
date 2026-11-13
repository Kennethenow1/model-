import './styles.css';
import { installIwer } from './xr/installIwer.js';
import { createWorld } from './world/createWorld.js';
import { createGazeTracker } from './tracking/gazeTracker.js';
import { SCENE_PROMPTS } from './worldlabs/prompts.js';
import { createWorldLabsClient } from './worldlabs/client.js';
import { createWorldStore, toWorldRecord } from './worldlabs/store.js';

const canvas = document.getElementById('world');
const mountEl = document.getElementById('app');
const panelEl = document.getElementById('story-panel');
const sceneLabel = document.getElementById('scene-label');
const gazeStatus = document.getElementById('gaze-status');
const gazeDot = document.getElementById('gaze-dot');
const mouseToggle = document.getElementById('mouse-as-eye');
const xrStatus = document.getElementById('xr-status');
const wlStatus = document.getElementById('wl-status');
const generateBtn = document.getElementById('generate-worlds');
const downloadCacheBtn = document.getElementById('download-worlds-cache');
const apiKeyInput = document.getElementById('wl-api-key');
const sceneElements = [
  ...document.querySelectorAll('.story-scene[data-scene]'),
];

const SCENE_TITLES = {
  ocean: 'Stormy Ocean',
  desert: 'Desert',
};

const store = createWorldStore();
await store.hydrateFromPublicFile();

const client = createWorldLabsClient({
  getApiKey: () =>
    apiKeyInput?.value?.trim() ||
    sessionStorage.getItem('wlt_api_key') ||
    null,
});

// Meta Immersive Web Emulator (IWER) must install before WebXR / renderer setup
const iwer = await installIwer();
if (xrStatus) {
  xrStatus.textContent = iwer.emulated
    ? 'XR: Immersive Web Emulator'
    : 'XR: native headset';
}

const world = createWorld(canvas, panelEl, mountEl, {
  xrDevice: iwer.xrDevice,
  devui: iwer.devui,
});

// Hide DevUI chrome until an XR session starts
if (iwer.devui?.devUICanvas) iwer.devui.devUICanvas.style.display = 'none';
if (iwer.devui?.devUIContainer) iwer.devui.devUIContainer.style.display = 'none';

world.renderer.xr.addEventListener('sessionend', () => {
  setPlayModeVisible(false);
});

const emulatorBtn = document.getElementById('emulator-btn');
const playModeBtn = document.getElementById('play-mode-btn');

function setPlayModeVisible(on) {
  if (!playModeBtn) return;
  playModeBtn.style.display = on && iwer.emulated ? 'block' : 'none';
}

playModeBtn?.addEventListener('click', () => {
  try {
    iwer.devui?.inputLayer?.lockPointer?.();
    setPlayModeVisible(false);
    setWlStatus('Mouse look on — WASD move · hands follow your view');
  } catch (err) {
    console.warn(err);
    setWlStatus('Could not lock pointer — try the IWER play button');
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked = !!document.pointerLockElement;
  if (world.isImmersive?.() && iwer.emulated) {
    setPlayModeVisible(!locked);
  }
});

emulatorBtn?.addEventListener('click', async () => {
  emulatorBtn.disabled = true;
  try {
    const on = await world.toggleImmersive();
    if (on) {
      setWlStatus(
        iwer.emulated
          ? 'Emulator on — click “mouse look + hands” then WASD to move'
          : 'Native VR — aim gaze at a section to switch worlds'
      );
      setPlayModeVisible(!!iwer.emulated);
    } else {
      setWlStatus('Marble: desktop view');
      setPlayModeVisible(false);
    }
  } catch (err) {
    console.warn(err);
    setWlStatus(err?.message || 'Could not start Immersive Web Emulator');
    setPlayModeVisible(false);
  } finally {
    emulatorBtn.disabled = false;
  }
});

// Hide the duplicate bottom ENTER VR when we have the HUD emulator CTA
if (iwer.emulated) {
  const vrBtn = document.getElementById('vr-button');
  if (vrBtn) vrBtn.style.display = 'none';
}

function setWlStatus(text) {
  if (wlStatus) wlStatus.textContent = text;
}

function onSceneChange(sceneName) {
  world.setScene(sceneName);
  sceneLabel.textContent = SCENE_TITLES[sceneName] ?? sceneName;
  sceneLabel.dataset.active = sceneName;
  for (const el of sceneElements) {
    el.classList.toggle('active', el.dataset.scene === sceneName);
  }
  const record = store.get(sceneName);
  if (record?.spzUrl) {
    setWlStatus(`Marble: ${record.displayName}`);
  } else {
    setWlStatus('Marble: procedural fallback');
  }
}

world.onSceneChange(onSceneChange);

/** Load any already-stored worlds into the scene */
async function warmStoredWorlds() {
  const all = store.all();
  for (const sceneId of Object.keys(SCENE_PROMPTS)) {
    const record = all[sceneId];
    if (!record?.spzUrl) continue;
    try {
      setWlStatus(`Loading cached ${sceneId}…`);
      await world.loadMarbleScene(sceneId, record, {
        onProgress: setWlStatus,
      });
    } catch (err) {
      console.warn(`Failed to load cached ${sceneId}`, err);
      setWlStatus(`Cache load failed for ${sceneId}`);
    }
  }
  onSceneChange(world.getActiveScene() || 'ocean');
}

onSceneChange('ocean');
await warmStoredWorlds();

const tracker = createGazeTracker({
  sceneElements,
  onSceneChange,
  gazeDot,
  statusEl: gazeStatus,
  mouseToggle,
});

tracker.start();

// Gaze / mouse gently steers the camera (heavy, slippery follow)
world.setLookPointSource(() => tracker.getPoint());

mouseToggle.addEventListener('change', async () => {
  mouseToggle.disabled = true;
  try {
    if (mouseToggle.checked) {
      await tracker.setMode('mouse');
    } else {
      await tracker.setMode('webcam');
    }
  } finally {
    mouseToggle.disabled = false;
    // Keep checkbox in sync with actual mode
    mouseToggle.checked = tracker.getMode() === 'mouse';
  }
});

apiKeyInput?.addEventListener('change', () => {
  const v = apiKeyInput.value.trim();
  if (v) sessionStorage.setItem('wlt_api_key', v);
});
if (apiKeyInput && sessionStorage.getItem('wlt_api_key')) {
  apiKeyInput.value = sessionStorage.getItem('wlt_api_key');
}

/**
 * Generate Marble worlds for each story section, store them, load SPZ.
 * Generation is slow (~5 min each) and spends API credits.
 */
async function generateAllWorlds() {
  generateBtn.disabled = true;
  try {
    for (const sceneId of Object.keys(SCENE_PROMPTS)) {
      const prompt = SCENE_PROMPTS[sceneId];
      setWlStatus(`Generating ${prompt.displayName}…`);
      const worldPayload = await client.generateAndWait(prompt, {
        onProgress: (p) => {
          setWlStatus(
            `${prompt.displayName}: ${p.status}${p.description ? ` — ${p.description}` : ''}`
          );
        },
      });
      const record = toWorldRecord(sceneId, prompt, worldPayload);
      store.set(sceneId, record);
      setWlStatus(`Loading splat for ${prompt.displayName}…`);
      await world.loadMarbleScene(sceneId, record, { onProgress: setWlStatus });
    }
    setWlStatus('Marble worlds ready — gaze switches them');
    onSceneChange(world.getActiveScene());
  } catch (err) {
    console.error(err);
    setWlStatus(err.message || 'Generation failed');
  } finally {
    generateBtn.disabled = false;
  }
}

generateBtn?.addEventListener('click', () => {
  const key = apiKeyInput?.value?.trim() || sessionStorage.getItem('wlt_api_key');
  if (!key) {
    setWlStatus('Tip: set WLT_API_KEY in .env (restart) or paste key here');
  }
  generateAllWorlds();
});

downloadCacheBtn?.addEventListener('click', () => {
  store.downloadCacheFile();
  setWlStatus('Downloaded worlds-cache.json — save into /public to commit');
});

let last = performance.now();

world.renderer.setAnimationLoop((now) => {
  const t = typeof now === 'number' ? now : performance.now();
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  world.update(dt);
});
