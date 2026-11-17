import { Maximize2, Minimize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { Plate } from '../types/gradebook';

interface PlateImageViewerModalProps {
  plate: Plate | null;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function PlateImageViewerModal({
  plate,
  onClose,
}: PlateImageViewerModalProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origPanX: number;
    origPanY: number;
    moved: boolean;
  } | null>(null);
  const pinchStartRef = useRef<{
    dist: number;
    startZoom: number;
  } | null>(null);
  const lastTapRef = useRef<number>(0);

  const clampPan = useCallback(
    (nextX: number, nextY: number, targetZoom: number) => {
      if (targetZoom <= 1.01) return { x: 0, y: 0 };
      const stage = stageRef.current;
      const img = imgRef.current;
      if (!stage || !img) return { x: nextX, y: nextY };
      const maxOffsetX = Math.max(
        0,
        (img.offsetWidth * targetZoom - stage.clientWidth) / 2 + 32
      );
      const maxOffsetY = Math.max(
        0,
        (img.offsetHeight * targetZoom - stage.clientHeight) / 2 + 32
      );
      return {
        x: clamp(nextX, -maxOffsetX, maxOffsetX),
        y: clamp(nextY, -maxOffsetY, maxOffsetY),
      };
    },
    []
  );

  const applyZoom = useCallback(
    (nextZoomRaw: number) => {
      const nextZoom = Number(clamp(nextZoomRaw, MIN_ZOOM, MAX_ZOOM).toFixed(2));
      setZoom(nextZoom);
      if (nextZoom <= 1.01) {
        setPan({ x: 0, y: 0 });
      } else {
        setPan((prev) => clampPan(prev.x, prev.y, nextZoom));
      }
    },
    [clampPan]
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!plate?.imageDataUrl) return;
    resetView();
    pointersRef.current.clear();
    dragStartRef.current = null;
    pinchStartRef.current = null;
    setIsDragging(false);
  }, [plate?.id, plate?.imageDataUrl, resetView]);

  useEffect(() => {
    if (!plate?.imageDataUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        applyZoom(zoomRef.current + ZOOM_STEP);
      } else if (e.key === '-' || e.key === '_') {
        applyZoom(zoomRef.current - ZOOM_STEP);
      } else if (e.key === '0') {
        resetView();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [plate?.imageDataUrl, onClose, applyZoom, resetView]);

  if (!plate || !plate.imageDataUrl) return null;

  const handleWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
    applyZoom(zoomRef.current * factor);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = {
        dist: Math.max(dist, 1),
        startZoom: zoomRef.current,
      };
      dragStartRef.current = null;
      setIsDragging(false);
      return;
    }

    if (pointersRef.current.size === 1) {
      // Double-tap support for touch/pen
      if (e.pointerType !== 'mouse') {
        const now = Date.now();
        if (now - lastTapRef.current < 280) {
          lastTapRef.current = 0;
          if (zoomRef.current > 1.05) {
            resetView();
          } else {
            applyZoom(2.5);
          }
          return;
        }
        lastTapRef.current = now;
      }

      dragStartRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origPanX: panRef.current.x,
        origPanY: panRef.current.y,
        moved: false,
      };
      if (zoomRef.current > 1.01) {
        setIsDragging(true);
      }
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const ratio = dist / pinchStartRef.current.dist;
      applyZoom(pinchStartRef.current.startZoom * ratio);
      return;
    }

    const drag = dragStartRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 4) {
        drag.moved = true;
      }
      if (zoomRef.current > 1.01) {
        setPan(clampPan(drag.origPanX + dx, drag.origPanY + dy, zoomRef.current));
      }
    }
  };

  const handlePointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (dragStartRef.current?.pointerId === e.pointerId) {
      dragStartRef.current = null;
    }
    setIsDragging(false);
  };

  const handleDoubleClick = () => {
    if (zoomRef.current > 1.05) {
      resetView();
    } else {
      applyZoom(2.5);
    }
  };

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-slate-950/92 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizzazione Tavola ${plate.number}: ${plate.title}`}
    >
      {/* Top Toolbar: responsive across smartphone, tablet, desktop */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-3 py-2 text-white sm:px-5 sm:py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 rounded bg-blue-600 px-2 py-0.5 font-mono text-xs font-extrabold tracking-tight text-white sm:text-sm">
            T{plate.number}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold leading-tight text-white sm:text-base">
              {plate.title}
            </h2>
            {plate.imageName && (
              <p className="hidden truncate text-[11px] text-slate-400 sm:block">
                {plate.imageName}
              </p>
            )}
          </div>
        </div>

        {/* Zoom Controls + Clear Close Button */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <div className="flex items-center rounded-md border border-slate-700 bg-slate-800/90 p-0.5">
            <button
              type="button"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => applyZoom(zoom - ZOOM_STEP)}
              title="Riduci zoom (-)"
              aria-label="Riduci zoom"
              className="inline-flex h-9 w-9 items-center justify-center rounded text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[48px] text-center font-mono text-xs font-semibold tabular-nums text-slate-100">
              {zoomPercent}%
            </span>
            <button
              type="button"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => applyZoom(zoom + ZOOM_STEP)}
              title="Ingrandisci (+)"
              aria-label="Ingrandisci"
              className="inline-flex h-9 w-9 items-center justify-center rounded text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={zoom > 1.01 ? resetView : () => applyZoom(2)}
              title={zoom > 1.01 ? 'Adatta allo schermo (0)' : 'Zoom 200%'}
              aria-label={zoom > 1.01 ? 'Adatta allo schermo' : 'Zoom 200%'}
              className="inline-flex h-9 items-center gap-1 rounded px-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              {zoom > 1.01 ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Adatta</span>
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">200%</span>
                </>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi visualizzazione immagine"
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-white px-3.5 text-xs font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-100 sm:text-sm"
          >
            <X className="h-4 w-4 text-slate-800" />
            <span>Chiudi</span>
          </button>
        </div>
      </header>

      {/* Main Viewport Stage: maximizes available screen area */}
      <div
        ref={stageRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={handleDoubleClick}
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 select-none touch-none sm:p-4 ${
          zoom > 1.01
            ? isDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-zoom-in'
        }`}
      >
        <img
          ref={imgRef}
          src={plate.imageDataUrl}
          alt={`Tavola ${plate.number} - ${plate.title}`}
          draggable={false}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transition: isDragging ? 'none' : 'transform 120ms ease-out',
          }}
          className="max-h-full max-w-full rounded bg-white object-contain shadow-2xl will-change-transform"
        />

        {/* Quiet usage hint at bottom */}
        <div className="pointer-events-none absolute bottom-2.5 left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-md border border-slate-700/80 bg-slate-900/85 px-3 py-1 text-[11px] text-slate-300 shadow sm:flex">
          {zoom > 1.01 ? (
            <>
              <Minimize2 className="h-3 w-3 text-blue-300" />
              <span>Trascina per spostarti · Doppio clic per adattare</span>
            </>
          ) : (
            <span>
              Doppio clic o rotellina per ingrandire · Esc per chiudere
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
