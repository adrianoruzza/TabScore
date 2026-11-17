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
  onRestoreState: (payload: TabScoreSyncPayload, sourceLabel?: string) => void;
}

const AUTO_SYNC_DEBOUNCE_MS = 1500;

export function useGoogleDriveSync({
  storeState,
  dataFingerprint,
  onRestoreState,
}: UseGoogleDriveSyncOptions) {
  const [account, setAccount] = useState<GoogleDriveAccount | null>(null);
  const [hasValidToken, setHasValidToken] = useState(false);
  const [syncMeta, setSyncMeta] = useState<DriveSyncMetadata>(() =>
    loadDriveSyncMetadata()
  );
  const [status, setStatus] = useState<DriveSyncStatus>(() => {
    const initial = loadDriveSyncMetadata();
    if (
      typeof navigator !== 'undefined' &&
      !navigator.onLine &&
      initial.pendingSync
    ) {
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
  const [syncQueueTick, setSyncQueueTick] = useState(0);
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

  const latestLocalHashRef = useRef<string | null>(localHash);
  latestLocalHashRef.current = localHash;

  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  const statusRef = useRef(status);
  statusRef.current = status;

  const isBusyRef = useRef(false);
  const queueFollowUpSyncRef = useRef(false);

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

  // Track browser online / offline events
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

  // Track Firebase Auth user & strictly in-memory OAuth access token
  useEffect(() => {
    return initGoogleDriveAuth((nextAccount, nextValidToken) => {
      setAccount(nextAccount);
      setHasValidToken(nextValidToken);
      if (!nextAccount) {
        setStatus('idle');
      } else if (!nextValidToken) {
        setStatus((prev) => {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            return syncMetaRef.current.pendingSync ? 'offline_queued' : prev;
          }
          if (prev === 'error' || prev === 'conflict') {
            return prev;
          }
          return 'needs_auth';
        });
      }
    });
  }, []);

  // Recompute canonical store hash on ANY persistent change (even during an active transfer)
  useEffect(() => {
    let active = true;
    const snapshot = storeState;
    computeStoreContentHash(snapshot).then((hash) => {
      if (!active) return;
      setLocalHash(hash);
      latestLocalHashRef.current = hash;

      if (!account) return;
      const meta = syncMetaRef.current;
      const isDirty =
        !meta.lastSyncedContentHash || hash !== meta.lastSyncedContentHash;

      if (isDirty) {
        if (isBusyRef.current) {
          queueFollowUpSyncRef.current = true;
        }
        const offline = !isOnlineRef.current;
        const nextStatus: DriveSyncStatus = offline
          ? 'offline_queued'
          : !hasValidToken
          ? 'needs_auth'
          : isBusyRef.current
          ? 'syncing'
          : statusRef.current === 'conflict'
          ? 'conflict'
          : 'unsynced';

        updateMeta({
          pendingSync: true,
          lastSyncStatus:
            nextStatus === 'syncing' ? 'unsynced' : nextStatus,
        });
        setStatus((prev) => {
          if (prev === 'conflict') return 'conflict';
          if (prev === 'syncing' && !offline && hasValidToken) return 'syncing';
          return nextStatus;
        });
      } else if (!isBusyRef.current) {
        if (meta.pendingSync) {
          updateMeta({ pendingSync: false });
        }
        if (hasValidToken && meta.syncConfirmedByUser) {
          setStatus((prev) =>
            prev === 'conflict' || prev === 'error' ? prev : 'synced'
          );
        }
      }
    });
    return () => {
      active = false;
    };
  }, [
    storeState,
    dataFingerprint,
    account,
    hasValidToken,
    isOnline,
    updateMeta,
  ]);

  const handleDriveFailure = useCallback(
    (err: unknown) => {
      if (err instanceof DriveApiError) {
        if (err.code === 'unauthorized') {
          invalidateInMemoryAccessToken();
          setStatus('needs_auth');
          updateMeta({
            pendingSync: true,
            lastSyncStatus: 'needs_auth',
            lastError: err.message,
          });
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
      const snapshotState = storeStateRef.current;
      const nextRevision = (inspection?.remotePayload?.revision ?? 0) + 1;

      const uploaded = await syncArchiveToDrive(
        accessToken,
        snapshotState,
        meta,
        {
          targetRevision: nextRevision,
          existingFolderId: inspection?.folderId ?? meta.folderId,
          existingImagesFolderId:
            inspection?.imagesFolderId ?? meta.imagesFolderId,
          existingArchiveFileId:
            inspection?.archiveFileId ?? meta.archiveFileId,
        }
      );

      const now = new Date().toISOString();
      const latestHashNow = latestLocalHashRef.current;
      const editedDuringTransfer =
        Boolean(
          latestHashNow && latestHashNow !== uploaded.payload.contentHash
        ) || queueFollowUpSyncRef.current;

      queueFollowUpSyncRef.current = false;

      if (editedDuringTransfer) {
        // Newer local changes arrived while this upload was in flight:
        // preserve dirty state and schedule follow-up sync immediately.
        updateMeta({
          syncConfirmedByUser: true,
          folderId: uploaded.folderId,
          imagesFolderId: uploaded.imagesFolderId,
          archiveFileId: uploaded.archiveFileId,
          uploadedImageIndex: uploaded.uploadedImageIndex,
          lastSyncedContentHash: uploaded.payload.contentHash,
          lastSyncedRemoteRevision: uploaded.payload.revision,
          lastSyncedAt: now,
          lastSyncStatus: isOnlineRef.current ? 'unsynced' : 'offline_queued',
          lastError: null,
          pendingSync: true,
        });
        setStatus(isOnlineRef.current ? 'unsynced' : 'offline_queued');
        setSyncQueueTick((t) => t + 1);
      } else {
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
        setStatus('synced');
      }

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
        latestLocalHashRef.current = currentHash;

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
              autoSyncEnabled: true,
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
              'Account collegato: i dati locali coincidono già con Google Drive e la sincronizzazione automatica è attiva.'
            );
            return;
          }

          setStatus('conflict');
          setPendingDialog({
            kind: 'conflict',
            inspection,
            localSummary,
          });
          return;
        }

        // No remote archive yet in SYNC_TabScore -> ask one-time confirmation before first upload
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
    if (!isOnline) {
      setError('Connessione assente: impossibile riconfermare la sessione offline.');
      return;
    }
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsSyncing(true);
    setError(null);
    setNotice(null);

    try {
      const { accessToken } = await signInWithGoogleDrive(false);
      setStatus('syncing');
      const currentHash = await computeStoreContentHash(storeStateRef.current);
      setLocalHash(currentHash);
      latestLocalHashRef.current = currentHash;

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
            lastSyncedAt:
              inspection.remoteModifiedTime ??
              inspection.remotePayload.updatedAt,
            lastSyncStatus: 'synced',
            lastError: null,
            pendingSync: false,
          });
          setStatus('synced');
          setNotice('Sessione riconfermata: archivio allineato con Google Drive.');
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
      setNotice('Sessione riconfermata e modifiche sincronizzate su Google Drive.');
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      isBusyRef.current = false;
      setIsSyncing(false);
    }
  }, [isOnline, updateMeta, performUpload, handleDriveFailure]);

  const disconnectGoogle = useCallback(async () => {
    setError(null);
    setNotice(null);
    setPendingDialog(null);
    await signOutGoogleDrive();
    const cleared = clearDriveSyncConnectionMetadata();
    setSyncMeta(cleared);
    syncMetaRef.current = cleared;
    setStatus('idle');
    setNotice(
      'Account Google scollegato. I dati locali sul dispositivo sono rimasti intatti.'
    );
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
        'Sei offline: le modifiche sono salvate localmente e verranno sincronizzate appena torna la connessione.'
      );
      return;
    }

    if (isBusyRef.current) {
      queueFollowUpSyncRef.current = true;
      setSyncQueueTick((t) => t + 1);
      return;
    }

    isBusyRef.current = true;
    setIsSyncing(true);
    setStatus('syncing');

    try {
      const accessToken = await ensureValidTokenInteractive(false);
      const currentHash = await computeStoreContentHash(storeStateRef.current);
      setLocalHash(currentHash);
      latestLocalHashRef.current = currentHash;

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

      updateMeta({ autoSyncEnabled: true, syncConfirmedByUser: true });
      await performUpload(accessToken, inspection);
      setPendingDialog(null);
      setNotice(
        'Dati locali salvati su Google Drive (SYNC_TabScore). Sincronizzazione automatica attiva.'
      );
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
    updateMeta,
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

      saveLocalSafetyBackup(
        storeStateRef.current,
        'Backup automatico di sicurezza prima del ripristino da Google Drive'
      );
      setSafetyBackup(loadLocalSafetyBackup());

      const hydrated = await downloadAndHydrateArchiveFromDrive(
        accessToken,
        archiveId
      );

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
      latestLocalHashRef.current = hydrated.contentHash || restoredHash;
      queueFollowUpSyncRef.current = false;
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
      pendingSync: true,
    });
    setStatus('unsynced');
    setError(null);
    setNotice(
      'Ripristinato il backup locale precedente all’ultimo scaricamento.'
    );
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

  // Continuous debounced automatic sync + coalesced queue for concurrent edits & reconnect
  useEffect(() => {
    if (!account) return;
    if (!isOnline) return;
    if (!hasValidToken) return;
    if (!syncMeta.autoSyncEnabled || !syncMeta.syncConfirmedByUser) return;
    if (pendingDialog || status === 'conflict') return;
    if (!localHash) return;

    const isDirty =
      syncMeta.pendingSync ||
      !syncMeta.lastSyncedContentHash ||
      localHash !== syncMeta.lastSyncedContentHash;

    if (!isDirty) return;

    const timer = window.setTimeout(async () => {
      if (isBusyRef.current) {
        queueFollowUpSyncRef.current = true;
        return;
      }
      const accessToken = getInMemoryAccessToken();
      if (!accessToken) {
        setStatus('needs_auth');
        return;
      }

      isBusyRef.current = true;
      setIsSyncing(true);
      setStatus('syncing');
      setError(null);

      try {
        const meta = syncMetaRef.current;
        const currentHash = await computeStoreContentHash(storeStateRef.current);
        latestLocalHashRef.current = currentHash;

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
            const latestNow = latestLocalHashRef.current;
            const changedMeanwhile =
              Boolean(latestNow && latestNow !== currentHash) ||
              queueFollowUpSyncRef.current;
            queueFollowUpSyncRef.current = false;

            updateMeta({
              lastSyncedContentHash: currentHash,
              lastSyncedRemoteRevision: inspection.remotePayload.revision,
              lastSyncedAt: new Date().toISOString(),
              lastSyncStatus: changedMeanwhile ? 'unsynced' : 'synced',
              lastError: null,
              pendingSync: changedMeanwhile,
            });
            setStatus(changedMeanwhile ? 'unsynced' : 'synced');
            if (changedMeanwhile) setSyncQueueTick((t) => t + 1);
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
    pendingDialog,
    status,
    localHash,
    syncQueueTick,
    updateMeta,
    performUpload,
    handleDriveFailure,
  ]);

  const hasPendingChanges = Boolean(
    account &&
      (syncMeta.pendingSync ||
        !syncMeta.lastSyncedContentHash ||
        (localHash !== null && localHash !== syncMeta.lastSyncedContentHash))
  );

  const dismissPendingDialog = useCallback(() => {
    setPendingDialog(null);
  }, []);

  return {
    account,
    hasValidToken,
    syncMeta,
    status,
    hasPendingChanges,
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
