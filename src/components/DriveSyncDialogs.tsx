import {
  AlertTriangle,
  CloudDownload,
  CloudUpload,
  Download,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import type { PendingDriveDialog } from '../hooks/useGoogleDriveSync';
import type { TabScoreSyncSummary } from '../services/googleDriveSync';

interface DriveSyncDialogsProps {
  dialog: PendingDriveDialog | null;
  isBusy: boolean;
  onPushLocalToDrive: () => void;
  onRestoreFromDrive: () => void;
  onConfirmEnableAutoSync: () => void;
  onDownloadLocalBackup: () => void;
  onClose: () => void;
}

function formatSummaryLine(summary: TabScoreSyncSummary): string {
  return `${summary.classCount} ${
    summary.classCount === 1 ? 'classe' : 'classi'
  } · ${summary.studentCount} studenti · ${summary.plateCount} tavole${
    summary.imageCount > 0 ? ` · ${summary.imageCount} immagini` : ''
  }`;
}

function formatDateTimeIt(iso: string | null | undefined): string {
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

export function DriveSyncDialogs({
  dialog,
  isBusy,
  onPushLocalToDrive,
  onRestoreFromDrive,
  onConfirmEnableAutoSync,
  onDownloadLocalBackup,
  onClose,
}: DriveSyncDialogsProps) {
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, isBusy, onClose]);

  if (!dialog) return null;

  const remotePayload =
    dialog.inspection?.remotePayload ?? null;
  const remoteSummary = remotePayload?.summary ?? null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-dialog-title"
    >
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-2xl">
        {/* CONFLICT DIALOG */}
        {dialog.kind === 'conflict' && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-800">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div>
                  <h3
                    id="drive-dialog-title"
                    className="font-display text-base font-semibold text-slate-900"
                  >
                    Conflitto tra dati locali e Google Drive
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Nella cartella <strong>SYNC_TabScore</strong> è presente una versione diversa da quella su questo dispositivo. Scegli come procedere senza rischiare perdite di dati.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={onClose}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Su questo dispositivo
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-900">
                    {formatSummaryLine(dialog.localSummary)}
                  </div>
                </div>
                <div className="rounded-md border border-blue-200 bg-blue-50/70 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-800">
                    Su Google Drive (SYNC_TabScore)
                  </div>
                  <div className="mt-1 text-xs font-medium text-blue-950">
                    {remoteSummary ? formatSummaryLine(remoteSummary) : 'Archivio presente'}
                  </div>
                  {remotePayload && (
                    <div className="mt-1 text-[11px] text-blue-700">
                      Aggiornato: {formatDateTimeIt(remotePayload.updatedAt)} (rev. {remotePayload.revision})
                    </div>
                  )}
                </div>
              </div>

              {dialog.conflicts && dialog.conflicts.length > 0 && (
                <div className="rounded-md border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-900">
                  <div className="font-semibold text-rose-950">
                    Elementi modificati in modo incompatibile su entrambi i dispositivi:
                  </div>
                  <ul className="mt-1.5 max-h-28 list-disc space-y-1 overflow-y-auto pl-4 text-[11px]">
                    {dialog.conflicts.slice(0, 6).map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                    {dialog.conflicts.length > 6 && (
                      <li>
                        …e altri {dialog.conflicts.length - 6} elementi in conflitto.
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <span>
                  Prima di qualsiasi ripristino da Google Drive viene creato automaticamente un backup locale di sicurezza dei dati attuali.
                </span>
              </div>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onPushLocalToDrive}
                  className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  <CloudUpload className="h-4 w-4" />
                  {isBusy ? 'Operazione in corso…' : 'Mantieni i dati locali e aggiorna Google Drive'}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onRestoreFromDrive}
                  className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50"
                >
                  <CloudDownload className="h-4 w-4" />
                  Scarica e ripristina da Google Drive (con backup di sicurezza)
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={onDownloadLocalBackup}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Scarica copia locale .json prima di decidere
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={onClose}
                    className="min-h-9 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Decidi dopo
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* CONFIRM RESTORE DIALOG */}
        {dialog.kind === 'confirm_restore' && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-800">
                  <CloudDownload className="h-4 w-4" />
                </span>
                <div>
                  <h3
                    id="drive-dialog-title"
                    className="font-display text-base font-semibold text-slate-900"
                  >
                    Ripristinare l’archivio da Google Drive?
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    I dati presenti nella cartella <strong>SYNC_TabScore</strong> sostituiranno quelli attualmente aperti su questo dispositivo.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={onClose}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Dati locali attuali
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-900">
                    {formatSummaryLine(dialog.localSummary)}
                  </div>
                </div>
                <div className="rounded-md border border-blue-200 bg-blue-50/70 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-800">
                    Archivio Google Drive
                  </div>
                  <div className="mt-1 text-xs font-medium text-blue-950">
                    {remoteSummary ? formatSummaryLine(remoteSummary) : 'Archivio valido'}
                  </div>
                  {remotePayload && (
                    <div className="mt-1 text-[11px] text-blue-700">
                      Salvato: {formatDateTimeIt(remotePayload.updatedAt)}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <span>
                  Prima del ripristino verrà salvato un backup locale di sicurezza, così potrai sempre tornare indietro in caso di necessità.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onClose}
                  className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onRestoreFromDrive}
                  className="min-h-10 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {isBusy ? 'Ripristino in corso…' : 'Conferma ripristino'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* CONFIRM INITIAL UPLOAD TO DRIVE */}
        {dialog.kind === 'confirm_overwrite_drive' && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-800">
                  <CloudUpload className="h-4 w-4" />
                </span>
                <div>
                  <h3
                    id="drive-dialog-title"
                    className="font-display text-base font-semibold text-slate-900"
                  >
                    Avviare la sincronizzazione su Google Drive?
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    TabScore salverà l’archivio completo (classi, studenti, tavole, immagini e cartelline) nella cartella dedicata <strong>SYNC_TabScore</strong> del tuo Google Drive.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={onClose}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                <div className="font-semibold text-slate-900">Contenuto che verrà sincronizzato:</div>
                <div className="mt-1">{formatSummaryLine(dialog.localSummary)}</div>
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onClose}
                  className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Non ora
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onPushLocalToDrive}
                  className="min-h-10 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {isBusy ? 'Sincronizzazione…' : 'Sincronizza in SYNC_TabScore'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* CONFIRM AUTO-SYNC ACTIVATION */}
        {dialog.kind === 'confirm_autosync' && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-800">
                  <RefreshCw className="h-4 w-4" />
                </span>
                <div>
                  <h3
                    id="drive-dialog-title"
                    className="font-display text-base font-semibold text-slate-900"
                  >
                    Attivare la sincronizzazione automatica?
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Dopo le modifiche principali, TabScore aggiornerà automaticamente l’archivio nella cartella <strong>SYNC_TabScore</strong> su Google Drive (con controllo conflitti attivo).
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={onClose}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                Se sei offline, le modifiche vengono comunque salvate sul dispositivo e sincronizzate automaticamente al ritorno della connessione.
              </div>
              <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onClose}
                  className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onConfirmEnableAutoSync}
                  className="min-h-10 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  Attiva sincronizzazione automatica
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
