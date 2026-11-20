import { ArrowRightLeft, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Student, StudentSupportTag } from '../types/gradebook';
import { formatDateIt, formatGradeLabel } from '../utils/calculations';

const SUPPORT_OPTIONS: {
  id: StudentSupportTag;
  label: string;
  description: string;
}[] = [
  {
    id: 'DSA',
    label: 'DSA',
    description: "Disturbi Specifici dell'Apprendimento",
  },
  {
    id: 'BES',
    label: 'BES',
    description: 'Bisogni Educativi Speciali',
  },
  {
    id: 'H',
    label: 'H',
    description: 'Disabilità (Legge 104)',
  },
];

interface StudentModalProps {
  open: boolean;
  student: Student | null;
  classes?: { id: string; name: string }[];
  currentClassId?: string;
  suppressEscape?: boolean;
  onSave: (data: {
    lastName: string;
    firstName: string;
    supportNeeds: StudentSupportTag[];
    exemptFromPenalties: boolean;
  }) => void;
  onRequestMoveToClass?: (
    targetClassId: string,
    draftData: {
      lastName: string;
      firstName: string;
      supportNeeds: StudentSupportTag[];
      exemptFromPenalties: boolean;
    }
  ) => void;
  onClose: () => void;
}

export function StudentModal({
  open,
  student,
  classes = [],
  currentClassId,
  suppressEscape = false,
  onSave,
  onRequestMoveToClass,
  onClose,
}: StudentModalProps) {
  const lastNameInputRef = useRef<HTMLInputElement>(null);
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [supportNeeds, setSupportNeeds] = useState<StudentSupportTag[]>([]);
  const [exemptFromPenalties, setExemptFromPenalties] = useState(false);
  const [targetClassId, setTargetClassId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (student) {
      const initialNeeds = student.supportNeeds ? [...student.supportNeeds] : [];
      setLastName(student.lastName);
      setFirstName(student.firstName);
      setSupportNeeds(initialNeeds);
      setExemptFromPenalties(
        initialNeeds.length > 0 && Boolean(student.exemptFromPenalties)
      );
    } else {
      setLastName('');
      setFirstName('');
      setSupportNeeds([]);
      setExemptFromPenalties(false);
    }
    setTargetClassId('');
    setError('');
  }, [open, student]);

  useEffect(() => {
    if (!open || suppressEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, suppressEscape, onClose]);

  if (!open) return null;

  const otherClasses = classes.filter((c) => c.id !== currentClassId);

  const toggleSupportTag = (tag: StudentSupportTag) => {
    setSupportNeeds((prev) => {
      const next = prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : [...prev, tag];
      if (next.length === 0) {
        setExemptFromPenalties(false);
      }
      return next;
    });
  };

  const saveAndMaybeContinue = (keepOpen: boolean) => {
    if (!lastName.trim() && !firstName.trim()) {
      setError('Inserisci almeno il cognome o il nome dello studente.');
      return;
    }
    const effectiveExempt = supportNeeds.length > 0 ? exemptFromPenalties : false;
    onSave({
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      supportNeeds,
      exemptFromPenalties: effectiveExempt,
    });
    if (keepOpen) {
      setLastName('');
      setFirstName('');
      setSupportNeeds([]);
      setExemptFromPenalties(false);
      setError('');
      window.setTimeout(() => lastNameInputRef.current?.focus(), 0);
    } else {
      onClose();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveAndMaybeContinue(false);
  };

  const handleMoveClick = () => {
    if (!student || !onRequestMoveToClass || !targetClassId) return;
    if (!lastName.trim() && !firstName.trim()) {
      setError('Inserisci almeno il cognome o il nome dello studente.');
      return;
    }
    onRequestMoveToClass(targetClassId, {
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      supportNeeds,
      exemptFromPenalties: supportNeeds.length > 0 ? exemptFromPenalties : false,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2
            id="student-modal-title"
            className="font-display text-base font-semibold text-slate-900"
          >
            {student ? 'Modifica studente' : 'Nuovo studente'}
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
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Cognome *
            </label>
            <input
              ref={lastNameInputRef}
              type="text"
              autoFocus
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                setError('');
              }}
              placeholder="es. Rossi"
              className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Nome *
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                setError('');
              }}
              placeholder="es. Marco"
              className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <fieldset className="space-y-2 border-t border-slate-200 pt-3">
            <legend className="text-xs font-medium text-slate-700">
              Indicazioni didattiche (facoltativo)
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SUPPORT_OPTIONS.map((opt) => {
                const checked = supportNeeds.includes(opt.id);
                return (
                  <label
                    key={opt.id}
                    className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
                      checked
                        ? 'border-amber-400 bg-amber-50 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    title={opt.description}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSupportTag(opt.id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <span className="font-semibold">{opt.label}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500">
              Se almeno una casella è selezionata, compare un piccolo asterisco (*) accanto al numero dello studente.
            </p>

            {supportNeeds.length > 0 && (
              <div className="mt-2.5 rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2.5">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={exemptFromPenalties}
                    onChange={(e) => setExemptFromPenalties(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-900">
                      Escludi dalle penalità della classe
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-600">
                      Se attiva, le penalità automatiche per stato NO, tavole mancanti e giorni di ritardo non incidono sul voto finale di questo studente.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </fieldset>

          {student && onRequestMoveToClass && (
            <div className="space-y-2.5 border-t border-slate-200 pt-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <ArrowRightLeft className="h-3.5 w-3.5 text-blue-700" />
                <span>Sposta in un&apos;altra classe</span>
              </div>

              {otherClasses.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  Nessun&apos;altra classe disponibile. Crea prima un&apos;altra classe per poter spostare lo studente.
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      aria-label="Classe di destinazione"
                      value={targetClassId}
                      onChange={(e) => setTargetClassId(e.target.value)}
                      className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="">Seleziona classe di destinazione...</option>
                      {classes.map((cls) => {
                        const isCurrent = cls.id === currentClassId;
                        return (
                          <option
                            key={cls.id}
                            value={cls.id}
                            disabled={isCurrent}
                          >
                            {cls.name}
                            {isCurrent ? ' (classe attuale)' : ''}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      disabled={!targetClassId}
                      onClick={handleMoveClick}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3.5 text-xs font-semibold text-blue-900 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 whitespace-nowrap"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      Sposta studente
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Anagrafica, indicazioni (DSA/BES/H) e storico delle valutazioni restano preservati senza sovrascritture.
                  </p>
                </>
              )}
            </div>
          )}

          {student?.transferHistory && student.transferHistory.length > 0 && (
            <details className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">
                Storico classi precedenti ({student.transferHistory.length})
              </summary>
              <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
                {student.transferHistory.map((tr) => (
                  <div key={tr.id} className="space-y-1 text-[11px] text-slate-600">
                    <div className="font-semibold text-slate-800">
                      Da {tr.fromClassName} → {tr.toClassName} ({formatDateIt(tr.movedAt.slice(0, 10))})
                    </div>
                    {tr.plates.length > 0 ? (
                      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[10.5px]">
                        {tr.plates.map((p) => (
                          <span key={p.plateId}>
                            T{p.plateNumber}: {p.status ?? '—'} / {formatGradeLabel(p.grade)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-slate-500">Nessuna valutazione tavole registrata.</div>
                    )}
                    {tr.folders.length > 0 && (
                      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] text-blue-900">
                        {tr.folders.map((f) => (
                          <span key={f.folderId}>
                            {f.folderTitle}: {formatGradeLabel(f.finalGrade)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Annulla
            </button>
            {!student && (
              <button
                type="button"
                onClick={() => saveAndMaybeContinue(true)}
                className="min-h-10 rounded-md border border-blue-300 bg-blue-50 px-3.5 py-2 text-sm font-medium text-blue-900 hover:bg-blue-100 whitespace-nowrap"
              >
                Salva e altro
              </button>
            )}
            <button
              type="submit"
              className="min-h-10 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 whitespace-nowrap"
            >
              {student ? 'Salva modifiche' : 'Aggiungi studente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
