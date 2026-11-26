import type { GradebookStoreState } from '../types/gradebook';
import {
  createInitialSeedState,
  sortAndNormalizeClasses,
  STORAGE_KEY,
  STORE_VERSION,
} from './storage';

export const LOCAL_DB_NAME = 'tabscore_local_db';
export const LOCAL_DB_VERSION = 1;
const ARCHIVE_STORE = 'archive';
const HANDLES_STORE = 'handles';
const PRIMARY_RECORD_ID = 'primary';
const PREVIOUS_SNAPSHOT_ID = 'previous_snapshot';
const BACKUP_DIR_HANDLE_ID = 'backup_directory';

export const STORAGE_META_KEY = 'tabscore_storage_meta_v1';
const LOCALSTORAGE_MIRROR_MAX_BYTES = 2_500_000;

export type PersistenceEngine = 'indexeddb' | 'localstorage';

export interface LocalStorageMeta {
  engine: PersistenceEngine;
  updatedAt: string;
  revision: number;
  byteLength: number;
}

interface ArchiveDbRecord {
  id: string;
  state: GradebookStoreState;
  savedAt: string;
  revision: number;
}

export interface BackupDirectoryRecord {
  id: string;
  handle: FileSystemDirectoryHandle;
  folderName: string;
  savedAt: string;
}

export interface LocalHydrationResult {
  state: GradebookStoreState;
  engine: PersistenceEngine;
  savedAt: string | null;
  revision: number;
  migratedFromLocalStorage: boolean;
  recoveredFromSnapshot: boolean;
  isNewSeed: boolean;
}

export interface LocalPersistResult {
  ok: boolean;
  engine: PersistenceEngine;
  savedAt: string;
  revision: number;
  byteLength: number;
  error?: string;
}

const LEGACY_CLOUD_LOCALSTORAGE_KEYS = [
  'tabscore_drive_account_hint_v1',
  'tabscore_drive_sync_meta_v1',
  'tabscore_drive_sync_base_v1',
  'tabscore_safety_backup_v1',
  'tabscore_pwa_sync_meta_v1',
] as const;

let legacyCleanupDone = false;

/**
 * Purges obsolete Google Drive / Firebase / cloud-sync keys left over in the
 * browser from earlier versions while strictly preserving all local gradebook
 * data and UI preferences.
 */
export function cleanupLegacyCloudArtifacts(): void {
  if (legacyCleanupDone || typeof window === 'undefined') return;
  legacyCleanupDone = true;

  const scrubStorage = (storage: Storage | undefined, includeExplicitKeys: boolean) => {
    if (!storage) return;
    try {
      if (includeExplicitKeys) {
        for (const key of LEGACY_CLOUD_LOCALSTORAGE_KEYS) {
          storage.removeItem(key);
        }
      }
      const prefixedKeys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key && (/^firebase:/i.test(key) || /^tabscore_drive_/i.test(key))) {
          prefixedKeys.push(key);
        }
      }
      for (const key of prefixedKeys) {
        storage.removeItem(key);
      }
    } catch {
      // Ignore storage access restrictions
    }
  };

  scrubStorage(window.localStorage, true);
  scrubStorage(window.sessionStorage, false);

  try {
    if (
      typeof window.indexedDB !== 'undefined' &&
      typeof window.indexedDB.deleteDatabase === 'function'
    ) {
      const req = window.indexedDB.deleteDatabase('firebaseLocalStorageDb');
      req.onerror = () => {};
      req.onblocked = () => {};
    }
  } catch {
    // Ignore IndexedDB unavailability
  }
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
  } catch {
    return false;
  }
}

export function readStorageMeta(): LocalStorageMeta | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalStorageMeta>;
    if (
      (parsed.engine !== 'indexeddb' && parsed.engine !== 'localstorage') ||
      typeof parsed.updatedAt !== 'string'
    ) {
      return null;
    }
    return {
      engine: parsed.engine,
      updatedAt: parsed.updatedAt,
      revision: typeof parsed.revision === 'number' && Number.isFinite(parsed.revision) ? parsed.revision : 0,
      byteLength: typeof parsed.byteLength === 'number' && Number.isFinite(parsed.byteLength) ? parsed.byteLength : 0,
    };
  } catch {
    return null;
  }
}

function writeStorageMeta(meta: LocalStorageMeta): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
  } catch {
    // Non-critical metadata
  }
}

export function normalizeStoredState(
  raw: unknown
): GradebookStoreState | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<GradebookStoreState>;
  if (!Array.isArray(candidate.classes)) return null;

  const validClasses = candidate.classes.every(
    (c) =>
      c &&
      typeof c === 'object' &&
      typeof c.id === 'string' &&
      typeof c.name === 'string' &&
      Array.isArray(c.students) &&
      Array.isArray(c.plates) &&
      Array.isArray(c.folders)
  );
  if (!validClasses) return null;

  const normalizedClasses = sortAndNormalizeClasses(candidate.classes);
  return {
    version:
      typeof candidate.version === 'number' && Number.isFinite(candidate.version)
        ? candidate.version
        : STORE_VERSION,
    activeClassId:
      candidate.activeClassId &&
      normalizedClasses.some((c) => c.id === candidate.activeClassId)
        ? candidate.activeClassId
        : normalizedClasses[0]?.id ?? null,
    classes: normalizedClasses,
    auditLog: Array.isArray(candidate.auditLog)
      ? candidate.auditLog.slice(0, 500)
      : [],
  };
}

function readLegacyLocalStorageState(): GradebookStoreState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return normalizeStoredState(parsed);
  } catch {
    return null;
  }
}

export function getLatestStateTimestampMs(state: GradebookStoreState): number {
  let latest = 0;
  for (const cls of state.classes) {
    const ts = Date.parse(cls.updatedAt || cls.createdAt || '');
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  const latestLogTs = state.auditLog[0]?.timestamp
    ? Date.parse(state.auditLog[0].timestamp)
    : 0;
  if (Number.isFinite(latestLogTs) && latestLogTs > latest) {
    latest = latestLogTs;
  }
  return latest;
}

function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('IndexedDB non disponibile in questo browser.'));
      return;
    }
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARCHIVE_STORE)) {
        db.createObjectStore(ARCHIVE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(HANDLES_STORE)) {
        db.createObjectStore(HANDLES_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('Impossibile aprire il database locale IndexedDB.'));
    request.onblocked = () =>
      reject(new Error('Database locale temporaneamente bloccato da un’altra scheda.'));
  });
}

async function readArchiveRecord(
  db: IDBDatabase,
  id: string
): Promise<ArchiveDbRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARCHIVE_STORE, 'readonly');
    const store = tx.objectStore(ARCHIVE_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      resolve((req.result as ArchiveDbRecord | undefined) ?? null);
    };
    req.onerror = () => reject(new Error('Errore lettura archivio locale.'));
  });
}

async function writeArchiveRecordAtomic(
  db: IDBDatabase,
  nextState: GradebookStoreState,
  options?: { preservePrevious?: boolean }
): Promise<{ savedAt: string; revision: number }> {
  const preservePrevious = options?.preservePrevious !== false;
  const savedAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARCHIVE_STORE, 'readwrite');
    const store = tx.objectStore(ARCHIVE_STORE);
    let nextRevision = 1;

    const getReq = store.get(PRIMARY_RECORD_ID);
    getReq.onsuccess = () => {
      const existing = getReq.result as ArchiveDbRecord | undefined;
      if (existing) {
        nextRevision =
          typeof existing.revision === 'number' && Number.isFinite(existing.revision)
            ? existing.revision + 1
            : 1;
        if (preservePrevious && normalizeStoredState(existing.state)) {
          store.put({
            id: PREVIOUS_SNAPSHOT_ID,
            state: existing.state,
            savedAt: existing.savedAt,
            revision: existing.revision,
          } satisfies ArchiveDbRecord);
        }
      }

      store.put({
        id: PRIMARY_RECORD_ID,
        state: nextState,
        savedAt,
        revision: nextRevision,
      } satisfies ArchiveDbRecord);
    };
    getReq.onerror = () => {
      reject(new Error('Errore preparazione transazione locale.'));
    };

    tx.oncomplete = () => resolve({ savedAt, revision: nextRevision });
    tx.onerror = () =>
      reject(new Error('Errore durante il salvataggio in IndexedDB.'));
    tx.onabort = () =>
      reject(new Error('Salvataggio locale annullato (spazio esaurito o transazione interrotta).'));
  });
}

function tryUpdateLocalStorageMirror(
  serialized: string,
  indexedDbSucceeded: boolean
): boolean {
  if (typeof localStorage === 'undefined') return false;
  if (serialized.length > LOCALSTORAGE_MIRROR_MAX_BYTES) {
    // Once IndexedDB safely holds the large archive, remove any stale mirror copy
    if (indexedDbSucceeded) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    if (indexedDbSucceeded) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
    return false;
  }
}

export async function requestPersistentStorageBestEffort(): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      return await navigator.storage.persist();
    }
  } catch {
    // Ignore unsupported environments
  }
  return false;
}

/**
 * Persists the authoritative gradebook archive locally in IndexedDB (primary),
 * maintaining a previous_snapshot recovery slot and a fast-boot localStorage
 * mirror when payload size allows.
 */
export async function persistArchiveLocally(
  state: GradebookStoreState,
  options?: { preservePrevious?: boolean }
): Promise<LocalPersistResult> {
  const normalized = normalizeStoredState(state);
  if (!normalized) {
    return {
      ok: false,
      engine: 'indexeddb',
      savedAt: new Date().toISOString(),
      revision: 0,
      byteLength: 0,
      error: 'Struttura dell’archivio non valida: salvataggio annullato per proteggere i dati esistenti.',
    };
  }

  let serialized = '';
  try {
    serialized = JSON.stringify(normalized);
  } catch {
    return {
      ok: false,
      engine: 'indexeddb',
      savedAt: new Date().toISOString(),
      revision: 0,
      byteLength: 0,
      error: 'Impossibile serializzare l’archivio locale.',
    };
  }

  const byteLength = new Blob([serialized]).size;

  if (isIndexedDbAvailable()) {
    let db: IDBDatabase | null = null;
    try {
      db = await openLocalDb();
      const { savedAt, revision } = await writeArchiveRecordAtomic(
        db,
        normalized,
        options
      );
      tryUpdateLocalStorageMirror(serialized, true);
      writeStorageMeta({
        engine: 'indexeddb',
        updatedAt: savedAt,
        revision,
        byteLength,
      });
      return {
        ok: true,
        engine: 'indexeddb',
        savedAt,
        revision,
        byteLength,
      };
    } catch {
      // Fallback to localStorage only if IndexedDB fails
      const lsSaved = tryUpdateLocalStorageMirror(serialized, false);
      const savedAt = new Date().toISOString();
      if (lsSaved) {
        writeStorageMeta({
          engine: 'localstorage',
          updatedAt: savedAt,
          revision: (readStorageMeta()?.revision ?? 0) + 1,
          byteLength,
        });
        return {
          ok: true,
          engine: 'localstorage',
          savedAt,
          revision: readStorageMeta()?.revision ?? 1,
          byteLength,
        };
      }
      return {
        ok: false,
        engine: 'indexeddb',
        savedAt,
        revision: 0,
        byteLength,
        error:
          'Impossibile salvare i dati sul dispositivo (spazio locale esaurito o archiviazione bloccata dal browser).',
      };
    } finally {
      db?.close();
    }
  }

  // Browser without IndexedDB: fallback to localStorage
  const savedAt = new Date().toISOString();
  const lsSaved = tryUpdateLocalStorageMirror(serialized, false);
  if (lsSaved) {
    const rev = (readStorageMeta()?.revision ?? 0) + 1;
    writeStorageMeta({
      engine: 'localstorage',
      updatedAt: savedAt,
      revision: rev,
      byteLength,
    });
    return {
      ok: true,
      engine: 'localstorage',
      savedAt,
      revision: rev,
      byteLength,
    };
  }
  return {
    ok: false,
    engine: 'localstorage',
    savedAt,
    revision: 0,
    byteLength,
    error: 'Spazio di archiviazione locale insufficiente nel browser.',
  };
}

/**
 * Loads the authoritative local archive on startup with automatic, zero-loss
 * migration from legacy localStorage (`dt_registro_tavole_v1`) into IndexedDB
 * and automatic corruption recovery from `previous_snapshot`.
 */
export async function hydrateLocalArchive(): Promise<LocalHydrationResult> {
  cleanupLegacyCloudArtifacts();
  const legacyState = readLegacyLocalStorageState();

  if (isIndexedDbAvailable()) {
    let db: IDBDatabase | null = null;
    try {
      db = await openLocalDb();
      const primaryRecord = await readArchiveRecord(db, PRIMARY_RECORD_ID);
      const primaryState = primaryRecord
        ? normalizeStoredState(primaryRecord.state)
        : null;

      // Case 1: Both IndexedDB and localStorage exist -> keep the newest one safely
      if (primaryState && legacyState) {
        const idbTs = Math.max(
          getLatestStateTimestampMs(primaryState),
          Date.parse(primaryRecord?.savedAt || '') || 0
        );
        const lsTs = getLatestStateTimestampMs(legacyState);
        // Only prefer localStorage over IndexedDB if localStorage clearly has newer class edits
        if (lsTs > idbTs + 1000) {
          const { savedAt, revision } = await writeArchiveRecordAtomic(
            db,
            legacyState,
            { preservePrevious: true }
          );
          const byteLength = new Blob([JSON.stringify(legacyState)]).size;
          writeStorageMeta({
            engine: 'indexeddb',
            updatedAt: savedAt,
            revision,
            byteLength,
          });
          return {
            state: legacyState,
            engine: 'indexeddb',
            savedAt,
            revision,
            migratedFromLocalStorage: true,
            recoveredFromSnapshot: false,
            isNewSeed: false,
          };
        }

        return {
          state: primaryState,
          engine: 'indexeddb',
          savedAt: primaryRecord?.savedAt ?? null,
          revision: primaryRecord?.revision ?? 1,
          migratedFromLocalStorage: false,
          recoveredFromSnapshot: false,
          isNewSeed: false,
        };
      }

      // Case 2: IndexedDB already has authoritative data
      if (primaryState) {
        return {
          state: primaryState,
          engine: 'indexeddb',
          savedAt: primaryRecord?.savedAt ?? null,
          revision: primaryRecord?.revision ?? 1,
          migratedFromLocalStorage: false,
          recoveredFromSnapshot: false,
          isNewSeed: false,
        };
      }

      // Case 3: IndexedDB primary missing/corrupted -> try previous_snapshot recovery
      const snapshotRecord = await readArchiveRecord(db, PREVIOUS_SNAPSHOT_ID);
      const snapshotState = snapshotRecord
        ? normalizeStoredState(snapshotRecord.state)
        : null;
      if (snapshotState && !legacyState) {
        const { savedAt, revision } = await writeArchiveRecordAtomic(
          db,
          snapshotState,
          { preservePrevious: false }
        );
        return {
          state: snapshotState,
          engine: 'indexeddb',
          savedAt,
          revision,
          migratedFromLocalStorage: false,
          recoveredFromSnapshot: true,
          isNewSeed: false,
        };
      }

      // Case 4: Migrate existing localStorage archive into IndexedDB without data loss
      if (legacyState) {
        const { savedAt, revision } = await writeArchiveRecordAtomic(
          db,
          legacyState,
          { preservePrevious: false }
        );
        const byteLength = new Blob([JSON.stringify(legacyState)]).size;
        writeStorageMeta({
          engine: 'indexeddb',
          updatedAt: savedAt,
          revision,
          byteLength,
        });
        return {
          state: legacyState,
          engine: 'indexeddb',
          savedAt,
          revision,
          migratedFromLocalStorage: true,
          recoveredFromSnapshot: false,
          isNewSeed: false,
        };
      }

      // Case 5: Brand new device -> initialize default sample archive
      const seed = createInitialSeedState();
      const { savedAt, revision } = await writeArchiveRecordAtomic(db, seed, {
        preservePrevious: false,
      });
      const serialized = JSON.stringify(seed);
      tryUpdateLocalStorageMirror(serialized, true);
      writeStorageMeta({
        engine: 'indexeddb',
        updatedAt: savedAt,
        revision,
        byteLength: new Blob([serialized]).size,
      });
      return {
        state: seed,
        engine: 'indexeddb',
        savedAt,
        revision,
        migratedFromLocalStorage: false,
        recoveredFromSnapshot: false,
        isNewSeed: true,
      };
    } catch {
      // If IndexedDB fails to open, fall back cleanly to localStorage without losing data
    } finally {
      db?.close();
    }
  }

  if (legacyState) {
    return {
      state: legacyState,
      engine: 'localstorage',
      savedAt: readStorageMeta()?.updatedAt ?? null,
      revision: readStorageMeta()?.revision ?? 1,
      migratedFromLocalStorage: false,
      recoveredFromSnapshot: false,
      isNewSeed: false,
    };
  }

  const seed = createInitialSeedState();
  const serialized = JSON.stringify(seed);
  tryUpdateLocalStorageMirror(serialized, false);
  return {
    state: seed,
    engine: 'localstorage',
    savedAt: new Date().toISOString(),
    revision: 1,
    migratedFromLocalStorage: false,
    recoveredFromSnapshot: false,
    isNewSeed: true,
  };
}

export async function readPreviousRecoverySnapshot(): Promise<{
  state: GradebookStoreState;
  savedAt: string;
} | null> {
  if (!isIndexedDbAvailable()) return null;
  let db: IDBDatabase | null = null;
  try {
    db = await openLocalDb();
    const rec = await readArchiveRecord(db, PREVIOUS_SNAPSHOT_ID);
    if (!rec) return null;
    const state = normalizeStoredState(rec.state);
    if (!state) return null;
    return { state, savedAt: rec.savedAt };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function getSavedBackupDirectoryHandle(): Promise<{
  handle: FileSystemDirectoryHandle;
  folderName: string;
  savedAt: string;
} | null> {
  if (!isIndexedDbAvailable()) return null;
  let db: IDBDatabase | null = null;
  try {
    db = await openLocalDb();
    return await new Promise((resolve, reject) => {
      const tx = db!.transaction(HANDLES_STORE, 'readonly');
      const store = tx.objectStore(HANDLES_STORE);
      const req = store.get(BACKUP_DIR_HANDLE_ID);
      req.onsuccess = () => {
        const rec = req.result as BackupDirectoryRecord | undefined;
        if (!rec?.handle) {
          resolve(null);
          return;
        }
        resolve({
          handle: rec.handle,
          folderName: rec.folderName || rec.handle.name || 'Cartella backup',
          savedAt: rec.savedAt,
        });
      };
      req.onerror = () => reject(new Error('Errore lettura cartella backup.'));
    });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function saveBackupDirectoryHandle(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  let db: IDBDatabase | null = null;
  try {
    db = await openLocalDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(HANDLES_STORE, 'readwrite');
      const store = tx.objectStore(HANDLES_STORE);
      store.put({
        id: BACKUP_DIR_HANDLE_ID,
        handle,
        folderName: handle.name || 'Cartella backup',
        savedAt: new Date().toISOString(),
      } satisfies BackupDirectoryRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Errore salvataggio cartella backup.'));
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function clearBackupDirectoryHandle(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  let db: IDBDatabase | null = null;
  try {
    db = await openLocalDb();
    await new Promise<void>((resolve) => {
      const tx = db!.transaction(HANDLES_STORE, 'readwrite');
      tx.objectStore(HANDLES_STORE).delete(BACKUP_DIR_HANDLE_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  } finally {
    db?.close();
  }
}
