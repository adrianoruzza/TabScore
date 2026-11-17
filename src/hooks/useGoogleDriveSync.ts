import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getInMemoryAccessToken,
  initGoogleDriveAuth,
  invalidateInMemoryAccessToken,
  mapGoogleAuthError,
  signInWithGoogleDrive,
  signOutGoogleDrive,
  type GoogleDriveAccount,
} from '../services/googleDriveAuth';
import {
  clearDriveSyncConnectionMetadata,
  computeStoreContentHash,
  downloadAndHydrateArchiveFromDrive,
  DriveApiError,
  inspectDriveSyncState,
  loadDriveSyncMetadata,
  loadLocalSafetyBackup,
  saveDriveSyncMetadata,
  saveLocalSafetyBackup,
  summarizeStoreState,
  syncArchiveToDrive,
  type DriveSyncMetadata,
  type DriveSyncStatus,
  type LocalSafetyBackup,
  type RemoteArchiveInspection,
  type TabScoreSyncPayload,
  type TabScoreSyncSummary,
} from '../services/googleDriveSync';
import type { GradebookStoreState } from '../types/gradebook';

export type PendingDriveDialog =
  | {
      kind: 'conflict';
      inspection: RemoteArchiveInspection;
      localSummary: TabScoreSyncSummary;
    }
  | {
      kind: 'confirm_restore';
      inspection: RemoteArchiveInspection;
      localSummary: TabScoreSyncSummary;
    }
  | {
      kind: 'confirm_autosync';
      inspection: RemoteArchiveInspection | null;
      localSummary: TabScoreSyncSummary;
    }
  | {
      kind: 'confirm_overwrite_drive';
      inspection: RemoteArchiveInspection | null;
      localSummary: TabScoreSyncSummary;
    };

interface UseGoogleDriveSyncOptions {
  storeState: GradebookStoreState;
  dataFingerprint: string;
  isEditingBusy: boolean;
  onRestoreState: (payload: TabScoreSyncPayload, sourceLabel?: string) => void;
}

const AUTO_SYNC_DEBOUNCE_MS = 4000;

export function useGoogleDriveSync({
  storeState,
  dataFingerprint,
  isEditingBusy,
  onRestoreState,
}: UseGoogleDriveSyncOptions) {
  const [account, setAccount] = useState<GoogleDriveAccount | null>(null);
  const [hasValidToken, setHasValidToken] = useState(false);
  const [syncMeta, setSyncMeta] = useState<DriveSyncMetadata>(() =>
    loadDriveSyncMetadata()
  );
  const [status, setStatus] = useState<DriveSyncStatus>(() => {
    const initial = loadDriveSyncMetadata();
    if (typeof navigator !== 'undefined' && !navigator.onLine && initial.pendingSync) {
      return 'offline_queued';
    }
    return initial.lastSyncStatus ?? 'idle';
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [localHash, setLocalHash] = useState<string | null>(null);
  const [safetyBackup, setSafetyBackup] = useState<LocalSafetyBackup | null>(() =>
    loadLocalSafetyBackup()
  );
  const [pendingDialog, setPendingDialog] = useState<PendingDriveDialog | null>(
    null
  );

  const storeStateRef = useRef(storeState);
  storeStateRef.current = storeState;

  const syncMetaRef = useRef(syncMeta);
  syncMetaRef.current = syncMeta;

  const localHashRef = useRef(localHash);
  localHashRef.current = localHash;

  const isBusyRef = useRef(false);

  const updateMeta = useCallback(
    (
      updater:
        | Partial<DriveSyncMetadata>
        | ((prev: DriveSyncMetadata) => DriveSyncMetadata)
    ) => {
      setSyncMeta((prev) => {
        const next =
          typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
        saveDriveSyncMetadata(next);
        syncMetaRef.current = next;
        return next;
      });
    },
    []
  );

  // Track online/offline state
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Track Firebase Auth user & in-memory OAuth access token
  useEffect(() => {
    return initGoogleDriveAuth((nextAccount, nextValidToken) => {
      setAccount(nextAccount);
      setHasValidToken(nextValidToken);
      if (!nextAccount) {
        setStatus('idle');
      } else if (!nextValidToken) {
        setStatus((prev) => {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            return 'offline_queued';
          }
          if (
            prev === 'synced' ||
            prev === 'unsynced' ||
            prev === 'idle' ||
            prev === 'syncing'
          ) {
            return 'needs_auth';
          }
          return prev;
        });
      }
    });
  }, []);

  // Recompute canonical store hash whenever dataFingerprint changes
  useEffect(() => {
    let active = true;
    computeStoreContentHash(storeStateRef.current).then((hash) => {
      if (!active) return;
      setLocalHash(hash);
      localHashRef.current = hash;

      if (!account) return;
      const meta = syncMetaRef.current;
      if (meta.lastSyncedContentHash && hash !== meta.lastSyncedContentHash) {
        if (!isOnline) {
          updateMeta({
            pendingSync: meta.syncConfirmedByUser ? true : meta.pendingSync,
            lastSyncStatus: 'offline_queued',
          });
          setStatus('offline_queued');
        } else if (!hasValidToken) {
          updateMeta({
            pendingSync: meta.syncConfirmedByUser ? true : meta.pendingSync,
            lastSyncStatus: 'needs_auth',
          });
          setStatus('needs_auth');
        } else {
          setStatus((prev) => (prev === 'conflict' ? 'conflict' : 'unsynced'));
          updateMeta({ lastSyncStatus: 'unsynced' });
        }
      }
    });
    return () => {
      active = false;
    };
  }, [dataFingerprint, account, hasValidToken, isOnline, updateMeta]);

  const handleDriveFailure = useCallback(
    (err: unknown) => {
      if (err instanceof DriveApiError) {
        if (err.code === 'unauthorized') {
          invalidateInMemoryAccessToken();
          setStatus('needs_auth');
          updateMeta({ lastSyncStatus: 'needs_auth', lastError: err.message });
          setError(err.message);
          return;
        }
        if (err.code === 'network') {
          setStatus('offline_queued');
          updateMeta({
            pendingSync: true,
            lastSyncStatus: 'offline_queued',
            lastError: err.message,
          });
          setError(err.message);
          return;
        }
        setStatus('error');
        updateMeta({ lastSyncStatus: 'error', lastError: err.message });
        setError(err.message);
        return;
      }

      const msg = mapGoogleAuthError(err);
      setStatus('error');
      updateMeta({ lastSyncStatus: 'error', lastError: msg });
      setError(msg);
    },
    [updateMeta]
  );

  const performUpload = useCallback(
    async (
      accessToken: string,
      inspection: RemoteArchiveInspection | null
    ): Promise<TabScoreSyncPayload> => {
      const meta = syncMetaRef.current;
      const currentState = storeStateRef.current;
      const nextRevision = (inspection?.remotePayload?.revision ?? 0) + 1;

      const uploaded = await syncArchiveToDrive(accessToken, currentState, meta, {
        targetRevision: nextRevision,
        existingFolderId: inspection?.folderId ?? meta.folderId,
        existingImagesFolderId:
          inspection?.imagesFolderId ?? meta.imagesFolderId,
        existingArchiveFileId:
          inspection?.archiveFileId ?? meta.archiveFileId,
      });

      const now = new Date().toISOString();
      updateMeta({
        syncConfirmedByUser: true,
        folderId: uploaded.folderId,
        imagesFolderId: uploaded.imagesFolderId,
        archiveFileId: uploaded.archiveFileId,
        uploadedImageIndex: uploaded.uploadedImageIndex,
        lastSyncedContentHash: uploaded.payload.contentHash,
        lastSyncedRemoteRevision: uploaded.payload.revision,
        lastSyncedAt: now,
        lastSyncStatus: 'synced',
        lastError: null,
        pendingSync: false,
      });
      setLocalHash(uploaded.payload.contentHash);
      localHashRef.current = uploaded.payload.contentHash;
      setStatus('synced');
      setError(null);
      return uploaded.payload;
    },
    [updateMeta]
  );

  const ensureValidTokenInteractive = useCallback(
    async (forceSelectAccount = false): Promise<string> => {
      const live = getInMemoryAccessToken();
      if (live && !forceSelectAccount) return live;
      const res = await signInWithGoogleDrive(forceSelectAccount);
      setAccount(res.account);
      setHasValidToken(true);
      return res.accessToken;
    },
    []
  );

  const connectGoogle = useCallback(
    async (forceSelectAccount = false) => {
      if (!isOnline) {
        setError('Connessione assente: impossibile collegare Google Drive offline.');
        return;
      }
      if (isBusyRef.current) return;
      isBusyRef.current = true;
      setIsSyncing(true);
      setError(null);
      setNotice(null);

      try {
        const { accessToken } = await signInWithGoogleDrive(forceSelectAccount);
        setStatus('syncing');
        const currentHash = await computeStoreContentHash(storeStateRef.current);
        setLocalHash(currentHash);
        localHashRef.current = currentHash;

        const meta = syncMetaRef.current;
        const inspection = await inspectDriveSyncState(accessToken, meta);

        updateMeta({
          folderId: inspection.folderId,
          imagesFolderId: inspection.imagesFolderId,
          archiveFileId: inspection.archiveFileId,
        });

        if (inspection.archiveFileId && !inspection.remoteIntegrityValid) {
          setStatus('error');
          setError(
            inspection.remoteError ??
              'L’archivio presente su Google Drive risulta danneggiato.'
          );
          return;
        }

        const localSummary = summarizeStoreState(storeStateRef.current);

        if (inspection.remotePayload) {
          if (inspection.remotePayload.contentHash === currentHash) {
            updateMeta({
              syncConfirmedByUser: true,
              lastSyncedContentHash: currentHash,
              lastSyncedRemoteRevision: inspection.remotePayload.revision,
              lastSyncedAt:
                inspection.remoteModifiedTime ??
                inspection.remotePayload.updatedAt,
              lastSyncStatus: 'synced',
              lastError: null,
              pendingSync: false,
            });
            setStatus('synced');
            setNotice(
              'Account collegato: i dati locali coincidono già con Google Drive.'
            );
            return;
          }

          // Remote archive already exists and differs from local -> ask user explicitly
          setStatus('conflict');
          setPendingDialog({
            kind: 'conflict',
            inspection,
            localSummary,
          });
          return;
        }

        // No remote archive yet in SYNC_TabScore -> ask explicit user confirmation before first upload
        setStatus('unsynced');
        setPendingDialog({
          kind: 'confirm_overwrite_drive',
          inspection,
          localSummary,
        });
      } catch (err) {
        handleDriveFailure(err);
      } finally {
        isBusyRef.current = false;
        setIsSyncing(false);
      }
    },
    [isOnline, updateMeta, handleDriveFailure]
  );

  const reconnectSession = useCallback(async () => {
    await connectGoogle(false);
  }, [connectGoogle]);

  const disconnectGoogle = useCallback(async () => {
    setError(null);
    setNotice(null);
    setPendingDialog(null);
    await signOutGoogleDrive();
    const cleared = clearDriveSyncConnectionMetadata();
    setSyncMeta(cleared);
    syncMetaRef.current = cleared;
    setStatus('idle');
    setNotice('Account Google scollegato. I dati locali sul dispositivo sono rimasti intatti.');
  }, []);

  const requestManualSync = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (!isOnline) {
      updateMeta({
        pendingSync: true,
        lastSyncStatus: 'offline_queued',
      });
      setStatus('offline_queued');
      setNotice(
        'Sei offline: le modifiche sono salvate localmente e pronte per la sincronizzazione appena torna la rete.'
      );
      return;
    }

    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsSyncing(true);
    setStatus('syncing');

    try {
      const accessToken = await ensureValidTokenInteractive(false);
      const currentHash = await computeStoreContentHash(storeStateRef.current);
      setLocalHash(currentHash);
      localHashRef.current = currentHash;

      const meta = syncMetaRef.current;
      const inspection = await inspectDriveSyncState(accessToken, meta);

      updateMeta({
        folderId: inspection.folderId,
        imagesFolderId: inspection.imagesFolderId,
        archiveFileId: inspection.archiveFileId,
      });

      if (inspection.archiveFileId && !inspection.remoteIntegrityValid) {
        setStatus('error');
        setError(
          inspection.remoteError ??
            'Verifica integrità dell’archivio su Google Drive fallita.'
        );
        return;
      }

      const localSummary = summarizeStoreState(storeStateRef.current);

      if (inspection.remotePayload) {
        if (inspection.remotePayload.contentHash === currentHash) {
          updateMeta({
            syncConfirmedByUser: true,
            lastSyncedContentHash: currentHash,
            lastSyncedRemoteRevision: inspection.remotePayload.revision,
            lastSyncedAt: new Date().toISOString(),
            lastSyncStatus: 'synced',
            lastError: null,
            pendingSync: false,
          });
          setStatus('synced');
          setNotice('Archivio già sincronizzato e allineato con Google Drive.');
          return;
        }

        if (
          !meta.syncConfirmedByUser ||
          inspection.remotePayload.revision !== meta.lastSyncedRemoteRevision
        ) {
          setStatus('conflict');
          setPendingDialog({
            kind: 'conflict',
            inspection,
            localSummary,
          });
          return;
        }
      } else if (!meta.syncConfirmedByUser) {
        setStatus('unsynced');
        setPendingDialog({
          kind: 'confirm_overwrite_drive',
          inspection,
          localSummary,
        });
        return;
      }

      await performUpload(accessToken, inspection);
      setNotice('Sincronizzazione su Google Drive completata e verificata.');
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      isBusyRef.current = false;
      setIsSyncing(false);
    }
  }, [
    isOnline,
    ensureValidTokenInteractive,
    updateMeta,
    performUpload,
    handleDriveFailure,
  ]);

  const confirmUploadLocalToDrive = useCallback(async () => {
    if (!isOnline) {
      setError('Connessione assente: impossibile caricare su Google Drive.');
      return;
    }
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsSyncing(true);
    setStatus('syncing');
    setError(null);
    setNotice(null);

    try {
      const accessToken = await ensureValidTokenInteractive(false);
      const existingInspection =
        pendingDialog && 'inspection' in pendingDialog
          ? pendingDialog.inspection
          : null;
      const inspection =
        existingInspection ??
        (await inspectDriveSyncState(accessToken, syncMetaRef.current));

      await performUpload(accessToken, inspection);
      setPendingDialog(null);
      setNotice('Dati locali salvati e sincronizzati nella cartella SYNC_TabScore.');
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      isBusyRef.current = false;
      setIsSyncing(false);
    }
  }, [
    isOnline,
    ensureValidTokenInteractive,
    pendingDialog,
    performUpload,
    handleDriveFailure,
  ]);

  const requestRestoreFromDrive = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!isOnline) {
      setError('Connessione assente: impossibile leggere i dati da Google Drive.');
      return;
    }
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsRestoring(true);

    try {
      const accessToken = await ensureValidTokenInteractive(false);
      const inspection = await inspectDriveSyncState(
        accessToken,
        syncMetaRef.current
      );
      updateMeta({
        folderId: inspection.folderId,
        imagesFolderId: inspection.imagesFolderId,
        archiveFileId: inspection.archiveFileId,
      });

      if (!inspection.archiveFileId || !inspection.remotePayload) {
        setError(
          inspection.remoteError ??
            'Nessun archivio TabScore trovato nella cartella SYNC_TabScore di Google Drive.'
        );
        return;
      }

      setPendingDialog({
        kind: 'confirm_restore',
        inspection,
        localSummary: summarizeStoreState(storeStateRef.current),
      });
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      isBusyRef.current = false;
      setIsRestoring(false);
    }
  }, [isOnline, ensureValidTokenInteractive, updateMeta, handleDriveFailure]);

  const confirmRestoreFromDrive = useCallback(async () => {
    if (!isOnline) {
      setError('Connessione assente: impossibile completare il ripristino.');
      return;
    }
    const targetDialog = pendingDialog;
    if (
      !targetDialog ||
      (targetDialog.kind !== 'confirm_restore' &&
        targetDialog.kind !== 'conflict' &&
        targetDialog.kind !== 'confirm_autosync')
    ) {
      return;
    }
    const archiveId = targetDialog.inspection?.archiveFileId;
    if (!archiveId) {
      setError('ID file archivio mancante su Google Drive.');
      return;
    }
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsRestoring(true);
    setError(null);
    setNotice(null);

    try {
      const accessToken = await ensureValidTokenInteractive(false);

      // Step 1: Always protect current local state with a pre-restore safety backup
      saveLocalSafetyBackup(
        storeStateRef.current,
        'Backup automatico di sicurezza prima del ripristino da Google Drive'
      );
      setSafetyBackup(loadLocalSafetyBackup());

      // Step 2: Download, validate checksum, and hydrate any external plate image binaries
      const hydrated = await downloadAndHydrateArchiveFromDrive(
        accessToken,
        archiveId
      );

      // Step 3: Commit validated archive to store
      onRestoreState(hydrated, 'Google Drive');

      const restoredHash = await computeStoreContentHash({
        activeClassId: hydrated.activeClassId,
        classes: hydrated.classes,
        auditLog: hydrated.auditLog,
      });

      updateMeta({
        syncConfirmedByUser: true,
        archiveFileId: archiveId,
        lastSyncedContentHash: hydrated.contentHash || restoredHash,
        lastSyncedRemoteRevision: hydrated.revision,
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'synced',
        lastError: null,
        pendingSync: false,
      });
      setLocalHash(hydrated.contentHash || restoredHash);
      localHashRef.current = hydrated.contentHash || restoredHash;
      setStatus('synced');
      setPendingDialog(null);
      setNotice(
        'Ripristino completato da Google Drive. È stato salvato un backup locale di sicurezza della situazione precedente.'
      );
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      isBusyRef.current = false;
      setIsRestoring(false);
    }
  }, [
    isOnline,
    pendingDialog,
    ensureValidTokenInteractive,
    onRestoreState,
    updateMeta,
    handleDriveFailure,
  ]);

  const restoreFromSafetyBackup = useCallback(() => {
    const backup = loadLocalSafetyBackup();
    if (!backup) {
      setError('Nessun backup locale di sicurezza disponibile.');
      return;
    }
    onRestoreState(
      {
        format: 'tabscore_cloud_sync_v1',
        archiveType: 'full_backup',
        version: backup.state.version,
        exportedAt: backup.savedAt,
        revision: 0,
        updatedAt: backup.savedAt,
        deviceId: syncMetaRef.current.deviceId,
        contentHash: '',
        activeClassId: backup.state.activeClassId,
        classes: backup.state.classes,
        auditLog: backup.state.auditLog,
        imageManifest: [],
        summary: summarizeStoreState(backup.state),
      },
      'Backup locale di sicurezza'
    );
    updateMeta({
      lastSyncStatus: 'unsynced',
      pendingSync: false,
    });
    setStatus('unsynced');
    setError(null);
    setNotice('Ripristinato il backup locale precedente all’ultimo scaricamento.');
  }, [onRestoreState, updateMeta]);

  const toggleAutoSync = useCallback(
    async (enabled: boolean) => {
      setError(null);
      setNotice(null);
      if (!enabled) {
        updateMeta({ autoSyncEnabled: false });
        return;
      }

      if (syncMetaRef.current.syncConfirmedByUser || !account) {
        updateMeta({ autoSyncEnabled: true });
        return;
      }

      // First activation requires explicit user confirmation
      if (isOnline && hasValidToken) {
        try {
          const token = getInMemoryAccessToken();
          if (token) {
            const inspection = await inspectDriveSyncState(
              token,
              syncMetaRef.current
            );
            setPendingDialog({
              kind: 'confirm_autosync',
              inspection,
              localSummary: summarizeStoreState(storeStateRef.current),
            });
            return;
          }
        } catch (err) {
          handleDriveFailure(err);
          return;
        }
      }

      setPendingDialog({
        kind: 'confirm_autosync',
        inspection: null,
        localSummary: summarizeStoreState(storeStateRef.current),
      });
    },
    [account, isOnline, hasValidToken, updateMeta, handleDriveFailure]
  );

  const confirmEnableAutoSync = useCallback(async () => {
    updateMeta({ autoSyncEnabled: true, syncConfirmedByUser: true });
    setPendingDialog(null);
    if (account && isOnline) {
      await requestManualSync();
    }
  }, [account, isOnline, updateMeta, requestManualSync]);

  // Debounced automatic sync & auto-reconciliation upon returning online
  useEffect(() => {
    if (!account || !hasValidToken || !isOnline) return;
    if (!syncMeta.autoSyncEnabled || !syncMeta.syncConfirmedByUser) return;
    if (isEditingBusy || pendingDialog || status === 'conflict') return;
    if (!localHash) return;

    const isDirty =
      syncMeta.pendingSync ||
      (syncMeta.lastSyncedContentHash !== null &&
        localHash !== syncMeta.lastSyncedContentHash);

    if (!isDirty) return;

    const timer = window.setTimeout(async () => {
      if (isBusyRef.current) return;
      const accessToken = getInMemoryAccessToken();
      if (!accessToken) {
        setStatus('needs_auth');
        return;
      }

      isBusyRef.current = true;
      setIsSyncing(true);
      setStatus('syncing');

      try {
        const meta = syncMetaRef.current;
        const currentHash = await computeStoreContentHash(storeStateRef.current);
        const inspection = await inspectDriveSyncState(accessToken, meta);

        updateMeta({
          folderId: inspection.folderId,
          imagesFolderId: inspection.imagesFolderId,
          archiveFileId: inspection.archiveFileId,
        });

        if (inspection.archiveFileId && !inspection.remoteIntegrityValid) {
          setStatus('error');
          setError(
            inspection.remoteError ??
              'L’archivio remoto su Google Drive non ha superato il controllo di integrità.'
          );
          return;
        }

        if (inspection.remotePayload) {
          if (inspection.remotePayload.contentHash === currentHash) {
            updateMeta({
              lastSyncedContentHash: currentHash,
              lastSyncedRemoteRevision: inspection.remotePayload.revision,
              lastSyncedAt: new Date().toISOString(),
              lastSyncStatus: 'synced',
              lastError: null,
              pendingSync: false,
            });
            setStatus('synced');
            return;
          }

          if (inspection.remotePayload.revision !== meta.lastSyncedRemoteRevision) {
            setStatus('conflict');
            setPendingDialog({
              kind: 'conflict',
              inspection,
              localSummary: summarizeStoreState(storeStateRef.current),
            });
            return;
          }
        }

        await performUpload(accessToken, inspection);
      } catch (err) {
        handleDriveFailure(err);
      } finally {
        isBusyRef.current = false;
        setIsSyncing(false);
      }
    }, AUTO_SYNC_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    account,
    hasValidToken,
    isOnline,
    syncMeta.autoSyncEnabled,
    syncMeta.syncConfirmedByUser,
    syncMeta.pendingSync,
    syncMeta.lastSyncedContentHash,
    isEditingBusy,
    pendingDialog,
    status,
    localHash,
    updateMeta,
    performUpload,
    handleDriveFailure,
  ]);

  const dismissPendingDialog = useCallback(() => {
    setPendingDialog(null);
  }, []);

  return {
    account,
    hasValidToken,
    syncMeta,
    status,
    error,
    notice,
    isSyncing,
    isRestoring,
    isOnline,
    safetyBackup,
    pendingDialog,
    connectGoogle,
    reconnectSession,
    disconnectGoogle,
    requestManualSync,
    confirmUploadLocalToDrive,
    requestRestoreFromDrive,
    confirmRestoreFromDrive,
    restoreFromSafetyBackup,
    toggleAutoSync,
    confirmEnableAutoSync,
    dismissPendingDialog,
  };
}
