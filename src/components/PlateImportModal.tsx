import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Plus,
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
import type {
  ExternalPlateEntry,
  PlateImportMode,
} from '../hooks/useGradebookStore';
import type { ClassData, Plate } from '../types/gradebook';
import {
  buildPlatePreviewRows,
  extractPlateCandidatesFromExcelSheet,
  nextPlateTempId,
  normalizePlateTitleValue,
  parsePlateImportFile,
  type ParsedPlateCandidate,
  type ParsedPlateImportDocument,
  type PlateExcelColumnConfig,
  type PreviewPlateRow,
} from '../utils/plateImport';

interface PlateImportModalProps {
  open: boolean;
  targetClass?: ClassData | null;
  targetClassName?: string;
  targetSchoolYear?: string;
  existingPlates?: Plate[];
  allowReplaceMode?: boolean;
  initialMode?: PlateImportMode;
  initialStagedEntries?: ExternalPlateEntry[];
  initialStagedFileName?: string;
  confirmButtonLabel?: string;
  footerNote?: string;
  onConfirm: (
    entries: ExternalPlateEntry[],
    mode: PlateImportMode,
    fileName: string
  ) => void;
  onClose: () => void;
}

export function PlateImportModal({
  open,
  targetClass = null,
  targetClassName,
  targetSchoolYear,
  existingPlates,
  allowReplaceMode = false,
  initialMode = 'append',
  initialStagedEntries,
  initialStagedFileName,
  confirmButtonLabel,
  footerNote,
  onConfirm,
  onClose,
}: PlateImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [parsedDoc, setParsedDoc] = useState<
    Extract<ParsedPlateImportDocument, { ok: true }> | null
  >(null);
  const [sourceFileName, setSourceFileName] = useState('');

  // Excel interactive mapping state
  const [sheetIdx, setSheetIdx] = useState(0);
  const [excelConfig, setExcelConfig] = useState<PlateExcelColumnConfig | null>(
    null
  );

  // Editable candidates, selection & manual add
  const [candidates, setCandidates] = useState<ParsedPlateCandidate[]>([]);
  const [selectionMap, setSelectionMap] = useState<Map<string, boolean>>(
    () => new Map()
  );
  const [unrecognizedLines, setUnrecognizedLines] = useState<string[]>([]);
  const [manualTitle, setManualTitle] = useState('');

  // Mode & replace confirmation
  const [mode, setMode] = useState<PlateImportMode>(initialMode);
  const [confirmReplace, setConfirmReplace] = useState(false);

  // Drag & drop reorder state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dropInsertionIdx, setDropInsertionIdx] = useState<number | null>(null);

  const resetAll = useCallback(() => {
    setDraggingFile(false);
    setLoading(false);
    setError('');
    setParsedDoc(null);
    setSheetIdx(0);
    setExcelConfig(null);
    setUnrecognizedLines([]);
    setManualTitle('');
    setMode(initialMode);
    setConfirmReplace(false);
    setDraggedIdx(null);
    setDropInsertionIdx(null);
    setSelectionMap(new Map());
    if (initialStagedEntries && initialStagedEntries.length > 0) {
      setSourceFileName(initialStagedFileName || 'Elenco tavole');
      setCandidates(
        initialStagedEntries.map((entry) => ({
          tempId: nextPlateTempId(),
          title: entry.title,
          ...(entry.number !== undefined ? { detectedNumber: entry.number } : {}),
          rawSource: entry.title,
        }))
      );
    } else {
      setSourceFileName('');
      setCandidates([]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [initialMode, initialStagedEntries, initialStagedFileName]);

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
      doc: Extract<ParsedPlateImportDocument, { ok: true; kind: 'excel' }>,
      idx: number,
      cfg: PlateExcelColumnConfig
    ) => {
      const sheet = doc.sheets[idx];
      if (!sheet) return;
      const { candidates: nextCandidates } = extractPlateCandidatesFromExcelSheet(
        sheet,
        cfg
      );
      setCandidates(nextCandidates);
      setSelectionMap(new Map());
      setUnrecognizedLines([]);
      setConfirmReplace(false);
    },
    []
  );

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError('');
      setConfirmReplace(false);
      try {
        const res = await parsePlateImportFile(file);
        if (!res.ok) {
          setParsedDoc(null);
          setSourceFileName('');
          setCandidates([]);
          setUnrecognizedLines([]);
          setError(res.error);
          return;
        }

        setParsedDoc(res);
        setSourceFileName(res.fileName);
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
          setCandidates(res.candidates);
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

  const handleFileDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const resolvedExistingPlates = useMemo(
    () => targetClass?.plates ?? existingPlates ?? [],
    [targetClass, existingPlates]
  );

  const effectiveMode: PlateImportMode = allowReplaceMode ? mode : 'replace';

  const previewRows: PreviewPlateRow[] = useMemo(() => {
    return buildPlatePreviewRows(
      candidates,
      resolvedExistingPlates,
      effectiveMode,
      selectionMap
    );
  }, [candidates, resolvedExistingPlates, effectiveMode, selectionMap]);

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

  if (!open) return null;

  const resolvedTargetName =
    targetClass?.name ?? (targetClassName?.trim() || 'Nuova classe');
  const resolvedSchoolYear =
    targetClass?.schoolYear ?? (targetSchoolYear?.trim() || '');
  const hasLoadedSource = Boolean(parsedDoc || candidates.length > 0);
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

  const handleExcelConfigChange = (patch: Partial<PlateExcelColumnConfig>) => {
    if (!parsedDoc || parsedDoc.kind !== 'excel' || !excelConfig) return;
    const nextCfg = { ...excelConfig, ...patch };
    setExcelConfig(nextCfg);
    applyExcelExtraction(parsedDoc, sheetIdx, nextCfg);
  };

  const handleToggleRow = (row: PreviewPlateRow) => {
    if (row.isDuplicateInClass || row.isDuplicateInFile) return;
    setConfirmReplace(false);
    setSelectionMap((prev) => {
      const next = new Map(prev);
      next.set(row.tempId, !row.selected);
      return next;
    });
  };

  const handleSelectAllNew = (checked: boolean) => {
    setConfirmReplace(false);
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

  const handleUpdateTitle = (tempId: string, nextTitle: string) => {
    setConfirmReplace(false);
    setCandidates((prev) =>
      prev.map((c) => (c.tempId === tempId ? { ...c, title: nextTitle } : c))
    );
  };

  const handleRemoveRow = (tempId: string) => {
    setConfirmReplace(false);
    setCandidates((prev) => prev.filter((c) => c.tempId !== tempId));
    setSelectionMap((prev) => {
      const next = new Map(prev);
      next.delete(tempId);
      return next;
    });
  };

  const handleMoveRow = (fromIdx: number, toIdx: number) => {
    if (
      fromIdx < 0 ||
      toIdx < 0 ||
      fromIdx >= candidates.length ||
      toIdx >= candidates.length ||
      fromIdx === toIdx
    ) {
      return;
    }
    setConfirmReplace(false);
    setCandidates((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      // After manual reordering, re-number progressively in the new order
      return next.map((c) => ({
        tempId: c.tempId,
        title: c.title,
        rawSource: c.rawSource,
      }));
    });
  };

  const handleAddManualPlate = () => {
    const clean = normalizePlateTitleValue(manualTitle);
    if (!clean) return;
    setConfirmReplace(false);
    setError('');
    setCandidates((prev) => [
      ...prev,
      {
        tempId: nextPlateTempId(),
        title: clean,
        rawSource: clean,
      },
    ]);
    if (!sourceFileName) {
      setSourceFileName('Elenco personalizzato');
    }
    setManualTitle('');
  };

  const requiresReplaceConfirmation =
    allowReplaceMode &&
    effectiveMode === 'replace' &&
    resolvedExistingPlates.length > 0;

  const handleConfirmClick = () => {
    const chosen: ExternalPlateEntry[] = previewRows
      .filter(
        (r) =>
          r.selected &&
          !r.isDuplicateInClass &&
          !r.isDuplicateInFile &&
          normalizePlateTitleValue(r.title) !== ''
      )
      .map((r) => ({
        title: normalizePlateTitleValue(r.title),
        ...(r.assignedNumber !== null ? { number: r.assignedNumber } : {}),
      }));

    if (chosen.length === 0) return;

    if (requiresReplaceConfirmation && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }

    onConfirm(chosen, effectiveMode, sourceFileName || 'file esterno');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plate-import-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2
              id="plate-import-title"
              className="font-display text-base font-semibold text-slate-900"
            >
              Importa elenco tavole da file
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Classe di destinazione:{' '}
              <span className="font-semibold text-slate-900">
                {resolvedTargetName}
              </span>
              {resolvedSchoolYear ? ` (${resolvedSchoolYear})` : ''} · Elaborazione locale nel browser
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi importazione tavole"
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

          {/* Dropzone or loaded file bar */}
          {!hasLoadedSource ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDraggingFile(true);
              }}
              onDragLeave={() => setDraggingFile(false)}
              onDrop={handleFileDrop}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                draggingFile
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-300 bg-slate-50/60 hover:border-slate-400'
              }`}
            >
              <Upload className="h-7 w-7 text-blue-700" />
              <p className="mt-2.5 text-sm font-semibold text-slate-900">
                {loading
                  ? 'Lettura del file in corso...'
                  : 'Seleziona o trascina un file con l’elenco delle tavole'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Formati supportati: Excel (.xlsx, .xls), Word (.docx, .doc) e
                Testo (.txt)
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Verranno acquisiti esclusivamente i titoli delle tavole (nessun voto, studente o consegna).
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
                {parsedDoc?.kind === 'excel' ? (
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-blue-700" />
                )}
                <span className="truncate text-xs font-semibold text-slate-900">
                  {sourceFileName || 'Elenco tavole'}
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

          {/* Excel sheet & column controls */}
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
                  Disposizione elenco
                </label>
                <select
                  value={excelConfig.orientation}
                  onChange={(e) =>
                    handleExcelConfigChange({
                      orientation: e.target.value as 'rows' | 'columns',
                    })
                  }
                  className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="rows">Verticale (per righe)</option>
                  <option value="columns">Orizzontale (per colonne)</option>
                </select>
              </div>

              {excelConfig.orientation === 'rows' && (
                <>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600">
                      Colonna Titolo tavola
                    </label>
                    <select
                      value={excelConfig.titleCol}
                      onChange={(e) =>
                        handleExcelConfigChange({
                          titleCol: Number(e.target.value),
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
                      Colonna Numero (opz.)
                    </label>
                    <select
                      value={excelConfig.numberCol}
                      onChange={(e) =>
                        handleExcelConfigChange({
                          numberCol: Number(e.target.value),
                        })
                      }
                      className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value={-1}>Automatica / nel titolo</option>
                      {activeSheet.columnLabels.map((lbl, idx) => (
                        <option key={idx} value={idx}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {excelConfig.orientation === 'rows' && (
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
              )}
            </div>
          )}

          {/* Mode selector when importing into an existing class */}
          {hasLoadedSource && allowReplaceMode && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">
                  Modalità di importazione nella classe:
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('append');
                      setConfirmReplace(false);
                    }}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      mode === 'append'
                        ? 'border-blue-700 bg-blue-700 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Aggiungi (no duplicati)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('replace');
                      setConfirmReplace(false);
                    }}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      mode === 'replace'
                        ? 'border-amber-600 bg-amber-600 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Sostituisci elenco
                  </button>
                </div>
              </div>

              {requiresReplaceConfirmation && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                  <div>
                    <span className="font-semibold">
                      Attenzione alla sostituzione:
                    </span>{' '}
                    le {resolvedExistingPlates.length} tavole attuali di &quot;
                    {resolvedTargetName}&quot; e i relativi voti saranno sostituiti dal nuovo elenco. Studenti e cartelline resteranno intatti.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Preview Counters + Table + Manual Add */}
          {hasLoadedSource && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-3 tabular-nums">
                  <span className="font-medium text-slate-700">
                    Individuate:{' '}
                    <strong className="text-slate-900">
                      {stats.totalDetected}
                    </strong>
                  </span>
                  <span className="font-medium text-blue-800">
                    Da importare: <strong>{stats.selectedCount}</strong>
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
                    Seleziona tutte le nuove
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => handleSelectAllNew(false)}
                    className="text-[11px] font-medium text-slate-600 hover:underline"
                  >
                    Deseleziona tutte
                  </button>
                </div>
              </div>

              {previewRows.length === 0 ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
                  Nessuna tavola individuata con la configurazione corrente.
                  Prova a cambiare foglio/colonna oppure aggiungi manualmente le tavole qui sotto.
                </div>
              ) : (
                <div
                  className="max-h-[300px] overflow-y-auto rounded-md border border-slate-200"
                  onDragLeave={(e) => {
                    if (
                      !e.currentTarget.contains(e.relatedTarget as Node | null)
                    ) {
                      setDropInsertionIdx(null);
                    }
                  }}
                >
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-700">
                      <tr>
                        <th className="w-8 px-1.5 py-2 text-center" aria-label="Ordine" />
                        <th className="w-9 px-2 py-2 text-center">Sel.</th>
                        <th className="w-14 px-2 py-2 text-center">Codice</th>
                        <th className="px-2.5 py-2">Titolo tavola</th>
                        <th className="w-28 px-2 py-2">Stato</th>
                        <th className="w-24 px-2 py-2 text-right">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {previewRows.map((row, idx) => {
                        const isDup =
                          row.isDuplicateInClass || row.isDuplicateInFile;
                        const isDragging = draggedIdx === idx;
                        const showTopLine =
                          draggedIdx !== null &&
                          dropInsertionIdx === idx &&
                          dropInsertionIdx !== draggedIdx &&
                          dropInsertionIdx !== draggedIdx + 1;
                        const showBottomLine =
                          draggedIdx !== null &&
                          idx === previewRows.length - 1 &&
                          dropInsertionIdx === previewRows.length &&
                          draggedIdx !== previewRows.length - 1;

                        return (
                          <tr
                            key={row.tempId}
                            draggable={previewRows.length > 1}
                            onDragStart={(e) => {
                              const targetEl = e.target as HTMLElement | null;
                              if (targetEl?.closest('input, button')) {
                                e.preventDefault();
                                return;
                              }
                              setDraggedIdx(idx);
                              setDropInsertionIdx(idx);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', row.tempId);
                            }}
                            onDragOver={(e) => {
                              if (draggedIdx === null) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              const rect =
                                e.currentTarget.getBoundingClientRect();
                              const nextIns =
                                e.clientY < rect.top + rect.height / 2
                                  ? idx
                                  : idx + 1;
                              if (dropInsertionIdx !== nextIns) {
                                setDropInsertionIdx(nextIns);
                              }
                            }}
                            onDrop={(e) => {
                              if (draggedIdx === null) return;
                              e.preventDefault();
                              const insertion = dropInsertionIdx ?? idx;
                              const targetIdx =
                                insertion > draggedIdx
                                  ? insertion - 1
                                  : insertion;
                              if (targetIdx !== draggedIdx) {
                                handleMoveRow(draggedIdx, targetIdx);
                              }
                              setDraggedIdx(null);
                              setDropInsertionIdx(null);
                            }}
                            onDragEnd={() => {
                              setDraggedIdx(null);
                              setDropInsertionIdx(null);
                            }}
                            className={`relative transition-opacity ${
                              isDup
                                ? 'bg-amber-50/60'
                                : row.selected
                                ? 'bg-white'
                                : 'bg-slate-50/60 text-slate-400'
                            } ${isDragging ? 'opacity-45' : ''} ${
                              showTopLine ? 'border-t-2 border-t-blue-600' : ''
                            } ${
                              showBottomLine
                                ? 'border-b-2 border-b-blue-600'
                                : ''
                            }`}
                          >
                            <td className="px-1.5 py-1.5 text-center">
                              <span
                                title="Trascina per riordinare"
                                className="inline-flex cursor-grab items-center justify-center text-slate-400 hover:text-slate-700 active:cursor-grabbing"
                              >
                                <GripVertical className="h-3.5 w-3.5" />
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={row.selected}
                                disabled={isDup}
                                onChange={() => handleToggleRow(row)}
                                aria-label={`Seleziona tavola ${row.title}`}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 disabled:opacity-40"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-center font-mono text-[11px] font-bold text-blue-900 tabular-nums">
                              {row.assignedNumber !== null
                                ? `T${row.assignedNumber}`
                                : '—'}
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={row.title}
                                onChange={(e) =>
                                  handleUpdateTitle(row.tempId, e.target.value)
                                }
                                placeholder="Titolo tavola"
                                className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-2 py-1.5">
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
                                  Nuova
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <div className="inline-flex items-center gap-0.5">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveRow(idx, idx - 1)}
                                  title="Sposta su"
                                  aria-label={`Sposta su ${row.title}`}
                                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-700 disabled:opacity-30"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === previewRows.length - 1}
                                  onClick={() => handleMoveRow(idx, idx + 1)}
                                  title="Sposta giù"
                                  aria-label={`Sposta giù ${row.title}`}
                                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-700 disabled:opacity-30"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRow(row.tempId)}
                                  title="Elimina riga"
                                  aria-label={`Elimina ${row.title}`}
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

              {/* Manual add missing plate row */}
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2">
                <input
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddManualPlate();
                    }
                  }}
                  placeholder="Aggiungi manualmente una tavola mancante (es. Sezioni di solidi)..."
                  className="h-8 min-w-[200px] flex-1 rounded border border-slate-300 bg-white px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!manualTitle.trim()}
                  onClick={handleAddManualPlate}
                  className="inline-flex h-8 items-center gap-1 rounded border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Aggiungi tavola
                </button>
              </div>

              {unrecognizedLines.length > 0 && (
                <p className="text-[11px] text-slate-500">
                  Righe ignorate automaticamente (intestazioni, date o testo non pertinente):{' '}
                  {unrecognizedLines.length}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5">
          <p className="text-[11px] text-slate-500">
            {footerNote ??
              'Vengono importati solo i titoli delle tavole nell’ordine mostrato, con numerazione gestita da TabScore.'}
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
              disabled={stats.selectedCount === 0}
              onClick={handleConfirmClick}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                requiresReplaceConfirmation
                  ? 'bg-amber-700 hover:bg-amber-800'
                  : 'bg-blue-700 hover:bg-blue-800'
              }`}
            >
              {confirmButtonLabel
                ? `${confirmButtonLabel} (${stats.selectedCount})`
                : requiresReplaceConfirmation && confirmReplace
                ? `Conferma sostituzione (${stats.selectedCount})`
                : requiresReplaceConfirmation
                ? `Sostituisci con ${stats.selectedCount} ${
                    stats.selectedCount === 1 ? 'tavola' : 'tavole'
                  }`
                : `Importa ${stats.selectedCount} ${
                    stats.selectedCount === 1 ? 'tavola' : 'tavole'
                  }`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
