import { XRDevice, metaQuestPro } from 'iwer';
import { DevUI } from '@iwer/devui';

/**
 * Meta Immersive Web Emulator (IWER) + DevUI.
 * Mounts DevUI’s overlay/canvas (hands, play mode) and keeps manual control
 * so mouse look / controller gizmos actually work.
 */
export async function installIwer() {
  let immersiveNative = false;
  try {
    immersiveNative = !!(
      navigator.xr &&
      (await navigator.xr.isSessionSupported('immersive-vr'))
    );
  } catch {
    immersiveNative = false;
  }

  if (immersiveNative) {
    return {
      emulated: false,
      xrDevice: null,
      devui: null,
      label: 'Native WebXR headset',
    };
  }

  const xrDevice = new XRDevice(metaQuestPro);
  // Standing VR pose — panel sits at z≈-2.2 in XR story space
  xrDevice.position.set(0, 1.6, 0);
  xrDevice.ipd = 0;
  xrDevice.stereoEnabled = false;
  xrDevice.installRuntime({ forceInstall: true });

  if (xrDevice.gaze) {
    xrDevice.gaze.connected = true;
  }

  // Controllers visible + connected by default
  for (const hand of ['left', 'right']) {
    if (xrDevice.controllers?.[hand]) {
      xrDevice.controllers[hand].connected = true;
    }
  }

  const devui = new DevUI(xrDevice);
  // Keep manual mode so DevUI owns mouse / play mode / hand gizmos
  xrDevice.controlMode = 'manual';
  devui.setGazeMode?.('head-locked');

  // DevUI builds these but does not append them — without this, hands never show
  // and Play mode cannot pointer-lock.
  const overlay = devui.devUIContainer;
  const canvas = devui.devUICanvas;
  if (overlay && !overlay.isConnected) {
    overlay.style.zIndex = '80';
    document.body.appendChild(overlay);
  }
  if (canvas && !canvas.isConnected) {
    canvas.style.zIndex = '79';
    canvas.style.pointerEvents = 'auto';
    document.body.appendChild(canvas);
  }

  // DevUI free-move requires Shift+WASD by default — allow plain WASD
  const layer = devui.inputLayer;
  if (layer && typeof layer.movePlayerRig === 'function') {
    layer.movePlayerRig = function movePlayerRig(delta) {
      const { playerRig, keyState, vec3 } = this;
      vec3.set(
        (keyState.KeyD ? 1 : 0) - (keyState.KeyA ? 1 : 0),
        0,
        (keyState.KeyS ? 1 : 0) - (keyState.KeyW ? 1 : 0)
      );
      if (vec3.lengthSq() === 0) return;
      const sprint = keyState.ShiftLeft ? 2.2 : 1;
      vec3
        .normalize()
        .multiplyScalar(2.6 * sprint * delta)
        .applyQuaternion(playerRig.quaternion);
      playerRig.position.add(vec3);
    };
  }

  return {
    emulated: true,
    xrDevice,
    devui,
    label: 'Meta Immersive Web Emulator (Quest Pro + gaze)',
  };
}
