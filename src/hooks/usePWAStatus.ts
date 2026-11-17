import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { STORAGE_KEY } from '../utils/storage';

const SYNC_META_KEY = 'tabscore_pwa_sync_meta_v1';

interface SyncMeta {
  pendingOfflineSync: boolean;
  lastOfflineChangeAt: string | null;
  lastReconciledAt: string | null;
  pendingRevisionCount: number;
}

function readSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (!raw) {
      return {
        pendingOfflineSync: false,
        lastOfflineChangeAt: null,
        lastReconciledAt: null,
        pendingRevisionCount: 0,
      };
    }
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      pendingOfflineSync: Boolean(parsed.pendingOfflineSync),
      lastOfflineChangeAt:
        typeof parsed.lastOfflineChangeAt === 'string'
          ? parsed.lastOfflineChangeAt
          : null,
      lastReconciledAt:
        typeof parsed.lastReconciledAt === 'string'
          ? parsed.lastReconciledAt
          : null,
      pendingRevisionCount:
        typeof parsed.pendingRevisionCount === 'number'
          ? parsed.pendingRevisionCount
          : 0,
    };
  } catch {
    return {
      pendingOfflineSync: false,
      lastOfflineChangeAt: null,
      lastReconciledAt: null,
      pendingRevisionCount: 0,
    };
  }
}

function writeSyncMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage quota errors
  }
}

function verifyLocalArchiveReadable(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { classes?: unknown };
    return Boolean(parsed && Array.isArray(parsed.classes));
  } catch {
    return false;
  }
}

export function usePWAStatus(dataFingerprint: string, isEditingBusy: boolean) {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [reconciledNotice, setReconciledNotice] = useState<string | null>(null);
  const [pendingOfflineChanges, setPendingOfflineChanges] = useState<boolean>(
    () => readSyncMeta().pendingOfflineSync
  );
  const [isUpdating, setIsUpdating] = useState(false);

  const updateSwRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(
    null
  );
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);
  const prevFingerprintRef = useRef<string | null>(null);
  const wasOfflineRef = useRef<boolean>(!isOnline);
  const isReconcilingRef = useRef<boolean>(false);

  // Register Service Worker with prompt-based safe updates
  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        swRegRef.current = registration;
      },
    });
    updateSwRef.current = updateSW;

    const checkForUpdate = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      swRegRef.current?.update().catch(() => {
        // Ignore transient network errors while checking for SW updates
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };

    const intervalId = window.setInterval(checkForUpdate, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Track connectivity transitions cleanly & run idempotent reconciliation upon reconnect
  useEffect(() => {
    let dismissTimer: number | null = null;

    const reconcileOnReconnect = () => {
      if (isReconcilingRef.current) return;
      isReconcilingRef.current = true;
      try {
        const meta = readSyncMeta();
        const hadPending = meta.pendingOfflineSync;
        const ok = verifyLocalArchiveReadable();

        if (ok) {
          writeSyncMeta({
            pendingOfflineSync: false,
            lastOfflineChangeAt: meta.lastOfflineChangeAt,
            lastReconciledAt: new Date().toISOString(),
            pendingRevisionCount: 0,
          });
          setPendingOfflineChanges(false);

          if (hadPending || wasOfflineRef.current) {
            setReconciledNotice(
              hadPending
                ? 'Connessione ripristinata · Modifiche locali allineate senza duplicazioni'
                : 'Connessione ripristinata'
            );
            if (dismissTimer !== null) window.clearTimeout(dismissTimer);
            dismissTimer = window.setTimeout(() => {
              setReconciledNotice(null);
            }, 4500);
          }
        }

        // Safely check for a newer app version now that we are online
        swRegRef.current?.update().catch(() => {});
      } finally {
        wasOfflineRef.current = false;
        isReconcilingRef.current = false;
      }
    };

    const handleOnline = () => {
      setIsOnline(true);
      reconcileOnReconnect();
    };

    const handleOffline = () => {
      wasOfflineRef.current = true;
      setIsOnline(false);
      setReconciledNotice(null);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // If app started online with leftover pending offline edits from an earlier session, reconcile once cleanly
    if (navigator.onLine && readSyncMeta().pendingOfflineSync) {
      reconcileOnReconnect();
    }

    return () => {
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Record idempotent marker when local data changes while offline
  useEffect(() => {
    if (prevFingerprintRef.current === null) {
      prevFingerprintRef.current = dataFingerprint;
      return;
    }
    if (prevFingerprintRef.current === dataFingerprint) return;
    prevFingerprintRef.current = dataFingerprint;

    if (!isOnline) {
      const current = readSyncMeta();
      writeSyncMeta({
        pendingOfflineSync: true,
        lastOfflineChangeAt: new Date().toISOString(),
        lastReconciledAt: current.lastReconciledAt,
        pendingRevisionCount: current.pendingRevisionCount + 1,
      });
      setPendingOfflineChanges(true);
    }
  }, [dataFingerprint, isOnline]);

  // Apply waiting SW update ONLY on explicit user trigger and never while editing is active
  const applyUpdate = useCallback(async () => {
    if (isEditingBusy || !updateSwRef.current || isUpdating) return false;
    setIsUpdating(true);
    try {
      await updateSwRef.current(true);
      return true;
    } catch {
      setIsUpdating(false);
      return false;
    }
  }, [isEditingBusy, isUpdating]);

  const dismissUpdatePrompt = useCallback(() => {
    setNeedRefresh(false);
  }, []);

  return {
    isOnline,
    offlineReady,
    needRefresh,
    pendingOfflineChanges,
    reconciledNotice,
    isUpdating,
    applyUpdate,
    dismissUpdatePrompt,
  };
}
