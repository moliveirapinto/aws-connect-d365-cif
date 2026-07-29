// Path B: the Amazon Connect CCP cannot be iframed (the instance serves
// `frame-ancestors 'self'`), so we launch it as a top-level *companion* window
// docked next to D365. The CCP runs natively in that window, so softphone audio
// and call controls work reliably. The live transcript still reaches D365 through
// the server-side pipeline (Contact Lens real-time -> Lambda -> ingestor ->
// Direct Line -> Omnichannel), which is independent of this window.

import { config } from "../config";

const CCP_WINDOW_NAME = "aws_connect_ccp";
const CCP_WIDTH = 400;
const CCP_HEIGHT = 660;

let ccpWindow: Window | null = null;

/** Open (or focus) the Amazon Connect softphone in a docked companion window. */
export function openSoftphone(): Window | null {
  if (ccpWindow && !ccpWindow.closed) {
    ccpWindow.focus();
    return ccpWindow;
  }
  // Dock to the top-right corner of the available screen.
  const left = Math.max(0, (window.screen?.availWidth ?? 1280) - CCP_WIDTH);
  const features = `popup=yes,width=${CCP_WIDTH},height=${CCP_HEIGHT},left=${left},top=0`;
  ccpWindow = window.open(config.connectCcpUrl, CCP_WINDOW_NAME, features);
  return ccpWindow;
}

/** True while the companion softphone window is open. */
export function isSoftphoneOpen(): boolean {
  return !!ccpWindow && !ccpWindow.closed;
}

/** Close the companion softphone window. */
export function closeSoftphone(): void {
  if (ccpWindow && !ccpWindow.closed) ccpWindow.close();
  ccpWindow = null;
}
