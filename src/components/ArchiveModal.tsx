import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderOpen,
  HardDrive,
  HardDriveDownload,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type {
  ClassData,
  FullBackupArchive,
  GradebookStoreState,
  SingleClassArchive,
} from '../types/gradebook';
import {
  clearDedicatedBackupFolder,
  getDedicatedBackupFolderName,
  isDirectoryPickerSupported,
  isSaveFilePickerSupported,
  saveFullBackupLocally,
  saveFullBackupToDedicatedFolder,
  saveSingleClassBackupLocally,
  selectDedicatedBackupFolder,
  summarizeArchiveForConfirmation,
  type ArchivePreviewSummary,
} from '../utils/localBackup';
import type { PersistenceEngine } from '../utils/localDatabase';
import {
  exportClassToExcel,
  validateImportedArchive,
} from '../utils/storage';

interface ArchiveModalProps {
  open: boolean;
  storeState: GradebookStoreState;
  activeClass: ClassData | null;
  storageEngine: PersistenceEngine;
  lastSavedAt: string | null;
  onImportSingleClass: (
    archive: SingleClassArchive,
    mode: 'add_new' | 'replace_existing'
  ) => void;
  onImportFullBackup: (backup: FullBackupArchive) => void;
  onLogExport: (action: string, details: string) => void;
  onClose: () => void;
}

type PendingImport =
  | {
      kind: 'single_class';
      archive: SingleClassArchive;
      alreadyExists: boolean;
      summary: ArchivePreviewSummary;
    }
  | {
      kind: 'full_backup';
      archive: FullBackupArchive;
      summary: ArchivePreviewSummary;
    };

function formatDateTimeIt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ArchiveModal({
  open,
  storeState,
  activeClass,
  storageEngine,
  lastSavedAt,
  onImportSingleClass,
  onImportFullBackup,
  onLogExport,
  onClose,
}: ArchiveModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [dedicatedFolderName, setDedicatedFolderName] = useState<string | null>(
    null
  );

  const supportsDirPicker = isDirectoryPickerSupported();
  const supportsSavePicker = isSaveFilePickerSupported();

  useEffect(() => {
    if (!open) return;
    setImportError('');
    setImportSuccess('');
    setPendingImport(null);
    setBackupBusy(false);
    setBackupSuccess(null);
    setBackupError(null);

    let active = true;
    void getDedicatedBackupFolderName().then((name) => {
      if (active) setDedicatedFolderName(name);
    });
    return () => {
      active = false;
    };
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

  const totalAttachments = storeState.classes.reduce(
    (sum, cls) => sum + cls.plates.filter((p) => Boolean(p.imageDataUrl)).length,
    0
  );

  const handleChooseDedicatedFolder = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      const res = await selectDedicatedBackupFolder();
      if (res.ok) {
        setDedicatedFolderName(res.folderName);
        setBackupSuccess(
          `Cartella locale di backup impostata: "${res.folderName}".`
        );
      } else if (!res.cancelled && res.error) {
        setBackupError(res.error);
      }
    } finally {
      setBackupBusy(false);
    }
  };

  const handleClearDedicatedFolder = async () => {
    await clearDedicatedBackupFolder();
    setDedicatedFolderName(null);
    setBackupSuccess(null);
    setBackupError(null);
  };

  const handleSaveToDedicatedFolder = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      const res = await saveFullBackupToDedicatedFolder(storeState);
      if (res.ok) {
        const sizeKb = Math.max(1, Math.round(res.sizeBytes / 1024));
        if (res.folderName) setDedicatedFolderName(res.folderName);
        setBackupSuccess(
          `Backup salvato in "${res.folderName ?? 'Cartella backup'}/${res.fileName}" (${sizeKb} KB).`
        );
        onLogExport(
          'Backup completo locale (.json)',
          `Salvato backup completo "${res.fileName}" nella cartella locale "${res.folderName ?? 'dedicata'}" (${storeState.classes.length} classi).`
        );
      } else if (!res.cancelled && res.error) {
        setBackupError(res.error);
      }
    } finally {
      setBackupBusy(false);
    }
  };

  const handleSaveFullBackup = async (preferDownload = false) => {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      const res = await saveFullBackupLocally(storeState, { preferDownload });
      if (res.ok) {
        const sizeKb = Math.max(1, Math.round(res.sizeBytes / 1024));
        setBackupSuccess(
          res.method === 'file_picker'
            ? `Backup locale salvato come "${res.fileName}" (${sizeKb} KB).`
            : `Download locale avviato: "${res.fileName}" (${sizeKb} KB).`
        );
        onLogExport(
          'Backup completo locale (.json)',
          `Esportato backup completo locale "${res.fileName}" (${storeState.classes.length} classi).`
        );
      } else if (!res.cancelled && res.error) {
        setBackupError(res.error);
      }
    } finally {
      setBackupBusy(false);
    }
  };

  const handleSaveSingleClassJson = async () => {
    if (!activeClass || backupBusy) return;
    setBackupBusy(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      const res = await saveSingleClassBackupLocally(
        activeClass,
        storeState.auditLog
      );
      if (res.ok) {
        const sizeKb = Math.max(1, Math.round(res.sizeBytes / 1024));
        setBackupSuccess(
          `Archivio classe salvato come "${res.fileName}" (${sizeKb} KB).`
        );
        onLogExport(
          'Esportazione archivio classe (.json)',
          `Esportato archivio JSON locale della classe "${activeClass.name}".`
        );
      } else if (!res.cancelled && res.error) {
        setBackupError(res.error);
      }
    } finally {
      setBackupBusy(false);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportError('');
    setImportSuccess('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const validation = validateImportedArchive(parsed);
      if (!validation.ok) {
        setImportError(validation.error);
        setPendingImport(null);
        return;
      }

      const summary = summarizeArchiveForConfirmation(validation.archive);

      if (validation.kind === 'single_class') {
        const exists = storeState.classes.some(
          (c) => c.id === validation.archive.classData.id
        );
        setPendingImport({
          kind: 'single_class',
          archive: validation.archive,
          alreadyExists: exists,
          summary,
        });
      } else {
        setPendingImport({
          kind: 'full_backup',
          archive: validation.archive,
          summary,
        });
      }
    } catch {
      setImportError('Impossibile leggere il file JSON selezionato. Verifica che il file non sia danneggiato.');
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
            Archivio locale, backup e ripristino
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
          {/* Local-only persistence assurance */}
          <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-950">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="min-w-0 space-y-0.5">
              <div className="font-semibold">
                Archiviazione esclusivamente locale sul dispositivo
              </div>
              <div className="text-[11px] text-emerald-900">
                Nessun dato viene inviato a server esterni o servizi cloud. Motore attivo:{' '}
                <strong>
                  {storageEngine === 'indexeddb' ? 'IndexedDB' : 'Archivio browser'}
                </strong>
                {lastSavedAt ? ` · Ultimo salvataggio: ${formatDateTimeIt(lastSavedAt)}` : ''}.
              </div>
            </div>
          </div>

          {/* Export & Local Backup section */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Backup completo locale (.json)
            </h3>

            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="text-xs text-slate-600">
                Include tutte le <strong>{storeState.classes.length} classi</strong>, studenti, tavole, cartelline, voti, penalità, esenzioni, impostazioni, cronologia
                {totalAttachments > 0
                  ? ` e ${totalAttachments} allegat${totalAttachments === 1 ? 'o' : 'i'} (immagini/PDF)`
                  : ''}.
              </div>

              {supportsDirPicker && (
                <div className="space-y-2 rounded-md border border-blue-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-800">
                      <FolderOpen className="h-4 w-4 shrink-0 text-blue-700" />
                      <span className="truncate">
                        {dedicatedFolderName
                          ? `Cartella backup dedicata: ${dedicatedFolderName}`
                          : 'Cartella locale dedicata ai backup'}
                      </span>
                    </div>
                    {dedicatedFolderName && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={backupBusy}
                          onClick={() => void handleChooseDedicatedFolder()}
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Cambia
                        </button>
                        <button
                          type="button"
                          disabled={backupBusy}
                          onClick={() => void handleClearDedicatedFolder()}
                          title="Rimuovi cartella predefinita"
                          className="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {dedicatedFolderName ? (
                    <button
                      type="button"
                      disabled={backupBusy}
                      onClick={() => void handleSaveToDedicatedFolder()}
                      className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-70"
                    >
                      {backupBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <HardDriveDownload className="h-4 w-4" />
                      )}
                      Salva backup nella cartella "{dedicatedFolderName}"
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={backupBusy}
                      onClick={() => void handleChooseDedicatedFolder()}
                      className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-900 hover:bg-blue-100 disabled:opacity-60"
                    >
                      <FolderOpen className="h-4 w-4 text-blue-700" />
                      Scegli cartella locale di backup
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={backupBusy}
                  onClick={() => void handleSaveFullBackup(false)}
                  className={`flex flex-1 items-center justify-between rounded-md border px-3.5 py-2.5 text-left transition-colors disabled:opacity-60 ${
                    supportsDirPicker && dedicatedFolderName
                      ? 'border-slate-300 bg-white text-slate-900 hover:border-blue-300 hover:bg-blue-50/40'
                      : 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <HardDriveDownload className="h-4 w-4 shrink-0" />
                    <div>
                      <div className="text-xs font-semibold">
                        {supportsSavePicker
                          ? 'Salva backup scegliendo cartella…'
                          : 'Scarica backup completo (.json)'}
                      </div>
                      <div
                        className={`text-[11px] ${
                          supportsDirPicker && dedicatedFolderName
                            ? 'text-slate-500'
                            : 'text-blue-100'
                        }`}
                      >
                        File con data e ora: BACKUP_TabScore_AAAA-MM-GG_HH-MM-SS.json
                      </div>
                    </div>
                  </div>
                  <Download className="h-4 w-4 shrink-0 opacity-80" />
                </button>
              </div>

              {supportsSavePicker && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={backupBusy}
                    onClick={() => void handleSaveFullBackup(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline disabled:opacity-50"
                  >
                    <Download className="h-3 w-3" />
                    Oppure avvia download diretto nel browser
                  </button>
                </div>
              )}

              {!supportsDirPicker && !supportsSavePicker && (
                <p className="text-[11px] text-slate-500">
                  Questo browser gestisce la cartella di destinazione tramite il download standard del dispositivo.
                </p>
              )}

              {backupSuccess && (
                <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{backupSuccess}</span>
                </div>
              )}

              {backupError && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
                  {backupError}
                </div>
              )}
            </div>
          </section>

          {/* Single-class exports */}
          <section className="space-y-2.5 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">
              Esportazione singola classe
            </h3>
            <div className="grid grid-cols-1 gap-2.5">
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
                disabled={!activeClass || backupBusy}
                onClick={() => void handleSaveSingleClassJson()}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/40 disabled:opacity-40"
              >
                <div className="flex items-center gap-3">
                  <HardDrive className="h-5 w-5 text-blue-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Esporta archivio singola classe (.json)
                    </div>
                    <div className="text-xs text-slate-500">
                      Salva tutti i dati, allegati, impostazioni e valutazioni di {activeClass?.name ?? 'questa classe'}
                    </div>
                  </div>
                </div>
                <Download className="h-4 w-4 text-slate-400" />
              </button>
            </div>
          </section>

          {/* Import / Restore section */}
          <section className="space-y-3 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">
              Importazione e ripristino da file locale (.json)
            </h3>
            <p className="text-xs text-slate-500">
              Seleziona un backup completo o l’archivio di una singola classe esportato da TabScore. Prima di modificare i dati locali verranno verificati formato e integrità.
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
              Seleziona file backup (.json)
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
                    Archivio classe verificato: {pendingImport.archive.classData.name}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    {pendingImport.summary.studentCount} studenti ·{' '}
                    {pendingImport.summary.plateCount} tavole ·{' '}
                    {pendingImport.summary.folderCount} cartelline
                    {pendingImport.summary.attachmentCount > 0
                      ? ` · ${pendingImport.summary.attachmentCount} allegati`
                      : ''}
                    {pendingImport.summary.exportedAt
                      ? ` · Esportato il ${formatDateTimeIt(pendingImport.summary.exportedAt)}`
                      : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onImportSingleClass(pendingImport.archive, 'add_new');
                      setPendingImport(null);
                      setImportSuccess('Classe importata e aggiunta al registro locale.');
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
                        setImportSuccess('Classe esistente aggiornata dall’archivio locale.');
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
                    Ripristino backup completo verificato ({pendingImport.summary.classCount} classi)
                  </div>
                  <div className="mt-0.5 text-xs text-slate-700">
                    {pendingImport.summary.studentCount} studenti ·{' '}
                    {pendingImport.summary.plateCount} tavole ·{' '}
                    {pendingImport.summary.folderCount} cartelline
                    {pendingImport.summary.attachmentCount > 0
                      ? ` · ${pendingImport.summary.attachmentCount} allegati`
                      : ''}
                    {pendingImport.summary.exportedAt
                      ? ` · Creato il ${formatDateTimeIt(pendingImport.summary.exportedAt)}`
                      : ''}
                  </div>
                  <div className="mt-1.5 text-xs text-amber-900">
                    Attenzione: il ripristino sostituirà l’archivio attuale su questo dispositivo con il contenuto del backup selezionato.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onImportFullBackup(pendingImport.archive);
                      setPendingImport(null);
                      setImportSuccess('Backup completo ripristinato con successo nell’archivio locale.');
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
