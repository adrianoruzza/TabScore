import type {
  AuditLogEntry,
  ClassData,
  FullBackupArchive,
  GradebookStoreState,
  SingleClassArchive,
} from '../types/gradebook';
import {
  clearBackupDirectoryHandle,
  getSavedBackupDirectoryHandle,
  saveBackupDirectoryHandle,
} from './localDatabase';
import {
  buildTimestampedBackupFileName,
  createFullBackupArchive,
  exportSingleClassJson,
  STORE_VERSION,
  triggerJsonDownload,
} from './storage';

interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface ExtendedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?: (
    descriptor?: FileSystemPermissionDescriptor
  ) => Promise<PermissionState>;
  requestPermission?: (
    descriptor?: FileSystemPermissionDescriptor
  ) => Promise<PermissionState>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
}

interface FileSystemWindow extends Window {
  showDirectoryPicker?: (
    options?: DirectoryPickerOptions
  ) => Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions
  ) => Promise<FileSystemFileHandle>;
}

export interface LocalBackupSaveResult {
  ok: true;
  method: 'directory' | 'file_picker' | 'download';
  fileName: string;
  folderName?: string;
  savedAt: string;
  sizeBytes: number;
  fallbackNotice?: string;
}

export interface LocalBackupErrorResult {
  ok: false;
  cancelled?: boolean;
  needsFolderReselect?: boolean;
  folderName?: string;
  error: string;
}

export type LocalBackupResult = LocalBackupSaveResult | LocalBackupErrorResult;

export interface ArchivePreviewSummary {
  classCount: number;
  studentCount: number;
  plateCount: number;
  folderCount: number;
  attachmentCount: number;
  exportedAt: string | null;
}

export function isDirectoryPickerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as FileSystemWindow).showDirectoryPicker === 'function'
  );
}

export function isSaveFilePickerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as FileSystemWindow).showSaveFilePicker === 'function'
  );
}

function isUserAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function isSecurityContextError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'SecurityError';
}

function describeFsError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotFoundError') {
      return 'la cartella non esiste più o è stata spostata';
    }
    if (err.name === 'NotAllowedError') {
      return 'il permesso di scrittura è stato revocato o negato';
    }
    if (err.name === 'QuotaExceededError') {
      return 'spazio su disco esaurito';
    }
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'errore sconosciuto del file system';
}

async function ensureDirectoryWritePermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const ext = handle as ExtendedDirectoryHandle;
  const descriptor: FileSystemPermissionDescriptor = { mode: 'readwrite' };
  if (typeof ext.queryPermission === 'function') {
    const current = await ext.queryPermission(descriptor);
    if (current === 'granted') return true;
  }
  if (typeof ext.requestPermission === 'function') {
    const requested = await ext.requestPermission(descriptor);
    return requested === 'granted';
  }
  return true;
}

/**
 * Resolves a non-colliding backup filename in the target directory without
 * prompting for confirmation:
 * `backup-tabscore-AAAA-MM-GG_HH-MM.json`, or `_2.json`, `_3.json` if a file
 * with the exact same timestamp already exists.
 */
async function resolveUniqueBackupFileName(
  dirHandle: FileSystemDirectoryHandle,
  now: Date
): Promise<string> {
  const baseCandidate = buildTimestampedBackupFileName(now);
  for (let seq = 1; seq <= 99; seq += 1) {
    const candidate =
      seq === 1 ? baseCandidate : buildTimestampedBackupFileName(now, seq);
    try {
      await dirHandle.getFileHandle(candidate, { create: false });
      // File already exists -> try next progressive number
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        return candidate;
      }
      // If browser does not distinguish NotFoundError, safely use candidate
      return candidate;
    }
  }
  return baseCandidate;
}

async function writeFullBackupToDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  folderName: string,
  state: GradebookStoreState
): Promise<LocalBackupResult> {
  const now = new Date();
  const payload = createFullBackupArchive(state, now);
  const jsonText = JSON.stringify(payload, null, 2);
  const sizeBytes = new Blob([jsonText]).size;

  try {
    const fileName = await resolveUniqueBackupFileName(dirHandle, now);
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(jsonText);
    await writable.close();

    return {
      ok: true,
      method: 'directory',
      fileName,
      folderName,
      savedAt: now.toISOString(),
      sizeBytes,
    };
  } catch (err) {
    if (isUserAbortError(err)) {
      return { ok: false, cancelled: true, error: '' };
    }
    return {
      ok: false,
      needsFolderReselect: true,
      folderName,
      error: `Impossibile salvare nella cartella "${folderName}": ${describeFsError(err)}.`,
    };
  }
}

export async function getDedicatedBackupFolderName(): Promise<string | null> {
  if (!isDirectoryPickerSupported()) return null;
  const saved = await getSavedBackupDirectoryHandle();
  return saved?.folderName ?? null;
}

export async function selectDedicatedBackupFolder(): Promise<
  | { ok: true; folderName: string; handle: FileSystemDirectoryHandle }
  | { ok: false; cancelled?: boolean; securityBlocked?: boolean; error: string }
> {
  if (!isDirectoryPickerSupported()) {
    return {
      ok: false,
      error:
        'Questo browser non supporta la selezione diretta di una cartella locale.',
    };
  }

  try {
    const picker = (window as FileSystemWindow).showDirectoryPicker!;
    const handle = await picker({
      id: 'tabscore-local-backup-folder',
      mode: 'readwrite',
    });
    const granted = await ensureDirectoryWritePermission(handle);
    if (!granted) {
      return {
        ok: false,
        error:
          'Permesso di scrittura nella cartella locale non concesso dal browser.',
      };
    }
    const persisted = await saveBackupDirectoryHandle(handle);
    if (!persisted) {
      return {
        ok: false,
        error:
          'Cartella selezionata, ma non è stato possibile memorizzarla in IndexedDB.',
      };
    }
    return {
      ok: true,
      folderName: handle.name || 'Cartella backup',
      handle,
    };
  } catch (err) {
    if (isUserAbortError(err)) {
      return { ok: false, cancelled: true, error: '' };
    }
    if (isSecurityContextError(err)) {
      return {
        ok: false,
        securityBlocked: true,
        error: `Accesso diretto alla cartella bloccato dal contesto del browser (${describeFsError(err)}).`,
      };
    }
    return {
      ok: false,
      error: `Impossibile selezionare la cartella locale di backup (${describeFsError(err)}).`,
    };
  }
}

export async function clearDedicatedBackupFolder(): Promise<void> {
  await clearBackupDirectoryHandle();
}

function fallbackDownloadFullBackup(
  state: GradebookStoreState,
  fallbackNotice: string
): LocalBackupSaveResult {
  const now = new Date();
  const fileName = buildTimestampedBackupFileName(now);
  const payload = createFullBackupArchive(state, now);
  const jsonText = JSON.stringify(payload, null, 2);
  const sizeBytes = new Blob([jsonText]).size;
  triggerJsonDownload(fileName, payload);
  return {
    ok: true,
    method: 'download',
    fileName,
    savedAt: now.toISOString(),
    sizeBytes,
    fallbackNotice,
  };
}

/**
 * One-click Floppy Backup button flow:
 * - If showDirectoryPicker() is unsupported (e.g. Firefox / Safari): falls back to
 *   classic `<a download>` and informs the user they will need to pick the folder manually.
 * - First click (no saved folder handle): opens window.showDirectoryPicker(), stores the
 *   FileSystemDirectoryHandle in IndexedDB, and immediately writes the backup file.
 * - Subsequent clicks: reuses the saved handle without opening the picker, requesting
 *   readwrite permission only if needed.
 * - If permission was revoked or the folder is gone, returns `needsFolderReselect: true`
 *   with the exact error reason so the UI lets the user choose a new folder immediately.
 */
export async function saveQuickFloppyBackup(
  state: GradebookStoreState,
  options?: { forceReselectFolder?: boolean }
): Promise<LocalBackupResult> {
  if (!isDirectoryPickerSupported()) {
    return fallbackDownloadFullBackup(
      state,
      'Questo browser non supporta il salvataggio diretto in cartella: il file è stato scaricato e dovrai scegliere la cartella manualmente ogni volta.'
    );
  }

  let saved = options?.forceReselectFolder
    ? null
    : await getSavedBackupDirectoryHandle();

  if (!saved) {
    const pick = await selectDedicatedBackupFolder();
    if (!pick.ok) {
      if (pick.securityBlocked) {
        return fallbackDownloadFullBackup(
          state,
          'Il browser blocca la selezione diretta di cartelle in questo riquadro: il backup è stato scaricato con il download standard.'
        );
      }
      return pick;
    }
    saved = {
      handle: pick.handle,
      folderName: pick.folderName,
      savedAt: new Date().toISOString(),
    };
  }

  try {
    const granted = await ensureDirectoryWritePermission(saved.handle);
    if (!granted) {
      return {
        ok: false,
        needsFolderReselect: true,
        folderName: saved.folderName,
        error: `Permesso di scrittura revocato o negato per la cartella "${saved.folderName}".`,
      };
    }
  } catch (err) {
    if (isUserAbortError(err)) {
      return { ok: false, cancelled: true, error: '' };
    }
    return {
      ok: false,
      needsFolderReselect: true,
      folderName: saved.folderName,
      error: `Impossibile accedere alla cartella "${saved.folderName}": ${describeFsError(err)}.`,
    };
  }

  return writeFullBackupToDirectoryHandle(
    saved.handle,
    saved.folderName,
    state
  );
}

/**
 * Saves a complete JSON backup into the previously chosen dedicated local folder
 * (or prompts the user to select one if none is configured yet).
 */
export async function saveFullBackupToDedicatedFolder(
  state: GradebookStoreState
): Promise<LocalBackupResult> {
  if (!isDirectoryPickerSupported()) {
    return {
      ok: false,
      error:
        'La selezione di una cartella locale dedicata non è supportata su questo browser. Utilizza il download locale.',
    };
  }
  return saveQuickFloppyBackup(state);
}

/**
 * Saves a complete JSON backup by asking the user where to save it (when
 * showSaveFilePicker is supported) or via standard local browser download.
 */
export async function saveFullBackupLocally(
  state: GradebookStoreState,
  options?: { preferDownload?: boolean }
): Promise<LocalBackupResult> {
  const now = new Date();
  const fileName = buildTimestampedBackupFileName(now);
  const payload = createFullBackupArchive(state, now);
  const jsonText = JSON.stringify(payload, null, 2);
  const sizeBytes = new Blob([jsonText]).size;

  if (!options?.preferDownload && isSaveFilePickerSupported()) {
    try {
      const picker = (window as FileSystemWindow).showSaveFilePicker!;
      const fileHandle = await picker({
        suggestedName: fileName,
        types: [
          {
            description: 'Archivio di backup TabScore (JSON)',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(jsonText);
      await writable.close();
      return {
        ok: true,
        method: 'file_picker',
        fileName: fileHandle.name || fileName,
        savedAt: now.toISOString(),
        sizeBytes,
      };
    } catch (err) {
      if (isUserAbortError(err)) {
        return { ok: false, cancelled: true, error: '' };
      }
      // Fall back cleanly to standard download if picker is blocked (e.g., cross-origin iframe)
    }
  }

  triggerJsonDownload(fileName, payload);
  return {
    ok: true,
    method: 'download',
    fileName,
    savedAt: now.toISOString(),
    sizeBytes,
  };
}

export async function saveSingleClassBackupLocally(
  classData: ClassData,
  auditLog: AuditLogEntry[]
): Promise<LocalBackupResult> {
  const safeName = classData.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_|_$/g, '');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const fileName = `registro_${safeName || 'classe'}_${stamp}.json`;

  const archive: SingleClassArchive = {
    archiveType: 'single_class',
    version: STORE_VERSION,
    exportedAt: now.toISOString(),
    classData,
    classAuditLog: auditLog.filter((l) => l.classId === classData.id),
  };
  const jsonText = JSON.stringify(archive, null, 2);
  const sizeBytes = new Blob([jsonText]).size;

  if (isSaveFilePickerSupported()) {
    try {
      const picker = (window as FileSystemWindow).showSaveFilePicker!;
      const fileHandle = await picker({
        suggestedName: fileName,
        types: [
          {
            description: 'Archivio classe TabScore (JSON)',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(jsonText);
      await writable.close();
      return {
        ok: true,
        method: 'file_picker',
        fileName: fileHandle.name || fileName,
        savedAt: now.toISOString(),
        sizeBytes,
      };
    } catch (err) {
      if (isUserAbortError(err)) {
        return { ok: false, cancelled: true, error: '' };
      }
    }
  }

  exportSingleClassJson(classData, auditLog);
  return {
    ok: true,
    method: 'download',
    fileName,
    savedAt: now.toISOString(),
    sizeBytes,
  };
}

export function summarizeArchiveForConfirmation(
  archive: SingleClassArchive | FullBackupArchive
): ArchivePreviewSummary {
  const classes =
    archive.archiveType === 'single_class'
      ? [archive.classData]
      : archive.classes;
  let studentCount = 0;
  let plateCount = 0;
  let folderCount = 0;
  let attachmentCount = 0;

  for (const cls of classes) {
    studentCount += cls.students.length;
    plateCount += cls.plates.length;
    folderCount += cls.folders.length;
    for (const plate of cls.plates) {
      if (plate.imageDataUrl) attachmentCount += 1;
    }
  }

  return {
    classCount: classes.length,
    studentCount,
    plateCount,
    folderCount,
    attachmentCount,
    exportedAt: typeof archive.exportedAt === 'string' ? archive.exportedAt : null,
  };
}
