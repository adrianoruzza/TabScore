import { CheckCircle2, Lock, Trash2, Unlock, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ClassData, FolderDelivery } from '../types/gradebook';
import { formatPlateInterval, sortPlates } from '../utils/calculations';

interface FolderConfigModalProps {
  open: boolean;
  classData: ClassData;
  folder: FolderDelivery | null;
  onSave: (data: Omit<FolderDelivery, 'id'>) => void;
  onDelete?: (folder: FolderDelivery) => void;
  onConfirmAll?: (folderId: string) => void;
  onReopenAll?: (folderId: string) => void;
  onClose: () => void;
}

export function FolderConfigModal({
  open,
  classData,
  folder,
  onSave,
  onDelete,
  onConfirmAll,
  onReopenAll,
  onClose,
}: FolderConfigModalProps) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selectedPlateIds, setSelectedPlateIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const sortedPlates = useMemo(
    () => sortPlates(classData.plates),
    [classData.plates]
  );

  // Plates already included in other folders
  const platesInOtherFolders = useMemo(() => {
    const set = new Set<string>();
    classData.folders.forEach((f) => {
      if (!folder || f.id !== folder.id) {
        f.plateIds.forEach((id) => set.add(id));
      }
    });
    return set;
  }, [classData.folders, folder]);

  useEffect(() => {
    if (!open) return;
    if (folder) {
      setTitle(folder.title);
      setDueDate(folder.dueDate);
      setSelectedPlateIds(folder.plateIds);
      setNotes(folder.notes);
    } else {
      const nextIdx = classData.folders.length + 1;
      const unassigned = sortedPlates
        .filter((p) => !platesInOtherFolders.has(p.id))
        .slice(0, classData.settings.defaultPlatesPerFolder)
        .map((p) => p.id);
      setTitle(`Cartellina ${nextIdx}`);
      setDueDate(new Date().toISOString().slice(0, 10));
      setSelectedPlateIds(unassigned);
      setNotes('');
    }
    setError('');
  }, [open, folder, classData, sortedPlates, platesInOtherFolders]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const togglePlate = (plateId: string) => {
    setSelectedPlateIds((prev) =>
      prev.includes(plateId)
        ? prev.filter((id) => id !== plateId)
        : [...prev, plateId]
    );
  };

  const selectNextBatch = () => {
    const count = Math.max(1, classData.settings.defaultPlatesPerFolder || 10);
    const unassigned = sortedPlates
      .filter((p) => !platesInOtherFolders.has(p.id))
      .slice(0, count)
      .map((p) => p.id);
    setSelectedPlateIds(unassigned);
  };

  const selectAllPlates = () => {
    setSelectedPlateIds(sortedPlates.map((p) => p.id));
  };

  const confirmedCount = folder
    ? classData.students.filter(
        (s) => Boolean(classData.folderRecords[s.id]?.[folder.id]?.confirmedSnapshot)
      ).length
    : 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Inserisci un titolo per la consegna della cartellina.');
      return;
    }
    onSave({
      title: title.trim(),
      dueDate,
      plateIds: selectedPlateIds,
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2
            id="folder-modal-title"
            className="font-display text-base font-semibold text-slate-900"
          >
            {folder ? `Configura ${folder.title}` : 'Nuova consegna cartellina'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Titolo consegna *
              </label>
              <input
                type="text"
                autoFocus
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setError('');
                }}
                placeholder="es. Cartellina 1"
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Data prevista consegna
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Plate Selection */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Tavole incluse nel periodo
                </label>
                <div className="text-xs font-medium text-blue-700">
                  {formatPlateInterval(selectedPlateIds, classData.plates)} (
                  {selectedPlateIds.length} selezionate)
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectNextBatch}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Prossime {classData.settings.defaultPlatesPerFolder} non assegnate
                </button>
                <button
                  type="button"
                  onClick={selectAllPlates}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Tutte
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPlateIds([])}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Nessuna
                </button>
              </div>
            </div>

            <div className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/40">
              {sortedPlates.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-slate-500">
                  Nessuna tavola presente nella classe. Puoi comunque creare la cartellina e associare le tavole in seguito.
                </div>
              ) : (
                sortedPlates.map((p) => {
                  const checked = selectedPlateIds.includes(p.id);
                  const inOther = platesInOtherFolders.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-sm hover:bg-slate-100/70"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePlate(p.id)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-700"
                        />
                        <span className="font-mono text-xs font-semibold text-slate-700">
                          T{p.number}
                        </span>
                        <span className="truncate text-slate-800">{p.title}</span>
                      </div>
                      {inOther && (
                        <span className="shrink-0 text-[11px] text-slate-400">
                          già in altra cartellina
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Note generali sulla consegna
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Es. Controllo quaderno e copertina inclusi..."
              className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Class-wide confirmation lock controls */}
          {folder && classData.students.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <Lock className="h-3.5 w-3.5 text-blue-700" />
                    Stato conferma valutazioni ({confirmedCount}/{classData.students.length} studenti)
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    Le valutazioni confermate non vengono alterate da modifiche future alle impostazioni di valutazione.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {confirmedCount < classData.students.length && onConfirmAll && (
                    <button
                      type="button"
                      onClick={() => onConfirmAll(folder.id)}
                      className="inline-flex items-center gap-1.5 rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Conferma tutta la classe
                    </button>
                  )}
                  {confirmedCount > 0 && onReopenAll && (
                    <button
                      type="button"
                      onClick={() => onReopenAll(folder.id)}
                      className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                    >
                      <Unlock className="h-3.5 w-3.5" />
                      Riapri tutte
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            {folder && onDelete ? (
              <button
                type="button"
                onClick={() => onDelete(folder)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 whitespace-nowrap"
              >
                <Trash2 className="h-4 w-4" />
                Elimina cartellina
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2.5">
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
                {folder ? 'Salva modifiche' : 'Crea cartellina'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
