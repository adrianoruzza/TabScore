import { Eraser, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDecimalIt, formatGradeLabel } from '../utils/calculations';
import { getGradeColorStyle } from '../utils/gradeColors';

interface RapidGradePickerProps {
  currentGrade: number | null;
  onSelect: (grade: number | null) => void;
  onCancel: () => void;
  suggestedGrade?: number | null;
  onOpenDetail?: () => void;
}

export interface IntermediateGradeOption {
  value: number;
  label: string;
  decimalLabel: string;
}

const INTEGERS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const LONG_PRESS_MS = 240;

/**
 * Returns the contextual intermediate grade variants around an integer N (2..10):
 * N- (N - 0.25), N, N+ (N + 0.25), N ½ (N + 0.5), respecting the [2, 10] scale bounds.
 */
export function getIntermediateGradeOptions(
  base: number
): IntermediateGradeOption[] {
  const candidates: IntermediateGradeOption[] = [
    {
      value: base - 0.25,
      label: `${base}-`,
      decimalLabel: formatDecimalIt(base - 0.25, 2),
    },
    {
      value: base,
      label: String(base),
      decimalLabel: String(base),
    },
    {
      value: base + 0.25,
      label: `${base}+`,
      decimalLabel: formatDecimalIt(base + 0.25, 2),
    },
    {
      value: base + 0.5,
      label: `${base} ½`,
      decimalLabel: formatDecimalIt(base + 0.5, 2),
    },
  ];

  return candidates.filter((opt) => opt.value >= 2 && opt.value <= 10);
}

export function RapidGradePicker({
  currentGrade,
  onSelect,
  onCancel,
  suggestedGrade,
  onOpenDetail,
}: RapidGradePickerProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    base: number;
    rowIndex: number;
    colIndex: number;
  } | null>(null);
  const [hoveredVariant, setHoveredVariant] = useState<number | null>(null);

  const timerRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pressedBaseRef = useRef<number | null>(null);
  const hoveredVariantRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  // Close contextual menu on Escape or click outside the menu
  useEffect(() => {
    if (!contextMenu) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setContextMenu(null);
        setHoveredVariant(null);
      }
    };

    const handlePointerDownOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (contextMenuRef.current?.contains(target)) return;
      if (target?.closest('[data-integer-grade-btn]')) return;
      setContextMenu(null);
      setHoveredVariant(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDownOutside);
    };
  }, [contextMenu]);

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
          hoveredVariantRef.current = val;
          setHoveredVariant(val);
          return;
        }
      }
      hoveredVariantRef.current = null;
      setHoveredVariant(null);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      clearTimer();

      const wasLongPress = longPressTriggeredRef.current;
      const base = pressedBaseRef.current;
      const hoveredVal = hoveredVariantRef.current;

      activePointerIdRef.current = null;
      pressedBaseRef.current = null;
      hoveredVariantRef.current = null;
      setHoveredVariant(null);

      if (!wasLongPress && base !== null) {
        // Short click/tap -> immediately assign integer grade
        setContextMenu(null);
        onSelect(base);
        return;
      }

      if (wasLongPress && hoveredVal !== null) {
        // Long press + drag onto variant + release -> immediately assign variant
        setContextMenu(null);
        onSelect(hoveredVal);
      }
      // Otherwise keep contextual menu open so user can tap/click a variant
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      clearTimer();
      activePointerIdRef.current = null;
      pressedBaseRef.current = null;
      hoveredVariantRef.current = null;
      setHoveredVariant(null);
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
    intVal: number,
    index: number
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    clearTimer();

    const rowIndex = Math.floor(index / 3);
    const colIndex = index % 3;

    activePointerIdRef.current = e.pointerId;
    pressedBaseRef.current = intVal;
    longPressTriggeredRef.current = false;
    hoveredVariantRef.current = null;
    setHoveredVariant(null);

    timerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setContextMenu({ base: intVal, rowIndex, colIndex });
    }, LONG_PRESS_MS);
  };

  const contextOptions = contextMenu
    ? getIntermediateGradeOptions(contextMenu.base)
    : [];

  // Position contextual menu directly above rows 1 & 2 (5..10) and directly below row 0 (2..4)
  // so it always stays near the pressed grade and never clips outside the picker.
  const menuPositionClass = contextMenu
    ? contextMenu.rowIndex === 0
      ? 'top-[52px]'
      : contextMenu.rowIndex === 1
      ? 'top-[-4px]'
      : 'top-[46px]'
    : '';

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

      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-slate-700">
          Voto rapido{' '}
          <span className="font-mono font-normal text-slate-500">
            (attuale: {formatGradeLabel(currentGrade)})
          </span>
        </span>
        {contextMenu && (
          <button
            type="button"
            onClick={() => setContextMenu(null)}
            className="rounded px-1.5 py-0.5 text-[10.5px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            Chiudi varianti
          </button>
        )}
      </div>

      {/* 3x3 integer grid (2..10) with anchored contextual intermediate menu */}
      <div ref={gridRef} className="relative">
        <div className="grid grid-cols-3 gap-1.5">
          {INTEGERS.map((num, idx) => {
            const isSelected =
              currentGrade !== null && Math.abs(currentGrade - num) < 0.001;
            const isContextOwner = contextMenu?.base === num;
            return (
              <button
                key={num}
                type="button"
                data-integer-grade-btn={num}
                onPointerDown={(e) => handleIntegerPointerDown(e, num, idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(num);
                  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    setContextMenu({
                      base: num,
                      rowIndex: Math.floor(idx / 3),
                      colIndex: idx % 3,
                    });
                  }
                }}
                style={getGradeColorStyle(num, { includeBorder: true })}
                className={`flex h-11 touch-none items-center justify-center rounded-md border font-mono text-base font-bold tabular-nums transition-all hover:brightness-95 active:brightness-90 ${
                  isContextOwner
                    ? 'ring-2 ring-slate-900 ring-offset-1 brightness-95'
                    : isSelected
                    ? 'ring-2 ring-blue-700 ring-offset-1'
                    : ''
                } ${
                  contextMenu && !isContextOwner ? 'opacity-55' : ''
                }`}
              >
                {num}
              </button>
            );
          })}
        </div>

        {/* Compact contextual menu anchored near the pressed integer */}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            data-rapid-context-menu="true"
            role="menu"
            aria-label={`Varianti voto ${contextMenu.base}`}
            className={`absolute right-0 left-0 z-30 rounded-lg border border-slate-300 bg-white/98 p-1.5 shadow-xl ring-1 ring-slate-900/10 backdrop-blur-[2px] ${menuPositionClass}`}
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="font-mono text-[10px] font-semibold text-slate-600">
                Varianti voto {contextMenu.base}
              </span>
              <span className="text-[10px] text-slate-400">
                Tocca o rilascia
              </span>
            </div>
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${contextOptions.length}, minmax(0, 1fr))`,
              }}
            >
              {contextOptions.map((opt) => {
                const isSelected =
                  currentGrade !== null &&
                  Math.abs(currentGrade - opt.value) < 0.001;
                const isHovered = hoveredVariant === opt.value;

                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitem"
                    data-fraction-val={opt.value}
                    onClick={() => {
                      setContextMenu(null);
                      onSelect(opt.value);
                    }}
                    style={getGradeColorStyle(opt.value, {
                      includeBorder: true,
                    })}
                    title={`${opt.label} (${opt.decimalLabel})`}
                    className={`flex min-h-[46px] flex-col items-center justify-center rounded-md border px-1 py-1 font-mono tabular-nums transition-all hover:brightness-95 ${
                      isHovered || isSelected
                        ? 'ring-2 ring-blue-700 ring-offset-1 brightness-95'
                        : ''
                    }`}
                  >
                    <span className="text-[14px] font-extrabold leading-none">
                      {opt.label}
                    </span>
                    <span className="mt-1 text-[9.5px] font-medium leading-none opacity-80">
                      {opt.decimalLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Clic/tocco rapido per l&apos;intero · <strong>Tieni premuto</strong> per{' '}
        <span className="font-mono">-</span>,{' '}
        <span className="font-mono">+</span>,{' '}
        <span className="font-mono">½</span>.
      </p>

      {/* Footer: Clear grade / Cancel */}
      <div className="mt-2.5 flex items-center justify-between border-t border-slate-200 pt-2">
        {currentGrade !== null ? (
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              onSelect(null);
            }}
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
