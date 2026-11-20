import { Lock, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RapidGradePicker } from './RapidGradePicker';

interface FolderGradePopoverProps {
  anchorRect: DOMRect;
  studentName: string;
  folderTitle: string;
  currentGrade: number | null;
  suggestedGrade: number | null;
  isManualOverride?: boolean;
  isLocked: boolean;
  onSelectGrade: (grade: number | null) => void;
  onOpenDetail: () => void;
  onClose: () => void;
}

export function FolderGradePopover({
  anchorRect,
  studentName,
  folderTitle,
  currentGrade,
  suggestedGrade,
  isManualOverride = false,
  isLocked,
  onSelectGrade,
  onOpenDetail,
  onClose,
}: FolderGradePopoverProps) {
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

  const popoverNode = (
    <div
      ref={popoverRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-50 w-[308px] rounded-lg border border-slate-300 bg-white p-3 shadow-2xl"
      role="dialog"
      aria-label={`Voto finale ${folderTitle} per ${studentName}`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-900">
            {studentName}
          </div>
          <div className="truncate text-[11px] text-slate-500">
            {folderTitle} · {isManualOverride ? 'Voto finale (manuale)' : 'Voto finale (calcolato)'}
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
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs text-blue-900">
            <Lock className="h-3.5 w-3.5 shrink-0 text-blue-700" />
            <span>Valutazione confermata e bloccata.</span>
          </div>
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenDetail();
              }}
              className="text-xs font-semibold text-blue-700 hover:underline"
            >
              Apri dettaglio per riaprire →
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white"
            >
              Chiudi
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5">
          {isManualOverride && (
            <button
              type="button"
              onClick={() => {
                onSelectGrade(null);
                onClose();
              }}
              className="mb-2 w-full rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-left text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
            >
              Ripristina calcolo automatico post-penalità
            </button>
          )}
          <RapidGradePicker
            currentGrade={currentGrade}
            suggestedGrade={suggestedGrade}
            onOpenDetail={() => {
              onClose();
              onOpenDetail();
            }}
            onSelect={(grade) => {
              onSelectGrade(grade);
              onClose();
            }}
            onCancel={onClose}
          />
        </div>
      )}
    </div>
  );

  if (typeof document === 'undefined') return popoverNode;
  return createPortal(popoverNode, document.body);
}
