import { Cloud } from 'lucide-react';
import type { GoogleDriveAccount } from '../services/googleDriveAuth';
import type { DriveSyncStatus } from '../services/googleDriveSync';

export type DriveIndicatorTone = 'green' | 'amber' | 'blue' | 'red' | 'gray';

export interface DriveIndicatorState {
  tone: DriveIndicatorTone;
  label: string;
  tooltip: string;
  dotClass: string;
  badgeClass: string;
  isAnimating: boolean;
}

export function resolveDriveIndicatorState(params: {
  account: GoogleDriveAccount | null;
  status: DriveSyncStatus;
  isOnline: boolean;
  isSyncing?: boolean;
  hasPendingChanges?: boolean;
}): DriveIndicatorState {
  const { account, status, isOnline, isSyncing, hasPendingChanges } = params;

  if (!account) {
    return {
      tone: 'gray',
      label: 'Non collegato',
      tooltip: 'Google Drive non collegato',
      dotClass: 'bg-slate-400',
      badgeClass: 'border-slate-200 bg-slate-100 text-slate-700',
      isAnimating: false,
    };
  }

  if (isSyncing || status === 'syncing') {
    return {
      tone: 'blue',
      label: 'Sincronizzazione in corso',
      tooltip: 'Sincronizzazione in corso',
      dotClass: 'bg-blue-600 animate-pulse',
      badgeClass: 'border-blue-200 bg-blue-50 text-blue-800',
      isAnimating: true,
    };
  }

  if (status === 'error') {
    return {
      tone: 'red',
      label: 'Errore di sincronizzazione',
      tooltip: 'Errore di sincronizzazione',
      dotClass: 'bg-rose-500',
      badgeClass: 'border-rose-200 bg-rose-50 text-rose-800',
      isAnimating: false,
    };
  }

  if (status === 'conflict') {
    return {
      tone: 'red',
      label: 'Conflitto da risolvere',
      tooltip: 'Errore di sincronizzazione: conflitto tra dispositivi',
      dotClass: 'bg-rose-500',
      badgeClass: 'border-rose-200 bg-rose-50 text-rose-800',
      isAnimating: false,
    };
  }

  if (
    status === 'unsynced' ||
    status === 'offline_queued' ||
    hasPendingChanges
  ) {
    return {
      tone: 'amber',
      label: isOnline ? 'Modifiche in attesa' : 'Modifiche in attesa (offline)',
      tooltip: isOnline
        ? 'Modifiche in attesa'
        : 'Modifiche in attesa (nessuna connessione)',
      dotClass: 'bg-amber-400',
      badgeClass: 'border-amber-300 bg-amber-50 text-amber-900',
      isAnimating: false,
    };
  }

  if (status === 'needs_auth') {
    return {
      tone: 'red',
      label: 'Autenticazione scaduta',
      tooltip: isOnline
        ? 'Errore di sincronizzazione: riconferma accesso Google'
        : 'Sessione Google da riconfermare al ritorno della connessione',
      dotClass: 'bg-rose-500',
      badgeClass: 'border-rose-200 bg-rose-50 text-rose-800',
      isAnimating: false,
    };
  }

  if (status === 'synced') {
    return {
      tone: 'green',
      label: 'Sincronizzato',
      tooltip: 'Sincronizzato',
      dotClass: 'bg-emerald-500',
      badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      isAnimating: false,
    };
  }

  return {
    tone: 'green',
    label: 'Sincronizzato',
    tooltip: 'Sincronizzato',
    dotClass: 'bg-emerald-500',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    isAnimating: false,
  };
}

interface DriveSyncIndicatorButtonProps {
  account: GoogleDriveAccount | null;
  status: DriveSyncStatus;
  isOnline: boolean;
  isSyncing: boolean;
  hasPendingChanges: boolean;
  onClick: () => void;
}

export function DriveSyncIndicatorButton({
  account,
  status,
  isOnline,
  isSyncing,
  hasPendingChanges,
  onClick,
}: DriveSyncIndicatorButtonProps) {
  const indicator = resolveDriveIndicatorState({
    account,
    status,
    isOnline,
    isSyncing,
    hasPendingChanges,
  });

  return (
    <button
      type="button"
      onClick={onClick}
      title={indicator.tooltip}
      aria-label={`Sincronizzazione Google Drive: ${indicator.tooltip}`}
      data-sync-tone={indicator.tone}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
        indicator.tone === 'blue'
          ? 'border-blue-200 bg-blue-50/70 text-blue-700 hover:bg-blue-100/70'
          : indicator.tone === 'red'
          ? 'border-rose-200 bg-white text-slate-700 hover:bg-rose-50/60'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <Cloud
        className={`h-4 w-4 shrink-0 ${
          indicator.isAnimating ? 'animate-pulse text-blue-700' : 'text-slate-600'
        }`}
      />
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${indicator.dotClass}`}
      />
    </button>
  );
}
