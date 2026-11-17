import { Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Plate } from '../types/gradebook';

interface PlateModalProps {
  open: boolean;
  plate: Plate | null; // null = create mode
  nextNumber: number;
  onSave: (data: Omit<Plate, 'id'>) => void;
  onDelete?: (plate: Plate) => void;
  onClose: () => void;
}

export function PlateModal({
  open,
  plate,
  nextNumber,
  onSave,
  onDelete,
  onClose,
}: PlateModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [number, setNumber] = useState(nextNumber);
  const [title, setTitle] = useState('');
  const [assignedDate, setAssignedDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (plate) {
      setNumber(plate.number);
      setTitle(plate.title);
      setAssignedDate(plate.assignedDate);
      setDueDate(plate.dueDate);
      setNotes(plate.notes);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      setNumber(nextNumber);
      setTitle('');
      setAssignedDate(today);
      setDueDate('');
      setNotes('');
    }
    setError('');
  }, [open, plate, nextNumber]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const saveAndMaybeContinue = (keepOpen: boolean) => {
    if (!title.trim()) {
      setError('Inserisci un titolo per la tavola.');
      return;
    }
    if (!Number.isFinite(number) || number < 1) {
      setError('Il numero progressivo deve essere almeno 1.');
      return;
    }
    const savedNumber = Math.floor(number);
    onSave({
      number: savedNumber,
      title: title.trim(),
      assignedDate,
      dueDate,
      notes: notes.trim(),
    });
    if (keepOpen) {
      setNumber(savedNumber + 1);
      setTitle('');
      setNotes('');
      setError('');
      window.setTimeout(() => titleInputRef.current?.focus(), 0);
    } else {
      onClose();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveAndMaybeContinue(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plate-modal-title"
    >
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2
            id="plate-modal-title"
            className="font-display text-base font-semibold text-slate-900"
          >
            {plate ? `Modifica Tavola ${plate.number}` : 'Nuova tavola di disegno'}
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

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                N° progressivo
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={number}
                onChange={(e) => setNumber(Number(e.target.value))}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-700">
                Titolo della tavola *
              </label>
              <input
                ref={titleInputRef}
                type="text"
                autoFocus
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setError('');
                }}
                placeholder="es. Proiezioni ortogonali di una piramide"
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Data assegnazione / inizio
              </label>
              <input
                type="date"
                value={assignedDate}
                onChange={(e) => setAssignedDate(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Data prevista controllo / consegna
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Annotazioni del docente
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Indicazioni tecniche, strumenti richiesti o note di correzione..."
              className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            {plate && onDelete ? (
              <button
                type="button"
                onClick={() => onDelete(plate)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 whitespace-nowrap"
              >
                <Trash2 className="h-4 w-4" />
                Elimina tavola
              </button>
            ) : (
              <span />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annulla
              </button>
              {!plate && (
                <button
                  type="button"
                  onClick={() => saveAndMaybeContinue(true)}
                  className="min-h-10 rounded-md border border-blue-300 bg-blue-50 px-3.5 py-2 text-sm font-medium text-blue-900 hover:bg-blue-100 whitespace-nowrap"
                >
                  Salva e nuova
                </button>
              )}
              <button
                type="submit"
                className="min-h-10 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 whitespace-nowrap"
              >
                {plate ? 'Salva modifiche' : 'Aggiungi tavola'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
