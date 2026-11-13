/**
 * Gaze tracker:
 * - mouse: cursor as eye (testing)
 * - webcam: head pose via MediaPipe FaceLandmarker (face landmarks → screen)
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// MediaPipe face mesh indices
const LM_LEFT_EYE = 33;
const LM_RIGHT_EYE = 263;
const LM_NOSE = 1;
const LM_LEFT_IRIS = 468;
const LM_RIGHT_IRIS = 473;

export function createGazeTracker({
  sceneElements,
  onSceneChange,
  gazeDot,
  statusEl,
  mouseToggle = null,
}) {
  let mode = 'mouse'; // 'mouse' | 'webcam'
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let smoothX = x;
  let smoothY = y;
  let currentScene = null;
  let dwellScene = null;
  let dwellMs = 0;
  const DWELL_THRESHOLD_MS = 280;

  let video = null;
  let preview = null;
  let stream = null;
  let landmarker = null;
  let landmarkerLoading = null;
  let detecting = false;
  let lastVideoTime = -1;
  let rafId = null;
  let lastTs = performance.now();

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function forceMouseToggle(on) {
    if (mouseToggle) mouseToggle.checked = on;
  }

  function updateDot() {
    if (!gazeDot) return;
    gazeDot.style.left = `${smoothX}px`;
    gazeDot.style.top = `${smoothY}px`;
    gazeDot.classList.add('visible');
  }

  function pickSceneAtPoint(px, py) {
    const el = document.elementFromPoint(px, py);
    if (!el) return null;
    const section = el.closest?.('[data-scene]');
    if (section?.dataset?.scene) return section.dataset.scene;

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
    smoothX = x;
    smoothY = y;
    updateDot();
  }

  function stylePreview() {
    if (!preview) return;
    Object.assign(preview.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: '160px',
      height: '120px',
      objectFit: 'cover',
      borderRadius: '10px',
      zIndex: '70',
      transform: 'scaleX(-1)',
      boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      opacity: '0.92',
      pointerEvents: 'none',
    });
  }

  async function ensureLandmarker() {
    if (landmarker) return landmarker;
    if (landmarkerLoading) return landmarkerLoading;

    landmarkerLoading = (async () => {
      setStatus('loading head tracker…');
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      return landmarker;
    })().catch(async (err) => {
      console.warn('FaceLandmarker GPU failed, trying CPU', err);
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      return landmarker;
    });

    try {
      return await landmarkerLoading;
    } finally {
      landmarkerLoading = null;
    }
  }

  async function startWebcam() {
    try {
      await ensureLandmarker();

      setStatus('requesting camera…');
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();

      preview = document.createElement('video');
      preview.srcObject = stream;
      preview.muted = true;
      preview.playsInline = true;
      preview.setAttribute('playsinline', 'true');
      preview.id = 'head-track-preview';
      document.body.appendChild(preview);
      stylePreview();
      await preview.play().catch(() => {});

      setStatus('tracking: head — turn toward a section');
      return true;
    } catch (err) {
      console.warn('Head tracking failed', err);
      const msg =
        err?.name === 'NotAllowedError'
          ? 'camera blocked — using mouse'
          : `head failed: ${(err?.message || String(err)).slice(0, 48)}`;
      setStatus(msg);
      mode = 'mouse';
      forceMouseToggle(true);
      stopWebcam();
      return false;
    }
  }

  function stopWebcam() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    preview?.remove();
    preview = null;
    video = null;
    detecting = false;
    lastVideoTime = -1;
  }

  function landmarkPoint(lm, index) {
    const p = lm[index];
    if (!p) return null;
    return { x: p.x, y: p.y };
  }

  function sampleWebcam() {
    if (!video || !landmarker || detecting) return;
    if (video.readyState < 2) return;

    const t = video.currentTime;
    if (t === lastVideoTime) return;
    lastVideoTime = t;

    detecting = true;
    try {
      const result = landmarker.detectForVideo(video, performance.now());
      const faces = result?.faceLandmarks;
      if (!faces?.length) {
        detecting = false;
        return;
      }

      const lm = faces[0];
      const leftEye =
        landmarkPoint(lm, LM_LEFT_IRIS) || landmarkPoint(lm, LM_LEFT_EYE);
      const rightEye =
        landmarkPoint(lm, LM_RIGHT_IRIS) || landmarkPoint(lm, LM_RIGHT_EYE);
      const nose = landmarkPoint(lm, LM_NOSE);
      if (!leftEye || !rightEye) {
        detecting = false;
        return;
      }

      // Midpoint between eyes, nudged by nose for head pitch
      let nx = (leftEye.x + rightEye.x) * 0.5;
      let ny = (leftEye.y + rightEye.y) * 0.5;
      if (nose) {
        nx = nx * 0.75 + nose.x * 0.25;
        ny = ny * 0.65 + nose.y * 0.35;
      }

      // Selfie cam is mirrored — flip X so looking left aims left on screen
      x = (1 - nx) * window.innerWidth;
      y = ny * window.innerHeight;
    } catch (err) {
      console.warn('detectForVideo error', err);
    } finally {
      detecting = false;
    }
  }

  function tick(ts) {
    const dt = ts - lastTs;
    lastTs = ts;

    if (mode === 'webcam') {
      sampleWebcam();
    }

    const alpha = mode === 'webcam' ? 0.22 : 1;
    smoothX += (x - smoothX) * alpha;
    smoothY += (y - smoothY) * alpha;
    updateDot();

    const hit = pickSceneAtPoint(smoothX, smoothY);
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
        forceMouseToggle(true);
        setTimeout(() => {
          if (mode === 'mouse') setStatus('tracking: mouse');
        }, 2800);
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
    landmarker?.close?.();
    landmarker = null;
    if (rafId) cancelAnimationFrame(rafId);
    gazeDot?.classList.remove('visible');
  }

  return {
    start,
    stop,
    setMode,
    getMode: () => mode,
    getPoint: () => ({ x: smoothX, y: smoothY }),
    getCurrentScene: () => currentScene,
  };
}
