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
import type { StoreMutationSource } from './useGradebookStore';

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
  mutationSeq: number;
  mutationSource: StoreMutationSource;
  onRestoreState: (
    payload: TabScoreSyncPayload,
    sourceLabel?: string
  ) => GradebookStoreState;
}

const AUTO_SYNC_DEBOUNCE_MS = 2200;

export function useGoogleDriveSync({
  storeState,
  mutationSeq,
  mutationSource,
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
    if (initial.lastSyncStatus === 'syncing') {
      // Recover cleanly if a previous tab closed mid-transfer
      return initial.pendingSync ? 'unsynced' : 'synced';
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

  // Refs as single source of truth for async/timer callbacks (prevents reactive loops)
  const storeStateRef = useRef(storeState);
  storeStateRef.current = storeState;

  const mutationSeqRef = useRef(mutationSeq);
  mutationSeqRef.current = mutationSeq;

  const syncMetaRef = useRef(syncMeta);
  syncMetaRef.current = syncMeta;

  const accountRef = useRef(account);
  accountRef.current = account;

  const hasValidTokenRef = useRef(hasValidToken);
  hasValidTokenRef.current = hasValidToken;

  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  const statusRef = useRef(status);
  statusRef.current = status;

  const pendingDialogRef = useRef(pendingDialog);
  pendingDialogRef.current = pendingDialog;

  const latestLocalHashRef = useRef<string | null>(localHash);
  latestLocalHashRef.current = localHash;

  const isBusyRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  const scheduleAutoSyncRef = useRef<() => void>(() => {});

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

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
    ): Promise<{ payload: TabScoreSyncPayload; hasMoreChanges: boolean }> => {
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

      // Verify exact state right after upload finishes:
      // only mark pending if the user made real persistent edits during transfer.
      const actualHashNow = await computeStoreContentHash(storeStateRef.current);
      latestLocalHashRef.current = actualHashNow;
      setLocalHash(actualHashNow);

      const changedDuringTransfer =
        actualHashNow !== uploaded.payload.contentHash;
      const now = new Date().toISOString();

      if (changedDuringTransfer) {
        const nextStatus: DriveSyncStatus = isOnlineRef.current
          ? 'unsynced'
          : 'offline_queued';
        updateMeta({
          syncConfirmedByUser: true,
          folderId: uploaded.folderId,
          imagesFolderId: uploaded.imagesFolderId,
          archiveFileId: uploaded.archiveFileId,
          uploadedImageIndex: uploaded.uploadedImageIndex,
          lastSyncedContentHash: uploaded.payload.contentHash,
          lastSyncedRemoteRevision: uploaded.payload.revision,
          lastSyncedAt: now,
          lastSyncStatus: nextStatus,
          lastError: null,
          pendingSync: true,
        });
        setStatus(nextStatus);
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
      return {
        payload: uploaded.payload,
        hasMoreChanges: changedDuringTransfer,
      };
    },
    [updateMeta]
  );

  const executeAutoSync = useCallback(async () => {
    debounceTimerRef.current = null;

    if (isBusyRef.current) return;
    if (!accountRef.current || !isOnlineRef.current) return;
    const meta = syncMetaRef.current;
    if (!meta.autoSyncEnabled || !meta.syncConfirmedByUser) return;
    if (pendingDialogRef.current || statusRef.current === 'conflict') return;

    const accessToken = getInMemoryAccessToken();
    if (!accessToken) {
      setStatus('needs_auth');
      return;
    }

    const currentHash = await computeStoreContentHash(storeStateRef.current);
    latestLocalHashRef.current = currentHash;
    setLocalHash(currentHash);

    // Strictly skip transfer if local data matches the last synced version
    if (
      meta.lastSyncedContentHash &&
      currentHash === meta.lastSyncedContentHash
    ) {
      if (meta.pendingSync || meta.lastSyncStatus !== 'synced') {
        updateMeta({ pendingSync: false, lastSyncStatus: 'synced' });
      }
      setStatus('synced');
      return;
    }

    isBusyRef.current = true;
    setIsSyncing(true);
    setStatus('syncing');
    setError(null);

    let shouldScheduleFollowUp = false;

    try {
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
          const actualHashNow = await computeStoreContentHash(
            storeStateRef.current
          );
          latestLocalHashRef.current = actualHashNow;
          setLocalHash(actualHashNow);
          const editedDuringInspect = actualHashNow !== currentHash;

          updateMeta({
            lastSyncedContentHash: currentHash,
            lastSyncedRemoteRevision: inspection.remotePayload.revision,
            lastSyncedAt: new Date().toISOString(),
            lastSyncStatus: editedDuringInspect ? 'unsynced' : 'synced',
            lastError: null,
            pendingSync: editedDuringInspect,
          });
          setStatus(editedDuringInspect ? 'unsynced' : 'synced');
          shouldScheduleFollowUp = editedDuringInspect;
          return;
        }

        if (
          inspection.remotePayload.revision !== meta.lastSyncedRemoteRevision
        ) {
          setStatus('conflict');
          setPendingDialog({
            kind: 'conflict',
            inspection,
            localSummary: summarizeStoreState(storeStateRef.current),
          });
          return;
        }
      }

      const result = await performUpload(accessToken, inspection);
      shouldScheduleFollowUp = result.hasMoreChanges;
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      isBusyRef.current = false;
      setIsSyncing(false);
      if (shouldScheduleFollowUp) {
        scheduleAutoSyncRef.current();
      }
    }
  }, [handleDriveFailure, performUpload, updateMeta]);

  const scheduleAutoSync = useCallback(() => {
    clearDebounceTimer();
    if (isBusyRef.current) return;
    if (!accountRef.current || !isOnlineRef.current) return;
    if (!hasValidTokenRef.current) return;
    const meta = syncMetaRef.current;
    if (!meta.autoSyncEnabled || !meta.syncConfirmedByUser) return;
    if (pendingDialogRef.current || statusRef.current === 'conflict') return;

    const currentHash = latestLocalHashRef.current;
    if (
      currentHash &&
      meta.lastSyncedContentHash &&
      currentHash === meta.lastSyncedContentHash
    ) {
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      void executeAutoSync();
    }, AUTO_SYNC_DEBOUNCE_MS);
  }, [clearDebounceTimer, executeAutoSync]);

  scheduleAutoSyncRef.current = scheduleAutoSync;

  // Clean up any pending timer on unmount
  useEffect(() => () => clearDebounceTimer(), [clearDebounceTimer]);

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
      accountRef.current = nextAccount;
      hasValidTokenRef.current = nextValidToken;
      setAccount(nextAccount);
      setHasValidToken(nextValidToken);

      if (!nextAccount) {
        clearDebounceTimer();
        setStatus('idle');
      } else if (!nextValidToken) {
        clearDebounceTimer();
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
  }, [clearDebounceTimer]);

  // React ONLY to persistent store state / user mutation / cloud restore changes
  // (strictly decoupled from `status`, `isSyncing`, and sync metadata updates!)
  useEffect(() => {
    let active = true;
    const snapshot = storeState;
    const seqAtStart = mutationSeq;
    const sourceAtStart = mutationSource;

    computeStoreContentHash(snapshot).then((hash) => {
      if (!active || seqAtStart !== mutationSeqRef.current) return;

      latestLocalHashRef.current = hash;
      setLocalHash(hash);

      const currentAccount = accountRef.current;
      if (!currentAccount) return;

      const meta = syncMetaRef.current;
      const matchesLastSynced = Boolean(
        meta.lastSyncedContentHash && hash === meta.lastSyncedContentHash
      );

      if (matchesLastSynced) {
        clearDebounceTimer();
        if (meta.pendingSync) {
          updateMeta({
            pendingSync: false,
            lastSyncStatus: hasValidTokenRef.current
              ? 'synced'
              : meta.lastSyncStatus,
          });
        }
        if (
          !isBusyRef.current &&
          hasValidTokenRef.current &&
          meta.syncConfirmedByUser
        ) {
          setStatus((prev) =>
            prev === 'conflict' || prev === 'error' ? prev : 'synced'
          );
        }
        return;
      }

      // Cloud restore sets `lastSyncedContentHash` explicitly right after restoring;
      // never treat a cloud download as a pending local modification.
      if (sourceAtStart === 'cloud_restore') {
        return;
      }

      const offline = !isOnlineRef.current;
      const validToken = hasValidTokenRef.current;
      const nextStatus: DriveSyncStatus = offline
        ? 'offline_queued'
        : !validToken
        ? 'needs_auth'
        : statusRef.current === 'conflict'
        ? 'conflict'
        : 'unsynced';

      if (
        sourceAtStart === 'user' ||
        meta.pendingSync ||
        meta.syncConfirmedByUser
      ) {
        updateMeta({
          pendingSync: true,
          lastSyncStatus: nextStatus,
        });
      }

      if (!isBusyRef.current) {
        setStatus((prev) => (prev === 'conflict' ? 'conflict' : nextStatus));
        if (
          !offline &&
          validToken &&
          meta.autoSyncEnabled &&
          meta.syncConfirmedByUser
        ) {
          scheduleAutoSync();
        }
      }
    });

    return () => {
      active = false;
    };
  }, [
    storeState,
    mutationSeq,
    mutationSource,
    clearDebounceTimer,
    scheduleAutoSync,
    updateMeta,
  ]);

  // Recover & reconcile ONLY genuine pending changes when connectivity, auth, or auto-sync transitions to active
  useEffect(() => {
    if (!account) {
      clearDebounceTimer();
      return;
    }

    const meta = syncMetaRef.current;
    const currentHash = latestLocalHashRef.current;
    const isDirty =
      currentHash !== null &&
      (!meta.lastSyncedContentHash ||
        currentHash !== meta.lastSyncedContentHash);

    if (!isOnline) {
      clearDebounceTimer();
      if (!isBusyRef.current && (isDirty || meta.pendingSync)) {
        setStatus('offline_queued');
      }
      return;
    }

    if (!hasValidToken) {
      clearDebounceTimer();
      if (
        !isBusyRef.current &&
        statusRef.current !== 'error' &&
        statusRef.current !== 'conflict'
      ) {
        setStatus('needs_auth');
      }
      return;
    }

    if (isBusyRef.current) return;

    if (!isDirty && currentHash !== null) {
      if (meta.pendingSync) {
        updateMeta({ pendingSync: false, lastSyncStatus: 'synced' });
      }
      if (
        meta.syncConfirmedByUser &&
        statusRef.current !== 'conflict' &&
        statusRef.current !== 'error'
      ) {
        setStatus('synced');
      }
      return;
    }

    if (
      isDirty &&
      meta.autoSyncEnabled &&
      meta.syncConfirmedByUser &&
      !pendingDialogRef.current &&
      statusRef.current !== 'conflict'
    ) {
      setStatus('unsynced');
      scheduleAutoSync();
    }
  }, [
    account,
    isOnline,
    hasValidToken,
    syncMeta.autoSyncEnabled,
    syncMeta.syncConfirmedByUser,
    clearDebounceTimer,
    scheduleAutoSync,
    updateMeta,
  ]);

  const ensureValidTokenInteractive = useCallback(
    async (forceSelectAccount = false): Promise<string> => {
      const live = getInMemoryAccessToken();
      if (live && !forceSelectAccount) return live;
      const res = await signInWithGoogleDrive(forceSelectAccount);
      accountRef.current = res.account;
      hasValidTokenRef.current = true;
      setAccount(res.account);
      setHasValidToken(true);
      return res.accessToken;
    },
    []
  );

  const connectGoogle = useCallback(
    async (forceSelectAccount = false) => {
      if (!isOnlineRef.current) {
        setError(
          'Connessione assente: impossibile collegare Google Drive offline.'
        );
        return;
      }
      if (isBusyRef.current) return;
      clearDebounceTimer();
      isBusyRef.current = true;
      setIsSyncing(true);
      setError(null);
      setNotice(null);

      try {
        const { accessToken } = await signInWithGoogleDrive(forceSelectAccount);
        setStatus('syncing');
        const currentHash = await computeStoreContentHash(
          storeStateRef.current
        );
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
    [clearDebounceTimer, updateMeta, handleDriveFailure]
  );

  const reconnectSession = useCallback(async () => {
    if (!isOnlineRef.current) {
      setError(
        'Connessione assente: impossibile riconfermare la sessione offline.'
      );
      return;
    }
    if (isBusyRef.current) return;
    clearDebounceTimer();
    isBusyRef.current = true;
    setIsSyncing(true);
    setError(null);
    setNotice(null);

    let shouldScheduleFollowUp = false;

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

      const result = await performUpload(accessToken, inspection);
      shouldScheduleFollowUp = result.hasMoreChanges;
      setNotice('Sessione riconfermata e modifiche sincronizzate su Google Drive.');
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      isBusyRef.current = false;
      setIsSyncing(false);
      if (shouldScheduleFollowUp) {
        scheduleAutoSyncRef.current();
      }
    }
  }, [clearDebounceTimer, updateMeta, performUpload, handleDriveFailure]);

  const disconnectGoogle = useCallback(async () => {
    clearDebounceTimer();
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
  }, [clearDebounceTimer]);

  const requestManualSync = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (!isOnlineRef.current) {
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

    if (isBusyRef.current) return;
    clearDebounceTimer();
    isBusyRef.current = true;
    setIsSyncing(true);
    setStatus('syncing');

    let shouldScheduleFollowUp = false;

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

      const result = await performUpload(accessToken, inspection);
      shouldScheduleFollowUp = result.hasMoreChanges;
      setNotice('Sincronizzazione su Google Drive completata e verificata.');
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      isBusyRef.current = false;
      setIsSyncing(false);
      if (shouldScheduleFollowUp) {
        scheduleAutoSyncRef.current();
      }
    }
  }, [
    clearDebounceTimer,
    ensureValidTokenInteractive,
    updateMeta,
    performUpload,
    handleDriveFailure,
  ]);

  const confirmUploadLocalToDrive = useCallback(async () => {
    if (!isOnlineRef.current) {
      setError('Connessione assente: impossibile caricare su Google Drive.');
      return;
    }
    if (isBusyRef.current) return;
    clearDebounceTimer();
    isBusyRef.current = true;
    setIsSyncing(true);
    setStatus('syncing');
    setError(null);
    setNotice(null);

    let shouldScheduleFollowUp = false;

    try {
      const accessToken = await ensureValidTokenInteractive(false);
      const existingInspection =
        pendingDialogRef.current && 'inspection' in pendingDialogRef.current
          ? pendingDialogRef.current.inspection
          : null;
      const inspection =
        existingInspection ??
        (await inspectDriveSyncState(accessToken, syncMetaRef.current));

      updateMeta({ autoSyncEnabled: true, syncConfirmedByUser: true });
      const result = await performUpload(accessToken, inspection);
      shouldScheduleFollowUp = result.hasMoreChanges;
      setPendingDialog(null);
      setNotice(
        'Dati locali salvati su Google Drive (SYNC_TabScore). Sincronizzazione automatica attiva.'
      );
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      isBusyRef.current = false;
      setIsSyncing(false);
      if (shouldScheduleFollowUp) {
        scheduleAutoSyncRef.current();
      }
    }
  }, [
    clearDebounceTimer,
    ensureValidTokenInteractive,
    updateMeta,
    performUpload,
    handleDriveFailure,
  ]);

  const requestRestoreFromDrive = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!isOnlineRef.current) {
      setError(
        'Connessione assente: impossibile leggere i dati da Google Drive.'
      );
      return;
    }
    if (isBusyRef.current) return;
    clearDebounceTimer();
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
  }, [
    clearDebounceTimer,
    ensureValidTokenInteractive,
    updateMeta,
    handleDriveFailure,
  ]);

  const confirmRestoreFromDrive = useCallback(async () => {
    if (!isOnlineRef.current) {
      setError('Connessione assente: impossibile completare il ripristino.');
      return;
    }
    const targetDialog = pendingDialogRef.current;
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
    clearDebounceTimer();
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

      // Restore faithfully without injecting dirty local audit mutations,
      // then align `lastSyncedContentHash` to the exact restored state hash.
      const restoredState = onRestoreState(hydrated, 'Google Drive');
      const restoredHash = await computeStoreContentHash(restoredState);

      clearDebounceTimer();
      updateMeta({
        syncConfirmedByUser: true,
        archiveFileId: archiveId,
        lastSyncedContentHash: restoredHash,
        lastSyncedRemoteRevision: hydrated.revision,
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'synced',
        lastError: null,
        pendingSync: false,
      });
      latestLocalHashRef.current = restoredHash;
      setLocalHash(restoredHash);
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
    clearDebounceTimer,
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
        clearDebounceTimer();
        updateMeta({ autoSyncEnabled: false });
        return;
      }

      if (syncMetaRef.current.syncConfirmedByUser || !accountRef.current) {
        updateMeta({ autoSyncEnabled: true });
        return;
      }

      if (isOnlineRef.current && hasValidTokenRef.current) {
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
    [clearDebounceTimer, updateMeta, handleDriveFailure]
  );

  const confirmEnableAutoSync = useCallback(async () => {
    updateMeta({ autoSyncEnabled: true, syncConfirmedByUser: true });
    setPendingDialog(null);
    if (accountRef.current && isOnlineRef.current) {
      await requestManualSync();
    }
  }, [updateMeta, requestManualSync]);

  const hasPendingChanges = Boolean(
    account &&
      (syncMeta.pendingSync ||
        (localHash !== null &&
          (!syncMeta.lastSyncedContentHash ||
            localHash !== syncMeta.lastSyncedContentHash)))
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
