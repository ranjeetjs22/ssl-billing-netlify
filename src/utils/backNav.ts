/**
 * Phone / browser Back button support.
 *
 * The app is a single page with no router, so without this the Back button leaves the
 * app. Every closable "layer" - a modal, the mobile drawer, a tab other than the home
 * dashboard - registers here while it is open. We keep exactly one history entry per
 * open layer, so:
 *   - Back closes the top-most open layer (a modal before the screen behind it),
 *   - with nothing open, Back from any tab returns to the dashboard,
 *   - only Back from the dashboard leaves the app.
 *
 * History is reconciled on a timer rather than on every open/close, so a layer that
 * closes and another that opens in the same moment (e.g. invoice detail -> edit form),
 * or React StrictMode's mount/unmount/mount in development, cost no extra entries.
 */
import { useEffect, useRef } from 'react';

interface Layer {
  id: number;
  /** Lower levels sit beneath higher ones (tabs 0, drawer/modals 1). */
  level: number;
  close: () => void;
}

const layers: Layer[] = [];
let seq = 0;
/** History entries we pushed that are still on the history stack. */
let depth = 0;
/** popstate events caused by our own history.go(), not by the user. */
let ignoring = 0;
let scheduled = false;
let listening = false;

function ordered(): Layer[] {
  return [...layers].sort((a, b) => a.level - b.level || a.id - b.id);
}

function reconcile() {
  scheduled = false;
  // Wait for our own navigation to land before touching history again
  if (ignoring > 0) return;
  const want = layers.length;
  if (depth < want) {
    while (depth < want) {
      depth += 1;
      window.history.pushState({ ...(window.history.state || {}), sslLayer: depth }, '');
    }
  } else if (depth > want) {
    const n = depth - want;
    depth = want;
    ignoring += 1;
    window.history.go(-n);
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(reconcile, 0);
}

function onPopState() {
  if (ignoring > 0) {
    ignoring -= 1;
    schedule();
    return;
  }
  // The user pressed Back: one of our entries is gone - close the top layer.
  if (depth > 0) depth -= 1;
  const top = ordered().pop();
  if (top) {
    const i = layers.indexOf(top);
    if (i !== -1) layers.splice(i, 1);
    top.close();
  }
  schedule();
}

function ensureListening() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPopState);
}

/**
 * While `active`, Back calls `onClose` instead of leaving the page.
 * `level` 0 is for screens (tabs); modals and drawers use the default 1.
 */
export function useBackLayer(onClose: () => void, active = true, level = 1) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    ensureListening();
    const layer: Layer = { id: ++seq, level, close: () => closeRef.current() };
    layers.push(layer);
    schedule();
    return () => {
      // Closed from the UI (not by Back): drop the layer; reconcile removes its entry
      const i = layers.indexOf(layer);
      if (i !== -1) {
        layers.splice(i, 1);
        schedule();
      }
    };
  }, [active, level]);
}
