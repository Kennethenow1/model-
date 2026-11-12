import { SparkRenderer, SplatLoader, SplatMesh } from '@sparkjsdev/spark';

/**
 * Loads cached Marble SPZ worlds into the Three.js scene and swaps them
 * in place of the procedural ocean/desert backgrounds, with opacity crossfade.
 */
export function createMarbleBackgrounds({ scene, renderer }) {
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  /** @type {Record<string, import('@sparkjsdev/spark').SplatMesh | null>} */
  const meshes = {
    ocean: null,
    desert: null,
  };

  let active = null;
  let proceduralVisible = true;
  let onFallback = null;
  /** @type {Record<string, number>} */
  const baseScale = { ocean: 1, desert: 1 };

  const loader = new SplatLoader();

  function setProceduralFallback(cb) {
    onFallback = cb;
  }

  function setMeshOpacity(mesh, opacity) {
    if (!mesh) return;
    mesh.visible = opacity > 0.01;
    // Spark SplatMesh supports opacity on the object in recent versions
    if ('opacity' in mesh) {
      mesh.opacity = opacity;
    }
    mesh.traverse?.((obj) => {
      if (obj.material && 'opacity' in obj.material) {
        obj.material.transparent = true;
        obj.material.opacity = opacity;
      }
    });
  }

  async function loadScene(sceneId, record, { onProgress } = {}) {
    if (!record?.spzUrl) {
      throw new Error(`No SPZ URL stored for scene "${sceneId}"`);
    }
    if (meshes[sceneId]) {
      return meshes[sceneId];
    }

    onProgress?.(`Downloading ${sceneId} splat…`);
    const packed = await loader.loadAsync(record.spzUrl, (ev) => {
      if (ev?.total) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        onProgress?.(`Downloading ${sceneId}: ${pct}%`);
      }
    });

    const mesh = new SplatMesh({ packedSplats: packed });
    // Marble SPZ → Three.js axis fix (World Labs / Spark convention)
    mesh.quaternion.set(1, 0, 0, 0);

    const semantics = record.semantics;
    const scale = semantics?.metric_scale_factor || 1;
    baseScale[sceneId] = scale;
    mesh.scale.setScalar(scale);
    if (typeof semantics?.ground_plane_offset === 'number') {
      mesh.position.y = -semantics.ground_plane_offset * scale;
    }

    mesh.visible = false;
    setMeshOpacity(mesh, 0);
    scene.add(mesh);
    meshes[sceneId] = mesh;
    onProgress?.(`${sceneId} ready`);
    return mesh;
  }

  function show(sceneId) {
    const next = sceneId ? meshes[sceneId] : null;

    if (!next) {
      for (const id of Object.keys(meshes)) {
        setMeshOpacity(meshes[id], 0);
        if (meshes[id]) meshes[id].scale.setScalar(baseScale[id] || 1);
      }
      active = null;
      proceduralVisible = true;
      onFallback?.(true);
      return false;
    }

    proceduralVisible = false;
    onFallback?.(false);

    for (const id of Object.keys(meshes)) {
      const m = meshes[id];
      if (!m) continue;
      const on = id === sceneId;
      setMeshOpacity(m, on ? 1 : 0);
      m.scale.setScalar(baseScale[id] || 1);
      m.position.z = 0;
    }
    active = sceneId;
    return true;
  }

  /**
   * During Marble-style warp: rush outgoing world toward camera,
   * then bring incoming world in from ahead.
   */
  function warpProgress(fromId, toId, u, phase) {
    const from = meshes[fromId];
    const to = meshes[toId];
    if (phase === 'dive' && from) {
      from.visible = true;
      setMeshOpacity(from, 1);
      const s = (baseScale[fromId] || 1) * (1 + u * 1.8);
      from.scale.setScalar(s);
      from.position.z = u * 6;
      if (to) {
        setMeshOpacity(to, 0);
      }
    }
    if (phase === 'emerge' && to) {
      to.visible = true;
      setMeshOpacity(to, 1);
      // Arrive from "far ahead" / oversized, settle to normal
      const s = (baseScale[toId] || 1) * (1.6 - u * 0.6);
      to.scale.setScalar(s);
      to.position.z = (1 - u) * -5;
      if (from) {
        setMeshOpacity(from, Math.max(0, 1 - u * 1.5));
      }
    }
  }

  function update() {
    // Warp is driven externally via warpProgress during transitions
  }

  function disposeScene(sceneId) {
    const mesh = meshes[sceneId];
    if (!mesh) return;
    scene.remove(mesh);
    mesh.dispose?.();
    meshes[sceneId] = null;
  }

  return {
    spark,
    loadScene,
    show,
    update,
    warpProgress,
    has(sceneId) {
      return !!meshes[sceneId];
    },
    setProceduralFallback,
    usingProcedural: () => proceduralVisible,
    disposeScene,
  };
}
