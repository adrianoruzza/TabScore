import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import type { ClassData } from '../types/gradebook';
import {
  buildPreviewWithDuplicates,
  extractCandidatesFromExcelSheet,
  materializeLinearEntries,
  parseStudentImportFile,
  sortStudentsAlphabeticallyIt,
  type ExcelColumnConfig,
  type ImportNameOrder,
  type ParsedImportDocument,
  type ParsedStudentCandidate,
  type PreviewStudentRow,
} from '../utils/studentImport';

interface StudentImportModalProps {
  open: boolean;
  targetClass: ClassData | null;
  onImport: (
    students: Array<{ lastName: string; firstName: string }>,
    fileName: string
  ) => void;
  onClose: () => void;
}

export function StudentImportModal({
  open,
  targetClass,
  onImport,
  onClose,
}: StudentImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [parsedDoc, setParsedDoc] = useState<
    Extract<ParsedImportDocument, { ok: true }> | null
  >(null);

  // Excel interactive mapping state
  const [sheetIdx, setSheetIdx] = useState(0);
  const [excelConfig, setExcelConfig] = useState<ExcelColumnConfig | null>(
    null
  );
  // Word / TXT global name order
  const [linearOrder, setLinearOrder] = useState<ImportNameOrder>('last_first');

  // Editable candidates + user selection
  const [candidates, setCandidates] = useState<ParsedStudentCandidate[]>([]);
  const [selectionMap, setSelectionMap] = useState<Map<string, boolean>>(
    () => new Map()
  );
  const [unrecognizedLines, setUnrecognizedLines] = useState<string[]>([]);

  const resetAll = useCallback(() => {
    setDragging(false);
    setLoading(false);
    setError('');
    setParsedDoc(null);
    setSheetIdx(0);
    setExcelConfig(null);
    setLinearOrder('last_first');
    setCandidates([]);
    setSelectionMap(new Map());
    setUnrecognizedLines([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    resetAll();
  }, [open, resetAll]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const applyExcelExtraction = useCallback(
    (
      doc: Extract<ParsedImportDocument, { ok: true; kind: 'excel' }>,
      idx: number,
      cfg: ExcelColumnConfig
    ) => {
      const sheet = doc.sheets[idx];
      if (!sheet) return;
      const { candidates: nextCandidates } = extractCandidatesFromExcelSheet(
        sheet,
        cfg
      );
      setCandidates(nextCandidates);
      setSelectionMap(new Map());
      setUnrecognizedLines([]);
    },
    []
  );

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError('');
      try {
        const res = await parseStudentImportFile(file);
        if (!res.ok) {
          setParsedDoc(null);
          setCandidates([]);
          setUnrecognizedLines([]);
          setError(res.error);
          return;
        }

        setParsedDoc(res);
        if (res.kind === 'excel') {
          const initialSheet = res.sheets[res.initialSheetIndex];
          setSheetIdx(res.initialSheetIndex);
          setExcelConfig(initialSheet.detectedConfig);
          applyExcelExtraction(
            res,
            res.initialSheetIndex,
            initialSheet.detectedConfig
          );
        } else {
          setLinearOrder(res.defaultOrder);
          const list = materializeLinearEntries(
            res.rawEntries,
            res.defaultOrder
          );
          setCandidates(list);
          setSelectionMap(new Map());
          setUnrecognizedLines(res.unrecognizedLines);
        }
      } finally {
        setLoading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [applyExcelExtraction]
  );

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const previewRows: PreviewStudentRow[] = useMemo(() => {
    if (!targetClass) return [];
    return buildPreviewWithDuplicates(
      candidates,
      targetClass.students,
      selectionMap
    );
  }, [candidates, targetClass, selectionMap]);

  const stats = useMemo(() => {
    let selectedCount = 0;
    let duplicateInClassCount = 0;
    let duplicateInFileCount = 0;
    for (const row of previewRows) {
      if (row.selected) selectedCount += 1;
      if (row.isDuplicateInClass) duplicateInClassCount += 1;
      if (row.isDuplicateInFile) duplicateInFileCount += 1;
    }
    return {
      totalDetected: previewRows.length,
      selectedCount,
      duplicateInClassCount,
      duplicateInFileCount,
    };
  }, [previewRows]);

  if (!open || !targetClass) return null;

  const activeSheet =
    parsedDoc?.kind === 'excel' ? parsedDoc.sheets[sheetIdx] ?? null : null;

  const handleSheetChange = (nextIdx: number) => {
    if (!parsedDoc || parsedDoc.kind !== 'excel') return;
    const sheet = parsedDoc.sheets[nextIdx];
    if (!sheet) return;
    setSheetIdx(nextIdx);
    setExcelConfig(sheet.detectedConfig);
    applyExcelExtraction(parsedDoc, nextIdx, sheet.detectedConfig);
  };

  const handleExcelConfigChange = (patch: Partial<ExcelColumnConfig>) => {
    if (!parsedDoc || parsedDoc.kind !== 'excel' || !excelConfig) return;
    const nextCfg = { ...excelConfig, ...patch };
    setExcelConfig(nextCfg);
    applyExcelExtraction(parsedDoc, sheetIdx, nextCfg);
  };

  const handleLinearOrderChange = (nextOrder: ImportNameOrder) => {
    if (!parsedDoc || parsedDoc.kind === 'excel') return;
    setLinearOrder(nextOrder);
    const nextList = materializeLinearEntries(parsedDoc.rawEntries, nextOrder);
    setCandidates(nextList);
    setSelectionMap(new Map());
  };

  const handleToggleRow = (row: PreviewStudentRow) => {
    if (row.isDuplicateInClass || row.isDuplicateInFile) return;
    setSelectionMap((prev) => {
      const next = new Map(prev);
      next.set(row.tempId, !row.selected);
      return next;
    });
  };

  const handleSelectAllNew = (checked: boolean) => {
    setSelectionMap((prev) => {
      const next = new Map(prev);
      for (const row of previewRows) {
        if (!row.isDuplicateInClass && !row.isDuplicateInFile) {
          next.set(row.tempId, checked);
        }
      }
      return next;
    });
  };

  const handleUpdateCandidateField = (
    tempId: string,
    field: 'lastName' | 'firstName',
    value: string
  ) => {
    setCandidates((prev) =>
      prev.map((c) => (c.tempId === tempId ? { ...c, [field]: value } : c))
    );
  };

  const handleSwapRow = (tempId: string) => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.tempId === tempId
          ? { ...c, lastName: c.firstName, firstName: c.lastName }
          : c
      )
    );
  };

  const handleRemoveRow = (tempId: string) => {
    setCandidates((prev) => prev.filter((c) => c.tempId !== tempId));
    setSelectionMap((prev) => {
      const next = new Map(prev);
      next.delete(tempId);
      return next;
    });
  };

  const handleConfirmImport = () => {
    if (!parsedDoc) return;
    const chosen = previewRows
      .filter(
        (r) =>
          r.selected &&
          !r.isDuplicateInClass &&
          !r.isDuplicateInFile &&
          (r.lastName.trim() !== '' || r.firstName.trim() !== '')
      )
      .map((r) => ({
        lastName: r.lastName.trim(),
        firstName: r.firstName.trim(),
      }));

    if (chosen.length === 0) return;

    const sorted = sortStudentsAlphabeticallyIt(chosen);
    onImport(sorted, parsedDoc.fileName);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-import-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2
              id="student-import-title"
              className="font-display text-base font-semibold text-slate-900"
            >
              Importa studenti
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Classe di destinazione:{' '}
              <span className="font-semibold text-slate-900">
                {targetClass.name}
              </span>{' '}
              ({targetClass.schoolYear}) · Elaborazione locale nel browser
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi importazione"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.docx,.doc,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />

          {/* File dropzone (full when no doc loaded, compact bar once loaded) */}
          {!parsedDoc ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                dragging
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-300 bg-slate-50/60 hover:border-slate-400'
              }`}
            >
              <Upload className="h-7 w-7 text-blue-700" />
              <p className="mt-2.5 text-sm font-semibold text-slate-900">
                {loading
                  ? 'Lettura del file in corso...'
                  : 'Seleziona o trascina un file con l’elenco studenti'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Formati supportati: Excel (.xlsx, .xls), Word (.docx, .doc) e
                Testo (.txt)
              </p>
              <button
                type="button"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-blue-700 px-4 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-60"
              >
                <Upload className="h-3.5 w-3.5" />
                Scegli file dal computer
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                {parsedDoc.kind === 'excel' ? (
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-blue-700" />
                )}
                <span className="truncate text-xs font-semibold text-slate-900">
                  {parsedDoc.fileName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
              >
                <Upload className="h-3 w-3" />
                Cambia file
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Excel mapping controls */}
          {parsedDoc?.kind === 'excel' && activeSheet && excelConfig && (
            <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-4">
              {parsedDoc.sheets.length > 1 && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-600">
                    Foglio Excel
                  </label>
                  <select
                    value={sheetIdx}
                    onChange={(e) => handleSheetChange(Number(e.target.value))}
                    className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  >
                    {parsedDoc.sheets.map((s, idx) => (
                      <option key={s.name} value={idx}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Struttura colonne
                </label>
                <select
                  value={excelConfig.mode}
                  onChange={(e) =>
                    handleExcelConfigChange({
                      mode: e.target.value as ExcelColumnConfig['mode'],
                    })
                  }
                  className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="two_columns">Due colonne (Cognome + Nome)</option>
                  <option value="single_column">Colonna unica</option>
                </select>
              </div>

              {excelConfig.mode === 'two_columns' ? (
                <>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600">
                      Colonna Cognome
                    </label>
                    <select
                      value={excelConfig.lastNameCol}
                      onChange={(e) =>
                        handleExcelConfigChange({
                          lastNameCol: Number(e.target.value),
                        })
                      }
                      className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      {activeSheet.columnLabels.map((lbl, idx) => (
                        <option key={idx} value={idx}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600">
                      Colonna Nome
                    </label>
                    <select
                      value={excelConfig.firstNameCol}
                      onChange={(e) =>
                        handleExcelConfigChange({
                          firstNameCol: Number(e.target.value),
                        })
                      }
                      className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      {activeSheet.columnLabels.map((lbl, idx) => (
                        <option key={idx} value={idx}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600">
                      Colonna nominativi
                    </label>
                    <select
                      value={excelConfig.fullNameCol}
                      onChange={(e) =>
                        handleExcelConfigChange({
                          fullNameCol: Number(e.target.value),
                        })
                      }
                      className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      {activeSheet.columnLabels.map((lbl, idx) => (
                        <option key={idx} value={idx}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600">
                      Ordine nella cella
                    </label>
                    <select
                      value={excelConfig.nameOrder}
                      onChange={(e) =>
                        handleExcelConfigChange({
                          nameOrder: e.target.value as ImportNameOrder,
                        })
                      }
                      className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="last_first">Cognome Nome</option>
                      <option value="first_last">Nome Cognome</option>
                    </select>
                  </div>
                </>
              )}

              <div className="sm:col-span-4 flex items-center justify-between border-t border-slate-200/80 pt-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={excelConfig.hasHeader}
                    onChange={(e) =>
                      handleExcelConfigChange({ hasHeader: e.target.checked })
                    }
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                  />
                  <span>Prima riga contiene intestazioni di colonna</span>
                </label>
              </div>
            </div>
          )}

          {/* Word / TXT global name order toggle */}
          {parsedDoc && parsedDoc.kind !== 'excel' && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-3.5 py-2">
              <span className="text-xs font-medium text-slate-700">
                Ordine automatico dei nominativi:
              </span>
              <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => handleLinearOrderChange('last_first')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    linearOrder === 'last_first'
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Cognome Nome
                </button>
                <button
                  type="button"
                  onClick={() => handleLinearOrderChange('first_last')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    linearOrder === 'first_last'
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Nome Cognome
                </button>
              </div>
            </div>
          )}

          {/* Summary counters & Preview Table */}
          {parsedDoc && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-3 tabular-nums">
                  <span className="font-medium text-slate-700">
                    Individuati:{' '}
                    <strong className="text-slate-900">
                      {stats.totalDetected}
                    </strong>
                  </span>
                  <span className="font-medium text-blue-800">
                    Da importare:{' '}
                    <strong>{stats.selectedCount}</strong>
                  </span>
                  {stats.duplicateInClassCount > 0 && (
                    <span className="font-medium text-amber-700">
                      Già in classe:{' '}
                      <strong>{stats.duplicateInClassCount}</strong>
                    </span>
                  )}
                  {stats.duplicateInFileCount > 0 && (
                    <span className="font-medium text-amber-700">
                      Duplicati nel file:{' '}
                      <strong>{stats.duplicateInFileCount}</strong>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectAllNew(true)}
                    className="text-[11px] font-medium text-blue-700 hover:underline"
                  >
                    Seleziona tutti i nuovi
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => handleSelectAllNew(false)}
                    className="text-[11px] font-medium text-slate-600 hover:underline"
                  >
                    Deseleziona tutti
                  </button>
                </div>
              </div>

              {previewRows.length === 0 ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
                  Nessuno studente individuato con la configurazione corrente.
                  Prova a modificare il foglio o le colonne selezionate.
                </div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto rounded-md border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-700">
                      <tr>
                        <th className="w-9 px-2.5 py-2 text-center">Sel.</th>
                        <th className="w-9 px-2 py-2 text-center">#</th>
                        <th className="px-2.5 py-2">Cognome</th>
                        <th className="px-2.5 py-2">Nome</th>
                        <th className="w-32 px-2.5 py-2">Stato</th>
                        <th className="w-16 px-2 py-2 text-right">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {previewRows.map((row, idx) => {
                        const isDup =
                          row.isDuplicateInClass || row.isDuplicateInFile;
                        return (
                          <tr
                            key={row.tempId}
                            className={
                              isDup
                                ? 'bg-amber-50/60'
                                : row.selected
                                ? 'bg-white'
                                : 'bg-slate-50/60 text-slate-400'
                            }
                          >
                            <td className="px-2.5 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={row.selected}
                                disabled={isDup}
                                onChange={() => handleToggleRow(row)}
                                aria-label={`Seleziona ${row.lastName} ${row.firstName}`}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 disabled:opacity-40"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-center font-mono text-[11px] text-slate-400 tabular-nums">
                              {idx + 1}
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={row.lastName}
                                onChange={(e) =>
                                  handleUpdateCandidateField(
                                    row.tempId,
                                    'lastName',
                                    e.target.value
                                  )
                                }
                                placeholder="Cognome"
                                className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={row.firstName}
                                onChange={(e) =>
                                  handleUpdateCandidateField(
                                    row.tempId,
                                    'firstName',
                                    e.target.value
                                  )
                                }
                                placeholder="Nome"
                                className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-2.5 py-1.5">
                              {row.isDuplicateInClass ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800">
                                  Già in classe
                                </span>
                              ) : row.isDuplicateInFile ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                                  Duplicato file
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Nuovo
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleSwapRow(row.tempId)}
                                  title="Scambia Cognome e Nome"
                                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-700"
                                >
                                  <ArrowLeftRight className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRow(row.tempId)}
                                  title="Rimuovi riga"
                                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {unrecognizedLines.length > 0 && (
                <p className="text-[11px] text-slate-500">
                  Righe ignorate automaticamente (intestazioni o testo non valido):{' '}
                  {unrecognizedLines.length}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5">
          <p className="text-[11px] text-slate-500">
            I nuovi studenti vengono aggiunti in ordine alfabetico senza
            modificare studenti, voti o tag esistenti.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={!parsedDoc || stats.selectedCount === 0}
              onClick={handleConfirmImport}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-700 px-4 text-xs font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Importa {stats.selectedCount}{' '}
              {stats.selectedCount === 1 ? 'studente' : 'studenti'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
