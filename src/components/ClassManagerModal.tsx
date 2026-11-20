import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  ExternalPlateEntry,
  PlateImportMode,
  PlateImportResult,
} from '../hooks/useGradebookStore';
import type { ClassData } from '../types/gradebook';
import {
  CLASS_COLOR_PALETTE,
  getClassColorOption,
  pickNextDistinctClassColorId,
} from '../utils/classColors';
import { PlateImportModal } from './PlateImportModal';
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
    sourcePlatesClassId?: string;
    includePlateAttachments?: boolean;
    initialPlates?: ExternalPlateEntry[];
    initialPlatesSourceFile?: string;
    initialStudents?: Array<{ lastName: string; firstName: string }>;
    initialStudentsSourceFile?: string;
  }) => void;
  onUpdateClass: (
    classId: string,
    data: { name: string; schoolYear: string; color: string }
  ) => void;
  onReorderClasses: (fromIndex: number, toIndex: number) => void;
  onDeleteClass: (cls: ClassData) => void;
  onImportStudents: (
    classId: string,
    students: Array<{ lastName: string; firstName: string }>,
    fileName?: string
  ) => void;
  onImportPlatesFromClass: (
    targetClassId: string,
    sourceClassId: string,
    mode: PlateImportMode,
    includeAttachments?: boolean
  ) => PlateImportResult;
  onImportPlatesFromFile: (
    targetClassId: string,
    entries: ExternalPlateEntry[],
    mode: PlateImportMode,
    sourceFileName?: string
  ) => PlateImportResult;
  onClose: () => void;
}

export function ClassManagerModal({
  open,
  classes,
  activeClassId,
  onSelectClass,
  onCreateClass,
  onUpdateClass,
  onReorderClasses,
  onDeleteClass,
  onImportStudents,
  onImportPlatesFromClass,
  onImportPlatesFromFile,
  onClose,
}: ClassManagerModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [schoolYear, setSchoolYear] = useState('2026/2027');
  const [color, setColor] = useState<string>(() =>
    pickNextDistinctClassColorId(classes.map((c) => c.color))
  );
  const [createSourcePlatesClassId, setCreateSourcePlatesClassId] = useState('');
  const [createIncludeAttachments, setCreateIncludeAttachments] = useState(false);
  const [stagedPlates, setStagedPlates] = useState<ExternalPlateEntry[]>([]);
  const [stagedPlatesFileName, setStagedPlatesFileName] = useState('');
  const [createPlatesImportOpen, setCreatePlatesImportOpen] = useState(false);
  const [stagedStudents, setStagedStudents] = useState<
    Array<{ lastName: string; firstName: string }>
  >([]);
  const [stagedStudentsFileName, setStagedStudentsFileName] = useState('');
  const [createStudentsImportOpen, setCreateStudentsImportOpen] = useState(false);
  const [error, setError] = useState('');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importNotice, setImportNotice] = useState('');

  // Drag & Drop class reordering state
  const [draggedClassIdx, setDraggedClassIdx] = useState<number | null>(null);
  const [dropInsertionIdx, setDropInsertionIdx] = useState<number | null>(null);

  // Import plates onto an existing class (from another class or external file)
  const [plateImportTargetId, setPlateImportTargetId] = useState<string | null>(null);
  const [filePlateImportTargetId, setFilePlateImportTargetId] = useState<
    string | null
  >(null);
  const [plateImportSourceId, setPlateImportSourceId] = useState('');
  const [plateImportMode, setPlateImportMode] = useState<PlateImportMode>('append');
  const [plateImportIncludeAttachments, setPlateImportIncludeAttachments] =
    useState(false);
  const [plateImportConfirmReplace, setPlateImportConfirmReplace] = useState(false);
  const [plateImportError, setPlateImportError] = useState('');
  const [plateImportSuccess, setPlateImportSuccess] = useState('');

  const selectedClass = classes.find((c) => c.id === activeClassId) ?? null;
  const classesWithPlates = classes.filter((c) => c.plates.length > 0);
  const createSourceClass =
    classesWithPlates.find((c) => c.id === createSourcePlatesClassId) ?? null;
  const createSourceHasAttachments = Boolean(
    createSourceClass?.plates.some((p) => Boolean(p.imageDataUrl))
  );

  const plateImportTargetClass =
    classes.find((c) => c.id === plateImportTargetId) ?? null;
  const filePlateImportTargetClass =
    classes.find((c) => c.id === filePlateImportTargetId) ?? null;
  const plateImportSourceOptions = plateImportTargetClass
    ? classes.filter(
        (c) => c.id !== plateImportTargetClass.id && c.plates.length > 0
      )
    : [];
  const plateImportSourceClass =
    plateImportSourceOptions.find((c) => c.id === plateImportSourceId) ?? null;
  const plateImportSourceHasAttachments = Boolean(
    plateImportSourceClass?.plates.some((p) => Boolean(p.imageDataUrl))
  );

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setName('');
    setSchoolYear('2026/2027');
    setColor(pickNextDistinctClassColorId(classes.map((c) => c.color)));
    setCreateSourcePlatesClassId('');
    setCreateIncludeAttachments(false);
    setStagedPlates([]);
    setStagedPlatesFileName('');
    setCreatePlatesImportOpen(false);
    setStagedStudents([]);
    setStagedStudentsFileName('');
    setCreateStudentsImportOpen(false);
    setDraggedClassIdx(null);
    setDropInsertionIdx(null);
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) {
      setImportModalOpen(false);
      setCreateStudentsImportOpen(false);
      setCreatePlatesImportOpen(false);
      setFilePlateImportTargetId(null);
      setImportNotice('');
      setPlateImportTargetId(null);
      setPlateImportSourceId('');
      setPlateImportMode('append');
      setPlateImportIncludeAttachments(false);
      setPlateImportConfirmReplace(false);
      setPlateImportError('');
      setPlateImportSuccess('');
      setDraggedClassIdx(null);
      setDropInsertionIdx(null);
    }
  }, [open]);

  useEffect(() => {
    if (
      !open ||
      importModalOpen ||
      createStudentsImportOpen ||
      createPlatesImportOpen ||
      Boolean(filePlateImportTargetId)
    ) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    open,
    importModalOpen,
    createStudentsImportOpen,
    createPlatesImportOpen,
    filePlateImportTargetId,
    onClose,
  ]);

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
    setCreateSourcePlatesClassId('');
    setCreateIncludeAttachments(false);
    setStagedPlates([]);
    setStagedPlatesFileName('');
    setCreatePlatesImportOpen(false);
    setStagedStudents([]);
    setStagedStudentsFileName('');
    setCreateStudentsImportOpen(false);
    setError('');
  };

  const openPlateImportForClass = (targetCls: ClassData) => {
    const candidates = classes.filter(
      (c) => c.id !== targetCls.id && c.plates.length > 0
    );
    setPlateImportError('');
    setPlateImportSuccess('');
    setPlateImportConfirmReplace(false);
    if (candidates.length === 0) {
      // No other classes have plates: open external file importer directly
      setPlateImportTargetId(null);
      setFilePlateImportTargetId(targetCls.id);
      return;
    }
    setPlateImportTargetId(targetCls.id);
    setPlateImportSourceId(candidates[0]?.id ?? '');
    setPlateImportMode('append');
    setPlateImportIncludeAttachments(false);
  };

  const handleConfirmPlateImport = () => {
    if (!plateImportTargetClass || !plateImportSourceClass) {
      setPlateImportError('Seleziona una classe sorgente valida.');
      return;
    }
    if (
      plateImportMode === 'replace' &&
      plateImportTargetClass.plates.length > 0 &&
      !plateImportConfirmReplace
    ) {
      setPlateImportConfirmReplace(true);
      setPlateImportError('');
      return;
    }

    const res = onImportPlatesFromClass(
      plateImportTargetClass.id,
      plateImportSourceClass.id,
      plateImportMode,
      plateImportIncludeAttachments
    );

    if (!res.ok) {
      setPlateImportError(
        res.error ?? 'Impossibile completare l’importazione delle tavole.'
      );
      return;
    }

    const skippedNote =
      res.skippedCount > 0
        ? ` (${res.skippedCount} ${
            res.skippedCount === 1 ? 'tavola già presente saltata' : 'tavole già presenti saltate'
          })`
        : '';
    const actionVerb =
      plateImportMode === 'replace' ? 'Sostituito elenco con' : 'Importate';

    setPlateImportSuccess(
      `${actionVerb} ${res.importedCount} ${
        res.importedCount === 1 ? 'tavola' : 'tavole'
      } in "${plateImportTargetClass.name}" da "${plateImportSourceClass.name}"${skippedNote}.`
    );
    setPlateImportTargetId(null);
    setPlateImportConfirmReplace(false);
    setPlateImportError('');
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
      onCreateClass({
        name,
        schoolYear,
        color,
        ...(stagedPlates.length > 0
          ? {
              initialPlates: stagedPlates,
              initialPlatesSourceFile: stagedPlatesFileName,
            }
          : createSourcePlatesClassId
          ? {
              sourcePlatesClassId: createSourcePlatesClassId,
              includePlateAttachments: createIncludeAttachments,
            }
          : {}),
        ...(stagedStudents.length > 0
          ? {
              initialStudents: stagedStudents,
              initialStudentsSourceFile: stagedStudentsFileName,
            }
          : {}),
      });
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
          {/* Existing classes list + Import students / plates */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-600">
                  Classi archiviate ({classes.length})
                </h3>
                {classes.length > 1 && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Trascina le classi dall&apos;icona laterale per personalizzare l&apos;ordine nel registro.
                  </p>
                )}
              </div>
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
            {plateImportSuccess && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{plateImportSuccess}</span>
              </div>
            )}
            {plateImportError && !plateImportTargetClass && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{plateImportError}</span>
              </div>
            )}
            <div
              className="mt-2 divide-y divide-slate-200 rounded-md border border-slate-200"
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setDropInsertionIdx(null);
                }
              }}
            >
              {classes.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">
                  Nessuna classe presente. Crea la prima classe qui sotto.
                </div>
              ) : (
                classes.map((cls, idx) => {
                  const isActive = cls.id === activeClassId;
                  const colorTheme = getClassColorOption(cls.color, idx);
                  const canReorder = classes.length > 1;
                  const isDraggingThis = draggedClassIdx === idx;
                  const showTopIndicator =
                    draggedClassIdx !== null &&
                    dropInsertionIdx === idx &&
                    dropInsertionIdx !== draggedClassIdx &&
                    dropInsertionIdx !== draggedClassIdx + 1;
                  const showBottomIndicator =
                    draggedClassIdx !== null &&
                    idx === classes.length - 1 &&
                    dropInsertionIdx === classes.length &&
                    draggedClassIdx !== classes.length - 1;

                  return (
                    <div
                      key={cls.id}
                      draggable={canReorder}
                      data-class-row-id={cls.id}
                      onDragStart={(e) => {
                        if (!canReorder) return;
                        const targetEl = e.target as HTMLElement | null;
                        if (targetEl?.closest('input, select, textarea')) {
                          e.preventDefault();
                          return;
                        }
                        setDraggedClassIdx(idx);
                        setDropInsertionIdx(idx);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', cls.id);
                      }}
                      onDragOver={(e) => {
                        if (draggedClassIdx === null) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const rect = e.currentTarget.getBoundingClientRect();
                        const nextInsertion =
                          e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
                        if (dropInsertionIdx !== nextInsertion) {
                          setDropInsertionIdx(nextInsertion);
                        }
                      }}
                      onDrop={(e) => {
                        if (draggedClassIdx === null) return;
                        e.preventDefault();
                        const insertion = dropInsertionIdx ?? idx;
                        const targetIdx =
                          insertion > draggedClassIdx ? insertion - 1 : insertion;
                        if (targetIdx !== draggedClassIdx) {
                          onReorderClasses(draggedClassIdx, targetIdx);
                        }
                        setDraggedClassIdx(null);
                        setDropInsertionIdx(null);
                      }}
                      onDragEnd={() => {
                        setDraggedClassIdx(null);
                        setDropInsertionIdx(null);
                      }}
                      style={
                        isActive
                          ? { backgroundColor: colorTheme.softBg }
                          : undefined
                      }
                      className={`relative flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-opacity ${
                        isActive ? '' : 'bg-white'
                      } ${isDraggingThis ? 'opacity-45' : ''}`}
                    >
                      {showTopIndicator && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute -top-[1px] right-0 left-0 z-10 h-0.5 bg-blue-600 shadow-[0_0_0_1px_rgba(37,99,235,0.25)]"
                        />
                      )}
                      {showBottomIndicator && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute right-0 -bottom-[1px] left-0 z-10 h-0.5 bg-blue-600 shadow-[0_0_0_1px_rgba(37,99,235,0.25)]"
                        />
                      )}

                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {canReorder && (
                          <button
                            type="button"
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowUp' && idx > 0) {
                                e.preventDefault();
                                onReorderClasses(idx, idx - 1);
                              } else if (
                                e.key === 'ArrowDown' &&
                                idx < classes.length - 1
                              ) {
                                e.preventDefault();
                                onReorderClasses(idx, idx + 1);
                              }
                            }}
                            title="Trascina per riordinare la classe (o usa Frecce Su/Giù)"
                            aria-label={`Riordina classe ${cls.name}`}
                            className="shrink-0 cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                        )}
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
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openPlateImportForClass(cls)}
                          title={`Importa elenco tavole in "${cls.name}" da file esterno o da un'altra classe`}
                          className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Importa tavole
                        </button>
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

            {/* Unified panel to import plates into an existing class (external file or another class) */}
            {plateImportTargetClass && (
              <div className="mt-3 space-y-3 rounded-md border border-blue-200 bg-blue-50/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900">
                      Importa elenco tavole in &quot;{plateImportTargetClass.name}&quot;
                    </h4>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      Importa da un file esterno (Excel, Word o TXT) con anteprima modificabile, oppure importa titoli e numerazione progressiva da un&apos;altra classe. Le cartelline esistenti, i loro intervalli, studenti, consegne e dati registrati restano invariati.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPlateImportTargetId(null);
                      setPlateImportConfirmReplace(false);
                      setPlateImportError('');
                    }}
                    className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                    aria-label="Chiudi pannello importazione tavole"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* External file source option */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-white px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-900">
                      Da file esterno (.xlsx, .xls, .docx, .doc, .txt)
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Riconoscimento automatico dei titoli con anteprima, modifica, riordino e scelta tra aggiunta o sostituzione.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFilePlateImportTargetId(plateImportTargetClass.id);
                      setPlateImportTargetId(null);
                      setPlateImportConfirmReplace(false);
                      setPlateImportError('');
                    }}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-blue-700 px-3 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Importa da file
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                  <span className="h-px flex-1 bg-blue-200/80" />
                  <span>oppure da un&apos;altra classe</span>
                  <span className="h-px flex-1 bg-blue-200/80" />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700">
                      Classe di origine
                    </label>
                    <select
                      value={plateImportSourceId}
                      onChange={(e) => {
                        setPlateImportSourceId(e.target.value);
                        setPlateImportConfirmReplace(false);
                        setPlateImportError('');
                      }}
                      className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      {plateImportSourceOptions.map((src) => (
                        <option key={src.id} value={src.id}>
                          {src.name} ({src.schoolYear}) — {src.plates.length} tavole
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-700">
                      Modalità di importazione
                    </label>
                    <div className="mt-1 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setPlateImportMode('append');
                          setPlateImportConfirmReplace(false);
                          setPlateImportError('');
                        }}
                        className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          plateImportMode === 'append'
                            ? 'border-blue-700 bg-blue-700 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Aggiungi (no duplicati)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlateImportMode('replace');
                          setPlateImportConfirmReplace(false);
                          setPlateImportError('');
                        }}
                        className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          plateImportMode === 'replace'
                            ? 'border-amber-600 bg-amber-600 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Sostituisci elenco
                      </button>
                    </div>
                  </div>
                </div>

                {plateImportSourceHasAttachments && (
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={plateImportIncludeAttachments}
                      onChange={(e) =>
                        setPlateImportIncludeAttachments(e.target.checked)
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                    />
                    Copia anche immagini/PDF allegati alle tavole
                  </label>
                )}

                {plateImportMode === 'replace' &&
                  plateImportTargetClass.plates.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                      <div>
                        <span className="font-semibold">
                          Sostituzione elenco tavole:
                        </span>{' '}
                        i titoli e la numerazione progressiva delle tavole di &quot;
                        {plateImportTargetClass.name}&quot; verranno aggiornati secondo l&apos;elenco selezionato. Tutte le cartelline esistenti, i loro intervalli, le consegne, le date, i voti e le annotazioni già registrate resteranno intatti
                        {plateImportSourceClass &&
                        plateImportSourceClass.plates.length <
                          plateImportTargetClass.plates.length
                          ? ` (verranno rimosse solo le ${
                              plateImportTargetClass.plates.length -
                              plateImportSourceClass.plates.length
                            } tavole eccedenti in coda).`
                          : '.'}
                      </div>
                    </div>
                  )}

                {plateImportError && (
                  <p className="text-xs font-medium text-rose-700">
                    {plateImportError}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPlateImportTargetId(null);
                      setPlateImportConfirmReplace(false);
                      setPlateImportError('');
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmPlateImport}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white ${
                      plateImportMode === 'replace' &&
                      plateImportTargetClass.plates.length > 0
                        ? 'bg-amber-700 hover:bg-amber-800'
                        : 'bg-blue-700 hover:bg-blue-800'
                    }`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {plateImportConfirmReplace
                      ? 'Conferma sostituzione tavole'
                      : plateImportMode === 'replace'
                      ? 'Sostituisci tavole'
                      : 'Importa tavole'}
                  </button>
                </div>
              </div>
            )}
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

            {/* Optional student import from Excel on class creation */}
            {!editingId && (
              <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-slate-700">
                      Elenco studenti da Excel (opzionale)
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Importa solo cognome e nome da file .xlsx o .xls con anteprima prima della creazione.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreateStudentsImportOpen(true)}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-medium text-emerald-900 hover:bg-emerald-100 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                    Importa studenti da Excel
                  </button>
                </div>

                {stagedStudents.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1 text-emerald-950">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span>
                          {stagedStudents.length}{' '}
                          {stagedStudents.length === 1 ? 'studente pronto' : 'studenti pronti'}{' '}
                          da &quot;{stagedStudentsFileName}&quot;
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-emerald-800">
                        {stagedStudents
                          .slice(0, 4)
                          .map((s) => `${s.lastName} ${s.firstName}`.trim())
                          .join(', ')}
                        {stagedStudents.length > 4
                          ? ` (+ altri ${stagedStudents.length - 4})`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setCreateStudentsImportOpen(true)}
                        className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100"
                      >
                        Sostituisci
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStagedStudents([]);
                          setStagedStudentsFileName('');
                        }}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 hover:text-rose-700"
                      >
                        Rimuovi
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Optional plate import on class creation (external file or existing class) */}
            {!editingId && (
              <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-slate-700">
                      Elenco tavole (opzionale)
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Importa i titoli delle tavole da file Excel (.xlsx, .xls), Word (.docx, .doc) o TXT con anteprima modificabile.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreatePlatesImportOpen(true)}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 text-xs font-medium text-blue-900 hover:bg-blue-100 whitespace-nowrap"
                  >
                    <FileText className="h-3.5 w-3.5 text-blue-700" />
                    Importa tavole da file
                  </button>
                </div>

                {stagedPlates.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50/80 px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1 text-blue-950">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                        <span>
                          {stagedPlates.length}{' '}
                          {stagedPlates.length === 1
                            ? 'tavola pronta'
                            : 'tavole pronte'}
                          {stagedPlatesFileName
                            ? ` da "${stagedPlatesFileName}"`
                            : ''}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-blue-800">
                        {stagedPlates
                          .slice(0, 4)
                          .map((p, i) => `T${i + 1} ${p.title}`)
                          .join(' · ')}
                        {stagedPlates.length > 4
                          ? ` (+ altre ${stagedPlates.length - 4})`
                          : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCreatePlatesImportOpen(true)}
                        className="rounded border border-blue-300 bg-white px-2 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-100"
                      >
                        Modifica
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStagedPlates([]);
                          setStagedPlatesFileName('');
                        }}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 hover:text-rose-700"
                      >
                        Rimuovi
                      </button>
                    </div>
                  </div>
                )}

                {classesWithPlates.length > 0 && (
                  <div className="space-y-1.5 border-t border-slate-200/80 pt-2.5">
                    <label
                      htmlFor="create-import-plates-select"
                      className="block text-[11px] font-medium text-slate-600"
                    >
                      Oppure importa elenco tavole da una classe esistente
                    </label>
                    <select
                      id="create-import-plates-select"
                      value={createSourcePlatesClassId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setCreateSourcePlatesClassId(nextId);
                        setCreateIncludeAttachments(false);
                        if (nextId) {
                          setStagedPlates([]);
                          setStagedPlatesFileName('');
                        }
                      }}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="">Nessuna classe di origine</option>
                      {classesWithPlates.map((cls) => (
                        <option key={cls.id} value={cls.id}>
                          {cls.name} ({cls.schoolYear}) — {cls.plates.length}{' '}
                          tavole
                        </option>
                      ))}
                    </select>
                    {createSourceClass && (
                      <div className="space-y-1.5 pt-0.5">
                        {createSourceHasAttachments && (
                          <label className="flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={createIncludeAttachments}
                              onChange={(e) =>
                                setCreateIncludeAttachments(e.target.checked)
                              }
                              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                            />
                            Copia anche immagini/PDF allegati delle tavole
                          </label>
                        )}
                        <p className="text-[11px] text-slate-500">
                          Verranno importati solo i titoli, la numerazione progressiva e le note descrittive delle {createSourceClass.plates.length}{' '}
                          tavole. Cartelline, studenti, date, voti, consegne e statistiche non verranno copiati.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

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
                        selected
                          ? 'ring-2 ring-offset-1 ring-slate-800/35 font-semibold'
                          : 'hover:brightness-97'
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

      <StudentImportModal
        open={createStudentsImportOpen}
        excelOnly
        existingStudents={[]}
        targetClassName={name.trim() || 'Nuova classe'}
        targetSchoolYear={schoolYear.trim() || '2026/2027'}
        confirmButtonLabel="Conferma elenco studenti"
        footerNote="Verranno associati solo cognome e nome in ordine alfabetico alla nuova classe, senza voti, tavole o altri dati."
        onImport={(students, fileName) => {
          setStagedStudents(students);
          setStagedStudentsFileName(fileName);
        }}
        onClose={() => setCreateStudentsImportOpen(false)}
      />

      <PlateImportModal
        open={createPlatesImportOpen}
        existingPlates={[]}
        targetClassName={name.trim() || 'Nuova classe'}
        targetSchoolYear={schoolYear.trim() || '2026/2027'}
        allowReplaceMode={false}
        initialStagedEntries={stagedPlates}
        initialStagedFileName={stagedPlatesFileName}
        confirmButtonLabel="Conferma elenco tavole"
        footerNote="Verranno associate solo le tavole elencate (titoli e ordine) alla nuova classe, senza studenti, voti o consegne."
        onConfirm={(entries, _mode, fileName) => {
          setStagedPlates(entries);
          setStagedPlatesFileName(fileName);
          setCreateSourcePlatesClassId('');
          setCreateIncludeAttachments(false);
        }}
        onClose={() => setCreatePlatesImportOpen(false)}
      />

      <PlateImportModal
        open={Boolean(filePlateImportTargetClass)}
        targetClass={filePlateImportTargetClass}
        allowReplaceMode
        initialMode="append"
        onConfirm={(entries, mode, fileName) => {
          if (!filePlateImportTargetClass) return;
          const res = onImportPlatesFromFile(
            filePlateImportTargetClass.id,
            entries,
            mode,
            fileName
          );
          if (!res.ok) {
            setPlateImportError(
              res.error ??
                'Impossibile completare l’importazione delle tavole dal file.'
            );
            setPlateImportSuccess('');
            return;
          }
          const skippedNote =
            res.skippedCount > 0
              ? ` (${res.skippedCount} ${
                  res.skippedCount === 1
                    ? 'tavola già presente saltata'
                    : 'tavole già presenti saltate'
                })`
              : '';
          const actionVerb =
            mode === 'replace' ? 'Sostituito elenco con' : 'Importate';
          const sourceLabel = fileName ? ` da "${fileName}"` : '';
          setPlateImportSuccess(
            `${actionVerb} ${res.importedCount} ${
              res.importedCount === 1 ? 'tavola' : 'tavole'
            } in "${filePlateImportTargetClass.name}"${sourceLabel}${skippedNote}.`
          );
          setPlateImportError('');
        }}
        onClose={() => setFilePlateImportTargetId(null)}
      />
    </div>
  );
}
