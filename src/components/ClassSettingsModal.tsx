import { Info, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  ClassData,
  ClassSettings,
  RoundingMode,
} from '../types/gradebook';
import { ROUNDING_MODE_LABELS } from '../utils/calculations';

interface ClassSettingsModalProps {
  open: boolean;
  classData: ClassData;
  onSave: (settings: ClassSettings) => void;
  onClose: () => void;
}

export function ClassSettingsModal({
  open,
  classData,
  onSave,
  onClose,
}: ClassSettingsModalProps) {
  const [penaltyNo, setPenaltyNo] = useState('0.20');
  const [penaltyMissing, setPenaltyMissing] = useState('0.50');
  const [penaltyLatePerDay, setPenaltyLatePerDay] = useState('0.10');
  const [toleranceDays, setToleranceDays] = useState('0');
  const [defaultPlatesPerFolder, setDefaultPlatesPerFolder] = useState('10');
  const [roundingMode, setRoundingMode] = useState<RoundingMode>('quarter');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const s = classData.settings;
    setPenaltyNo(String(s.penaltyNo));
    setPenaltyMissing(String(s.penaltyMissing));
    setPenaltyLatePerDay(String(s.penaltyLatePerDay));
    setToleranceDays(String(s.toleranceDays));
    setDefaultPlatesPerFolder(String(s.defaultPlatesPerFolder));
    setRoundingMode(s.roundingMode);
    setError('');
  }, [open, classData]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const parseNum = (val: string) => Number(val.replace(',', '.'));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const pNo = parseNum(penaltyNo);
    const pMissing = parseNum(penaltyMissing);
    const pLate = parseNum(penaltyLatePerDay);
    const tol = Math.floor(parseNum(toleranceDays));
    const defPlates = Math.floor(parseNum(defaultPlatesPerFolder));

    if (
      [pNo, pMissing, pLate, tol, defPlates].some(
        (n) => Number.isNaN(n) || n < 0
      ) ||
      defPlates < 1
    ) {
      setError(
        'Controlla i valori inseriti: le penalità e la tolleranza devono essere ≥ 0; il numero di tavole per cartellina ≥ 1.'
      );
      return;
    }

    onSave({
      penaltyNo: Math.round(pNo * 100) / 100,
      penaltyMissing: Math.round(pMissing * 100) / 100,
      penaltyLatePerDay: Math.round(pLate * 100) / 100,
      toleranceDays: tol,
      defaultPlatesPerFolder: defPlates,
      roundingMode,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2
              id="settings-modal-title"
              className="font-display text-base font-semibold text-slate-900"
            >
              Impostazioni valutazione · {classData.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
          <div className="flex items-start gap-2.5 rounded-md border border-blue-200 bg-blue-50/70 px-3.5 py-2.5 text-xs text-blue-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
            <span>
              I parametri si applicano a tutti gli studenti della classe. Le valutazioni delle cartelline già <strong>concluse e confermate</strong> rimarranno invariate.
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Penalità per ogni NO (punti)
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                value={penaltyNo}
                onChange={(e) => setPenaltyNo(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Applicata per ogni tavola contrassegnata NO (anche se consegnata successivamente).
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Penalità per tavola mancante finale (punti)
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                value={penaltyMissing}
                onChange={(e) => setPenaltyMissing(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Aggiuntiva per ogni tavola ancora non consegnata nella cartellina.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Penalità per giorno di ritardo cartellina
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                value={penaltyLatePerDay}
                onChange={(e) => setPenaltyLatePerDay(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Giorni di tolleranza sul ritardo
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={toleranceDays}
                onChange={(e) => setToleranceDays(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Tavole indicative per cartellina
              </label>
              <input
                type="number"
                step="1"
                min="1"
                value={defaultPlatesPerFolder}
                onChange={(e) => setDefaultPlatesPerFolder(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Arrotondamento voto indicativo
              </label>
              <select
                value={roundingMode}
                onChange={(e) => setRoundingMode(e.target.value as RoundingMode)}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {(Object.keys(ROUNDING_MODE_LABELS) as RoundingMode[]).map(
                  (mode) => (
                    <option key={mode} value={mode}>
                      {ROUNDING_MODE_LABELS[mode]}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Annulla
            </button>
            <button
              type="submit"
              className="min-h-10 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              Salva impostazioni
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
