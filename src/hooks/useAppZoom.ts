import { useCallback, useEffect, useRef, useState } from 'react';
import {
  flushUiSessionNow,
  loadUiSession,
  updateUiSession,
} from '../utils/uiSessionState';

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

export function clampAppZoomContinuous(value: number): number {
  if (!Number.isFinite(value)) return APP_ZOOM_DEFAULT;
  return Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, value));
}

export interface PinchPreviewTransformInput {
  startZoom: number;
  liveZoom: number;
  startMidX: number;
  startMidY: number;
  currMidX: number;
  currMidY: number;
  layerLeft: number;
  layerTop: number;
}

export interface PinchPreviewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Pure focal-point transform math for GPU-accelerated pinch preview on an
 * unzoomed outer wrapper (transform-origin: 0 0).
 * Keeps the exact content point under (startMidX, startMidY) pinned under
 * (currMidX, currMidY) throughout the gesture.
 */
export function computePinchPreviewTransform(
  input: PinchPreviewTransformInput
): PinchPreviewTransform {
  const safeStartZoom =
    Number.isFinite(input.startZoom) && input.startZoom > 0
      ? input.startZoom
      : APP_ZOOM_DEFAULT;
  const safeLiveZoom = clampAppZoomContinuous(input.liveZoom);
  const scale = safeLiveZoom / safeStartZoom;

  const originX = input.startMidX - input.layerLeft;
  const originY = input.startMidY - input.layerTop;
  const currX = input.currMidX - input.layerLeft;
  const currY = input.currMidY - input.layerTop;

  return {
    scale,
    tx: currX - originX * scale,
    ty: currY - originY * scale,
  };
}

export interface ZoomCommitScrollInput {
  startZoom: number;
  nextZoom: number;
  startScrollLeft: number;
  startScrollTop: number;
  scrollRectLeft: number;
  scrollRectTop: number;
  startMidX: number;
  startMidY: number;
  currMidX: number;
  currMidY: number;
  maxScrollLeft?: number;
  maxScrollTop?: number;
}

/**
 * Computes scrollLeft/scrollTop after committing CSS `zoom` from startZoom to
 * nextZoom so the content point under (startMidX, startMidY) lands at
 * (currMidX, currMidY) with zero visual jump.
 */
export function computeZoomCommitScroll(input: ZoomCommitScrollInput): {
  scrollLeft: number;
  scrollTop: number;
} {
  const safeStart =
    Number.isFinite(input.startZoom) && input.startZoom > 0
      ? input.startZoom
      : APP_ZOOM_DEFAULT;
  const safeNext = clampAppZoomContinuous(input.nextZoom);

  const contentX =
    input.startScrollLeft + (input.startMidX - input.scrollRectLeft) / safeStart;
  const contentY =
    input.startScrollTop + (input.startMidY - input.scrollRectTop) / safeStart;

  let scrollLeft = contentX - (input.currMidX - input.scrollRectLeft) / safeNext;
  let scrollTop = contentY - (input.currMidY - input.scrollRectTop) / safeNext;

  scrollLeft = Math.max(0, scrollLeft);
  scrollTop = Math.max(0, scrollTop);

  if (
    input.maxScrollLeft !== undefined &&
    Number.isFinite(input.maxScrollLeft)
  ) {
    scrollLeft = Math.min(Math.max(0, input.maxScrollLeft), scrollLeft);
  }
  if (
    input.maxScrollTop !== undefined &&
    Number.isFinite(input.maxScrollTop)
  ) {
    scrollTop = Math.min(Math.max(0, input.maxScrollTop), scrollTop);
  }

  return { scrollLeft, scrollTop };
}

export function isAppWorkspacePinching(node?: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false;
  if (node) {
    return Boolean(node.closest('[data-workspace-pinching="true"]'));
  }
  return Boolean(document.querySelector('[data-workspace-pinching="true"]'));
}

export function loadSavedAppZoom(): number {
  try {
    return clampAppZoom(loadUiSession().zoom);
  } catch {
    return APP_ZOOM_DEFAULT;
  }
}

export function saveAppZoom(
  zoom: number,
  options?: { debounce?: boolean }
): void {
  const clamped = clampAppZoom(zoom);
  updateUiSession(
    (prev) => (Math.abs(prev.zoom - clamped) < 0.001 ? prev : { ...prev, zoom: clamped }),
    options?.debounce ? { immediate: false, debounceMs: 120 } : { immediate: true }
  );
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

function isTouchInsideModalOrPopover(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return Boolean(el.closest('[role="dialog"], [aria-modal="true"]'));
}

function findActiveScrollContainer(
  root: HTMLElement | null
): HTMLElement | null {
  if (!root) return null;
  const marked = root.querySelector<HTMLElement>(
    '[data-zoom-scroll-container="true"]'
  );
  if (marked && marked.offsetParent !== null) {
    return marked;
  }
  return marked;
}

export function useAppZoom() {
  const [zoom, setZoomState] = useState<number>(() => loadSavedAppZoom());
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [workspaceEl, setWorkspaceEl] = useState<HTMLElement | null>(null);

  const pinchLayerElRef = useRef<HTMLElement | null>(null);
  const zoomLayerElRef = useRef<HTMLElement | null>(null);
  const toastContainerRef = useRef<HTMLDivElement | null>(null);
  const toastTextRef = useRef<HTMLSpanElement | null>(null);
  const toolbarPercentRef = useRef<HTMLSpanElement | null>(null);

  const workspaceRef = useCallback((node: HTMLElement | null) => {
    setWorkspaceEl(node);
  }, []);

  const pinchLayerRef = useCallback((node: HTMLElement | null) => {
    pinchLayerElRef.current = node;
  }, []);

  const zoomLayerRef = useCallback((node: HTMLElement | null) => {
    zoomLayerElRef.current = node;
  }, []);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const toastTimerRef = useRef<number | null>(null);

  const syncLiveIndicators = useCallback(
    (pct: number, forceShowToast: boolean) => {
      if (toastTextRef.current) {
        toastTextRef.current.textContent = `Zoom ${pct}%`;
      }
      if (toolbarPercentRef.current) {
        toolbarPercentRef.current.textContent = `${pct}%`;
      }
      if (forceShowToast && toastContainerRef.current) {
        toastContainerRef.current.style.opacity = '1';
      }
    },
    []
  );

  const showToastBriefly = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (toastContainerRef.current) {
      toastContainerRef.current.style.opacity = '';
    }
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
      flushUiSessionNow();
    };
  }, []);

  const applyZoomWithAnchor = useCallback(
    (
      nextRaw: number,
      options?: {
        showToast?: boolean;
        anchorClientX?: number;
        anchorClientY?: number;
        debounceSave?: boolean;
      }
    ) => {
      const prevZoom = zoomRef.current;
      const next = clampAppZoom(nextRaw);

      if (Math.abs(next - prevZoom) < 0.001) {
        if (options?.showToast) showToastBriefly();
        return;
      }

      const zoomLayerEl = zoomLayerElRef.current;
      const scrollEl = findActiveScrollContainer(zoomLayerEl);
      let scrollSnapshot: {
        scrollLeft: number;
        scrollTop: number;
        rectLeft: number;
        rectTop: number;
        anchorX: number;
        anchorY: number;
      } | null = null;

      if (scrollEl && zoomLayerEl) {
        const rect = scrollEl.getBoundingClientRect();
        const anchorX =
          options?.anchorClientX ?? rect.left + rect.width * 0.5;
        const anchorY =
          options?.anchorClientY ?? rect.top + rect.height * 0.5;
        scrollSnapshot = {
          scrollLeft: scrollEl.scrollLeft,
          scrollTop: scrollEl.scrollTop,
          rectLeft: rect.left,
          rectTop: rect.top,
          anchorX,
          anchorY,
        };
      }

      zoomRef.current = next;

      // Apply CSS zoom and focal-point scroll adjustment synchronously in the same frame
      if (zoomLayerEl) {
        zoomLayerEl.style.zoom = next !== 1 ? String(next) : '';
      }
      if (scrollEl && scrollSnapshot) {
        const nextRect = scrollEl.getBoundingClientRect();
        const maxScrollLeft = Math.max(
          0,
          scrollEl.scrollWidth - scrollEl.clientWidth
        );
        const maxScrollTop = Math.max(
          0,
          scrollEl.scrollHeight - scrollEl.clientHeight
        );
        const targetScroll = computeZoomCommitScroll({
          startZoom: prevZoom,
          nextZoom: next,
          startScrollLeft: scrollSnapshot.scrollLeft,
          startScrollTop: scrollSnapshot.scrollTop,
          scrollRectLeft: nextRect.left,
          scrollRectTop: nextRect.top,
          startMidX: scrollSnapshot.anchorX,
          startMidY: scrollSnapshot.anchorY,
          currMidX: scrollSnapshot.anchorX,
          currMidY: scrollSnapshot.anchorY,
          maxScrollLeft,
          maxScrollTop,
        });
        scrollEl.scrollLeft = targetScroll.scrollLeft;
        scrollEl.scrollTop = targetScroll.scrollTop;
      }

      syncLiveIndicators(Math.round(next * 100), false);
      setZoomState(next);

      saveAppZoom(next, { debounce: Boolean(options?.debounceSave) });

      if (options?.showToast) {
        showToastBriefly();
      }
    },
    [showToastBriefly, syncLiveIndicators]
  );

  const setZoom = useCallback(
    (nextRaw: number, options?: { showToast?: boolean }) => {
      applyZoomWithAnchor(nextRaw, options);
    },
    [applyZoomWithAnchor]
  );

  const zoomIn = useCallback(() => {
    applyZoomWithAnchor(stepAppZoom(zoomRef.current, 'in'), {
      showToast: true,
    });
  }, [applyZoomWithAnchor]);

  const zoomOut = useCallback(() => {
    applyZoomWithAnchor(stepAppZoom(zoomRef.current, 'out'), {
      showToast: true,
    });
  }, [applyZoomWithAnchor]);

  const resetZoom = useCallback(() => {
    applyZoomWithAnchor(APP_ZOOM_DEFAULT, { showToast: true });
  }, [applyZoomWithAnchor]);

  // Attach Ctrl/Cmd+Wheel (desktop) and GPU-accelerated 2-finger pinch (tablet/touch)
  useEffect(() => {
    const el = workspaceEl;
    if (!el) return;

    interface ActivePinchState {
      startDist: number;
      startZoom: number;
      liveZoom: number;
      startMidX: number;
      startMidY: number;
      currMidX: number;
      currMidY: number;
      layerLeft: number;
      layerTop: number;
      scrollEl: HTMLElement | null;
      startScrollLeft: number;
      startScrollTop: number;
      scrollRectLeft: number;
      scrollRectTop: number;
    }

    let pinch: ActivePinchState | null = null;
    let rafId: number | null = null;
    let waitingForZeroTouches = false;

    const getTouchMetrics = (t1: Touch, t2: Touch) => ({
      dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
      midX: (t1.clientX + t2.clientX) * 0.5,
      midY: (t1.clientY + t2.clientY) * 0.5,
    });

    const clearPendingRaf = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const applyPreviewFrame = () => {
      rafId = null;
      if (!pinch) return;
      const pinchLayerEl = pinchLayerElRef.current;
      if (!pinchLayerEl) return;

      const { scale, tx, ty } = computePinchPreviewTransform({
        startZoom: pinch.startZoom,
        liveZoom: pinch.liveZoom,
        startMidX: pinch.startMidX,
        startMidY: pinch.startMidY,
        currMidX: pinch.currMidX,
        currMidY: pinch.currMidY,
        layerLeft: pinch.layerLeft,
        layerTop: pinch.layerTop,
      });

      pinchLayerEl.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${scale.toFixed(5)})`;
      syncLiveIndicators(Math.round(pinch.liveZoom * 100), true);
    };

    const commitPinch = (remainingTouches: number) => {
      clearPendingRaf();
      const finished = pinch;
      pinch = null;

      const pinchLayerEl = pinchLayerElRef.current;
      const zoomLayerEl = zoomLayerElRef.current;

      if (pinchLayerEl) {
        pinchLayerEl.style.transform = '';
        pinchLayerEl.style.transformOrigin = '';
        pinchLayerEl.style.willChange = '';
      }

      if (remainingTouches > 0) {
        waitingForZeroTouches = true;
      } else {
        waitingForZeroTouches = false;
        el.removeAttribute('data-workspace-pinching');
      }

      if (!finished) return;

      const committedZoom = clampAppZoom(finished.liveZoom);
      zoomRef.current = committedZoom;

      // Synchronously commit CSS zoom and adjust scroll so content stays locked
      // at the exact same viewport position as the final GPU preview frame.
      if (zoomLayerEl) {
        zoomLayerEl.style.zoom =
          committedZoom !== 1 ? String(committedZoom) : '';
      }

      if (finished.scrollEl) {
        const scrollEl = finished.scrollEl;
        const postRect = scrollEl.getBoundingClientRect();
        const maxScrollLeft = Math.max(
          0,
          scrollEl.scrollWidth - scrollEl.clientWidth
        );
        const maxScrollTop = Math.max(
          0,
          scrollEl.scrollHeight - scrollEl.clientHeight
        );
        const targetScroll = computeZoomCommitScroll({
          startZoom: finished.startZoom,
          nextZoom: committedZoom,
          startScrollLeft: finished.startScrollLeft,
          startScrollTop: finished.startScrollTop,
          scrollRectLeft: postRect.left || finished.scrollRectLeft,
          scrollRectTop: postRect.top || finished.scrollRectTop,
          startMidX: finished.startMidX,
          startMidY: finished.startMidY,
          currMidX: finished.currMidX,
          currMidY: finished.currMidY,
          maxScrollLeft,
          maxScrollTop,
        });
        scrollEl.scrollLeft = targetScroll.scrollLeft;
        scrollEl.scrollTop = targetScroll.scrollTop;
      }

      syncLiveIndicators(Math.round(committedZoom * 100), false);
      saveAppZoom(committedZoom);
      setZoomState(committedZoom);
      showToastBriefly();
    };

    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (isIndependentZoomOverlayOpen()) return;
      e.preventDefault();
      // Support both trackpad pinch (fine deltaY) and mouse wheel detents
      const stepFactor =
        Math.abs(e.deltaY) < 20
          ? 1 - e.deltaY * 0.01
          : e.deltaY < 0
          ? 1.08
          : 1 / 1.08;
      applyZoomWithAnchor(zoomRef.current * stepFactor, {
        showToast: true,
        anchorClientX: e.clientX,
        anchorClientY: e.clientY,
        debounceSave: true,
      });
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        if (pinch) {
          commitPinch(e.touches.length);
        }
        return;
      }
      if (isIndependentZoomOverlayOpen()) return;
      if (
        isTouchInsideModalOrPopover(e.touches[0].target) ||
        isTouchInsideModalOrPopover(e.touches[1].target)
      ) {
        return;
      }

      const { dist, midX, midY } = getTouchMetrics(e.touches[0], e.touches[1]);
      if (dist < 12) return;

      const pinchLayerEl = pinchLayerElRef.current;
      const zoomLayerEl = zoomLayerElRef.current;
      if (!pinchLayerEl || !zoomLayerEl) return;

      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      const layerRect = pinchLayerEl.getBoundingClientRect();
      const scrollEl = findActiveScrollContainer(zoomLayerEl);
      const scrollRect = scrollEl?.getBoundingClientRect();

      waitingForZeroTouches = false;
      el.setAttribute('data-workspace-pinching', 'true');

      pinchLayerEl.style.transformOrigin = '0 0';
      pinchLayerEl.style.willChange = 'transform';

      pinch = {
        startDist: dist,
        startZoom: zoomRef.current,
        liveZoom: zoomRef.current,
        startMidX: midX,
        startMidY: midY,
        currMidX: midX,
        currMidY: midY,
        layerLeft: layerRect.left,
        layerTop: layerRect.top,
        scrollEl,
        startScrollLeft: scrollEl?.scrollLeft ?? 0,
        startScrollTop: scrollEl?.scrollTop ?? 0,
        scrollRectLeft: scrollRect?.left ?? layerRect.left,
        scrollRectTop: scrollRect?.top ?? layerRect.top,
      };

      syncLiveIndicators(Math.round(zoomRef.current * 100), true);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!pinch) {
        if (waitingForZeroTouches) {
          // Prevent accidental single-finger scroll jump while lifting the second finger
          e.preventDefault();
        }
        return;
      }

      if (e.touches.length !== 2 || isIndependentZoomOverlayOpen()) {
        commitPinch(e.touches.length);
        return;
      }

      e.preventDefault();
      const { dist, midX, midY } = getTouchMetrics(e.touches[0], e.touches[1]);
      const ratio = dist / Math.max(12, pinch.startDist);
      pinch.liveZoom = clampAppZoomContinuous(pinch.startZoom * ratio);
      pinch.currMidX = midX;
      pinch.currMidY = midY;

      if (rafId === null) {
        rafId = window.requestAnimationFrame(applyPreviewFrame);
      }
    };

    const handleTouchEndOrCancel = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) {
        commitPinch(e.touches.length);
        return;
      }
      if (e.touches.length === 0 && waitingForZeroTouches) {
        waitingForZeroTouches = false;
        el.removeAttribute('data-workspace-pinching');
      }
    };

    // Prevent iPadOS Safari native page pinch-zoom from fighting our custom workspace pinch
    const handleSafariGesture = (e: Event) => {
      if (isIndependentZoomOverlayOpen()) return;
      if (isTouchInsideModalOrPopover(e.target)) return;
      e.preventDefault();
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEndOrCancel, { passive: true });
    el.addEventListener('touchcancel', handleTouchEndOrCancel, {
      passive: true,
    });
    el.addEventListener('gesturestart', handleSafariGesture, {
      passive: false,
    });
    el.addEventListener('gesturechange', handleSafariGesture, {
      passive: false,
    });

    return () => {
      clearPendingRaf();
      if (pinchLayerElRef.current) {
        pinchLayerElRef.current.style.transform = '';
        pinchLayerElRef.current.style.transformOrigin = '';
        pinchLayerElRef.current.style.willChange = '';
      }
      el.removeAttribute('data-workspace-pinching');
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEndOrCancel);
      el.removeEventListener('touchcancel', handleTouchEndOrCancel);
      el.removeEventListener('gesturestart', handleSafariGesture);
      el.removeEventListener('gesturechange', handleSafariGesture);
    };
  }, [workspaceEl, applyZoomWithAnchor, showToastBriefly, syncLiveIndicators]);

  const zoomPercent = Math.round(zoom * 100);
  const isDefaultZoom = Math.abs(zoom - APP_ZOOM_DEFAULT) < 0.005;

  return {
    zoom,
    zoomPercent,
    isDefaultZoom,
    isToastVisible,
    workspaceRef,
    pinchLayerRef,
    zoomLayerRef,
    toastContainerRef,
    toastTextRef,
    toolbarPercentRef,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
