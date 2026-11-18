import { useCallback, useEffect, useRef, useState } from 'react';
import {
  decideSyncAction,
  getEffectiveArchiveModifiedAt,
  isUntouchedInitialLocalState,
  reconcileArchives,
} from '../services/driveMerge';
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
  loadSyncedBaseSnapshot,
  saveDriveSyncMetadata,
  saveLocalSafetyBackup,
  saveSyncedBaseSnapshot,
  summarizeStoreState,
  syncArchiveToDrive,
  uploadFullBackupToDriveFolder,
  type DriveBackupUploadResult,
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
      conflicts?: string[];
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
    payload: Pick<GradebookStoreState, 'activeClassId' | 'classes'> & {
      version?: number;
      auditLog?: GradebookStoreState['auditLog'];
    },
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
      // Recover cleanly if browser closed abruptly mid-transfer
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

  // Refs as single source of truth for async/timer callbacks (eliminates reactive loops)
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
  const interactiveAuthInProgressRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  const scheduleAutoSyncRef = useRef<() => void>(() => {});
  const reconciledTokenRef = useRef<string | null>(null);
  const wasOfflineRef = useRef<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

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
          reconciledTokenRef.current = null;
          setStatus('needs_auth');
          updateMeta({
            pendingSync: syncMetaRef.current.pendingSync,
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
      inspection: RemoteArchiveInspection | null,
      snapshotOverride?: GradebookStoreState
    ): Promise<{ payload: TabScoreSyncPayload; hasMoreChanges: boolean }> => {
      const meta = syncMetaRef.current;
      const snapshotState = snapshotOverride ?? storeStateRef.current;
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

      // Persist clean 3-way base snapshot matching what we actually uploaded
      saveSyncedBaseSnapshot(snapshotState);

      // Verify exact state right after upload finishes:
      // only mark pending if real persistent edits arrived during transfer.
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
          autoSyncEnabled: true,
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
          autoSyncEnabled: true,
          folderId: uploaded.folderId,
          imagesFolderId: uploaded.imagesFolderId,
          archiveFileId: uploaded.archiveFileId,
          uploadedImageIndex: uploaded.uploadedImageIndex,
          lastSyncedContentHash: uploaded.payload.contentHash,
          lastSyncedRemoteRevision: uploaded.payload.revision,
          lastSyncedAt: now,
          lastLocalModifiedAt:
            uploaded.payload.lastEffectiveModifiedAt ??
            meta.lastLocalModifiedAt ??
            now,
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

  const applyRemoteHydratedState = useCallback(
    async (
      hydrated: TabScoreSyncPayload,
      archiveFileId: string,
      inspection: RemoteArchiveInspection
    ) => {
      const restoredState = onRestoreState(hydrated, 'Google Drive');
      storeStateRef.current = restoredState;
      const restoredHash = await computeStoreContentHash(restoredState);
      saveSyncedBaseSnapshot(restoredState);

      clearDebounceTimer();
      updateMeta({
        syncConfirmedByUser: true,
        autoSyncEnabled: true,
        folderId: inspection.folderId,
        imagesFolderId: inspection.imagesFolderId,
        archiveFileId,
        lastSyncedContentHash: restoredHash,
        lastSyncedRemoteRevision: hydrated.revision,
        lastSyncedAt: new Date().toISOString(),
        lastLocalModifiedAt:
          hydrated.lastEffectiveModifiedAt ?? hydrated.updatedAt,
        lastSyncStatus: 'synced',
        lastError: null,
        pendingSync: false,
      });
      latestLocalHashRef.current = restoredHash;
      setLocalHash(restoredHash);
      setStatus('synced');
      setPendingDialog(null);
      return restoredState;
    },
    [clearDebounceTimer, onRestoreState, updateMeta]
  );

  /**
   * Unified intelligent reconciliation engine:
   * Evaluates local vs remote revision, hash, pending flags, seed state, and effective timestamps,
   * automatically choosing up_to_date / pull_remote / push_local / 3-way element merge.
   */
  const reconcileWithDrive = useCallback(
    async (
      accessToken: string,
      mode: 'auto' | 'connect' | 'reconnect' | 'manual'
    ): Promise<void> => {
      if (isBusyRef.current) return;
      if (!isOnlineRef.current) return;

      clearDebounceTimer();
      isBusyRef.current = true;
      setIsSyncing(true);
      setStatus('syncing');
      setError(null);
      if (mode !== 'auto') setNotice(null);

      let shouldScheduleFollowUp = false;

      try {
        reconciledTokenRef.current = accessToken;
        const snapshotAtStart = storeStateRef.current;
        const currentHash = await computeStoreContentHash(snapshotAtStart);
        latestLocalHashRef.current = currentHash;
        setLocalHash(currentHash);

        const inspection = await inspectDriveSyncState(
          accessToken,
          syncMetaRef.current
        );
        updateMeta({
          folderId: inspection.folderId,
          imagesFolderId: inspection.imagesFolderId,
          archiveFileId: inspection.archiveFileId,
        });

        const meta = syncMetaRef.current;
        const isUntouchedSeed = isUntouchedInitialLocalState(snapshotAtStart);
        const hasLocalChanges = Boolean(
          meta.pendingSync ||
            (meta.lastSyncedContentHash
              ? currentHash !== meta.lastSyncedContentHash
              : !isUntouchedSeed)
        );

        const decision = decideSyncAction({
          localHash: currentHash,
          hasLocalChanges,
          localVersionSeq: meta.localVersionSeq,
          lastLocalModifiedAt:
            meta.lastLocalModifiedAt ??
            getEffectiveArchiveModifiedAt(snapshotAtStart),
          lastSyncedRemoteRevision: meta.lastSyncedRemoteRevision,
          lastSyncedContentHash: meta.lastSyncedContentHash,
          isUntouchedLocalSeed: isUntouchedSeed,
          remotePayload: inspection.remotePayload
            ? {
                revision: inspection.remotePayload.revision,
                contentHash: inspection.remotePayload.contentHash,
                updatedAt: inspection.remotePayload.updatedAt,
                lastEffectiveModifiedAt:
                  inspection.remotePayload.lastEffectiveModifiedAt,
                deviceId: inspection.remotePayload.deviceId,
              }
            : null,
          remoteIntegrityValid: inspection.remoteIntegrityValid,
        });

        if (decision.action === 'corrupt_remote') {
          setStatus('error');
          setError(
            inspection.remoteError ??
              'L’archivio presente su Google Drive non ha superato la verifica di integrità.'
          );
          return;
        }

        if (decision.action === 'up_to_date') {
          if (!loadSyncedBaseSnapshot()) {
            saveSyncedBaseSnapshot(snapshotAtStart);
          }
          const actualHashNow = await computeStoreContentHash(
            storeStateRef.current
          );
          latestLocalHashRef.current = actualHashNow;
          setLocalHash(actualHashNow);
          const editedMeanwhile = actualHashNow !== currentHash;

          updateMeta({
            syncConfirmedByUser: true,
            autoSyncEnabled: true,
            lastSyncedContentHash: currentHash,
            lastSyncedRemoteRevision: inspection.remotePayload!.revision,
            lastSyncedAt:
              inspection.remoteModifiedTime ??
              inspection.remotePayload!.updatedAt,
            lastSyncStatus: editedMeanwhile ? 'unsynced' : 'synced',
            lastError: null,
            pendingSync: editedMeanwhile,
          });
          setStatus(editedMeanwhile ? 'unsynced' : 'synced');
          shouldScheduleFollowUp = editedMeanwhile;
          if (!editedMeanwhile && mode !== 'auto') {
            setNotice(
              mode === 'connect'
                ? 'Account collegato: i dati locali e su Google Drive sono già allineati.'
                : 'Archivio già sincronizzato e aggiornato con Google Drive.'
            );
          }
          return;
        }

        if (decision.action === 'pull_remote' && inspection.archiveFileId) {
          saveLocalSafetyBackup(
            snapshotAtStart,
            'Backup automatico prima dell’aggiornamento alla versione più recente su Google Drive'
          );
          setSafetyBackup(loadLocalSafetyBackup());

          const hydrated = await downloadAndHydrateArchiveFromDrive(
            accessToken,
            inspection.archiveFileId
          );

          const hashBeforeApply = await computeStoreContentHash(
            storeStateRef.current
          );
          if (hashBeforeApply !== currentHash) {
            // User edited data while downloading remote archive -> switch seamlessly to 3-way merge!
            const merge = reconcileArchives({
              base: loadSyncedBaseSnapshot(),
              local: storeStateRef.current,
              remote: hydrated,
            });
            if (merge.outcome === 'merged' && merge.mergedState) {
              const applied = onRestoreState(merge.mergedState, 'Google Drive');
              storeStateRef.current = applied;
              const up = await performUpload(accessToken, inspection, applied);
              shouldScheduleFollowUp = up.hasMoreChanges;
              setNotice(
                'Sincronizzazione completata: integrate le modifiche locali con la versione più recente di Google Drive.'
              );
              return;
            }
            setStatus('conflict');
            setPendingDialog({
              kind: 'conflict',
              inspection: { ...inspection, remotePayload: hydrated },
              localSummary: summarizeStoreState(storeStateRef.current),
              conflicts: merge.conflicts,
            });
            return;
          }

          await applyRemoteHydratedState(
            hydrated,
            inspection.archiveFileId,
            inspection
          );
          setNotice(
            'Archivio aggiornato automaticamente alla versione più recente presente su Google Drive.'
          );
          return;
        }

        if (decision.action === 'reconcile_both' && inspection.archiveFileId) {
          saveLocalSafetyBackup(
            snapshotAtStart,
            'Backup automatico prima della riconciliazione multi-dispositivo'
          );
          setSafetyBackup(loadLocalSafetyBackup());

          const hydrated = await downloadAndHydrateArchiveFromDrive(
            accessToken,
            inspection.archiveFileId
          );
          const localNow = storeStateRef.current;
          const merge = reconcileArchives({
            base: loadSyncedBaseSnapshot(),
            local: localNow,
            remote: hydrated,
          });

          if (merge.outcome === 'merged' && merge.mergedState) {
            const applied = onRestoreState(merge.mergedState, 'Google Drive');
            storeStateRef.current = applied;
            const up = await performUpload(accessToken, inspection, applied);
            shouldScheduleFollowUp = up.hasMoreChanges;
            setNotice(
              'Sincronizzazione automatica completata: unite senza perdite le modifiche di entrambi i dispositivi.'
            );
            return;
          }

          setStatus('conflict');
          setPendingDialog({
            kind: 'conflict',
            inspection: { ...inspection, remotePayload: hydrated },
            localSummary: summarizeStoreState(localNow),
            conflicts: merge.conflicts,
          });
          return;
        }

        // 'push_local': local is cleanly ahead of Drive (or Drive archive doesn't exist yet)
        const result = await performUpload(
          accessToken,
          inspection,
          storeStateRef.current
        );
        shouldScheduleFollowUp = result.hasMoreChanges;
        if (mode !== 'auto') {
          setNotice(
            inspection.remotePayload
              ? 'Sincronizzazione completata: caricata su Google Drive la versione più recente.'
              : 'Archivio iniziale salvato in SYNC_TabScore. Sincronizzazione automatica attiva.'
          );
        }
      } catch (err) {
        handleDriveFailure(err);
      } finally {
        isBusyRef.current = false;
        setIsSyncing(false);
        if (shouldScheduleFollowUp) {
          scheduleAutoSyncRef.current();
        }
      }
    },
    [
      applyRemoteHydratedState,
      clearDebounceTimer,
      handleDriveFailure,
      onRestoreState,
      performUpload,
      updateMeta,
    ]
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

    // Strictly skip network round-trip if local matches the last synced hash
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

    await reconcileWithDrive(accessToken, 'auto');
  }, [reconcileWithDrive, updateMeta]);

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

  useEffect(() => () => clearDebounceTimer(), [clearDebounceTimer]);

  // Track browser online / offline transitions
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      wasOfflineRef.current = true;
      setIsOnline(false);
    };
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
        reconciledTokenRef.current = null;
        clearDebounceTimer();
        setStatus('idle');
      } else if (!nextValidToken) {
        reconciledTokenRef.current = null;
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

  // React ONLY to persistent store state / explicit user mutation / cloud restore changes
  useEffect(() => {
    let active = true;
    const snapshot = storeState;
    const seqAtStart = mutationSeq;
    const sourceAtStart = mutationSource;

    // Immediately persist crash-safe version & dirty marker on every user mutation
    if (sourceAtStart === 'user') {
      const nowIso = new Date().toISOString();
      updateMeta((prev) => ({
        ...prev,
        pendingSync: Boolean(accountRef.current || prev.syncConfirmedByUser),
        localVersionSeq: prev.localVersionSeq + 1,
        lastLocalModifiedAt: nowIso,
      }));
    }

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

      if (sourceAtStart === 'user' || meta.pendingSync) {
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

  // Automatic version check on session connect/startup or network reconnect (runs ONCE per event, never loops!)
  useEffect(() => {
    if (!account) {
      clearDebounceTimer();
      return;
    }

    const meta = syncMetaRef.current;
    const currentHash = latestLocalHashRef.current;
    const isDirty =
      meta.pendingSync ||
      (currentHash !== null &&
        (!meta.lastSyncedContentHash ||
          currentHash !== meta.lastSyncedContentHash));

    if (!isOnline) {
      clearDebounceTimer();
      if (!isBusyRef.current && isDirty) {
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

    if (isBusyRef.current || interactiveAuthInProgressRef.current) return;

    const liveToken = getInMemoryAccessToken();
    if (!liveToken) return;

    const recoveredFromOffline = wasOfflineRef.current;
    wasOfflineRef.current = false;

    const tokenNeedsInitialReconcile =
      reconciledTokenRef.current !== liveToken && meta.syncConfirmedByUser;

    if (
      (tokenNeedsInitialReconcile || recoveredFromOffline) &&
      !pendingDialogRef.current &&
      statusRef.current !== 'conflict'
    ) {
      void reconcileWithDrive(liveToken, 'auto');
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
    reconcileWithDrive,
    scheduleAutoSync,
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
      interactiveAuthInProgressRef.current = true;
      try {
        const res = await signInWithGoogleDrive(forceSelectAccount);
        accountRef.current = res.account;
        hasValidTokenRef.current = true;
        setAccount(res.account);
        setHasValidToken(true);
        await reconcileWithDrive(res.accessToken, 'connect');
      } catch (err) {
        handleDriveFailure(err);
      } finally {
        interactiveAuthInProgressRef.current = false;
      }
    },
    [handleDriveFailure, reconcileWithDrive]
  );

  const reconnectSession = useCallback(async () => {
    if (!isOnlineRef.current) {
      setError(
        'Connessione assente: impossibile riconfermare la sessione offline.'
      );
      return;
    }
    if (isBusyRef.current) return;
    interactiveAuthInProgressRef.current = true;
    try {
      const res = await signInWithGoogleDrive(false);
      accountRef.current = res.account;
      hasValidTokenRef.current = true;
      setAccount(res.account);
      setHasValidToken(true);
      await reconcileWithDrive(res.accessToken, 'reconnect');
    } catch (err) {
      handleDriveFailure(err);
    } finally {
      interactiveAuthInProgressRef.current = false;
    }
  }, [handleDriveFailure, reconcileWithDrive]);

  const disconnectGoogle = useCallback(async () => {
    clearDebounceTimer();
    reconciledTokenRef.current = null;
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
    try {
      const accessToken = await ensureValidTokenInteractive(false);
      await reconcileWithDrive(accessToken, 'manual');
    } catch (err) {
      handleDriveFailure(err);
    }
  }, [ensureValidTokenInteractive, handleDriveFailure, reconcileWithDrive, updateMeta]);

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
      reconciledTokenRef.current = accessToken;
      const existingInspection =
        pendingDialogRef.current && 'inspection' in pendingDialogRef.current
          ? pendingDialogRef.current.inspection
          : null;
      const inspection =
        existingInspection ??
        (await inspectDriveSyncState(accessToken, syncMetaRef.current));

      updateMeta({ autoSyncEnabled: true, syncConfirmedByUser: true });
      const result = await performUpload(
        accessToken,
        inspection,
        storeStateRef.current
      );
      shouldScheduleFollowUp = result.hasMoreChanges;
      setPendingDialog(null);
      setNotice(
        'Dati locali mantenuti e sincronizzati su Google Drive (SYNC_TabScore).'
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
      reconciledTokenRef.current = accessToken;
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
    if (!archiveId || !targetDialog.inspection) {
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
      reconciledTokenRef.current = accessToken;

      saveLocalSafetyBackup(
        storeStateRef.current,
        'Backup automatico di sicurezza prima del ripristino da Google Drive'
      );
      setSafetyBackup(loadLocalSafetyBackup());

      const hydrated = await downloadAndHydrateArchiveFromDrive(
        accessToken,
        archiveId
      );

      await applyRemoteHydratedState(
        hydrated,
        archiveId,
        targetDialog.inspection
      );
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
    applyRemoteHydratedState,
    clearDebounceTimer,
    ensureValidTokenInteractive,
    handleDriveFailure,
  ]);

  const restoreFromSafetyBackup = useCallback(() => {
    const backup = loadLocalSafetyBackup();
    if (!backup) {
      setError('Nessun backup locale di sicurezza disponibile.');
      return;
    }
    onRestoreState(backup.state, 'Backup locale di sicurezza');
    const nowIso = new Date().toISOString();
    updateMeta((prev) => ({
      ...prev,
      lastLocalModifiedAt: nowIso,
      localVersionSeq: prev.localVersionSeq + 1,
      lastSyncStatus: 'unsynced',
      pendingSync: true,
    }));
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

      updateMeta({ autoSyncEnabled: true, syncConfirmedByUser: true });
      if (accountRef.current && isOnlineRef.current && hasValidTokenRef.current) {
        await requestManualSync();
      }
    },
    [clearDebounceTimer, requestManualSync, updateMeta]
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

  /**
   * Salva una copia del backup completo (.json) nella sottocartella
   * SYNC_TabScore/BACKUP su Google Drive.
   * Completamente isolato dallo stato di sincronizzazione operativa per evitare
   * interferenze con tabscore_sync_archive.json o riattivazioni di cicli di sync.
   */
  const backupFullArchiveToDrive = useCallback(async (): Promise<
    | { ok: true; result: DriveBackupUploadResult }
    | { ok: false; error: string }
  > => {
    if (!accountRef.current) {
      return {
        ok: false,
        error:
          'Google Drive non è collegato. Accedi a Google Drive dalle impostazioni di sincronizzazione per salvare il backup in SYNC_TabScore/BACKUP.',
      };
    }
    if (!isOnlineRef.current) {
      return {
        ok: false,
        error:
          'Connessione internet assente: impossibile salvare il backup su Google Drive in questo momento.',
      };
    }

    try {
      let accessToken = getInMemoryAccessToken();
      if (!accessToken) {
        const authRes = await signInWithGoogleDrive(false);
        accountRef.current = authRes.account;
        hasValidTokenRef.current = true;
        setAccount(authRes.account);
        setHasValidToken(true);
        accessToken = authRes.accessToken;
      }

      const uploadOnce = (token: string) =>
        uploadFullBackupToDriveFolder(token, storeStateRef.current, {
          existingFolderId: syncMetaRef.current.folderId,
          existingBackupFolderId: syncMetaRef.current.backupFolderId,
        });

      let result: DriveBackupUploadResult;
      try {
        result = await uploadOnce(accessToken);
      } catch (err) {
        if (err instanceof DriveApiError && err.code === 'unauthorized') {
          invalidateInMemoryAccessToken();
          const refreshed = await signInWithGoogleDrive(false);
          accountRef.current = refreshed.account;
          hasValidTokenRef.current = true;
          setAccount(refreshed.account);
          setHasValidToken(true);
          result = await uploadOnce(refreshed.accessToken);
        } else {
          throw err;
        }
      }

      // Cache folder IDs only — never touch pendingSync, localVersionSeq, or storeState
      if (
        syncMetaRef.current.folderId !== result.folderId ||
        syncMetaRef.current.backupFolderId !== result.backupFolderId
      ) {
        updateMeta({
          folderId: result.folderId,
          backupFolderId: result.backupFolderId,
        });
      }

      return { ok: true, result };
    } catch (err) {
      const msg =
        err instanceof DriveApiError
          ? err.message
          : mapGoogleAuthError(err);
      return { ok: false, error: msg };
    }
  }, [updateMeta]);

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
    backupFullArchiveToDrive,
  };
}
