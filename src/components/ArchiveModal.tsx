import { Download, FileSpreadsheet, HardDriveDownload, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type {
  ClassData,
  FullBackupArchive,
  GradebookStoreState,
  SingleClassArchive,
} from '../types/gradebook';
import {
  exportClassToExcel,
  exportFullBackupJson,
  exportSingleClassJson,
  validateImportedArchive,
} from '../utils/storage';

interface ArchiveModalProps {
  open: boolean;
  storeState: GradebookStoreState;
  activeClass: ClassData | null;
  onImportSingleClass: (
    archive: SingleClassArchive,
    mode: 'add_new' | 'replace_existing'
  ) => void;
  onImportFullBackup: (backup: FullBackupArchive) => void;
  onLogExport: (action: string, details: string) => void;
  onClose: () => void;
}

type PendingImport =
  | { kind: 'single_class'; archive: SingleClassArchive; alreadyExists: boolean }
  | { kind: 'full_backup'; archive: FullBackupArchive };

export function ArchiveModal({
  open,
  storeState,
  activeClass,
  onImportSingleClass,
  onImportFullBackup,
  onLogExport,
  onClose,
}: ArchiveModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  useEffect(() => {
    if (!open) return;
    setImportError('');
    setImportSuccess('');
    setPendingImport(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportError('');
    setImportSuccess('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validation = validateImportedArchive(parsed);
      if (!validation.ok) {
        setImportError(validation.error);
        setPendingImport(null);
        return;
      }

      if (validation.kind === 'single_class') {
        const exists = storeState.classes.some(
          (c) => c.id === validation.archive.classData.id
        );
        setPendingImport({
          kind: 'single_class',
          archive: validation.archive,
          alreadyExists: exists,
        });
      } else {
        setPendingImport({
          kind: 'full_backup',
          archive: validation.archive,
        });
      }
    } catch {
      setImportError('Impossibile leggere il file JSON selezionato.');
      setPendingImport(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2
            id="archive-modal-title"
            className="font-display text-base font-semibold text-slate-900"
          >
            Esportazione, backup e importazione dati
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
          {/* Export section */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Esportazione e backup
            </h3>

            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                disabled={!activeClass}
                onClick={() => {
                  if (!activeClass) return;
                  exportClassToExcel(activeClass);
                  onLogExport(
                    'Esportazione Excel (.xlsx)',
                    `Esportata classe "${activeClass.name}" in formato Microsoft Excel.`
                  );
                }}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-left hover:border-emerald-300 hover:bg-emerald-50/40 disabled:opacity-40"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Esporta classe in formato Excel (.xlsx)
                    </div>
                    <div className="text-xs text-slate-500">
                      {activeClass
                        ? `Include fogli Registro Valutazioni, Dettaglio Cartelline e Tavole per ${activeClass.name}`
                        : 'Seleziona una classe per esportare'}
                    </div>
                  </div>
                </div>
                <Download className="h-4 w-4 text-slate-400" />
              </button>

              <button
                type="button"
                disabled={!activeClass}
                onClick={() => {
                  if (!activeClass) return;
                  exportSingleClassJson(activeClass, storeState.auditLog);
                  onLogExport(
                    'Esportazione archivio classe (.json)',
                    `Esportato archivio JSON della classe "${activeClass.name}".`
                  );
                }}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/40 disabled:opacity-40"
              >
                <div className="flex items-center gap-3">
                  <Download className="h-5 w-5 text-blue-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Esporta archivio singola classe (.json)
                    </div>
                    <div className="text-xs text-slate-500">
                      Salva tutti i dati, impostazioni e valutazioni di {activeClass?.name ?? 'questa classe'}
                    </div>
                  </div>
                </div>
                <Download className="h-4 w-4 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  exportFullBackupJson(storeState);
                  onLogExport(
                    'Backup completo (.json)',
                    `Esportato backup completo con ${storeState.classes.length} classi.`
                  );
                }}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-400 hover:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <HardDriveDownload className="h-5 w-5 text-slate-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Backup completo di tutte le classi (.json)
                    </div>
                    <div className="text-xs text-slate-500">
                      Archivio integrale di {storeState.classes.length} classi e cronologia operazioni
                    </div>
                  </div>
                </div>
                <Download className="h-4 w-4 text-slate-400" />
              </button>
            </div>
          </section>

          {/* Import section */}
          <section className="space-y-3 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">
              Importazione archivio (.json)
            </h3>
            <p className="text-xs text-slate-500">
              Puoi importare sia il file di una singola classe sia un backup completo precedentemente esportato.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              <Upload className="h-4 w-4" />
              Seleziona file archivio (.json)
            </button>

            {importError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
                {importError}
              </div>
            )}

            {importSuccess && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
                {importSuccess}
              </div>
            )}

            {pendingImport && pendingImport.kind === 'single_class' && (
              <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50/70 p-4 text-sm">
                <div>
                  <div className="font-semibold text-slate-900">
                    Archivio classe pronto: {pendingImport.archive.classData.name}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    {pendingImport.archive.classData.students.length} studenti ·{' '}
                    {pendingImport.archive.classData.plates.length} tavole ·{' '}
                    {pendingImport.archive.classData.folders.length} cartelline
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onImportSingleClass(pendingImport.archive, 'add_new');
                      setPendingImport(null);
                      setImportSuccess('Classe importata e aggiunta al registro.');
                    }}
                    className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
                  >
                    Importa come nuova classe
                  </button>
                  {pendingImport.alreadyExists && (
                    <button
                      type="button"
                      onClick={() => {
                        onImportSingleClass(
                          pendingImport.archive,
                          'replace_existing'
                        );
                        setPendingImport(null);
                        setImportSuccess('Classe esistente aggiornata dall’archivio.');
                      }}
                      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    >
                      Sovrascrivi classe esistente
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingImport(null)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}

            {pendingImport && pendingImport.kind === 'full_backup' && (
              <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
                <div>
                  <div className="font-semibold text-slate-900">
                    Ripristino backup completo ({pendingImport.archive.classes.length} classi)
                  </div>
                  <div className="mt-0.5 text-xs text-amber-900">
                    Attenzione: il ripristino sostituirà le classi attualmente salvate nel browser con quelle contenute nel backup.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onImportFullBackup(pendingImport.archive);
                      setPendingImport(null);
                      setImportSuccess('Backup completo ripristinato con successo.');
                    }}
                    className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800"
                  >
                    Conferma ripristino completo
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingImport(null)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
