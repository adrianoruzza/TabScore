import { CheckCircle2, Download, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        title="Installa TabScore come applicazione desktop o mobile"
        className={`inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 font-semibold text-blue-800 transition-colors hover:border-blue-300 hover:bg-blue-100 whitespace-nowrap shrink-0 ${
          compact ? 'h-8 px-2.5 text-xs' : 'h-8 px-3 text-xs'
        }`}
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span>Installa app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          title="Aggiungi TabScore alla schermata Home"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
        >
          <Share className="h-3.5 w-3.5 shrink-0" />
          <span>Installa</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Installa TabScore su iPhone o iPad"
          >
            <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={`${import.meta.env.BASE_URL}assets/aistudio/TabScore_34d66820.png`}
                    alt="TabScore"
                    className="h-9 w-auto shrink-0 object-contain"
                  />
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Installa TabScore su iPhone / iPad
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Chiudi"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-slate-600">
                <li>
                  1. Tocca il pulsante <strong>Condividi</strong> nella barra di
                  Safari.
                </li>
                <li>
                  2. Scorri l’elenco e scegli{' '}
                  <strong>Aggiungi alla schermata Home</strong>.
                </li>
                <li>
                  3. Conferma con <strong>Aggiungi</strong> per aprire TabScore
                  a schermo indipendente.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-md bg-blue-700 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                Ho capito
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

interface PWABannersProps {
  isOnline: boolean;
  needRefresh: boolean;
  pendingOfflineChanges: boolean;
  reconciledNotice: string | null;
  isEditingBusy: boolean;
  isUpdating: boolean;
  onApplyUpdate: () => void;
  onDismissUpdate: () => void;
}

export function PWABanners({
  isOnline,
  needRefresh,
  pendingOfflineChanges,
  reconciledNotice,
  isEditingBusy,
  isUpdating,
  onApplyUpdate,
  onDismissUpdate,
}: PWABannersProps) {
  return (
    <>
      {/* Offline / Reconnected Connectivity Notice */}
      {!isOnline ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-3 left-3 z-40 flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 shadow-md"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span className="truncate">
            Modalità offline · Dati salvati in locale
            {pendingOfflineChanges ? ' (allineamento al rientro)' : ''}
          </span>
        </div>
      ) : (
        reconciledNotice && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-3 left-3 z-40 flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-950 shadow-md"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
            <span className="truncate">{reconciledNotice}</span>
          </div>
        )
      )}

      {/* Non-intrusive App Update Prompt (never forces reload during edits) */}
      {needRefresh && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-3 bottom-3 z-50 w-[min(360px,calc(100vw-24px))] rounded-lg border border-blue-200 bg-white p-3.5 shadow-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              <img
                src={`${import.meta.env.BASE_URL}assets/aistudio/TabScore_34d66820.png`}
                alt=""
                aria-hidden="true"
                className="mt-0.5 h-8 w-auto shrink-0 object-contain"
              />
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900">
                  Aggiornamento di TabScore disponibile
                </div>
                <p className="mt-0.5 text-[11.5px] leading-snug text-slate-600">
                  {isEditingBusy
                    ? 'Completa o chiudi l’inserimento in corso: i dati locali restano al sicuro.'
                    : 'È pronta una nuova versione dell’app. Tutti i tuoi dati locali saranno conservati.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismissUpdate}
              aria-label="Chiudi avviso aggiornamento"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onDismissUpdate}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Più tardi
            </button>
            <button
              type="button"
              disabled={isEditingBusy || isUpdating}
              onClick={onApplyUpdate}
              title={
                isEditingBusy
                  ? 'Salva o chiudi la finestra di modifica prima di aggiornare'
                  : 'Aggiorna subito alla nuova versione'
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3 w-3 ${isUpdating ? 'animate-spin' : ''}`}
              />
              {isUpdating
                ? 'Aggiornamento...'
                : isEditingBusy
                ? 'Salva prima di aggiornare'
                : 'Aggiorna ora'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
