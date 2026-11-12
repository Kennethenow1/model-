import { XRDevice, metaQuestPro } from 'iwer';
import { DevUI } from '@iwer/devui';

/**
 * Install Meta's Immersive Web Emulation Runtime when immersive-vr is
 * not natively available. Uses Quest Pro profile so eye/gaze tracking
 * exists in the emulated runtime.
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
    return { emulated: false, xrDevice: null, devui: null };
  }

  const xrDevice = new XRDevice(metaQuestPro);
  // Standing start, facing -Z toward the VR story panel
  xrDevice.position.set(0, 1.6, 0);
  xrDevice.ipd = 0.063;
  xrDevice.stereoEnabled = false;

  // Chrome's partial navigator.xr would otherwise block IWER
  xrDevice.installRuntime({ forceInstall: true });

  // Enable emulated eye-gaze input (Quest Pro feature)
  if (xrDevice.gaze) {
    xrDevice.gaze.connected = true;
  }

  const devui = new DevUI(xrDevice);

  return { emulated: true, xrDevice, devui };
}
