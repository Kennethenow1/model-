import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

/**
 * XR player rig + visible controller models.
 * When IWER/DevUI is present, DevUI owns mouse look / WASD / hand gizmos
 * (manual mode). This module only moves the rig for native headsets.
 */
export function createXrControls({ renderer, scene, camera, xrDevice }) {
  const player = new THREE.Group();
  player.name = 'playerRig';
  scene.add(player);
  player.add(camera);

  const controllerModelFactory = new XRControllerModelFactory();
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    player.add(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(controllerModelFactory.createControllerModel(grip));
    player.add(grip);

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1.2),
      ]),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
      })
    );
    line.scale.z = 1;
    controller.add(line);
  }

  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();
  let pointerLocked = false;
  let lookDragging = false;
  let enabled = false;
  let yaw = 0;
  let pitch = 0;

  // IWER path: DevUI drives the device — don't steal mouse/keyboard
  const useDevUi = !!xrDevice;

  function applyLook(dx, dy) {
    if (useDevUi || !xrDevice) return;
    const sens = 0.0024;
    yaw -= dx * sens;
    pitch -= dy * sens;
    pitch = Math.max(-1.15, Math.min(1.15, pitch));
    euler.set(pitch, yaw, 0, 'YXZ');
    xrDevice.quaternion.setFromEuler(euler);
    if (xrDevice.gaze) xrDevice.gaze.quaternion.set(0, 0, 0, 1);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return (
      el.isContentEditable ||
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      tag === 'BUTTON'
    );
  }

  function onKeyDown(e) {
    if (!enabled || useDevUi) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    if (
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(
        e.code
      )
    ) {
      e.preventDefault();
    }
    keys.add(e.code);
  }

  function onKeyUp(e) {
    if (useDevUi) return;
    keys.delete(e.code);
  }

  function onMouseMove(e) {
    if (!enabled || useDevUi) return;
    if (pointerLocked || lookDragging) {
      applyLook(e.movementX || 0, e.movementY || 0);
    }
  }

  function onPointerDown(e) {
    if (!enabled || useDevUi) return;
    if (e.button === 0) {
      renderer.domElement.requestPointerLock?.();
      lookDragging = true;
    } else if (e.button === 2 || e.button === 1) {
      lookDragging = true;
      e.preventDefault();
    }
  }

  function onPointerUp(e) {
    if (e.button === 0 && !pointerLocked) lookDragging = false;
    if (e.button === 2 || e.button === 1) lookDragging = false;
  }

  function onContextMenu(e) {
    if (enabled && !useDevUi) e.preventDefault();
  }

  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (!pointerLocked) lookDragging = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('contextmenu', onContextMenu);

  function readThumbstick() {
    const session = renderer.xr.getSession?.();
    if (!session) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    for (const src of session.inputSources) {
      const pad = src.gamepad;
      if (!pad?.axes || pad.axes.length < 4) continue;
      x += pad.axes[2] || 0;
      y += pad.axes[3] || 0;
    }
    if (Math.hypot(x, y) < 0.15) return { x: 0, y: 0 };
    return { x, y };
  }

  function update(dt) {
    if (!enabled || useDevUi) return;

    wish.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) wish.z -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) wish.z += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) wish.x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) wish.x += 1;

    const stick = readThumbstick();
    wish.x += stick.x;
    wish.z += stick.y;

    if (wish.lengthSq() === 0) return;
    wish.normalize();

    const xrCam = renderer.xr.getCamera();
    xrCam.getWorldDirection(forward);
    const heading = Math.atan2(-forward.x, -forward.z);
    forward.set(-Math.sin(heading), 0, -Math.cos(heading));
    right.set(Math.cos(heading), 0, -Math.sin(heading));

    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5.5 : 3.2;
    player.position.addScaledVector(forward, -wish.z * speed * dt);
    player.position.addScaledVector(right, wish.x * speed * dt);
    player.position.y = 0;
  }

  function resetToDesktopView({
    position = new THREE.Vector3(0, 1.6, 0),
    target = new THREE.Vector3(0, 1.7, -2.2),
  } = {}) {
    player.position.set(0, 0, 0);
    player.quaternion.identity();

    if (xrDevice) {
      xrDevice.position.set(position.x, position.y, position.z);
      const tmp = new THREE.PerspectiveCamera();
      tmp.position.copy(position);
      tmp.lookAt(target);
      xrDevice.quaternion.set(
        tmp.quaternion.x,
        tmp.quaternion.y,
        tmp.quaternion.z,
        tmp.quaternion.w
      );
      euler.setFromQuaternion(tmp.quaternion, 'YXZ');
      yaw = euler.y;
      pitch = euler.x;
    }
  }

  function setEnabled(on) {
    enabled = on;
    // Always leave IWER in manual mode so DevUI play mode / hands work
    if (xrDevice) xrDevice.controlMode = 'manual';
    if (!on) {
      keys.clear();
      lookDragging = false;
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock?.();
      }
    } else if (!useDevUi) {
      renderer.domElement.tabIndex = 0;
      renderer.domElement.focus({ preventScroll: true });
    }
  }

  return {
    player,
    update,
    setEnabled,
    resetToDesktopView,
    usesDevUi: () => useDevUi,
    isPointerLocked: () => pointerLocked,
    dispose() {
      setEnabled(false);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
