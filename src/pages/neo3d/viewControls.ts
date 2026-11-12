/** Pan, zoom and reset buttons overlaid on the 3D viewport. */
import { icon, type IconName } from '../../lib/icons';
import type { Neo3D } from './scene/Neo3D';

const PAN_STEP = 120;
const ZOOM_IN_FACTOR = 0.82;
const ZOOM_OUT_FACTOR = 1.22;

const byButtonId = (id: string) => document.getElementById(id) as HTMLButtonElement | null;

function setControlIcon(
  button: HTMLButtonElement | null,
  name: IconName,
  label: string,
  options: { hint?: string } = {},
): void {
  if (!button) return;
  const hint = options.hint ?? label;
  button.innerHTML = `${icon(name, { label })}<span class="sr-only">${label}</span>`;
  button.setAttribute('aria-label', label);
  button.title = hint;
}

/** Fires `handler` once on press, then repeatedly while the pointer is held down. */
function registerPressAction(
  button: HTMLButtonElement | null,
  handler: () => void,
  options: { interval?: number } = {},
): void {
  if (!button) return;
  const interval = Math.max(60, options.interval ?? 170);
  let repeatId: number | null = null;
  let activePointer: number | null = null;

  const stop = () => {
    if (repeatId !== null) {
      window.clearInterval(repeatId);
      repeatId = null;
    }
    if (activePointer !== null && button.hasPointerCapture(activePointer)) {
      try {
        button.releasePointerCapture(activePointer);
      } catch {
        // Non-fatal; pointer capture may already be released.
      }
    }
    activePointer = null;
  };

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    stop();
    button.focus();
    handler();
    button.setPointerCapture(event.pointerId);
    activePointer = event.pointerId;
    repeatId = window.setInterval(handler, interval);
    event.preventDefault();
  });

  const cancel = () => {
    stop();
  };

  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointerleave', cancel);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('lostpointercapture', cancel);

  button.addEventListener('click', (event) => {
    if (event.detail === 0) {
      handler();
    }
  });

  button.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      handler();
    }
  });
}

export function initViewControls(simulation: Neo3D): void {
  const panUpBtn = byButtonId('neo3d-pan-up');
  const panDownBtn = byButtonId('neo3d-pan-down');
  const panLeftBtn = byButtonId('neo3d-pan-left');
  const panRightBtn = byButtonId('neo3d-pan-right');
  const zoomInBtn = byButtonId('neo3d-zoom-in');
  const zoomOutBtn = byButtonId('neo3d-zoom-out');
  const resetViewBtn = byButtonId('neo3d-reset-view');

  setControlIcon(panUpBtn, 'arrowUp', 'Pan up', { hint: 'Pan up (press and hold)' });
  setControlIcon(panDownBtn, 'arrowDown', 'Pan down', { hint: 'Pan down (press and hold)' });
  setControlIcon(panLeftBtn, 'arrowLeft', 'Pan left', { hint: 'Pan left (press and hold)' });
  setControlIcon(panRightBtn, 'arrowRight', 'Pan right', { hint: 'Pan right (press and hold)' });
  setControlIcon(zoomInBtn, 'plus', 'Zoom in', { hint: 'Zoom in (press and hold)' });
  setControlIcon(zoomOutBtn, 'minus', 'Zoom out', { hint: 'Zoom out (press and hold)' });
  setControlIcon(resetViewBtn, 'target', 'Reset view');

  registerPressAction(panUpBtn, () => {
    simulation.panBy(0, -PAN_STEP);
  });
  registerPressAction(panDownBtn, () => {
    simulation.panBy(0, PAN_STEP);
  });
  registerPressAction(panLeftBtn, () => {
    simulation.panBy(PAN_STEP, 0);
  });
  registerPressAction(panRightBtn, () => {
    simulation.panBy(-PAN_STEP, 0);
  });
  registerPressAction(zoomInBtn, () => {
    simulation.zoomBy(ZOOM_IN_FACTOR);
  }, { interval: 200 });
  registerPressAction(zoomOutBtn, () => {
    simulation.zoomBy(ZOOM_OUT_FACTOR);
  }, { interval: 200 });

  if (resetViewBtn) {
    resetViewBtn.addEventListener('click', () => {
      simulation.resetView();
    });
  }
}
