import { Check, CheckCircle2, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ClassData } from '../types/gradebook';
import {
  CLASS_COLOR_PALETTE,
  getClassColorOption,
  pickNextDistinctClassColorId,
} from '../utils/classColors';
import { StudentImportModal } from './StudentImportModal';

interface ClassManagerModalProps {
  open: boolean;
  classes: ClassData[];
  activeClassId: string | null;
  onSelectClass: (classId: string) => void;
  onCreateClass: (data: {
    name: string;
    schoolYear: string;
    color: string;
  }) => void;
  onUpdateClass: (
    classId: string,
    data: { name: string; schoolYear: string; color: string }
  ) => void;
  onDeleteClass: (cls: ClassData) => void;
  onImportStudents: (
    classId: string,
    students: Array<{ lastName: string; firstName: string }>,
    fileName?: string
  ) => void;
  onClose: () => void;
}

export function ClassManagerModal({
  open,
  classes,
  activeClassId,
  onSelectClass,
  onCreateClass,
  onUpdateClass,
  onDeleteClass,
  onImportStudents,
  onClose,
}: ClassManagerModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [schoolYear, setSchoolYear] = useState('2026/2027');
  const [color, setColor] = useState<string>(() =>
    pickNextDistinctClassColorId(classes.map((c) => c.color))
  );
  const [error, setError] = useState('');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importNotice, setImportNotice] = useState('');

  const selectedClass = classes.find((c) => c.id === activeClassId) ?? null;

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setName('');
    setSchoolYear('2026/2027');
    setColor(pickNextDistinctClassColorId(classes.map((c) => c.color)));
    setError('');
  }, [open, classes]);

  useEffect(() => {
    if (!open) {
      setImportModalOpen(false);
      setImportNotice('');
    }
  }, [open]);

  useEffect(() => {
    if (!open || importModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, importModalOpen, onClose]);

  if (!open) return null;

  const startEdit = (cls: ClassData, idx: number) => {
    setEditingId(cls.id);
    setName(cls.name);
    setSchoolYear(cls.schoolYear);
    setColor(getClassColorOption(cls.color, idx).id);
    setError('');
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setSchoolYear('2026/2027');
    setColor(pickNextDistinctClassColorId(classes.map((c) => c.color)));
    setError('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Inserisci il nome della classe (es. 1ª A).');
      return;
    }
    if (editingId) {
      onUpdateClass(editingId, { name, schoolYear, color });
      resetForm();
    } else {
      onCreateClass({ name, schoolYear, color });
      resetForm();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="class-manager-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2
            id="class-manager-title"
            className="font-display text-base font-semibold text-slate-900"
          >
            Gestione classi
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

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Existing classes list + Import students into currently selected class */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-600">
                Classi archiviate ({classes.length})
              </h3>
              <button
                type="button"
                disabled={!selectedClass}
                onClick={() => {
                  setImportNotice('');
                  setImportModalOpen(true);
                }}
                title={
                  selectedClass
                    ? `Importa elenco studenti in "${selectedClass.name}"`
                    : 'Seleziona una classe per importare gli studenti'
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                Importa studenti
                {selectedClass ? ` (${selectedClass.name})` : ''}
              </button>
            </div>
            {importNotice && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{importNotice}</span>
              </div>
            )}
            <div className="mt-2 divide-y divide-slate-200 rounded-md border border-slate-200">
              {classes.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">
                  Nessuna classe presente. Crea la prima classe qui sotto.
                </div>
              ) : (
                classes.map((cls, idx) => {
                  const isActive = cls.id === activeClassId;
                  const colorTheme = getClassColorOption(cls.color, idx);
                  return (
                    <div
                      key={cls.id}
                      style={
                        isActive
                          ? { backgroundColor: colorTheme.softBg }
                          : undefined
                      }
                      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                        isActive ? '' : 'bg-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectClass(cls.id);
                          onClose();
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            style={{ backgroundColor: colorTheme.accent }}
                            className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm"
                          />
                          <span className="font-semibold text-slate-900">
                            {cls.name}
                          </span>
                          {isActive && (
                            <span
                              style={{ color: colorTheme.text }}
                              className="inline-flex items-center gap-1 text-xs font-medium"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Aperta
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 pl-6 text-xs text-slate-500">
                          {cls.schoolYear} · {cls.students.length} studenti ·{' '}
                          {cls.plates.length} tavole
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(cls, idx)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Modifica
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteClass(cls)}
                          className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Elimina
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Create / Edit form */}
          <form
            onSubmit={handleSubmit}
            className="space-y-4 border-t border-slate-200 pt-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingId ? 'Modifica classe selezionata' : 'Crea nuova classe'}
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  Annulla modifica
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">
                  Nome classe *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError('');
                  }}
                  placeholder="es. 3ª C — Disegno Tecnico"
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Anno scolastico
                </label>
                <input
                  type="text"
                  value={schoolYear}
                  onChange={(e) => setSchoolYear(e.target.value)}
                  placeholder="2026/2027"
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Distinct class color palette */}
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label className="block text-xs font-medium text-slate-700">
                  Colore identificativo classe
                </label>
                <span className="text-[11px] text-slate-500">
                  {getClassColorOption(color).label}
                </span>
              </div>
              <div
                className="mt-2 flex flex-wrap items-center gap-2"
                role="radiogroup"
                aria-label="Colore identificativo classe"
              >
                {CLASS_COLOR_PALETTE.map((opt) => {
                  const selected = color === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={opt.label}
                      title={opt.label}
                      onClick={() => setColor(opt.id)}
                      style={{
                        backgroundColor: opt.softBg,
                        borderColor: selected ? opt.accent : opt.border,
                        color: opt.text,
                      }}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        selected ? 'ring-2 ring-offset-1 ring-slate-800/35 font-semibold' : 'hover:brightness-97'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: opt.accent }}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-white"
                      >
                        {selected && <Check className="h-3 w-3 stroke-[2.5]" />}
                      </span>
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                {editingId ? 'Salva modifiche classe' : 'Crea e apri classe'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <StudentImportModal
        open={importModalOpen}
        targetClass={selectedClass}
        onImport={(students, fileName) => {
          if (!selectedClass) return;
          onImportStudents(selectedClass.id, students, fileName);
          setImportNotice(
            `Importati ${students.length} ${
              students.length === 1 ? 'studente' : 'studenti'
            } nella classe "${selectedClass.name}".`
          );
        }}
        onClose={() => setImportModalOpen(false)}
      />
    </div>
  );
}
