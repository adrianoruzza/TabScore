import { ArrowLeft, Eraser, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDecimalIt, formatGradeLabel } from '../utils/calculations';

interface RapidGradePickerProps {
  currentGrade: number | null;
  onSelect: (grade: number | null) => void;
  onCancel: () => void;
  suggestedGrade?: number | null;
  onOpenDetail?: () => void;
}

interface FractionOption {
  value: number;
  label: string;
  subLabel: string;
}

const INTEGERS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const LONG_PRESS_MS = 220;

function getFractionOptionsForBase(base: number): FractionOption[] {
  if (base >= 10) {
    return [
      { value: 9.75, label: '9,75', subLabel: '10-' },
      { value: 10, label: '10', subLabel: '' },
    ];
  }
  return [
    { value: base, label: String(base), subLabel: '' },
    {
      value: base + 0.25,
      label: `${base}+`,
      subLabel: formatDecimalIt(base + 0.25, 2),
    },
    {
      value: base + 0.5,
      label: `${base}½`,
      subLabel: formatDecimalIt(base + 0.5, 2),
    },
    {
      value: base + 0.75,
      label: formatDecimalIt(base + 0.75, 2),
      subLabel: `${base + 1}-`,
    },
    { value: base + 1, label: String(base + 1), subLabel: '' },
  ];
}

export function RapidGradePicker({
  currentGrade,
  onSelect,
  onCancel,
  suggestedGrade,
  onOpenDetail,
}: RapidGradePickerProps) {
  const [expandedBase, setExpandedBase] = useState<number | null>(null);
  const [hoveredFraction, setHoveredFraction] = useState<number | null>(null);

  const timerRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pressedBaseRef = useRef<number | null>(null);
  const hoveredFractionRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (
        activePointerIdRef.current !== e.pointerId ||
        !longPressTriggeredRef.current
      ) {
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const btn = el?.closest('[data-fraction-val]') as HTMLElement | null;
      if (btn) {
        const val = Number(btn.getAttribute('data-fraction-val'));
        if (!Number.isNaN(val)) {
          hoveredFractionRef.current = val;
          setHoveredFraction(val);
          return;
        }
      }
      hoveredFractionRef.current = null;
      setHoveredFraction(null);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      clearTimer();

      const wasLongPress = longPressTriggeredRef.current;
      const base = pressedBaseRef.current;
      const hoveredVal = hoveredFractionRef.current;

      activePointerIdRef.current = null;
      pressedBaseRef.current = null;
      hoveredFractionRef.current = null;
      setHoveredFraction(null);

      if (!wasLongPress && base !== null) {
        // Quick tap/click -> select integer immediately
        onSelect(base);
        return;
      }

      if (wasLongPress && hoveredVal !== null) {
        // Dragged onto a fraction during long press -> select immediately
        onSelect(hoveredVal);
      }
      // Otherwise keep the expanded intermediate bar open for a direct tap
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      clearTimer();
      activePointerIdRef.current = null;
      pressedBaseRef.current = null;
      hoveredFractionRef.current = null;
      setHoveredFraction(null);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [onSelect]);

  const handleIntegerPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    intVal: number
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    clearTimer();

    activePointerIdRef.current = e.pointerId;
    pressedBaseRef.current = intVal;
    longPressTriggeredRef.current = false;
    hoveredFractionRef.current = null;
    setHoveredFraction(null);

    timerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setExpandedBase(intVal);
    }, LONG_PRESS_MS);
  };

  const fractionOptions =
    expandedBase !== null ? getFractionOptionsForBase(expandedBase) : [];

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      style={{
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        userSelect: 'none',
      }}
      className="select-none"
    >
      {/* Optional Cartellina helper row */}
      {(suggestedGrade !== undefined || onOpenDetail) && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50/70 px-2.5 py-1.5 text-[11px]">
          {suggestedGrade !== undefined && suggestedGrade !== null ? (
            <button
              type="button"
              onClick={() => onSelect(suggestedGrade)}
              className="font-medium text-blue-800 hover:underline"
            >
              Applica calcolato ({formatGradeLabel(suggestedGrade)})
            </button>
          ) : (
            <span className="text-slate-500">Voto manuale</span>
          )}
          {onOpenDetail && (
            <button
              type="button"
              onClick={onOpenDetail}
              className="font-semibold text-blue-800 hover:underline"
            >
              Dettaglio →
            </button>
          )}
        </div>
      )}

      {expandedBase === null ? (
        <>
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-700">
              Voto rapido{' '}
              <span className="font-mono font-normal text-slate-500">
                (attuale: {formatGradeLabel(currentGrade)})
              </span>
            </span>
          </div>

          {/* 3x3 integer grid (2..10) */}
          <div className="grid grid-cols-3 gap-1.5">
            {INTEGERS.map((num) => {
              const isSelected =
                currentGrade !== null && Math.abs(currentGrade - num) < 0.001;
              return (
                <button
                  key={num}
                  type="button"
                  onPointerDown={(e) => handleIntegerPointerDown(e, num)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(num);
                    }
                  }}
                  className={`flex h-11 touch-none items-center justify-center rounded-md border font-mono text-base font-semibold tabular-nums transition-colors ${
                    isSelected
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-sky-200 bg-sky-50 text-slate-900 hover:border-sky-400 hover:bg-sky-100 active:bg-sky-200'
                  }`}
                >
                  {num}
                </button>
              );
            })}
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            Tocca un voto intero oppure <strong>tieni premuto</strong> per i voti intermedi (+, ½, ,75).
          </p>
        </>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setExpandedBase(null)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Tutti gli interi
            </button>
            <span className="font-mono text-xs font-semibold text-blue-800">
              Intervallo {expandedBase}–{Math.min(10, expandedBase + 1)}
            </span>
          </div>

          <div
            className={`grid gap-1.5 ${
              fractionOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-5'
            }`}
          >
            {fractionOptions.map((opt) => {
              const isSelected =
                currentGrade !== null &&
                Math.abs(currentGrade - opt.value) < 0.001;
              const isHovered = hoveredFraction === opt.value;

              return (
                <button
                  key={opt.value}
                  type="button"
                  data-fraction-val={opt.value}
                  onClick={() => onSelect(opt.value)}
                  className={`flex min-h-[52px] flex-col items-center justify-center rounded-md border px-1 py-1.5 font-mono tabular-nums transition-colors ${
                    isHovered || isSelected
                      ? 'border-blue-700 bg-blue-700 text-white ring-2 ring-blue-300'
                      : 'border-sky-200 bg-sky-50 text-slate-900 hover:border-sky-400 hover:bg-sky-100'
                  }`}
                >
                  <span className="text-sm font-bold leading-none">
                    {opt.label}
                  </span>
                  {opt.subLabel && (
                    <span
                      className={`mt-1 text-[10px] leading-none ${
                        isHovered || isSelected
                          ? 'text-blue-100'
                          : 'text-slate-500'
                      }`}
                    >
                      ({opt.subLabel})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer: Clear grade / Cancel */}
      <div className="mt-2.5 flex items-center justify-between border-t border-slate-200 pt-2">
        {currentGrade !== null ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
          >
            <Eraser className="h-3.5 w-3.5" />
            Rimuovi voto
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <X className="h-3.5 w-3.5" />
          Annulla
        </button>
      </div>
    </div>
  );
}
