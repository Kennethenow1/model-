import * as THREE from 'three';
import {
  SparkRenderer,
  SplatLoader,
  SplatMesh,
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
  SplatEditRgbaBlendMode,
} from '@sparkjsdev/spark';

const DOT_BUDGET = 340000;
const SEED_COUNT = 5;
/** Spatial bins so dense floor/center splats can't hog the cloud */
const GRID_X = 16;
const GRID_Y = 12;
const GRID_Z = 16;

/**
 * World Labs–style marble transition:
 *  1) Colored lidar-style dots fill the volume
 *  2) Several soft fronts crawl from floor seeds at different rates
 *  3) Solid Gaussian splat (real scene colors) reveals behind them
 */
export function createMarbleBackgrounds({ scene, renderer }) {
  const spark = new SparkRenderer({
    renderer,
    minPixelRadius: 0,
    falloff: 1,
  });
  scene.add(spark);

  /** @type {Record<string, SplatMesh | null>} */
  const meshes = { ocean: null, desert: null };
  /** @type {Record<string, number>} */
  const baseScale = { ocean: 1, desert: 1 };
  /** @type {Record<string, THREE.Points | null>} */
  const clouds = { ocean: null, desert: null };
  /** @type {Record<string, {
   *   reveal: SplatEdit,
   *   sdfs: SplatEditSdf[],
   * } | null>} */
  const burns = { ocean: null, desert: null };
  /** @type {Record<string, Array<{
   *   pos: THREE.Vector3,
   *   rate: number,
   *   delay: number,
   *   maxScale: number,
   * }>>} */
  const burnSeeds = { ocean: [], desert: [] };
  /** @type {Record<string, number>} */
  const burnMaxR = { ocean: 8, desert: 8 };

  let active = null;
  let proceduralVisible = true;
  let onFallback = null;
  /** 'dots' | 'solid' */
  let viewMode = 'dots';

  /** @type {null | {
   *   phase: 'dissolve'|'crossfade'|'hold'|'burn'|'done',
   *   t: number,
   *   hold: number,
   *   duration: number,
   *   dissolve: number,
   *   crossfade: number,
   *   maxRadius: number,
   *   fromId: string|null,
   *   toId: string,
   *   resolve: (v?: void) => void,
   * }} */
  let anim = null;

  const loader = new SplatLoader();
  const _box = new THREE.Box3();
  const _size = new THREE.Vector3();
  const _center = new THREE.Vector3();
  function setProceduralFallback(cb) {
    onFallback = cb;
  }

  function easeInOutButter(t) {
    return t < 0.5
      ? 16 * t * t * t * t * t
      : 1 - Math.pow(-2 * t + 2, 5) / 2;
  }

  function makeDotMaterial() {
    const origins = [];
    const radii = [];
    for (let i = 0; i < SEED_COUNT; i++) {
      origins.push(new THREE.Vector3());
      radii.push(-1);
    }
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uSize: { value: 7.2 },
        uOpacity: { value: 1 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTime: { value: 0 },
        uWobble: { value: 1 },
        uBurnOrigins: { value: origins },
        uBurnRadii: { value: radii },
        uBurnCount: { value: 0 }, // 0 = no clip (full dots)
        uBurnSoft: { value: 1.4 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vBurn;
        varying vec2 vBlurDir;
        varying float vBlurAmt;
        uniform float uSize;
        uniform float uPixelRatio;
        uniform float uTime;
        uniform float uWobble;
        uniform vec3 uBurnOrigins[${SEED_COUNT}];
        uniform float uBurnRadii[${SEED_COUNT}];
        uniform int uBurnCount;
        uniform float uBurnSoft;

        vec3 wobbleOffset(float t, float seed) {
          float s = seed * 6.2831853;
          float a = 0.016 * uWobble;
          return vec3(
            sin(t * 2.1 + s) * a + sin(t * 5.3 + s * 1.7) * a * 0.35,
            cos(t * 1.7 + s * 0.9) * a * 0.75 + sin(t * 4.2 + s) * a * 0.25,
            sin(t * 2.6 + s * 1.3) * a + cos(t * 3.8 + s * 0.6) * a * 0.3
          );
        }

        vec3 wobbleVelocity(float t, float seed) {
          float s = seed * 6.2831853;
          float a = 0.016 * uWobble;
          return vec3(
            cos(t * 2.1 + s) * 2.1 * a + cos(t * 5.3 + s * 1.7) * 5.3 * a * 0.35,
            -sin(t * 1.7 + s * 0.9) * 1.7 * a * 0.75 + cos(t * 4.2 + s) * 4.2 * a * 0.25,
            cos(t * 2.6 + s * 1.3) * 2.6 * a - sin(t * 3.8 + s * 0.6) * 3.8 * a * 0.3
          );
        }

        void main() {
          // True splat colors — no lift/boost
          vColor = color;

          vec3 wob = wobbleOffset(uTime, aSeed);
          vec3 vel = wobbleVelocity(uTime, aSeed);
          vec3 worldPos = position + wob;

          // Keep = 1 outside all reveal seeds; 0 inside any growing front
          float keep = 1.0;
          if (uBurnCount > 0) {
            for (int i = 0; i < ${SEED_COUNT}; i++) {
              if (i >= uBurnCount) break;
              float r = uBurnRadii[i];
              if (r < 0.0) continue;
              float d = distance(worldPos, uBurnOrigins[i]);
              float soft = max(0.08, uBurnSoft);
              float k = smoothstep(r - soft, r + soft * 0.35, d);
              keep = min(keep, k);
            }
          }
          vBurn = keep;

          vec4 mv = modelViewMatrix * vec4(worldPos, 1.0);
          // Velocity in view space for screen-aligned motion blur
          vec3 velView = mat3(modelViewMatrix) * vel;
          vec2 blur = velView.xy;
          float blurLen = length(blur);
          vBlurDir = blurLen > 1e-5 ? blur / blurLen : vec2(1.0, 0.0);
          vBlurAmt = clamp(blurLen * 14.0, 0.0, 2.2);

          float dist = max(0.35, -mv.z);
          float size = uSize * (0.85 + aSeed * 0.55);
          // Stretch point sprite a bit with speed
          size *= (1.0 + vBlurAmt * 0.55);
          gl_PointSize = clamp((size * uPixelRatio) / dist * 3.0, 2.0, 24.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vColor;
        varying float vBurn;
        varying vec2 vBlurDir;
        varying float vBlurAmt;
        uniform float uOpacity;
        void main() {
          if (vBurn < 0.02) discard;
          vec2 c = gl_PointCoord - 0.5;
          // Anisotropic disc stretched along motion → motion blur streak
          float stretch = 1.0 + vBlurAmt * 1.1;
          float along = dot(c, vBlurDir);
          float across = dot(c, vec2(-vBlurDir.y, vBlurDir.x));
          float d = length(vec2(along / stretch, across));
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.14, d);
          // Soft trail fade along the streak
          float trail = smoothstep(0.5, -0.15, along / stretch);
          float alpha = core * mix(1.0, 0.55 + trail * 0.45, clamp(vBlurAmt * 0.5, 0.0, 1.0));
          alpha *= uOpacity * vBurn;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
    });
  }

  function sampleDotCloud(sceneId, mesh, packedHint = null) {
    if (clouds[sceneId]) {
      scene.remove(clouds[sceneId]);
      clouds[sceneId].geometry.dispose();
      clouds[sceneId].material.dispose();
      clouds[sceneId] = null;
    }

    const positions = [];
    const colors = [];
    const seeds = [];

    // Prefer the loaded PackedSplats CPU buffer (mesh.splats can be empty/GPU-only)
    const source =
      packedHint ||
      mesh.packedSplats ||
      mesh.extSplats ||
      null;

    const num = source?.numSplats || source?.getNumSplats?.() || 0;

    // Local AABB for spatial bins (avoids floor/center hogging all samples)
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    try {
      const box = mesh.getBoundingBox?.(true);
      if (box && !box.isEmpty()) {
        minX = box.min.x;
        minY = box.min.y;
        minZ = box.min.z;
        maxX = box.max.x;
        maxY = box.max.y;
        maxZ = box.max.z;
      }
    } catch {
      /* fall through */
    }

    const cellCount = GRID_X * GRID_Y * GRID_Z;
    const baseCap = Math.max(20, Math.ceil(DOT_BUDGET / cellCount) + 4);
    /** @type {Array<Array<{x:number,y:number,z:number,r:number,g:number,b:number}>>} */
    const cells = new Array(cellCount);
    for (let c = 0; c < cellCount; c++) cells[c] = [];

    const hasBounds =
      Number.isFinite(minX) &&
      maxX > minX &&
      maxY > minY &&
      maxZ > minZ;
    const spanX = hasBounds ? maxX - minX : 1;
    const spanY = hasBounds ? maxY - minY : 1;
    const spanZ = hasBounds ? maxZ - minZ : 1;

    // Marble meshes are X-flipped (quat 1,0,0,0): local +Y → world floor.
    // Bias caps toward high local Y so the underside isn't empty.
    function cellCapForY(cy) {
      const t = cy / Math.max(1, GRID_Y - 1); // 0 = local min, 1 = local max (floor)
      const boost = 1.0 + t * 1.45; // ~2.45x on floor, 1x on sky
      return Math.ceil(baseCap * boost);
    }

    // Visit more candidates than budget; bins enforce coverage (with floor bias)
    const stride = Math.max(1, Math.floor((num || DOT_BUDGET * 2) / (DOT_BUDGET * 2.5)));
    let i = 0;
    let written = 0;

    if (source && typeof source.forEachSplat === 'function' && num > 0) {
      source.forEachSplat((index, center, scales, quat, opacity, color) => {
        if (written >= DOT_BUDGET) return;
        if (i++ % stride !== 0) return;
        // Keep faint sky/atmosphere splats too
        if (opacity < 0.02) return;
        const sx = scales?.x ?? 0;
        const sy = scales?.y ?? 0;
        const sz = scales?.z ?? 0;
        if (sx + sy + sz < 1e-6) return;

        let cx = 0;
        let cy = 0;
        let cz = 0;
        if (hasBounds) {
          cx = Math.min(
            GRID_X - 1,
            Math.max(0, Math.floor(((center.x - minX) / spanX) * GRID_X))
          );
          cy = Math.min(
            GRID_Y - 1,
            Math.max(0, Math.floor(((center.y - minY) / spanY) * GRID_Y))
          );
          cz = Math.min(
            GRID_Z - 1,
            Math.max(0, Math.floor(((center.z - minZ) / spanZ) * GRID_Z))
          );
        } else {
          cx = index % GRID_X;
          cy = Math.floor(index / GRID_X) % GRID_Y;
          cz = Math.floor(index / (GRID_X * GRID_Y)) % GRID_Z;
        }

        const cell = cells[cx + cy * GRID_X + cz * GRID_X * GRID_Y];
        if (cell.length >= cellCapForY(cy)) return;

        cell.push({
          x: center.x,
          y: center.y,
          z: center.z,
          r: color?.r ?? 0.7,
          g: color?.g ?? 0.7,
          b: color?.b ?? 0.7,
        });
        written += 1;
      });
    }

    // Flatten bins (already spatially balanced)
    for (let c = 0; c < cellCount; c++) {
      const cell = cells[c];
      for (let k = 0; k < cell.length; k++) {
        const p = cell[k];
        positions.push(p.x, p.y, p.z);
        colors.push(p.r, p.g, p.b);
        seeds.push(Math.random());
      }
    }
    written = positions.length / 3;

    if (written < 500) {
      console.warn(
        `[marble] splat sample failed for ${sceneId} (got ${written}, num=${num})`
      );
      return null;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    geo.computeBoundingSphere();

    const mat = makeDotMaterial();
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 40;
    pts.visible = false;
    // Keep in scene root (not under SplatMesh — Spark may skip normal children)
    pts.userData.followMesh = mesh;
    scene.add(pts);
    clouds[sceneId] = pts;

    // Multi-seed layout on the WORLD-space floor (splat is often X-flipped)
    try {
      mesh.updateMatrixWorld(true);
      const box = mesh.getBoundingBox?.(true);
      if (box && !box.isEmpty()) {
        _box.copy(box).applyMatrix4(mesh.matrixWorld);
        _box.getCenter(_center);
        _box.getSize(_size);
        burnMaxR[sceneId] = Math.max(5, _size.length() * 0.55);
        buildBurnSeeds(sceneId, mesh, _box);
      } else if (geo.boundingSphere) {
        const s = geo.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
        burnMaxR[sceneId] = Math.max(5, s.radius * 1.6);
        _box.setFromCenterAndSize(
          s.center,
          new THREE.Vector3(s.radius * 1.4, s.radius * 0.5, s.radius * 1.4)
        );
        _box.min.y = s.center.y - s.radius * 0.7;
        _box.max.y = s.center.y - s.radius * 0.35;
        buildBurnSeeds(sceneId, mesh, _box);
      }
    } catch {
      burnMaxR[sceneId] = Math.max(5, geo.boundingSphere?.radius || 8);
      burnSeeds[sceneId] = [];
    }

    return pts;
  }

  /** Scatter pinprick seeds across the floor with varied rates / delays. */
  function buildBurnSeeds(sceneId, mesh, worldBox) {
    const floorY = worldBox.min.y + Math.max(0.12, (worldBox.max.y - worldBox.min.y) * 0.04);
    const cx = (worldBox.min.x + worldBox.max.x) * 0.5;
    const cz = (worldBox.min.z + worldBox.max.z) * 0.5;
    const hx = Math.max(1.5, (worldBox.max.x - worldBox.min.x) * 0.38);
    const hz = Math.max(1.5, (worldBox.max.z - worldBox.min.z) * 0.38);

    // Offsets + personality (rate, delay, coverage scale)
    const layouts = [
      { ox: 0.0, oz: 0.0, rate: 1.0, delay: 0.0, maxScale: 1.05 },
      { ox: -0.72, oz: 0.35, rate: 0.72, delay: 0.1, maxScale: 0.95 },
      { ox: 0.65, oz: 0.55, rate: 1.22, delay: 0.04, maxScale: 0.9 },
      { ox: 0.25, oz: -0.7, rate: 0.88, delay: 0.18, maxScale: 1.0 },
      { ox: -0.4, oz: -0.45, rate: 1.35, delay: 0.12, maxScale: 0.85 },
    ];

    const list = [];
    for (let i = 0; i < SEED_COUNT; i++) {
      const L = layouts[i % layouts.length];
      const world = new THREE.Vector3(
        cx + L.ox * hx,
        floorY,
        cz + L.oz * hz
      );
      const local = world.clone();
      mesh.worldToLocal(local);
      list.push({
        pos: local,
        rate: L.rate,
        delay: L.delay,
        maxScale: L.maxScale,
      });
    }
    burnSeeds[sceneId] = list;
  }

  function ensureBurnRig(sceneId) {
    const mesh = meshes[sceneId];
    if (!mesh) return null;
    if (burns[sceneId]) return burns[sceneId];

    // Multiple growing spheres — soft blend where fronts meet
    const reveal = new SplatEdit({
      rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
      softEdge: 0.8,
      sdfSmooth: 0.85,
      invert: true,
    });
    const sdfs = [];
    for (let i = 0; i < SEED_COUNT; i++) {
      const sdf = new SplatEditSdf({
        type: SplatEditSdfType.SPHERE,
        opacity: 0,
        color: new THREE.Color(1, 1, 1),
        radius: 0.05,
      });
      reveal.add(sdf);
      sdfs.push(sdf);
    }
    reveal.visible = false;
    mesh.add(reveal);

    burns[sceneId] = { reveal, sdfs };
    return burns[sceneId];
  }

  function setRevealActive(sceneId, on) {
    const rig = burns[sceneId];
    if (!rig) return;
    rig.reveal.visible = on;
    if (!on) {
      for (const sdf of rig.sdfs) sdf.radius = 0.05;
    }
  }

  function placeBurn(sceneId) {
    const rig = ensureBurnRig(sceneId);
    const seeds = burnSeeds[sceneId];
    if (!rig) return burnMaxR[sceneId] || 8;

    // Ensure seeds exist
    if (!seeds?.length) {
      const mesh = meshes[sceneId];
      if (mesh) {
        mesh.updateMatrixWorld(true);
        try {
          const box = mesh.getBoundingBox?.(true);
          if (box && !box.isEmpty()) {
            _box.copy(box).applyMatrix4(mesh.matrixWorld);
            buildBurnSeeds(sceneId, mesh, _box);
          }
        } catch {
          /* ignore */
        }
      }
    }

    const list = burnSeeds[sceneId] || [];
    for (let i = 0; i < SEED_COUNT; i++) {
      const sdf = rig.sdfs[i];
      const seed = list[i];
      if (sdf && seed) {
        sdf.position.copy(seed.pos);
        sdf.radius = 0.05;
      }
    }

    syncCloudBurnSeeds(sceneId, null);

    // Overshoot so late frames fully clear the volume
    return (burnMaxR[sceneId] || 8) * 1.15;
  }

  /** @param {number[]|null} radii  null/empty = disable clip */
  function syncCloudBurnSeeds(sceneId, radii) {
    const cloud = clouds[sceneId];
    const seeds = burnSeeds[sceneId] || [];
    if (!cloud?.material?.uniforms) return;
    const u = cloud.material.uniforms;
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = seeds[i];
      if (seed) u.uBurnOrigins.value[i].copy(seed.pos);
      u.uBurnRadii.value[i] = radii ? (radii[i] ?? -1) : -1;
    }
    u.uBurnCount.value = radii ? SEED_COUNT : 0;
  }

  function setCloudVisible(sceneId, on) {
    const cloud = clouds[sceneId];
    if (!cloud) return;
    cloud.visible = on;
    if (on) {
      cloud.material.uniforms.uOpacity.value = 1;
      syncCloudBurnSeeds(sceneId, null);
    }
  }

  async function loadScene(sceneId, record, { onProgress } = {}) {
    if (!record?.spzUrl) {
      throw new Error(`No SPZ URL stored for scene "${sceneId}"`);
    }
    if (meshes[sceneId]) return meshes[sceneId];

    onProgress?.(`Downloading ${sceneId} splat…`);
    const packed = await loader.loadAsync(record.spzUrl, (ev) => {
      if (ev?.total) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        onProgress?.(`Downloading ${sceneId}: ${pct}%`);
      }
    });

    const mesh = new SplatMesh({ packedSplats: packed });
    mesh.quaternion.set(1, 0, 0, 0);
    mesh.editable = true;

    const semantics = record.semantics;
    const scale = semantics?.metric_scale_factor || 1;
    baseScale[sceneId] = scale;
    mesh.scale.setScalar(scale);
    if (typeof semantics?.ground_plane_offset === 'number') {
      mesh.position.y = -semantics.ground_plane_offset * scale;
    }

    mesh.visible = false;
    mesh.opacity = 0;
    scene.add(mesh);
    meshes[sceneId] = mesh;

    try {
      await mesh.initialized;
    } catch {
      /* continue */
    }

    onProgress?.(`Sampling ${sceneId} point cloud…`);
    sampleDotCloud(sceneId, mesh, packed);
    ensureBurnRig(sceneId);
    setRevealActive(sceneId, false);

    onProgress?.(`${sceneId} ready`);
    return mesh;
  }

  /**
   * @param {string|null} sceneId
   * @param {{ mode?: 'dots'|'solid'|'points' }} [opts]
   */
  function show(sceneId, { mode } = {}) {
    if (mode === 'points' || mode === 'dots') viewMode = 'dots';
    if (mode === 'solid') viewMode = 'solid';

    if (!sceneId || !meshes[sceneId]) {
      for (const id of Object.keys(meshes)) {
        if (meshes[id]) meshes[id].visible = false;
        setCloudVisible(id, false);
        setRevealActive(id, false);
      }
      active = null;
      proceduralVisible = true;
      onFallback?.(true);
      anim = null;
      return false;
    }

    proceduralVisible = false;
    onFallback?.(false);
    active = sceneId;

    for (const id of Object.keys(meshes)) {
      const mesh = meshes[id];
      if (!mesh) continue;
      const on = id === sceneId;
      mesh.visible = on;
      mesh.scale.setScalar(baseScale[id] || 1);
      if (!on) {
        mesh.opacity = 0;
        setCloudVisible(id, false);
        setRevealActive(id, false);
        continue;
      }

      if (viewMode === 'dots') {
        // Dots only — solid fully off until burn
        mesh.opacity = 0;
        setCloudVisible(id, true);
        placeBurn(id);
        setRevealActive(id, false);
        syncCloudBurnSeeds(id, null);
      } else {
        mesh.opacity = 1;
        setCloudVisible(id, false);
        setRevealActive(id, false);
      }
    }

    anim = null;
    return true;
  }

  function playBurnReveal({ hold = 0.45, duration = 3.07 } = {}) {
    if (!active || !meshes[active]) return Promise.resolve();
    return transitionTo(active, {
      dissolve: 0,
      crossfade: 0,
      hold,
      duration,
    });
  }

  /**
   * Smooth world→world: fade out old solid into NEW scene dots (not old-scene
   * dots — that left ocean blue lingering into desert), then burn-reveal.
   */
  function transitionTo(
    toId,
    { dissolve = 0.45, crossfade = 0.53, hold = 0.45, duration = 3.07 } = {}
  ) {
    if (!toId || !meshes[toId]) return Promise.resolve();

    // Abort in-flight transition cleanly
    if (anim) {
      const prevFrom = anim.fromId;
      const prevTo = anim.toId;
      anim.resolve?.();
      anim = null;
      // Park anything that isn't the new destination
      for (const id of [prevFrom, prevTo]) {
        if (id && id !== toId) hideScene(id);
      }
    }

    const fromId = active && active !== toId ? active : null;
    const fromSolid =
      !!fromId &&
      !!meshes[fromId] &&
      viewMode === 'solid' &&
      meshes[fromId].opacity > 0.2;
    const fromDots =
      !!fromId && !fromSolid && !!clouds[fromId]?.visible;

    proceduralVisible = false;
    onFallback?.(false);

    // Destination: solid hidden, dots ready
    const toMesh = meshes[toId];
    toMesh.visible = true;
    toMesh.opacity = 0;
    toMesh.scale.setScalar(baseScale[toId] || 1);
    setRevealActive(toId, false);
    if (clouds[toId]) {
      clouds[toId].visible = true;
      clouds[toId].material.uniforms.uOpacity.value = 0;
      clouds[toId].material.uniforms.uWobble.value = 0.25;
      syncCloudBurnSeeds(toId, null);
    }
    const maxRadius = placeBurn(toId);

    // Never leave a third scene hanging around
    hideAllExcept(fromId, toId);

    let phase = 'hold';
    if (fromId && fromSolid && dissolve > 0.05) phase = 'dissolve';
    else if (fromId && (fromDots || crossfade > 0.05) && crossfade > 0.05) {
      phase = 'crossfade';
    }

    if (phase === 'dissolve' && fromId) {
      // Fade OLD solid while bringing up NEW dots (destination colors)
      meshes[fromId].visible = true;
      setRevealActive(fromId, false);
      // Keep old dots OFF — they were the blue remnant
      setCloudVisible(fromId, false);
      if (clouds[toId]) {
        clouds[toId].visible = true;
        clouds[toId].material.uniforms.uOpacity.value = 0;
        clouds[toId].material.uniforms.uWobble.value = 0.25;
      }
    } else if (phase === 'crossfade' && fromId) {
      // Already in dots — overlap old→new clouds only
      if (meshes[fromId]) {
        meshes[fromId].opacity = 0;
        meshes[fromId].visible = false;
      }
      setRevealActive(fromId, false);
      if (clouds[fromId]) {
        clouds[fromId].visible = true;
        clouds[fromId].material.uniforms.uOpacity.value = 1;
        clouds[fromId].material.uniforms.uWobble.value = 0.35;
      }
    } else {
      // Cold start — only destination dots
      if (clouds[toId]) clouds[toId].material.uniforms.uOpacity.value = 1;
      active = toId;
      hideAllExcept(toId);
    }

    if (phase === 'dissolve' || phase === 'crossfade') {
      active = fromId;
    }

    viewMode = 'dots';
    anim = {
      phase,
      t: 0,
      hold,
      duration,
      dissolve,
      crossfade,
      maxRadius,
      fromId,
      toId,
      _fromDots: fromDots,
      resolve: null,
    };

    return new Promise((resolve) => {
      anim.resolve = resolve;
    });
  }

  function hideScene(sceneId) {
    if (!sceneId) return;
    if (meshes[sceneId]) {
      meshes[sceneId].visible = false;
      meshes[sceneId].opacity = 0;
    }
    setCloudVisible(sceneId, false);
    setRevealActive(sceneId, false);
  }

  /** Kill leftover solid/dots from every scene except keepIds. */
  function hideAllExcept(...keepIds) {
    const keep = new Set(keepIds.filter(Boolean));
    for (const id of Object.keys(meshes)) {
      if (keep.has(id)) continue;
      hideScene(id);
    }
  }

  function beginCrossfade() {
    if (!anim) return;
    const { fromId, toId } = anim;
    // Outgoing solid must be fully gone — leftover ocean blue was sticking here
    if (fromId && meshes[fromId]) {
      meshes[fromId].opacity = 0;
      meshes[fromId].visible = false;
      setRevealActive(fromId, false);
    }
    if (fromId && clouds[fromId]) {
      // Only keep from-dots if we were already in a dots→dots swap
      if (anim._fromDots) {
        clouds[fromId].visible = true;
        clouds[fromId].material.uniforms.uOpacity.value = Math.min(
          1,
          clouds[fromId].material.uniforms.uOpacity.value || 1
        );
      } else {
        setCloudVisible(fromId, false);
      }
    }
    if (clouds[toId]) {
      clouds[toId].visible = true;
      // After solid→dots dissolve, destination dots are already up
      if (!anim._fromDots) {
        clouds[toId].material.uniforms.uOpacity.value = Math.max(
          clouds[toId].material.uniforms.uOpacity.value || 0,
          0.001
        );
      } else if (anim.phase === 'dissolve') {
        clouds[toId].material.uniforms.uOpacity.value = 0;
      }
    }
    anim.phase = 'crossfade';
    anim.t = 0;
  }

  function beginHold() {
    if (!anim) return;
    const { fromId, toId } = anim;
    hideScene(fromId);
    hideAllExcept(toId);
    active = toId;
    viewMode = 'dots';
    if (meshes[toId]) {
      meshes[toId].visible = true;
      meshes[toId].opacity = 0;
    }
    if (clouds[toId]) {
      clouds[toId].visible = true;
      clouds[toId].material.uniforms.uOpacity.value = 1;
      // Ease wobble in — hard 0→1 was reading as jitter
      clouds[toId].material.uniforms.uWobble.value = 0.35;
      syncCloudBurnSeeds(toId, null);
    }
    setRevealActive(toId, false);
    anim.maxRadius = placeBurn(toId);
    anim.phase = 'hold';
    anim.t = 0;
  }

  function beginBurn() {
    if (!anim || !active) return;
    const rig = ensureBurnRig(active);
    const mesh = meshes[active];
    if (!rig || !mesh) return;

    // Several pinpricks — each grows continuously at its own rate
    mesh.opacity = 1;
    placeBurn(active);
    setRevealActive(active, true);
    rig.reveal.softEdge = 0.08;
    rig.reveal.sdfSmooth = 0.5;

    const startRadii = [];
    for (let i = 0; i < SEED_COUNT; i++) {
      const r0 = 0.06;
      if (rig.sdfs[i]) rig.sdfs[i].radius = r0;
      startRadii.push(r0);
    }
    syncCloudBurnSeeds(active, startRadii);

    anim.phase = 'burn';
    anim.t = 0;
  }

  function finishBurn() {
    if (!active) return;
    // Full real scene — no clip, no dots
    setRevealActive(active, false);
    setCloudVisible(active, false);
    const mesh = meshes[active];
    if (mesh) {
      mesh.visible = true;
      mesh.opacity = 1;
    }
    viewMode = 'solid';
    if (anim) {
      anim.phase = 'done';
      anim.resolve?.();
      anim = null;
    }
  }

  function syncFollowMesh(obj, mesh) {
    if (!obj || !mesh) return;
    mesh.updateMatrixWorld(true);
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(mesh.matrixWorld);
    obj.matrixWorld.copy(mesh.matrixWorld);
    obj.matrixWorldNeedsUpdate = false;
  }

  function syncCloudTransforms() {
    for (const id of Object.keys(clouds)) {
      const pts = clouds[id];
      syncFollowMesh(pts, pts?.userData?.followMesh);
    }
  }

  let dotTime = 0;

  function update(dt = 0.016) {
    syncCloudTransforms();
    dotTime += dt;

    // Drive wobble / motion blur on visible clouds
    for (const id of Object.keys(clouds)) {
      const cloud = clouds[id];
      if (!cloud?.visible || !cloud.material?.uniforms?.uTime) continue;
      cloud.material.uniforms.uTime.value = dotTime;
      const phase = anim?.phase;
      let wobble = cloud.material.uniforms.uWobble.value;
      if (phase === 'burn' && anim) {
        const u = Math.min(1, anim.t / anim.duration);
        wobble = 0.55 * (1 - easeInOutButter(u));
      } else if (phase === 'hold' && anim) {
        const u = Math.min(1, anim.t / Math.max(0.05, anim.hold));
        wobble = 0.35 + u * 0.25;
      } else if (phase === 'dissolve' || phase === 'crossfade') {
        wobble = Math.min(wobble, 0.45);
      } else if (viewMode === 'solid') {
        wobble = 0;
      }
      cloud.material.uniforms.uWobble.value = wobble;
    }

    if (!anim) return;

    anim.t += dt;

    if (anim.phase === 'dissolve') {
      const dur = Math.max(0.05, anim.dissolve || 1.2);
      const e = easeInOutButter(Math.min(1, anim.t / dur));
      const { fromId, toId } = anim;
      // Fade OUT old solid completely (and hard-hide near the end)
      if (fromId && meshes[fromId]) {
        meshes[fromId].opacity = 1 - e;
        if (e > 0.92) {
          meshes[fromId].opacity = 0;
          meshes[fromId].visible = false;
        }
      }
      // Fade IN destination dots (desert colors when leaving ocean)
      if (clouds[toId]) {
        clouds[toId].visible = true;
        clouds[toId].material.uniforms.uOpacity.value = e;
        clouds[toId].material.uniforms.uWobble.value = 0.2 + e * 0.25;
      }
      if (meshes[toId]) meshes[toId].opacity = 0;
      // Never show outgoing dots during solid→new dissolve
      if (fromId) setCloudVisible(fromId, false);

      if (anim.t >= dur) {
        // Destination dots are already up — skip a second crossfade hop
        if (!anim._fromDots) {
          beginHold();
        } else {
          beginCrossfade();
        }
      }
      return;
    }

    if (anim.phase === 'crossfade') {
      const dur = Math.max(0.05, anim.crossfade || 1.4);
      const e = easeInOutButter(Math.min(1, anim.t / dur));
      const { fromId, toId } = anim;
      if (fromId && clouds[fromId]) {
        clouds[fromId].visible = true;
        clouds[fromId].material.uniforms.uOpacity.value = 1 - e;
        if (e > 0.92) setCloudVisible(fromId, false);
      }
      if (clouds[toId]) {
        clouds[toId].visible = true;
        clouds[toId].material.uniforms.uOpacity.value = e;
        clouds[toId].material.uniforms.uWobble.value = 0.25 + e * 0.2;
      }
      if (fromId && meshes[fromId]) {
        meshes[fromId].opacity = 0;
        meshes[fromId].visible = false;
      }
      if (meshes[toId]) meshes[toId].opacity = 0;
      if (anim.t >= dur) beginHold();
      return;
    }

    if (anim.phase === 'hold') {
      // Keep destination dots steady; ensure old scene is gone
      if (anim.fromId) hideScene(anim.fromId);
      if (anim.t >= anim.hold) beginBurn();
      return;
    }

    if (anim.phase === 'burn') {
      const u = Math.min(1, anim.t / anim.duration);
      const rig = burns[active];
      const seeds = burnSeeds[active] || [];
      const radii = [];
      let maxR = 0;
      let avgE = 0;

      for (let i = 0; i < SEED_COUNT; i++) {
        const seed = seeds[i] || {
          rate: 1,
          delay: 0,
          maxScale: 1,
        };
        // Staggered start + different growth speed
        const denom = Math.max(0.35, 1 - seed.delay);
        const localU = THREE.MathUtils.clamp((u - seed.delay) / denom, 0, 1);
        // Slightly different easing per seed for organic feel
        const power = 0.92 + (seed.rate - 1) * 0.12;
        const e = easeInOutButter(Math.pow(localU, THREE.MathUtils.clamp(power, 0.75, 1.15)));
        const target = anim.maxRadius * seed.maxScale;
        // rate scales how quickly it approaches target (faster seeds finish early)
        const sped = Math.min(1, e * (0.55 + seed.rate * 0.55));
        const r = THREE.MathUtils.lerp(0.06, target, sped);
        radii.push(r);
        maxR = Math.max(maxR, r);
        avgE += e;

        if (rig?.sdfs[i]) {
          rig.sdfs[i].radius = r;
        }
      }
      avgE /= SEED_COUNT;

      // Soft edge grows gently; stays small vs radius early so pinpricks stay pinpricks
      const soft = Math.min(
        THREE.MathUtils.lerp(0.1, 0.95, avgE),
        Math.max(0.08, maxR * 0.35)
      );
      if (rig) {
        rig.reveal.softEdge = soft;
        rig.reveal.sdfSmooth = THREE.MathUtils.lerp(0.45, 1.1, avgE);
      }

      // Dots clear just inside each front
      const clipRadii = radii.map((r) => Math.max(0, r - soft * 0.2));
      syncCloudBurnSeeds(active, clipRadii);
      const cloud = clouds[active];
      if (cloud) {
        cloud.material.uniforms.uBurnSoft.value = Math.max(0.1, soft);
        cloud.material.uniforms.uOpacity.value = THREE.MathUtils.lerp(
          1,
          0,
          Math.pow(avgE, 1.4)
        );
      }

      if (u >= 1) finishBurn();
    }
  }

  function getRevealPhase() {
    return anim?.phase ?? (viewMode === 'dots' ? 'dots' : 'solid');
  }

  function isTransitioning() {
    return !!anim && anim.phase !== 'done';
  }

  function getPointCloudBounds() {
    if (!active) return null;
    const cloud = clouds[active];
    const mesh = meshes[active];
    if (cloud?.geometry?.boundingSphere && mesh) {
      mesh.updateMatrixWorld(true);
      const s = cloud.geometry.boundingSphere.clone();
      s.applyMatrix4(mesh.matrixWorld);
      return s;
    }
    if (!mesh) return null;
    mesh.updateMatrixWorld(true);
    _box.setFromObject(mesh);
    if (_box.isEmpty()) return null;
    _box.getCenter(_center);
    _box.getSize(_size);
    return new THREE.Sphere(_center.clone(), _size.length() * 0.5);
  }

  function disposeScene(sceneId) {
    if (clouds[sceneId]) {
      const pts = clouds[sceneId];
      scene.remove(pts);
      pts.geometry.dispose();
      pts.material.dispose();
      clouds[sceneId] = null;
    }
    if (burns[sceneId]) {
      const rig = burns[sceneId];
      meshes[sceneId]?.remove(rig.reveal);
      burns[sceneId] = null;
    }
    const mesh = meshes[sceneId];
    if (!mesh) return;
    scene.remove(mesh);
    mesh.dispose?.();
    meshes[sceneId] = null;
    if (active === sceneId) active = null;
  }

  return {
    spark,
    loadScene,
    show,
    playBurnReveal,
    transitionTo,
    getRevealPhase,
    isTransitioning,
    setPointCloudMode(on) {
      viewMode = on ? 'dots' : 'solid';
      if (active) show(active, { mode: viewMode });
    },
    getPointCloudBounds,
    samplePoints() {
      return !!active && !!clouds[active];
    },
    setActiveOpacity(opacity) {
      if (active && meshes[active]) meshes[active].opacity = opacity;
      if (active && clouds[active]) {
        clouds[active].material.uniforms.uOpacity.value = opacity;
      }
    },
    update,
    has(sceneId) {
      return !!meshes[sceneId];
    },
    setProceduralFallback,
    usingProcedural: () => proceduralVisible,
    disposeScene,
    dispose() {
      for (const id of Object.keys(meshes)) disposeScene(id);
    },
  };
}
