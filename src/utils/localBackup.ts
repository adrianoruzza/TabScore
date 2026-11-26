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
  sizeBytes: number;
}

export interface LocalBackupErrorResult {
  ok: false;
  cancelled?: boolean;
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
  return (
    err instanceof DOMException && err.name === 'AbortError'
  );
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

export async function getDedicatedBackupFolderName(): Promise<string | null> {
  if (!isDirectoryPickerSupported()) return null;
  const saved = await getSavedBackupDirectoryHandle();
  return saved?.folderName ?? null;
}

export async function selectDedicatedBackupFolder(): Promise<
  | { ok: true; folderName: string }
  | { ok: false; cancelled?: boolean; error: string }
> {
  if (!isDirectoryPickerSupported()) {
    return {
      ok: false,
      error:
        'Questo browser non supporta la selezione diretta di una cartella locale. Usa il salvataggio tramite download standard.',
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
          'Cartella selezionata, ma non è stato possibile memorizzarla nell’archivio locale del browser.',
      };
    }
    return { ok: true, folderName: handle.name || 'Cartella backup' };
  } catch (err) {
    if (isUserAbortError(err)) {
      return { ok: false, cancelled: true, error: '' };
    }
    return {
      ok: false,
      error: 'Impossibile selezionare la cartella locale di backup.',
    };
  }
}

export async function clearDedicatedBackupFolder(): Promise<void> {
  await clearBackupDirectoryHandle();
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

  let saved = await getSavedBackupDirectoryHandle();
  if (!saved) {
    const pick = await selectDedicatedBackupFolder();
    if (!pick.ok) {
      return pick;
    }
    saved = await getSavedBackupDirectoryHandle();
    if (!saved) {
      return {
        ok: false,
        error: 'Cartella di backup non disponibile. Riprova a selezionarla.',
      };
    }
  }

  try {
    const granted = await ensureDirectoryWritePermission(saved.handle);
    if (!granted) {
      return {
        ok: false,
        error:
          'Autorizzazione di scrittura negata per la cartella selezionata. Riconferma l’accesso o cambia cartella.',
      };
    }

    const now = new Date();
    const fileName = buildTimestampedBackupFileName(now);
    const payload = createFullBackupArchive(state, now);
    const jsonText = JSON.stringify(payload, null, 2);
    const sizeBytes = new Blob([jsonText]).size;

    const fileHandle = await saved.handle.getFileHandle(fileName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(jsonText);
    await writable.close();

    return {
      ok: true,
      method: 'directory',
      fileName,
      folderName: saved.folderName,
      sizeBytes,
    };
  } catch (err) {
    if (isUserAbortError(err)) {
      return { ok: false, cancelled: true, error: '' };
    }
    return {
      ok: false,
      error:
        'Impossibile scrivere nella cartella locale selezionata. Verifica che la cartella esista ancora o seleziona una nuova destinazione.',
    };
  }
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
