import { Minus, Plus, RotateCcw, Search } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  APP_ZOOM_DEFAULT,
  APP_ZOOM_MAX,
  APP_ZOOM_MIN,
  APP_ZOOM_PRESETS,
} from '../hooks/useAppZoom';

interface ZoomControlsProps {
  zoom: number;
  zoomPercent: number;
  isDefaultZoom: boolean;
  toolbarPercentRef?: RefObject<HTMLSpanElement | null>;
  onSetZoom: (nextZoom: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export function ZoomControls({
  zoom,
  zoomPercent,
  isDefaultZoom,
  toolbarPercentRef,
  onSetZoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: ZoomControlsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Zoom interfaccia (Ctrl + rotellina o pizzico a 2 dita)"
        aria-label={`Zoom interfaccia: ${zoomPercent}%`}
        aria-expanded={open}
        className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 font-mono text-xs font-semibold tabular-nums transition-colors whitespace-nowrap ${
          !isDefaultZoom
            ? 'border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <Search className="h-3.5 w-3.5 shrink-0 opacity-75" />
        <span ref={toolbarPercentRef}>{zoomPercent}%</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Controlli zoom interfaccia"
          className="absolute right-0 z-50 mt-1.5 w-[232px] rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
            <span className="text-xs font-semibold text-slate-800">
              Zoom interfaccia
            </span>
            <span className="font-mono text-xs font-bold tabular-nums text-blue-800">
              {zoomPercent}%
            </span>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              disabled={zoom <= APP_ZOOM_MIN + 0.005}
              onClick={onZoomOut}
              title="Riduci zoom"
              aria-label="Riduci zoom"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={isDefaultZoom}
              onClick={onResetZoom}
              title="Ripristina zoom al 100%"
              className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <RotateCcw className="h-3 w-3" />
              <span>100%</span>
            </button>
            <button
              type="button"
              disabled={zoom >= APP_ZOOM_MAX - 0.005}
              onClick={onZoomIn}
              title="Aumenta zoom"
              aria-label="Aumenta zoom"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-3 gap-1">
            {APP_ZOOM_PRESETS.map((preset) => {
              const pct = Math.round(preset * 100);
              const active = Math.abs(zoom - preset) < 0.01;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onSetZoom(preset)}
                  className={`h-7 rounded border font-mono text-[11px] font-semibold tabular-nums transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {pct}%
                </button>
              );
            })}
          </div>

          {!isDefaultZoom && (
            <button
              type="button"
              onClick={() => {
                onSetZoom(APP_ZOOM_DEFAULT);
                setOpen(false);
              }}
              className="mt-2.5 w-full rounded-md border border-blue-200 bg-blue-50/70 py-1.5 text-center text-[11px] font-semibold text-blue-900 hover:bg-blue-100"
            >
              Ripristina 100%
            </button>
          )}

          <p className="mt-2 text-[10.5px] leading-snug text-slate-500">
            Usa <span className="font-mono font-medium text-slate-700">Ctrl + rotellina</span> o il pizzico a 2 dita nell&apos;area di lavoro.
          </p>
        </div>
      )}
    </div>
  );
}

export function ZoomToastBadge({
  zoomPercent,
  visible,
  containerRef,
  textRef,
}: {
  zoomPercent: number;
  visible: boolean;
  containerRef?: RefObject<HTMLDivElement | null>;
  textRef?: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div
      ref={containerRef}
      aria-live="polite"
      aria-hidden={!visible}
      className={`pointer-events-none fixed right-4 bottom-4 z-40 rounded-md border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white shadow-lg transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span ref={textRef}>Zoom {zoomPercent}%</span>
    </div>
  );
}
