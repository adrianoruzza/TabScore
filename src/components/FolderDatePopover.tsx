import { Lock, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FolderDeliveryStatus } from '../types/gradebook';
import { FOLDER_STATUS_META, formatShortMonthDateIt } from '../utils/calculations';

interface FolderDatePopoverProps {
  anchorRect: DOMRect;
  studentName: string;
  folderTitle: string;
  dueDate: string;
  actualDeliveryDate: string;
  manualDelayDays: number;
  status: FolderDeliveryStatus;
  isLocked: boolean;
  onUpdate: (patch: {
    actualDeliveryDate?: string;
    manualDelayDays?: number;
    status?: FolderDeliveryStatus;
  }) => void;
  onOpenDetail: () => void;
  onClose: () => void;
}

export function FolderDatePopover({
  anchorRect,
  studentName,
  folderTitle,
  dueDate,
  actualDeliveryDate,
  manualDelayDays,
  status,
  isLocked,
  onUpdate,
  onOpenDetail,
  onClose,
}: FolderDatePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
  });

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
  }, [anchorRect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-50 w-[280px] rounded-lg border border-slate-300 bg-white p-3.5 shadow-2xl"
      role="dialog"
      aria-label={`Consegna ${folderTitle} per ${studentName}`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-900">
            {studentName}
          </div>
          <div className="truncate text-[11px] text-slate-500">
            {folderTitle} · Prevista:{' '}
            {dueDate ? formatShortMonthDateIt(dueDate) : '—'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Chiudi"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {isLocked ? (
        <div className="mt-3 flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs text-blue-900">
          <Lock className="h-3.5 w-3.5 shrink-0 text-blue-700" />
          <span>Valutazione confermata e bloccata.</span>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-medium text-slate-600">
                Data effettiva di consegna
              </label>
              <button
                type="button"
                onClick={() => {
                  const today = new Date().toISOString().slice(0, 10);
                  onUpdate({
                    actualDeliveryDate: today,
                    status: status === 'da_consegnare' ? 'consegnata' : status,
                  });
                }}
                className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 hover:bg-blue-100"
              >
                Oggi
              </button>
            </div>
            <input
              type="date"
              value={actualDeliveryDate}
              onChange={(e) => {
                const nextDate = e.target.value;
                onUpdate({
                  actualDeliveryDate: nextDate,
                  status:
                    nextDate && status === 'da_consegnare'
                      ? 'consegnata'
                      : status,
                });
              }}
              className="mt-1 h-9 w-full rounded border border-slate-300 px-2.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600">
              Giorni di ritardo (0–10)
            </label>
            <select
              value={Math.min(10, Math.max(0, Math.floor(manualDelayDays || 0)))}
              onChange={(e) => {
                const days = Number(e.target.value);
                onUpdate({
                  manualDelayDays: days,
                  status:
                    days > 0 && (status === 'da_consegnare' || status === 'consegnata')
                      ? 'consegnata_ritardo'
                      : days === 0 && status === 'consegnata_ritardo' && actualDeliveryDate
                      ? 'consegnata'
                      : status,
                });
              }}
              className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              <option value={0}>0 giorni (consegna puntuale)</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '1 giorno di ritardo' : `${d} giorni di ritardo`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600">
              Stato consegna
            </label>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {Object.values(FOLDER_STATUS_META).map((opt) => {
                const active = status === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdate({ status: opt.value })}
                    className={`rounded border px-2 py-1.5 text-left text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50 font-semibold text-blue-900 ring-1 ring-blue-600/30'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2.5">
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenDetail();
          }}
          className="text-xs font-medium text-blue-700 hover:underline"
        >
          Dettaglio calcoli →
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
        >
          Chiudi
        </button>
      </div>
    </div>
  );
}
