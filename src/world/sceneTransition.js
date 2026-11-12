import * as THREE from 'three';

/**
 * Marble-style "Next world" transition:
 * accelerate forward through the current world → tunnel/warp peak →
 * emerge into the next world and ease to a settle pose.
 * This is a spatial dive, not an opacity crossfade.
 */
export function createSceneTransition({
  mountEl,
  camera,
  controls,
  getLookTarget,
}) {
  const el = document.createElement('div');
  el.id = 'world-transition';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="wt-streaks"></div>
    <div class="wt-tunnel"></div>
    <div class="wt-flash"></div>
    <p class="wt-label"></p>
  `;
  mountEl.appendChild(el);
  const labelEl = el.querySelector('.wt-label');

  const startPos = new THREE.Vector3();
  const startQuat = new THREE.Quaternion();
  const lookDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const settlePos = new THREE.Vector3();
  const settleTarget = new THREE.Vector3();

  let busy = false;
  let anim = null;

  function easeInCubic(t) {
    return t * t * t;
  }
  function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
  }
  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  /**
   * @param {object} opts
   * @param {string} opts.label
   * @param {() => void | Promise<void>} opts.onSwap  called at warp peak
   * @param {(u: number, phase: 'dive'|'emerge') => void} [opts.onProgress]
   *   u in 0..1 within phase — use to rush/scale splat meshes
   */
  function play({ label = '', onSwap, onProgress } = {}) {
    if (busy) {
      return Promise.resolve(onSwap?.());
    }
    busy = true;
    if (labelEl) labelEl.textContent = label;

    const wasControls = controls?.enabled;
    if (controls) controls.enabled = false;

    startPos.copy(camera.position);
    startQuat.copy(camera.quaternion);
    camera.getWorldDirection(lookDir);

    // Dive deep into the look direction, then settle slightly ahead of start
    const diveDistance = 14;
    const settleDistance = 1.2;
    settlePos.copy(startPos).addScaledVector(lookDir, settleDistance);
    const target = getLookTarget?.();
    if (target) {
      settleTarget.copy(target);
    } else {
      settleTarget.copy(settlePos).addScaledVector(lookDir, 4);
    }

    el.classList.add('active');
    document.getElementById('story-panel')?.classList.add('warping');
    document.getElementById('hud')?.classList.add('warping');
    anim = {
      t: 0,
      swapped: false,
      diveDur: 0.55,
      emergeDur: 0.85,
      diveDistance,
      wasControls,
      onSwap,
      onProgress,
    };

    return new Promise((resolve) => {
      anim.resolve = resolve;
    });
  }

  function update(dt) {
    if (!anim) return;

    const a = anim;
    a.t += dt;
    const diveEnd = a.diveDur;
    const total = a.diveDur + a.emergeDur;

    if (a.t < diveEnd) {
      // —— DIVE: rush forward, tunnel builds ——
      const u = Math.min(1, a.t / a.diveDur);
      const e = easeInCubic(u);
      camera.position.copy(startPos).addScaledVector(lookDir, e * a.diveDistance);
      // slight roll for energy
      camera.quaternion.copy(startQuat);
      camera.rotateZ(Math.sin(e * Math.PI) * 0.08);

      el.style.setProperty('--wt-intensity', String(smoothstep(u)));
      el.style.setProperty('--wt-zoom', String(1 + e * 2.8));
      el.classList.toggle('peaking', u > 0.72);
      a.onProgress?.(u, 'dive');

      if (u > 0.82 && !a.swapped) {
        a.swapped = true;
        Promise.resolve(a.onSwap?.()).catch(() => {});
      }
    } else {
      // —— EMERGE: decelerate into settle ——
      const u = Math.min(1, (a.t - diveEnd) / a.emergeDur);
      const e = easeOutCubic(u);

      // Come from "past the camera" — start far along lookDir then ease back
      const emergeStart = tmp
        .copy(settlePos)
        .addScaledVector(lookDir, 10);
      camera.position.lerpVectors(emergeStart, settlePos, e);
      camera.lookAt(settleTarget);
      // unwind roll
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      euler.z *= 1 - e;
      camera.quaternion.setFromEuler(euler);

      const intensity = 1 - smoothstep(u);
      el.style.setProperty('--wt-intensity', String(intensity));
      el.style.setProperty('--wt-zoom', String(1 + (1 - e) * 1.2));
      el.classList.toggle('peaking', intensity > 0.55);
      a.onProgress?.(u, 'emerge');

      if (u >= 1) {
        finish();
      }
    }

    if (a.t > total + 0.05) finish();
  }

  function finish() {
    if (!anim) return;
    const a = anim;
    anim = null;
    camera.position.copy(settlePos);
    camera.lookAt(settleTarget);
    if (controls) {
      controls.target.copy(settleTarget);
      controls.update();
      controls.enabled = a.wasControls !== false;
    }
    el.classList.remove('active', 'peaking');
    el.style.setProperty('--wt-intensity', '0');
    el.style.setProperty('--wt-zoom', '1');
    document.getElementById('story-panel')?.classList.remove('warping');
    document.getElementById('hud')?.classList.remove('warping');
    busy = false;
    a.resolve?.();
  }

  return {
    play,
    update,
    isBusy: () => busy,
    dispose() {
      el.remove();
    },
  };
}
