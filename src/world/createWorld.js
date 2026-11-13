import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createOcean } from './ocean.js';
import { createDesert } from './desert.js';
import { createXrStoryPanel } from './xrStoryPanel.js';
import { createXrControls } from '../xr/xrControls.js';
import { createMarbleBackgrounds } from '../worldlabs/marbleBackgrounds.js';

const PANEL_WIDTH_PX = 420;
const PANEL_HEIGHT_PX = 560;
const PANEL_SCALE = 0.0055;

export function createWorld(
  canvas,
  panelEl,
  mountEl,
  { xrDevice = null, devui = null } = {}
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.xr.enabled = true;

  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.domElement.className = 'css3d-layer';
  mountEl.appendChild(cssRenderer.domElement);

  const sessionInit = {
    optionalFeatures: [
      'local-floor',
      'bounded-floor',
      'hand-tracking',
      'layers',
      'eye-tracking',
      'gaze-tracking',
    ],
  };
  // Keep Three's VRButton as a fallback control; primary CTA is the HUD emulator btn
  const vrButton = VRButton.createButton(renderer, sessionInit);
  vrButton.id = 'vr-button';
  mountEl.appendChild(vrButton);

  let xrSession = null;

  async function enterImmersive() {
    if (renderer.xr.isPresenting || xrSession) return true;
    if (!navigator.xr) {
      throw new Error('WebXR unavailable — Immersive Web Emulator failed to install');
    }
    const supported = await navigator.xr.isSessionSupported('immersive-vr');
    if (!supported) {
      throw new Error('immersive-vr not supported in this browser');
    }
    const session = await navigator.xr.requestSession('immersive-vr', {
      ...sessionInit,
      optionalFeatures: [
        'local-floor',
        'bounded-floor',
        'layers',
        ...(sessionInit.optionalFeatures || []),
      ],
    });
    session.addEventListener('end', () => {
      xrSession = null;
      syncImmersiveButtons(false);
    });
    await renderer.xr.setSession(session);
    xrSession = session;
    syncImmersiveButtons(true);
    return true;
  }

  async function exitImmersive() {
    const session = xrSession || renderer.xr.getSession?.();
    if (session) await session.end();
    xrSession = null;
    syncImmersiveButtons(false);
  }

  async function toggleImmersive() {
    if (renderer.xr.isPresenting || xrSession) {
      await exitImmersive();
      return false;
    }
    await enterImmersive();
    return true;
  }

  function syncImmersiveButtons(on) {
    const emu = document.getElementById('emulator-btn');
    if (emu) {
      emu.textContent = on
        ? 'Exit Immersive Web Emulator'
        : 'View in Immersive Web Emulator';
      emu.setAttribute('aria-pressed', on ? 'true' : 'false');
      emu.classList.toggle('active', on);
    }
    if (vrButton && vrButton.tagName === 'BUTTON') {
      vrButton.textContent = on ? 'EXIT VR' : 'ENTER VR';
    }
  }

  renderer.xr.addEventListener('sessionstart', () => syncImmersiveButtons(true));
  renderer.xr.addEventListener('sessionend', () => {
    xrSession = null;
    syncImmersiveButtons(false);
  });

  const scene = new THREE.Scene();
  const cssScene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a2430, 0.018);

  const camera = new THREE.PerspectiveCamera(
    58,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(0, 2.2, 8.5);

  const xrControls = createXrControls({ renderer, scene, camera, xrDevice });

  canvas.style.pointerEvents = 'auto';
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.rotateSpeed = 0.55;
  controls.panSpeed = 0.7;
  controls.zoomSpeed = 0.85;
  controls.minDistance = 3.8;
  controls.maxDistance = 18;
  controls.minPolarAngle = Math.PI * 0.22;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.minAzimuthAngle = -Math.PI * 0.7;
  controls.maxAzimuthAngle = Math.PI * 0.7;
  controls.screenSpacePanning = true;
  controls.target.set(0, 2.0, 3.2);
  controls.update();

  const ambient = new THREE.AmbientLight(0x8899aa, 0.45);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(8, 14, 6);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x6a8cb0, 0.35);
  fillLight.position.set(-10, 4, -4);
  scene.add(fillLight);

  const ocean = createOcean();
  const desert = createDesert();
  scene.add(ocean.group);
  scene.add(desert.group);
  desert.group.visible = false;

  // Marble (World Labs) splat backgrounds — replace procedural when loaded
  const marble = createMarbleBackgrounds({ scene, renderer });
  let useProcedural = true;
  let marbleFramed = false;

  // Mouse / gaze gently steers the camera — heavy, slippery follow
  let lookPointSource = null;
  const lookTarget = { x: 0, y: 0 };
  const lookSmooth = { x: 0, y: 0 };
  const lookVel = { x: 0, y: 0 };
  const lookBasePos = new THREE.Vector3();
  const lookBaseQuat = new THREE.Quaternion();
  const lookOffset = new THREE.Vector3();
  const lookSpherical = new THREE.Spherical();
  let lookBaseReady = false;
  // Max extra turn (radians) + spring (low = heavy / slow)
  const LOOK_YAW = 0.22;
  const LOOK_PITCH = 0.12;
  const LOOK_STIFFNESS = 3.2;
  const LOOK_DAMPING = 4.6;
  marble.setProceduralFallback((showProcedural) => {
    useProcedural = showProcedural;
    if (!showProcedural) {
      ocean.group.visible = false;
      desert.group.visible = false;
      scene.background = new THREE.Color(0x050608);
      scene.fog.density = 0.002;
    }
  });

  function cacheBaseOpacities(root) {
    root.traverse((obj) => {
      if (obj.material && obj.material.opacity !== undefined) {
        obj.userData.baseOpacity = obj.material.opacity;
        obj.material.transparent = true;
      }
    });
  }
  cacheBaseOpacities(ocean.group);
  cacheBaseOpacities(desert.group);

  // Desktop HTML panel in CSS3D
  panelEl.style.width = `${PANEL_WIDTH_PX}px`;
  panelEl.style.height = `${PANEL_HEIGHT_PX}px`;
  panelEl.classList.add('in-world');

  const panelObject = new CSS3DObject(panelEl);
  panelObject.scale.setScalar(PANEL_SCALE);
  panelObject.position.set(0, 2.05, 3.2);
  cssScene.add(panelObject);

  const panelGroup = new THREE.Group();
  panelGroup.position.copy(panelObject.position);
  scene.add(panelGroup);

  const worldW = PANEL_WIDTH_PX * PANEL_SCALE;
  const worldH = PANEL_HEIGHT_PX * PANEL_SCALE;

  const slabDepth = 0.12;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(worldW + 0.22, worldH + 0.22, slabDepth),
    new THREE.MeshStandardMaterial({
      color: 0xd9d0c4,
      roughness: 0.4,
      metalness: 0.12,
      transparent: true,
      opacity: 0.55,
    })
  );
  slab.position.z = -slabDepth * 0.5 - 0.01;
  panelGroup.add(slab);

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(worldW + 0.32, worldH + 0.32, 0.04),
    new THREE.MeshStandardMaterial({
      color: 0xf5f0e8,
      roughness: 0.3,
      metalness: 0.35,
      transparent: true,
      opacity: 0.55,
    })
  );
  rim.position.z = -0.02;
  panelGroup.add(rim);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(worldW + 0.7, worldH + 0.7),
    new THREE.MeshBasicMaterial({
      color: 0x7eb7ff,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  glow.position.z = -slabDepth - 0.04;
  panelGroup.add(glow);

  const pedestal = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    })
  );
  pedestal.rotation.x = -Math.PI / 2;
  pedestal.position.set(0, 0.05, 3.2);
  scene.add(pedestal);

  // Immersive-VR story panel (CSS3D can't draw in WebXR — 3D WebGL board instead)
  const xrStory = createXrStoryPanel();
  scene.add(xrStory.group);

  // Gaze reticle in VR
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.012, 0.022, 24),
    new THREE.MeshBasicMaterial({
      color: 0xff7a3c,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      side: THREE.DoubleSide,
    })
  );
  reticle.visible = false;
  reticle.renderOrder = 10;
  scene.add(reticle);

  const gazeDot3d = new THREE.Mesh(
    new THREE.SphereGeometry(0.01, 12, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff7a3c,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    })
  );
  gazeDot3d.visible = false;
  gazeDot3d.renderOrder = 11;
  scene.add(gazeDot3d);

  const xrGazeRaycaster = new THREE.Raycaster();
  const xrGazeOrigin = new THREE.Vector3();
  const xrGazeDir = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _headQ = new THREE.Quaternion();
  let xrDwellScene = null;
  let xrDwellMs = 0;
  let onSceneChangeCb = null;

  let activeScene = 'ocean';
  let transition = 0;
  let targetTransition = 0;
  let time = 0;
  let immersive = false;
  const voidSky = new THREE.Color(0x030405);

  const skyColors = {
    ocean: new THREE.Color(0x152536),
    desert: new THREE.Color(0xe0b56a),
  };
  const fogColors = {
    ocean: new THREE.Color(0x243848),
    desert: new THREE.Color(0xe8c57a),
  };
  const currentSky = skyColors.ocean.clone();
  const currentFog = fogColors.ocean.clone();
  scene.background = currentSky;

  const hintEl = document.getElementById('xr-hint');

  function setImmersive(on) {
    immersive = on;
    controls.enabled = !on;
    cssRenderer.domElement.style.display = on ? 'none' : '';
    panelGroup.visible = !on;
    pedestal.visible = !on;
    xrStory.setVisible(on);
    xrControls.setEnabled(on);
    reticle.visible = on;
    gazeDot3d.visible = on;

    // Show / hide DevUI overlay (hands + play mode)
    if (devui?.devUICanvas) {
      devui.devUICanvas.style.display = on ? 'block' : 'none';
      devui.devUICanvas.style.opacity = on ? '1' : '0';
    }
    if (devui?.devUIContainer) {
      devui.devUIContainer.style.display = on ? 'block' : 'none';
    }

    if (hintEl) {
      hintEl.style.display = on ? 'block' : 'none';
      if (on) {
        hintEl.textContent = xrDevice
          ? 'Play mode: click the IWER “lock pointer” control (or the overlay) · mouse looks · WASD moves · aim reticle at a section'
          : 'Aim reticle at a section · use controllers to move';
      }
    }

    if (on) {
      // Standing height looking at the XR story panel (not the far desktop orbit)
      xrControls.resetToDesktopView({
        position: new THREE.Vector3(0, 1.6, 0),
        target: new THREE.Vector3(0, 1.7, -2.2),
      });
      // Keep DevUI’s internal rig in sync with that pose
      try {
        devui?.applyDefaultPose?.({
          headset: {
            position: [0, 1.6, 0],
            quaternion: [
              xrDevice?.quaternion.x ?? 0,
              xrDevice?.quaternion.y ?? 0,
              xrDevice?.quaternion.z ?? 0,
              xrDevice?.quaternion.w ?? 1,
            ],
          },
          controllers: {},
          hands: {},
        });
      } catch {
        /* optional */
      }
      renderer.xr.setFramebufferScaleFactor?.(1.25);
      // Enter DevUI play mode so mouse + hands work immediately
      queueMicrotask(() => {
        try {
          devui?.inputLayer?.lockPointer?.();
        } catch {
          /* needs a user gesture — hint covers it */
        }
      });
    } else {
      renderer.xr.setFramebufferScaleFactor?.(1);
      try {
        document.exitPointerLock?.();
      } catch {
        /* ignore */
      }
      camera.position.set(0, 2.2, 8.5);
      camera.quaternion.identity();
      controls.target.set(0, 2.0, 3.2);
      controls.update();
      lookBaseReady = false;
      lookSmooth.x = 0;
      lookSmooth.y = 0;
      lookVel.x = 0;
      lookVel.y = 0;
    }
  }

  renderer.xr.addEventListener('sessionstart', () => setImmersive(true));
  renderer.xr.addEventListener('sessionend', () => setImmersive(false));

  function applySceneSwap(name) {
    activeScene = name;
    targetTransition = name === 'desert' ? 1 : 0;
    transition = targetTransition;
    xrStory.setActiveScene(name);

    if (marble.has(name)) {
      ocean.group.visible = false;
      desert.group.visible = false;
      scene.background.copy(voidSky);
      scene.fog.density = 0.0008;
      // Frame once — re-snapping the camera every swap caused the jitter
      if (!marbleFramed) {
        framePointCloud();
        marbleFramed = true;
      }
      // Smooth: dissolve solid → destination dots → multi-seed reveal
      marble.transitionTo(name, {
        dissolve: 0.45,
        crossfade: 0.53,
        hold: 0.45,
        duration: 3.07,
      });
    } else {
      marble.show(null);
      useProcedural = true;
      ocean.group.visible = name === 'ocean';
      desert.group.visible = name === 'desert';
    }
  }

  /** Start inside the world, facing the story panel (letter box). */
  function framePointCloud() {
    const panel = new THREE.Vector3(0, 2.0, 3.2);
    controls.target.copy(panel);
    // Same interior framing as the default desktop view
    camera.position.set(0, 2.2, 8.5);
    camera.lookAt(panel);

    const sphere = marble.getPointCloudBounds?.();
    if (sphere && sphere.radius > 0.1) {
      controls.minDistance = 2.5;
      controls.maxDistance = Math.max(18, sphere.radius * 3);
    } else {
      controls.minDistance = 3.8;
      controls.maxDistance = 18;
    }
    controls.update();
  }

  function setScene(name) {
    if (name !== 'ocean' && name !== 'desert') return;
    if (name === activeScene) return;
    applySceneSwap(name);
  }

  async function loadMarbleScene(sceneId, record, opts) {
    await marble.loadScene(sceneId, record, opts);
    if (activeScene === sceneId) {
      applySceneSwap(sceneId);
    }
  }

  // Start with procedural ocean; marble load swaps to point cloud
  applySceneSwap('ocean');

  function getGazeRay() {
    // Prefer emulated / hardware eye-gaze when available
    if (xrDevice?.gaze?.connected) {
      const g = xrDevice.gaze;
      // Gaze is viewer-local: origin at headset, direction from gaze quaternion
      xrGazeOrigin.set(
        xrDevice.position.x + xrControls.player.position.x,
        xrDevice.position.y + xrControls.player.position.y,
        xrDevice.position.z + xrControls.player.position.z
      );
      _q.set(g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w);
      _headQ.set(
        xrDevice.quaternion.x,
        xrDevice.quaternion.y,
        xrDevice.quaternion.z,
        xrDevice.quaternion.w
      );
      // gaze quaternion is relative to viewer; combine with headset
      _headQ.multiply(_q);
      xrGazeDir.set(0, 0, -1).applyQuaternion(_headQ);
      return true;
    }

    const xrCam = renderer.xr.getCamera();
    if (xrCam.isArrayCamera && xrCam.cameras?.length) {
      const eye = xrCam.cameras[0];
      eye.getWorldPosition(xrGazeOrigin);
      eye.getWorldDirection(xrGazeDir);
      return true;
    }
    xrCam.getWorldPosition(xrGazeOrigin);
    xrCam.getWorldDirection(xrGazeDir);
    return true;
  }

  function updateXrGaze(dt) {
    if (!getGazeRay()) {
      reticle.visible = false;
      gazeDot3d.visible = false;
      return;
    }

    xrGazeRaycaster.set(xrGazeOrigin, xrGazeDir);
    const hits = xrGazeRaycaster.intersectObject(
      xrStory.hitMesh || xrStory.mesh,
      true
    );
    if (!hits.length) {
      // Still show a floating reticle ahead of the eyes
      gazeDot3d.visible = true;
      gazeDot3d.position
        .copy(xrGazeOrigin)
        .addScaledVector(xrGazeDir, 1.5);
      reticle.visible = false;
      xrDwellScene = null;
      xrDwellMs = 0;
      return;
    }

    const hit = hits[0];
    reticle.visible = true;
    gazeDot3d.visible = true;
    reticle.position.copy(hit.point);
    gazeDot3d.position.copy(hit.point);
    // Face the viewer
    reticle.lookAt(xrGazeOrigin);

    if (!hit.uv) {
      xrDwellScene = null;
      xrDwellMs = 0;
      return;
    }

    // Canvas paints storm in the upper half (high uv.y), desert below
    const sceneName = hit.uv.y > 0.55 ? 'ocean' : 'desert';
    if (sceneName !== xrDwellScene) {
      xrDwellScene = sceneName;
      xrDwellMs = 0;
      return;
    }
    xrDwellMs += dt * 1000;
    if (xrDwellMs >= 200 && sceneName !== activeScene) {
      setScene(sceneName);
      onSceneChangeCb?.(sceneName);
    }
  }

  function onResize() {
    if (renderer.xr.isPresenting) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    cssRenderer.setSize(w, h);
  }

  window.addEventListener('resize', onResize);

  function setLookPointSource(fn) {
    lookPointSource = typeof fn === 'function' ? fn : null;
  }

  function updateLookInfluence(dt) {
    let nx = 0;
    let ny = 0;
    const pt = lookPointSource?.();
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      nx = (pt.x / w) * 2 - 1;
      ny = (pt.y / h) * 2 - 1;
      // Soft deadzone at center so idle doesn't drift
      const dead = 0.04;
      if (Math.abs(nx) < dead) nx = 0;
      else nx = (nx - Math.sign(nx) * dead) / (1 - dead);
      if (Math.abs(ny) < dead) ny = 0;
      else ny = (ny - Math.sign(ny) * dead) / (1 - dead);
      nx = THREE.MathUtils.clamp(nx, -1, 1);
      ny = THREE.MathUtils.clamp(ny, -1, 1);
    }
    lookTarget.x = nx;
    lookTarget.y = ny;

    // Critically-ish damped spring — feels heavy + slippery
    const ax = (lookTarget.x - lookSmooth.x) * LOOK_STIFFNESS;
    const ay = (lookTarget.y - lookSmooth.y) * LOOK_STIFFNESS;
    lookVel.x += ax * dt;
    lookVel.y += ay * dt;
    const damp = Math.exp(-LOOK_DAMPING * dt);
    lookVel.x *= damp;
    lookVel.y *= damp;
    lookSmooth.x += lookVel.x * dt;
    lookSmooth.y += lookVel.y * dt;
  }

  /** Nudge orbit camera around the panel target after OrbitControls settles. */
  function applyLookInfluence() {
    if (!lookBaseReady) return;
    lookOffset.subVectors(camera.position, controls.target);
    lookSpherical.setFromVector3(lookOffset);
    // Mouse/gaze left → camera turns left (content slides right)
    lookSpherical.theta -= lookSmooth.x * LOOK_YAW;
    lookSpherical.phi = THREE.MathUtils.clamp(
      lookSpherical.phi + lookSmooth.y * LOOK_PITCH,
      0.12,
      Math.PI - 0.12
    );
    lookOffset.setFromSpherical(lookSpherical);
    camera.position.copy(controls.target).add(lookOffset);
    camera.lookAt(controls.target);
  }

  function update(dt) {
    time += dt;
    transition += (targetTransition - transition) * Math.min(1, dt * 2.2);

    currentSky.copy(skyColors.ocean).lerp(skyColors.desert, transition);
    currentFog.copy(fogColors.ocean).lerp(fogColors.desert, transition);

    if (useProcedural) {
      scene.background.copy(currentSky);
      scene.fog.density = 0.018 - transition * 0.008;
    } else {
      // Marble point-cloud mode: dark clear so colored dots read clearly
      scene.background.copy(voidSky);
      scene.fog.density = 0.0008;
    }
    scene.fog.color.copy(currentFog);

    ambient.color.setRGB(
      0.53 + transition * 0.25,
      0.6 + transition * 0.15,
      0.67 - transition * 0.25
    );
    keyLight.intensity = 1.1 + transition * 0.35;
    keyLight.color.setRGB(1, 0.98 - transition * 0.15, 0.95 - transition * 0.25);
    glow.material.color.setRGB(
      0.45 + transition * 0.4,
      0.7 - transition * 0.15,
      1 - transition * 0.55
    );

    if (useProcedural) {
      const showOcean = transition < 0.98;
      const showDesert = transition > 0.02;
      ocean.group.visible = showOcean;
      desert.group.visible = showDesert;
      ocean.group.traverse((obj) => {
        if (obj.material && obj.userData.baseOpacity !== undefined) {
          obj.material.opacity = obj.userData.baseOpacity * (1 - transition);
        }
      });
      desert.group.traverse((obj) => {
        if (obj.material && obj.userData.baseOpacity !== undefined) {
          obj.material.opacity = obj.userData.baseOpacity * transition;
        }
      });
      ocean.update(time, 1 - transition);
      desert.update(time, transition);
    } else {
      ocean.group.visible = false;
      desert.group.visible = false;
    }

    marble.update?.(dt);

    // Drive DevUI hand gizmos + headset sync while emulating
    if (immersive && devui?.render) {
      devui.render(performance.now());
    }

    if (!immersive) {
      const floatY = 2.05 + Math.sin(time * 0.7) * 0.04;
      const floatX = Math.sin(time * 0.18) * 0.03;
      panelObject.position.set(floatX, floatY, 3.2);
      panelObject.rotation.set(
        Math.sin(time * 0.28) * 0.02,
        Math.sin(time * 0.17) * 0.04,
        Math.sin(time * 0.21) * 0.01
      );
      panelGroup.position.copy(panelObject.position);
      panelGroup.rotation.copy(panelObject.rotation);
      pedestal.position.x = floatX;

      // Restore uninfluenced pose so OrbitControls doesn't eat the look offset
      if (lookBaseReady) {
        camera.position.copy(lookBasePos);
        camera.quaternion.copy(lookBaseQuat);
      }
      controls.update();
      lookBasePos.copy(camera.position);
      lookBaseQuat.copy(camera.quaternion);
      lookBaseReady = true;

      updateLookInfluence(dt);
      applyLookInfluence();

      renderer.render(scene, camera);
      cssRenderer.render(cssScene, camera);
    } else {
      xrControls.update(dt);
      xrStory.update?.(dt);
      updateXrGaze(dt);
      renderer.render(scene, camera);
    }
  }

  return {
    setScene,
    loadMarbleScene,
    marble,
    onSceneChange(cb) {
      onSceneChangeCb = cb;
    },
    getActiveScene: () => activeScene,
    setLookPointSource,
    enterImmersive,
    exitImmersive,
    toggleImmersive,
    controls,
    renderer,
    camera,
    scene,
    isImmersive: () => immersive,
    update,
    dispose() {
      window.removeEventListener('resize', onResize);
      controls.dispose();
      xrControls.dispose();
      marble.dispose?.();
      vrButton.remove();
      cssRenderer.domElement.remove();
      renderer.dispose();
    },
  };
}
