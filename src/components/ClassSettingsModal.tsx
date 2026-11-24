import {
  Cloud,
  CloudDownload,
  CloudUpload,
  Info,
  LogOut,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { GoogleDriveAccount } from '../services/googleDriveAuth';
import type {
  DriveSyncMetadata,
  DriveSyncStatus,
  LocalSafetyBackup,
} from '../services/googleDriveSync';
import type {
  ClassData,
  ClassSettings,
  RoundingMode,
} from '../types/gradebook';
import { ROUNDING_MODE_LABELS } from '../utils/calculations';
import { resolveDriveIndicatorState } from './DriveSyncIndicatorButton';

export type SettingsTab = 'valutazione' | 'drive';

export interface DriveSettingsViewProps {
  account: GoogleDriveAccount | null;
  hasValidToken: boolean;
  isAuthConfigured: boolean;
  syncMeta: DriveSyncMetadata;
  status: DriveSyncStatus;
  hasPendingChanges: boolean;
  error: string | null;
  notice: string | null;
  isSyncing: boolean;
  isRestoring: boolean;
  isOnline: boolean;
  safetyBackup: LocalSafetyBackup | null;
  onConnect: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onManualSync: () => void;
  onRequestRestore: () => void;
  onRestoreSafetyBackup: () => void;
  onToggleAutoSync: (enabled: boolean) => void;
}

interface ClassSettingsModalProps {
  open: boolean;
  classData: ClassData | null;
  initialTab?: SettingsTab;
  driveSync: DriveSettingsViewProps;
  onSave: (settings: ClassSettings) => void;
  onClose: () => void;
}

function formatSyncDateTime(iso: string | null): string {
  if (!iso) return 'Mai eseguita';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Mai eseguita';
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ClassSettingsModal({
  open,
  classData,
  initialTab = 'valutazione',
  driveSync,
  onSave,
  onClose,
}: ClassSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    classData ? initialTab : 'drive'
  );
  const [penaltyNo, setPenaltyNo] = useState('0.20');
  const [penaltyMissing, setPenaltyMissing] = useState('0.50');
  const [penaltyLatePerDay, setPenaltyLatePerDay] = useState('0.10');
  const [toleranceDays, setToleranceDays] = useState('0');
  const [defaultPlatesPerFolder, setDefaultPlatesPerFolder] = useState('10');
  const [roundingMode, setRoundingMode] = useState<RoundingMode>('quarter');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setActiveTab(classData ? initialTab : 'drive');
    if (classData) {
      const s = classData.settings;
      setPenaltyNo(String(s.penaltyNo));
      setPenaltyMissing(String(s.penaltyMissing));
      setPenaltyLatePerDay(String(s.penaltyLatePerDay));
      setToleranceDays(String(s.toleranceDays));
      setDefaultPlatesPerFolder(String(s.defaultPlatesPerFolder));
      setRoundingMode(s.roundingMode);
    }
    setError('');
  }, [open, classData, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const parseNum = (val: string) => Number(val.replace(',', '.'));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!classData) return;

    const pNo = parseNum(penaltyNo);
    const pMissing = parseNum(penaltyMissing);
    const pLate = parseNum(penaltyLatePerDay);
    const tol = Math.floor(parseNum(toleranceDays));
    const defPlates = Math.floor(parseNum(defaultPlatesPerFolder));

    if (
      [pNo, pMissing, pLate, tol, defPlates].some(
        (n) => Number.isNaN(n) || n < 0
      ) ||
      defPlates < 1
    ) {
      setError(
        'Controlla i valori inseriti: le penalità e la tolleranza devono essere ≥ 0; il numero di tavole per cartellina ≥ 1.'
      );
      return;
    }

    onSave({
      penaltyNo: Math.round(pNo * 100) / 100,
      penaltyMissing: Math.round(pMissing * 100) / 100,
      penaltyLatePerDay: Math.round(pLate * 100) / 100,
      toleranceDays: tol,
      defaultPlatesPerFolder: defPlates,
      roundingMode,
    });
    onClose();
  };

  const statusMeta = resolveDriveIndicatorState({
    account: driveSync.account,
    status: driveSync.status,
    isOnline: driveSync.isOnline,
    isSyncing: driveSync.isSyncing,
    hasPendingChanges: driveSync.hasPendingChanges,
  });
  const busyDrive = driveSync.isSyncing || driveSync.isRestoring;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2
              id="settings-modal-title"
              className="font-display text-base font-semibold text-slate-900"
            >
              {activeTab === 'valutazione' && classData
                ? `Impostazioni valutazione · ${classData.name}`
                : 'Impostazioni · Sincronizzazione Google Drive'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Clean Tab Bar */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6">
          <button
            type="button"
            disabled={!classData}
            onClick={() => setActiveTab('valutazione')}
            className={`border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              activeTab === 'valutazione'
                ? 'border-blue-700 text-blue-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Parametri valutazione
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('drive')}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === 'drive'
                ? 'border-blue-700 text-blue-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Cloud className="h-3.5 w-3.5" />
            Google Drive
          </button>
        </div>

        {activeTab === 'valutazione' && classData ? (
          <form
            onSubmit={handleSubmit}
            className="space-y-5 overflow-y-auto px-6 py-5"
          >
            <div className="flex items-start gap-2.5 rounded-md border border-blue-200 bg-blue-50/70 px-3.5 py-2.5 text-xs text-blue-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
              <span>
                I parametri si applicano a tutti gli studenti della classe. Le valutazioni delle cartelline già <strong>concluse e confermate</strong> rimarranno invariate.
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Penalità per ogni NO (punti)
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  value={penaltyNo}
                  onChange={(e) => setPenaltyNo(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Applicata per ogni tavola contrassegnata NO (anche se consegnata successivamente).
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Penalità per tavola mancante finale (punti)
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  value={penaltyMissing}
                  onChange={(e) => setPenaltyMissing(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Aggiuntiva per ogni tavola ancora non consegnata nella cartellina.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Penalità per giorno di ritardo cartellina
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  value={penaltyLatePerDay}
                  onChange={(e) => setPenaltyLatePerDay(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Giorni di tolleranza sul ritardo
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={toleranceDays}
                  onChange={(e) => setToleranceDays(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Tavole indicative per cartellina
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={defaultPlatesPerFolder}
                  onChange={(e) => setDefaultPlatesPerFolder(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Arrotondamento voto indicativo
                </label>
                <select
                  value={roundingMode}
                  onChange={(e) =>
                    setRoundingMode(e.target.value as RoundingMode)
                  }
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  {(Object.keys(ROUNDING_MODE_LABELS) as RoundingMode[]).map(
                    (mode) => (
                      <option key={mode} value={mode}>
                        {ROUNDING_MODE_LABELS[mode]}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>

            {error && (
              <p className="text-xs font-medium text-rose-600">{error}</p>
            )}

            <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-4">
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
                Salva impostazioni
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <div className="rounded-md border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Sincronizzazione cloud con Google Drive
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Salva automaticamente classi, studenti, valutazioni, immagini delle tavole e cartelline nella cartella dedicata <strong>SYNC_TabScore</strong> del tuo Google Drive.
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold ${statusMeta.badgeClass}`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`}
                  />
                  {statusMeta.label}
                </span>
              </div>

              {!driveSync.account ? (
                <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                  <p className="text-xs text-slate-600">
                    TabScore accede esclusivamente alla cartella creata dall’app (<strong>SYNC_TabScore</strong>) per sincronizzare i tuoi registri tra più dispositivi.
                  </p>
                  <button
                    type="button"
                    disabled={
                      busyDrive ||
                      !driveSync.isOnline ||
                      !driveSync.isAuthConfigured
                    }
                    onClick={driveSync.onConnect}
                    className="gsi-material-button"
                    aria-label="Accedi con Google per sincronizzare Google Drive"
                  >
                    <div className="gsi-material-button-state" />
                    <div className="gsi-material-button-content-wrapper">
                      <div className="gsi-material-button-icon">
                        <svg
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 48 48"
                          style={{ display: 'block' }}
                        >
                          <path
                            fill="#EA4335"
                            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                          />
                          <path
                            fill="#34A853"
                            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                          />
                          <path fill="none" d="M0 0h48v48H0z" />
                        </svg>
                      </div>
                      <span className="gsi-material-button-contents">
                        {busyDrive ? 'Connessione in corso…' : 'Accedi con Google'}
                      </span>
                    </div>
                  </button>
                  {!driveSync.isAuthConfigured && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                      <p className="font-semibold">
                        Configurazione OAuth 2.0 richiesta per Google Drive
                      </p>
                      <p className="mt-0.5">
                        Per attivare la sincronizzazione cloud senza alcuna API key, configura il tuo <strong>OAuth 2.0 Client ID</strong> pubblico nella variabile{' '}
                        <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">
                          VITE_GOOGLE_OAUTH_CLIENT_ID
                        </code>{' '}
                        e autorizza l’origine del sito in Google Cloud Console. Tutte le altre funzioni di TabScore (registro, statistiche, PWA offline e backup locale) continuano a funzionare normalmente.
                      </p>
                    </div>
                  )}
                  {!driveSync.isOnline && (
                    <p className="text-[11px] font-medium text-amber-800">
                      Connessione Internet non disponibile: collegati alla rete per accedere a Google Drive.
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                  {/* Account Summary */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-900">
                        {driveSync.account.displayName || 'Account Google collegato'}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {driveSync.account.email || driveSync.account.uid}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        Ultima sincronizzazione:{' '}
                        <strong className="font-medium text-slate-700">
                          {formatSyncDateTime(driveSync.syncMeta.lastSyncedAt)}
                        </strong>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Stato modifiche:{' '}
                        <strong
                          className={`font-medium ${
                            driveSync.hasPendingChanges
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {driveSync.hasPendingChanges
                            ? 'Modifiche locali in attesa di sincronizzazione'
                            : 'Nessuna modifica in attesa'}
                        </strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busyDrive}
                      onClick={driveSync.onDisconnect}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Disconnetti
                    </button>
                  </div>

                  {/* Session reconfirm prompt if OAuth access token is not in memory */}
                  {!driveSync.hasValidToken && driveSync.isOnline && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <span>
                        Riconferma l’accesso Google Drive in questa sessione per eseguire la sincronizzazione.
                      </span>
                      <button
                        type="button"
                        disabled={busyDrive}
                        onClick={driveSync.onReconnect}
                        className="rounded-md bg-amber-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        Riconferma accesso
                      </button>
                    </div>
                  )}

                  {/* Primary Drive Actions */}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={busyDrive}
                      onClick={driveSync.onManualSync}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                    >
                      <CloudUpload className="h-4 w-4" />
                      {driveSync.isSyncing
                        ? 'Sincronizzazione…'
                        : 'Sincronizza ora'}
                    </button>
                    <button
                      type="button"
                      disabled={busyDrive || !driveSync.isOnline}
                      onClick={driveSync.onRequestRestore}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                    >
                      <CloudDownload className="h-4 w-4 text-blue-700" />
                      {driveSync.isRestoring
                        ? 'Verifica Drive…'
                        : 'Ripristina da Google Drive'}
                    </button>
                  </div>

                  {/* Auto-Sync Toggle */}
                  <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-slate-200 bg-white px-3.5 py-2.5">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Sincronizzazione automatica
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Aggiorna la cartella <strong>SYNC_TabScore</strong> in background dopo le modifiche (con rilevamento conflitti).
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={driveSync.syncMeta.autoSyncEnabled}
                      onChange={(e) =>
                        driveSync.onToggleAutoSync(e.target.checked)
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Optional Safety Backup Recovery Card */}
            {driveSync.safetyBackup && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5">
                <div className="flex items-start gap-2 text-xs text-emerald-950">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  <div>
                    <div className="font-semibold">
                      Backup locale di sicurezza disponibile
                    </div>
                    <div className="text-[11px] text-emerald-800">
                      Salvato il {formatSyncDateTime(driveSync.safetyBackup.savedAt)} ({driveSync.safetyBackup.state.classes.length} classi).
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyDrive}
                  onClick={driveSync.onRestoreSafetyBackup}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Ripristina backup precedente
                </button>
              </div>
            )}

            {driveSync.error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                {driveSync.error}
              </div>
            )}
            {driveSync.notice && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-900">
                {driveSync.notice}
              </div>
            )}

            <div className="flex items-center justify-end border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Chiudi
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
