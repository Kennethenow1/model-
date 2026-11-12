/**
 * Gaze tracker with two modes:
 * - mouse: cursor position acts as the eye (for testing)
 * - webcam: experimental webcam eye approximation via face/nose proxy
 *
 * Both report a screen-space point and which story scene element is under it.
 */

export function createGazeTracker({
  sceneElements,
  onSceneChange,
  gazeDot,
  statusEl,
}) {
  let mode = 'mouse'; // 'mouse' | 'webcam'
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let currentScene = null;
  let dwellScene = null;
  let dwellMs = 0;
  const DWELL_THRESHOLD_MS = 280;

  let video = null;
  let stream = null;
  let canvas = null;
  let ctx = null;
  let detector = null;
  let rafId = null;
  let lastTs = performance.now();

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function updateDot() {
    if (!gazeDot) return;
    gazeDot.style.left = `${x}px`;
    gazeDot.style.top = `${y}px`;
    gazeDot.classList.add('visible');
  }

  function pickSceneAtPoint(px, py) {
    // Prefer elementFromPoint so scrolling inside the panel still works.
    const el = document.elementFromPoint(px, py);
    if (!el) return null;
    const section = el.closest?.('[data-scene]');
    if (section?.dataset?.scene) return section.dataset.scene;

    // Fallback: bounding-box hit test against story sections
    for (const sectionEl of sceneElements) {
      const r = sectionEl.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
        return sectionEl.dataset.scene;
      }
    }
    return null;
  }

  function applySceneHighlight(sceneName) {
    for (const el of sceneElements) {
      el.classList.toggle('active', el.dataset.scene === sceneName);
    }
  }

  function considerScene(sceneName, dt) {
    if (!sceneName) {
      dwellScene = null;
      dwellMs = 0;
      return;
    }

    if (sceneName !== dwellScene) {
      dwellScene = sceneName;
      dwellMs = 0;
      return;
    }

    dwellMs += dt;
    if (dwellMs >= DWELL_THRESHOLD_MS && sceneName !== currentScene) {
      currentScene = sceneName;
      applySceneHighlight(sceneName);
      onSceneChange?.(sceneName);
    }
  }

  function onMouseMove(e) {
    if (mode !== 'mouse') return;
    x = e.clientX;
    y = e.clientY;
    updateDot();
  }

  async function startWebcam() {
    if (!('FaceDetector' in window)) {
      setStatus('webcam unsupported — using mouse');
      mode = 'mouse';
      return false;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      });
      video = document.createElement('video');
      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      await video.play();

      canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      setStatus('tracking: webcam');
      return true;
    } catch {
      setStatus('camera blocked — using mouse');
      mode = 'mouse';
      stopWebcam();
      return false;
    }
  }

  function stopWebcam() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video = null;
    canvas = null;
    ctx = null;
    detector = null;
  }

  async function sampleWebcam() {
    if (!video || !ctx || !detector || video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const faces = await detector.detect(canvas);
      if (!faces.length) return;
      const box = faces[0].boundingBox;
      // Map face center to screen. Mirror X because selfie cameras are mirrored.
      const nx = 1 - (box.x + box.width / 2) / canvas.width;
      const ny = (box.y + box.height * 0.4) / canvas.height;
      x = nx * window.innerWidth;
      y = ny * window.innerHeight;
      updateDot();
    } catch {
      // FaceDetector can throw intermittently; ignore.
    }
  }

  function tick(ts) {
    const dt = ts - lastTs;
    lastTs = ts;

    if (mode === 'webcam') {
      sampleWebcam();
    }

    // Hide the gaze dot under opaque UI hit-testing by temporarily
    // disabling pointer events on the dot (already pointer-events: none).
    const hit = pickSceneAtPoint(x, y);
    considerScene(hit, dt);

    rafId = requestAnimationFrame(tick);
  }

  async function setMode(next) {
    if (next === mode) return;
    mode = next;
    if (mode === 'webcam') {
      const ok = await startWebcam();
      if (!ok) {
        mode = 'mouse';
        setStatus('tracking: mouse');
      }
    } else {
      stopWebcam();
      setStatus('tracking: mouse');
    }
  }

  function start() {
    window.addEventListener('mousemove', onMouseMove);
    setStatus('tracking: mouse');
    updateDot();
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    window.removeEventListener('mousemove', onMouseMove);
    stopWebcam();
    if (rafId) cancelAnimationFrame(rafId);
    gazeDot?.classList.remove('visible');
  }

  return {
    start,
    stop,
    setMode,
    getMode: () => mode,
    getPoint: () => ({ x, y }),
    getCurrentScene: () => currentScene,
  };
}
