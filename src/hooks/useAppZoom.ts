import { useCallback, useEffect, useRef, useState } from 'react';

export const APP_ZOOM_STORAGE_KEY = 'tabscore_ui_zoom_v1';
export const APP_ZOOM_MIN = 0.7;
export const APP_ZOOM_MAX = 1.75;
export const APP_ZOOM_DEFAULT = 1;
export const APP_ZOOM_PRESETS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

export function clampAppZoom(value: number): number {
  if (!Number.isFinite(value)) return APP_ZOOM_DEFAULT;
  const clamped = Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, value));
  return Math.round(clamped * 100) / 100;
}

export function loadSavedAppZoom(): number {
  if (typeof window === 'undefined') return APP_ZOOM_DEFAULT;
  try {
    const raw = window.localStorage.getItem(APP_ZOOM_STORAGE_KEY);
    if (!raw) return APP_ZOOM_DEFAULT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return APP_ZOOM_DEFAULT;
    return clampAppZoom(parsed);
  } catch {
    return APP_ZOOM_DEFAULT;
  }
}

export function saveAppZoom(zoom: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      APP_ZOOM_STORAGE_KEY,
      String(clampAppZoom(zoom))
    );
  } catch {
    // Ignore storage quota or private-browsing errors
  }
}

export function stepAppZoom(
  current: number,
  direction: 'in' | 'out'
): number {
  const safe = clampAppZoom(current);
  if (direction === 'in') {
    const nextPreset = APP_ZOOM_PRESETS.find((p) => p > safe + 0.015);
    if (nextPreset !== undefined) return nextPreset;
    return clampAppZoom(safe + 0.1);
  }
  const prevPreset = [...APP_ZOOM_PRESETS]
    .reverse()
    .find((p) => p < safe - 0.015);
  if (prevPreset !== undefined) return prevPreset;
  return clampAppZoom(safe - 0.1);
}

function isIndependentZoomOverlayOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('[data-independent-zoom="true"]'));
}

export function useAppZoom() {
  const [zoom, setZoomState] = useState<number>(() => loadSavedAppZoom());
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [workspaceEl, setWorkspaceEl] = useState<HTMLElement | null>(null);

  const workspaceRef = useCallback((node: HTMLElement | null) => {
    setWorkspaceEl(node);
  }, []);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const toastTimerRef = useRef<number | null>(null);

  const showToastBriefly = useCallback(() => {
    if (typeof window === 'undefined') return;
    setIsToastVisible(true);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setIsToastVisible(false);
      toastTimerRef.current = null;
    }, 1400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const setZoom = useCallback(
    (nextRaw: number, options?: { showToast?: boolean }) => {
      const next = clampAppZoom(nextRaw);
      if (Math.abs(next - zoomRef.current) < 0.001) {
        if (options?.showToast) showToastBriefly();
        return;
      }
      zoomRef.current = next;
      setZoomState(next);
      saveAppZoom(next);
      if (options?.showToast) {
        showToastBriefly();
      }
    },
    [showToastBriefly]
  );

  const zoomIn = useCallback(() => {
    setZoom(stepAppZoom(zoomRef.current, 'in'), { showToast: true });
  }, [setZoom]);

  const zoomOut = useCallback(() => {
    setZoom(stepAppZoom(zoomRef.current, 'out'), { showToast: true });
  }, [setZoom]);

  const resetZoom = useCallback(() => {
    setZoom(APP_ZOOM_DEFAULT, { showToast: true });
  }, [setZoom]);

  // Attach Ctrl+Wheel (desktop) and 2-finger pinch (touch) on the workspace container
  useEffect(() => {
    const el = workspaceEl;
    if (!el) return;

    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let isPinching = false;

    const getTouchDistance = (t1: Touch, t2: Touch) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (isIndependentZoomOverlayOpen()) return;
      e.preventDefault();
      // Support both trackpad pinch (fine deltaY) and mouse wheel clicks
      const stepFactor =
        Math.abs(e.deltaY) < 20
          ? 1 - e.deltaY * 0.01
          : e.deltaY < 0
          ? 1.08
          : 1 / 1.08;
      setZoom(zoomRef.current * stepFactor, { showToast: true });
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        isPinching = false;
        return;
      }
      if (isIndependentZoomOverlayOpen()) return;
      const dist = getTouchDistance(e.touches[0], e.touches[1]);
      if (dist < 10) return;
      isPinching = true;
      pinchStartDist = dist;
      pinchStartZoom = zoomRef.current;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPinching || e.touches.length !== 2) return;
      if (isIndependentZoomOverlayOpen()) {
        isPinching = false;
        return;
      }
      e.preventDefault();
      const dist = getTouchDistance(e.touches[0], e.touches[1]);
      const ratio = dist / Math.max(10, pinchStartDist);
      setZoom(pinchStartZoom * ratio, { showToast: true });
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isPinching = false;
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [workspaceEl, setZoom]);

  const zoomPercent = Math.round(zoom * 100);
  const isDefaultZoom = Math.abs(zoom - APP_ZOOM_DEFAULT) < 0.005;

  return {
    zoom,
    zoomPercent,
    isDefaultZoom,
    isToastVisible,
    workspaceRef,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
