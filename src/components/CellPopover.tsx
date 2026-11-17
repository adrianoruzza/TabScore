import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlateEvaluation, PlateStatus } from '../types/gradebook';
import { STATUS_META } from '../utils/calculations';
import { RapidGradePicker } from './RapidGradePicker';

interface CellPopoverProps {
  mode: 'status' | 'grade';
  anchorRect: DOMRect;
  studentName: string;
  plateNumber: number;
  plateTitle: string;
  evaluation: PlateEvaluation;
  onChange: (patch: Partial<PlateEvaluation> & { explicitWasNo?: boolean }) => void;
  onClose: () => void;
}

const STATUS_ORDER: PlateStatus[] = ['SI', 'NO', 'ASS', 'WIP'];

export function CellPopover({
  mode,
  anchorRect,
  studentName,
  plateNumber,
  plateTitle,
  evaluation,
  onChange,
  onClose,
}: CellPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [activeMode, setActiveMode] = useState<'status' | 'grade'>(mode);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
  });

  useEffect(() => {
    setActiveMode(mode);
  }, [mode, anchorRect]);

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchorRect.left;
    if (left + rect.width > vw - 12) {
      left = Math.max(12, vw - rect.width - 12);
    }

    let top = anchorRect.bottom + 4;
    if (top + rect.height > vh - 12) {
      top = Math.max(12, anchorRect.top - rect.height - 4);
    }

    setPos({ top, left });
  }, [anchorRect, activeMode]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (activeMode === 'status') {
        const key = e.key.toLowerCase();
        if (key === 's') {
          onChange({ status: 'SI' });
          onClose();
        } else if (key === 'n') {
          onChange({ status: 'NO' });
          onClose();
        } else if (key === 'a') {
          onChange({ status: 'ASS' });
          onClose();
        } else if (key === 'w') {
          onChange({ status: 'WIP' });
          onClose();
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          onChange({ status: null });
          onClose();
        }
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeMode, onChange, onClose]);

  return (
    <div
      ref={popoverRef}
      style={{ top: pos.top, left: pos.left }}
      className={`fixed z-50 rounded-lg border border-slate-300 bg-white p-3 shadow-2xl ${
        activeMode === 'status' ? 'w-[276px]' : 'w-[304px]'
      }`}
      role="dialog"
      aria-label={`${activeMode === 'status' ? 'Stato' : 'Voto'} Tavola ${plateNumber} per ${studentName}`}
    >
      {/* Compact Header with direct mode switch */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-900">
            {studentName}
          </div>
          <div className="truncate text-[11px] text-slate-500">
            Tav. {plateNumber} · {plateTitle}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeMode === 'status' && (
            <button
              type="button"
              onClick={() => setActiveMode('grade')}
              className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-sky-900 hover:bg-sky-100 whitespace-nowrap"
              title="Passa subito all'inserimento voto senza chiudere"
            >
              Voto →
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {activeMode === 'status' ? (
        <div className="mt-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700">
              Seleziona stato
            </span>
            {evaluation.status !== null && (
              <button
                type="button"
                onClick={() => {
                  onChange({ status: null });
                  onClose();
                }}
                className="text-[11px] text-slate-500 hover:text-rose-600"
              >
                Svuota
              </button>
            )}
          </div>

          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {STATUS_ORDER.map((code) => {
              const meta = STATUS_META[code];
              const active = evaluation.status === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    onChange({ status: active ? null : code });
                    onClose();
                  }}
                  title={meta.label}
                  className={`flex h-10 items-center justify-center rounded border font-mono text-xs font-semibold transition-colors ${
                    active
                      ? `${meta.buttonClass} ring-2 ring-slate-900/25`
                      : `${meta.badgeClass} hover:brightness-95`
                  }`}
                >
                  {code}
                </button>
              );
            })}
          </div>

          <div className="mt-2 text-[10px] text-slate-400">
            Tasti rapidi: S (SI) · N (NO) · A (ASS) · W (WIP)
          </div>

          {evaluation.wasNo && evaluation.status === 'SI' && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 rounded border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-[11px] text-amber-900">
              <input
                type="checkbox"
                checked={evaluation.wasNo}
                onChange={(e) => onChange({ explicitWasNo: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-amber-400 text-blue-700"
              />
              <span>Penalità ex-NO attiva</span>
            </label>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {/* Quick inline status toggle directly inside grade popover (saves reopening ST cell) */}
          <div className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50/80 p-1">
            <span className="px-1 text-[10px] font-semibold text-slate-500">
              Stato
            </span>
            <div className="grid flex-1 grid-cols-4 gap-1">
              {STATUS_ORDER.map((code) => {
                const meta = STATUS_META[code];
                const active = evaluation.status === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() =>
                      onChange({ status: active ? null : code })
                    }
                    title={`${meta.label} (aggiorna senza chiudere)`}
                    className={`h-6 rounded border font-mono text-[10px] font-semibold transition-colors ${
                      active
                        ? `${meta.buttonClass} ring-1 ring-slate-900/25`
                        : `${meta.badgeClass} hover:brightness-95`
                    }`}
                  >
                    {code}
                  </button>
                );
              })}
            </div>
          </div>

          <RapidGradePicker
            currentGrade={evaluation.grade}
            onSelect={(grade) => {
              onChange({ grade });
              onClose();
            }}
            onCancel={onClose}
          />
        </div>
      )}
    </div>
  );
}
