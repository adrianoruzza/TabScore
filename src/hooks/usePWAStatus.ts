import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Manages PWA Service Worker lifecycle (offline readiness & safe prompt-based
 * app updates) and online/offline connectivity state.
 * Never touches or synchronizes user data over the network.
 */
export function usePWAStatus(isEditingBusy: boolean) {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const updateSwRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(
    null
  );
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);

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

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      swRegRef.current?.update().catch(() => {});
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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
    isUpdating,
    applyUpdate,
    dismissUpdatePrompt,
  };
}
