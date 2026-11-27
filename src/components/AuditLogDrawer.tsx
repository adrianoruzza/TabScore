import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AuditCategory, AuditLogEntry } from '../types/gradebook';
import { loadUiSession, updateUiSession } from '../utils/uiSessionState';

interface AuditLogDrawerProps {
  open: boolean;
  entries: AuditLogEntry[];
  activeClassId: string | null;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<AuditCategory | 'all', string> = {
  all: 'Tutte le operazioni',
  valutazione: 'Valutazioni',
  cartellina: 'Cartelline',
  tavola: 'Tavole',
  studente: 'Studenti',
  classe: 'Classi',
  impostazioni: 'Impostazioni',
  archivio: 'Archivio & Export',
};

export function AuditLogDrawer({
  open,
  entries,
  activeClassId,
  onClose,
}: AuditLogDrawerProps) {
  const [category, setCategory] = useState<AuditCategory | 'all'>(
    () => loadUiSession().auditFilter.category
  );
  const [onlyActiveClass, setOnlyActiveClass] = useState<boolean>(
    () => loadUiSession().auditFilter.onlyActiveClass
  );
  const [query, setQuery] = useState('');

  useEffect(() => {
    updateUiSession(
      (prev) =>
        prev.auditFilter.category === category &&
        prev.auditFilter.onlyActiveClass === onlyActiveClass
          ? prev
          : {
              ...prev,
              auditFilter: { category, onlyActiveClass },
            },
      { immediate: true }
    );
  }, [category, onlyActiveClass]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (onlyActiveClass && activeClassId && item.classId !== activeClassId) {
        return false;
      }
      if (q) {
        const hay = `${item.action} ${item.details} ${item.className}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, category, onlyActiveClass, activeClassId, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Cronologia operazioni"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Cronologia operazioni
            </h2>
            <p className="text-xs text-slate-500">
              Registro cronologico automatico di tutte le modifiche ({entries.length} eventi)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="space-y-3 border-b border-slate-200 bg-slate-50 px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca nella cronologia..."
                className="h-9 w-full rounded-md border border-slate-300 bg-white pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as AuditCategory | 'all')
              }
              className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
            >
              {(Object.keys(CATEGORY_LABELS) as (AuditCategory | 'all')[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {CATEGORY_LABELS[key]}
                  </option>
                )
              )}
            </select>
          </div>

          {activeClassId && (
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={onlyActiveClass}
                onChange={(e) => setOnlyActiveClass(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
              />
              <span>Mostra solo operazioni della classe attualmente aperta</span>
            </label>
          )}
        </div>

        {/* Log entries */}
        <div className="flex-1 divide-y divide-slate-100 overflow-y-auto px-6">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Nessuna operazione registrata con i filtri selezionati.
            </div>
          ) : (
            filtered.map((entry) => {
              const dt = new Date(entry.timestamp);
              const dateStr = dt.toLocaleDateString('it-IT', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              });
              const timeStr = dt.toLocaleTimeString('it-IT', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              return (
                <div key={entry.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {entry.action}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
                      {dateStr} · {timeStr}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                    {entry.details}
                  </p>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {entry.className} · {CATEGORY_LABELS[entry.category]}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
