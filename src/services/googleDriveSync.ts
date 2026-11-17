import type {
  AuditLogEntry,
  ClassData,
  GradebookStoreState,
} from '../types/gradebook';
import { createId, STORE_VERSION } from '../utils/storage';

export const DRIVE_SYNC_FOLDER_NAME = 'SYNC_TabScore';
export const DRIVE_IMAGES_SUBFOLDER_NAME = 'tavole_immagini';
export const DRIVE_ARCHIVE_FILE_NAME = 'tabscore_sync_archive.json';
export const DRIVE_ARCHIVE_FORMAT = 'tabscore_cloud_sync_v1';

const DRIVE_META_STORAGE_KEY = 'tabscore_drive_sync_meta_v1';
const SAFETY_BACKUP_STORAGE_KEY = 'tabscore_safety_backup_v1';

export type DriveSyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'unsynced'
  | 'offline_queued'
  | 'needs_auth'
  | 'conflict'
  | 'error';

export interface UploadedImageRef {
  imageHash: string;
  driveFileId: string;
}

export interface DriveSyncMetadata {
  deviceId: string;
  autoSyncEnabled: boolean;
  syncConfirmedByUser: boolean;
  folderId: string | null;
  imagesFolderId: string | null;
  archiveFileId: string | null;
  uploadedImageIndex: Record<string, UploadedImageRef>;
  lastSyncedContentHash: string | null;
  lastSyncedRemoteRevision: number;
  lastSyncedAt: string | null;
  lastSyncStatus: DriveSyncStatus;
  lastError: string | null;
  pendingSync: boolean;
}

export interface ImageManifestEntry {
  classId: string;
  plateId: string;
  plateNumber: number;
  imageName: string;
  imageHash: string;
  driveFileId?: string;
}

export interface TabScoreSyncSummary {
  classCount: number;
  studentCount: number;
  plateCount: number;
  imageCount: number;
}

export interface TabScoreSyncPayload {
  format: typeof DRIVE_ARCHIVE_FORMAT;
  archiveType: 'full_backup';
  version: number;
  exportedAt: string;
  revision: number;
  updatedAt: string;
  deviceId: string;
  contentHash: string;
  activeClassId: string | null;
  classes: ClassData[];
  auditLog: AuditLogEntry[];
  imageManifest: ImageManifestEntry[];
  summary: TabScoreSyncSummary;
}

export interface RemoteArchiveInspection {
  folderId: string;
  imagesFolderId: string | null;
  archiveFileId: string | null;
  remoteModifiedTime: string | null;
  remotePayload: TabScoreSyncPayload | null;
  remoteIntegrityValid: boolean;
  remoteError: string | null;
}

export interface LocalSafetyBackup {
  savedAt: string;
  reason: string;
  state: GradebookStoreState;
}

export class DriveApiError extends Error {
  status: number;
  code: 'unauthorized' | 'forbidden' | 'not_found' | 'network' | 'corrupt' | 'unknown';

  constructor(
    message: string,
    status = 0,
    code: DriveApiError['code'] = 'unknown'
  ) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
    this.code = code;
  }
}

export type FetchLike = typeof fetch;

function defaultDeviceId(): string {
  return createId('dev');
}

export function loadDriveSyncMetadata(): DriveSyncMetadata {
  try {
    const raw = localStorage.getItem(DRIVE_META_STORAGE_KEY);
    if (!raw) {
      const initial: DriveSyncMetadata = {
        deviceId: defaultDeviceId(),
        autoSyncEnabled: true,
        syncConfirmedByUser: false,
        folderId: null,
        imagesFolderId: null,
        archiveFileId: null,
        uploadedImageIndex: {},
        lastSyncedContentHash: null,
        lastSyncedRemoteRevision: 0,
        lastSyncedAt: null,
        lastSyncStatus: 'idle',
        lastError: null,
        pendingSync: false,
      };
      saveDriveSyncMetadata(initial);
      return initial;
    }
    const parsed = JSON.parse(raw) as Partial<DriveSyncMetadata>;
    return {
      deviceId:
        typeof parsed.deviceId === 'string' && parsed.deviceId
          ? parsed.deviceId
          : defaultDeviceId(),
      autoSyncEnabled:
        typeof parsed.autoSyncEnabled === 'boolean'
          ? parsed.autoSyncEnabled
          : true,
      syncConfirmedByUser: Boolean(parsed.syncConfirmedByUser),
      folderId: typeof parsed.folderId === 'string' ? parsed.folderId : null,
      imagesFolderId:
        typeof parsed.imagesFolderId === 'string' ? parsed.imagesFolderId : null,
      archiveFileId:
        typeof parsed.archiveFileId === 'string' ? parsed.archiveFileId : null,
      uploadedImageIndex:
        parsed.uploadedImageIndex && typeof parsed.uploadedImageIndex === 'object'
          ? parsed.uploadedImageIndex
          : {},
      lastSyncedContentHash:
        typeof parsed.lastSyncedContentHash === 'string'
          ? parsed.lastSyncedContentHash
          : null,
      lastSyncedRemoteRevision:
        typeof parsed.lastSyncedRemoteRevision === 'number'
          ? parsed.lastSyncedRemoteRevision
          : 0,
      lastSyncedAt:
        typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
      lastSyncStatus: parsed.lastSyncStatus ?? 'idle',
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      pendingSync: Boolean(parsed.pendingSync),
    };
  } catch {
    return {
      deviceId: defaultDeviceId(),
      autoSyncEnabled: true,
      syncConfirmedByUser: false,
      folderId: null,
      imagesFolderId: null,
      archiveFileId: null,
      uploadedImageIndex: {},
      lastSyncedContentHash: null,
      lastSyncedRemoteRevision: 0,
      lastSyncedAt: null,
      lastSyncStatus: 'idle',
      lastError: null,
      pendingSync: false,
    };
  }
}

export function saveDriveSyncMetadata(meta: DriveSyncMetadata): void {
  try {
    localStorage.setItem(DRIVE_META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage quota errors on metadata
  }
}

export function clearDriveSyncConnectionMetadata(): DriveSyncMetadata {
  const prev = loadDriveSyncMetadata();
  const next: DriveSyncMetadata = {
    ...prev,
    syncConfirmedByUser: false,
    folderId: null,
    imagesFolderId: null,
    archiveFileId: null,
    uploadedImageIndex: {},
    lastSyncedRemoteRevision: 0,
    lastSyncStatus: 'idle',
    lastError: null,
  };
  saveDriveSyncMetadata(next);
  return next;
}

export function saveLocalSafetyBackup(
  state: GradebookStoreState,
  reason: string
): boolean {
  const snapshot: LocalSafetyBackup = {
    savedAt: new Date().toISOString(),
    reason,
    state,
  };
  try {
    localStorage.setItem(SAFETY_BACKUP_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    // Retry with trimmed audit log if plate images consume localStorage headroom
    try {
      const compact: LocalSafetyBackup = {
        savedAt: snapshot.savedAt,
        reason,
        state: {
          ...state,
          auditLog: state.auditLog.slice(0, 50),
        },
      };
      localStorage.setItem(SAFETY_BACKUP_STORAGE_KEY, JSON.stringify(compact));
      return true;
    } catch {
      return false;
    }
  }
}

export function loadLocalSafetyBackup(): LocalSafetyBackup | null {
  try {
    const raw = localStorage.getItem(SAFETY_BACKUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSafetyBackup;
    if (!parsed?.state || !Array.isArray(parsed.state.classes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function summarizeStoreState(
  state: Pick<GradebookStoreState, 'classes'>
): TabScoreSyncSummary {
  let studentCount = 0;
  let plateCount = 0;
  let imageCount = 0;
  for (const cls of state.classes) {
    studentCount += cls.students.length;
    plateCount += cls.plates.length;
    for (const p of cls.plates) {
      if (p.imageDataUrl) imageCount += 1;
    }
  }
  return {
    classCount: state.classes.length,
    studentCount,
    plateCount,
    imageCount,
  };
}

function fastStringDigest(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

export function computeImageHash(dataUrl: string): string {
  return `img_${dataUrl.length.toString(16)}_${fastStringDigest(dataUrl)}`;
}

export async function computeStoreContentHash(
  state: Pick<GradebookStoreState, 'activeClassId' | 'classes' | 'auditLog'>
): Promise<string> {
  const canonical = JSON.stringify({
    activeClassId: state.activeClassId ?? null,
    classes: state.classes,
    auditLog: state.auditLog ?? [],
  });
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `fnv_${canonical.length.toString(16)}_${fastStringDigest(canonical)}`;
}

function parseDataUrlToBytes(dataUrl: string): {
  mimeType: string;
  bytes: Uint8Array;
} | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mimeType, bytes };
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function driveFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {},
  fetchFn: FetchLike = fetch
): Promise<Response> {
  const maxAttempts = 3;
  let lastError: DriveApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetchFn(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init.headers ?? {}),
        },
      });
    } catch {
      lastError = new DriveApiError(
        'Errore di rete durante la comunicazione con Google Drive.',
        0,
        'network'
      );
      if (
        attempt < maxAttempts &&
        (typeof navigator === 'undefined' || navigator.onLine)
      ) {
        await sleepMs(500 * attempt);
        continue;
      }
      throw lastError;
    }

    if (response.status === 401) {
      throw new DriveApiError(
        'Sessione Google Drive scaduta. Riconferma l’accesso per continuare.',
        401,
        'unauthorized'
      );
    }
    if (response.status === 403) {
      throw new DriveApiError(
        'Permessi Google Drive insufficienti o quota temporaneamente esaurita.',
        403,
        'forbidden'
      );
    }
    if (response.status === 404) {
      throw new DriveApiError(
        'File o cartella non trovati su Google Drive.',
        404,
        'not_found'
      );
    }

    // Retry transient rate limit or 5xx errors before failing
    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < maxAttempts
    ) {
      await sleepMs(600 * attempt);
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new DriveApiError(
        text || `Errore Google Drive (${response.status}).`,
        response.status,
        'unknown'
      );
    }

    return response;
  }

  throw (
    lastError ??
    new DriveApiError(
      'Errore temporaneo durante la comunicazione con Google Drive.',
      0,
      'network'
    )
  );
}

async function findFolderByName(
  accessToken: string,
  name: string,
  parentId: string | null,
  fetchFn: FetchLike
): Promise<{ id: string; name: string } | null> {
  const escaped = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `name = '${escaped}'${parentClause} and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,createdTime)',
    orderBy: 'createdTime asc',
    spaces: 'drive',
    pageSize: '10',
  });
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken,
    {},
    fetchFn
  );
  const json = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  return json.files && json.files.length > 0 ? json.files[0] : null;
}

async function verifyFolderActive(
  accessToken: string,
  folderId: string,
  expectedName: string,
  fetchFn: FetchLike
): Promise<boolean> {
  try {
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        folderId
      )}?fields=id,name,trashed,mimeType`,
      accessToken,
      {},
      fetchFn
    );
    const info = (await res.json()) as {
      id?: string;
      name?: string;
      trashed?: boolean;
      mimeType?: string;
    };
    return (
      Boolean(info.id) &&
      !info.trashed &&
      info.name === expectedName &&
      info.mimeType === 'application/vnd.google-apps.folder'
    );
  } catch (err) {
    if (err instanceof DriveApiError && err.code === 'not_found') return false;
    throw err;
  }
}

async function createFolder(
  accessToken: string,
  name: string,
  parentId: string | null,
  fetchFn: FetchLike
): Promise<string> {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];
  const res = await driveFetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name',
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fetchFn
  );
  const created = (await res.json()) as { id?: string };
  if (!created.id) {
    throw new DriveApiError(
      `Impossibile creare la cartella "${name}" su Google Drive.`,
      0,
      'unknown'
    );
  }
  return created.id;
}

export async function ensureSyncRootFolder(
  accessToken: string,
  cachedFolderId: string | null,
  fetchFn: FetchLike = fetch
): Promise<string> {
  if (
    cachedFolderId &&
    (await verifyFolderActive(
      accessToken,
      cachedFolderId,
      DRIVE_SYNC_FOLDER_NAME,
      fetchFn
    ))
  ) {
    return cachedFolderId;
  }
  const existing = await findFolderByName(
    accessToken,
    DRIVE_SYNC_FOLDER_NAME,
    null,
    fetchFn
  );
  if (existing) return existing.id;
  return createFolder(accessToken, DRIVE_SYNC_FOLDER_NAME, null, fetchFn);
}

async function ensureImagesSubfolder(
  accessToken: string,
  rootFolderId: string,
  cachedImagesFolderId: string | null,
  fetchFn: FetchLike
): Promise<string> {
  if (
    cachedImagesFolderId &&
    (await verifyFolderActive(
      accessToken,
      cachedImagesFolderId,
      DRIVE_IMAGES_SUBFOLDER_NAME,
      fetchFn
    ))
  ) {
    return cachedImagesFolderId;
  }
  const existing = await findFolderByName(
    accessToken,
    DRIVE_IMAGES_SUBFOLDER_NAME,
    rootFolderId,
    fetchFn
  );
  if (existing) return existing.id;
  return createFolder(
    accessToken,
    DRIVE_IMAGES_SUBFOLDER_NAME,
    rootFolderId,
    fetchFn
  );
}

async function findArchiveFileInFolder(
  accessToken: string,
  folderId: string,
  fetchFn: FetchLike
): Promise<{
  id: string;
  name: string;
  size?: string;
  modifiedTime?: string;
} | null> {
  const escaped = DRIVE_ARCHIVE_FILE_NAME.replace(/'/g, "\\'");
  const q = `name = '${escaped}' and '${folderId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,size,modifiedTime)',
    orderBy: 'modifiedTime desc',
    spaces: 'drive',
    pageSize: '5',
  });
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken,
    {},
    fetchFn
  );
  const json = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      size?: string;
      modifiedTime?: string;
    }>;
  };
  return json.files && json.files.length > 0 ? json.files[0] : null;
}

async function multipartUploadFile(
  accessToken: string,
  options: {
    existingFileId?: string | null;
    metadata: Record<string, unknown>;
    contentType: string;
    contentBody: string | Uint8Array;
  },
  fetchFn: FetchLike
): Promise<{
  id: string;
  name: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
}> {
  const boundary = `tabscore_boundary_${Math.random().toString(36).slice(2)}`;
  const metaHeader =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(options.metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${options.contentType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  const encoder = new TextEncoder();
  const bodyBytes =
    typeof options.contentBody === 'string'
      ? encoder.encode(options.contentBody)
      : options.contentBody;

  const part1 = encoder.encode(metaHeader);
  const part3 = encoder.encode(closing);
  const combined = new Uint8Array(part1.length + bodyBytes.length + part3.length);
  combined.set(part1, 0);
  combined.set(bodyBytes, part1.length);
  combined.set(part3, part1.length + bodyBytes.length);

  const isUpdate = Boolean(options.existingFileId);
  const url = isUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        options.existingFileId!
      )}?uploadType=multipart&fields=id,name,size,modifiedTime,md5Checksum`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,modifiedTime,md5Checksum`;

  const res = await driveFetch(
    url,
    accessToken,
    {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: combined,
    },
    fetchFn
  );

  return (await res.json()) as {
    id: string;
    name: string;
    size?: string;
    modifiedTime?: string;
    md5Checksum?: string;
  };
}

export async function validateSyncPayload(
  raw: unknown
): Promise<{ ok: true; payload: TabScoreSyncPayload } | { ok: false; error: string }> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'L’archivio su Google Drive non contiene un oggetto JSON valido.' };
  }
  const obj = raw as Partial<TabScoreSyncPayload>;
  if (obj.archiveType !== 'full_backup' || !Array.isArray(obj.classes)) {
    return {
      ok: false,
      error: 'Formato archivio Google Drive non riconosciuto o incompleto.',
    };
  }
  const validClasses = obj.classes.every(
    (c) =>
      c &&
      typeof c.id === 'string' &&
      typeof c.name === 'string' &&
      Array.isArray(c.students) &&
      Array.isArray(c.plates)
  );
  if (!validClasses) {
    return {
      ok: false,
      error: 'Una o più classi presenti su Google Drive risultano incomplete.',
    };
  }

  const normalizedPayload: TabScoreSyncPayload = {
    format: obj.format ?? DRIVE_ARCHIVE_FORMAT,
    archiveType: 'full_backup',
    version: typeof obj.version === 'number' ? obj.version : STORE_VERSION,
    exportedAt:
      typeof obj.exportedAt === 'string'
        ? obj.exportedAt
        : new Date().toISOString(),
    revision: typeof obj.revision === 'number' ? obj.revision : 1,
    updatedAt:
      typeof obj.updatedAt === 'string'
        ? obj.updatedAt
        : new Date().toISOString(),
    deviceId: typeof obj.deviceId === 'string' ? obj.deviceId : 'unknown',
    contentHash: typeof obj.contentHash === 'string' ? obj.contentHash : '',
    activeClassId:
      typeof obj.activeClassId === 'string' ? obj.activeClassId : null,
    classes: obj.classes,
    auditLog: Array.isArray(obj.auditLog) ? obj.auditLog : [],
    imageManifest: Array.isArray(obj.imageManifest) ? obj.imageManifest : [],
    summary:
      obj.summary ??
      summarizeStoreState({ classes: obj.classes }),
  };

  if (normalizedPayload.contentHash) {
    const computed = await computeStoreContentHash({
      activeClassId: normalizedPayload.activeClassId,
      classes: normalizedPayload.classes,
      auditLog: normalizedPayload.auditLog,
    });
    if (computed !== normalizedPayload.contentHash) {
      return {
        ok: false,
        error:
          'Verifica integrità fallita: il contenuto scaricato da Google Drive non corrisponde al checksum salvato.',
      };
    }
  }

  return { ok: true, payload: normalizedPayload };
}

export async function inspectDriveSyncState(
  accessToken: string,
  meta: DriveSyncMetadata,
  fetchFn: FetchLike = fetch
): Promise<RemoteArchiveInspection> {
  const folderId = await ensureSyncRootFolder(accessToken, meta.folderId, fetchFn);
  const existingImagesFolder = await findFolderByName(
    accessToken,
    DRIVE_IMAGES_SUBFOLDER_NAME,
    folderId,
    fetchFn
  );
  const archiveFile = await findArchiveFileInFolder(
    accessToken,
    folderId,
    fetchFn
  );

  if (!archiveFile) {
    return {
      folderId,
      imagesFolderId: existingImagesFolder?.id ?? null,
      archiveFileId: null,
      remoteModifiedTime: null,
      remotePayload: null,
      remoteIntegrityValid: true,
      remoteError: null,
    };
  }

  const downloadRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      archiveFile.id
    )}?alt=media`,
    accessToken,
    {},
    fetchFn
  );

  let parsedRaw: unknown;
  try {
    parsedRaw = await downloadRes.json();
  } catch {
    return {
      folderId,
      imagesFolderId: existingImagesFolder?.id ?? null,
      archiveFileId: archiveFile.id,
      remoteModifiedTime: archiveFile.modifiedTime ?? null,
      remotePayload: null,
      remoteIntegrityValid: false,
      remoteError: 'Il file di sincronizzazione su Google Drive è illeggibile o corrotto.',
    };
  }

  const validation = await validateSyncPayload(parsedRaw);
  if (!validation.ok) {
    return {
      folderId,
      imagesFolderId: existingImagesFolder?.id ?? null,
      archiveFileId: archiveFile.id,
      remoteModifiedTime: archiveFile.modifiedTime ?? null,
      remotePayload: null,
      remoteIntegrityValid: false,
      remoteError: validation.error,
    };
  }

  return {
    folderId,
    imagesFolderId: existingImagesFolder?.id ?? null,
    archiveFileId: archiveFile.id,
    remoteModifiedTime: archiveFile.modifiedTime ?? null,
    remotePayload: validation.payload,
    remoteIntegrityValid: true,
    remoteError: null,
  };
}

async function listExistingImageFilesInFolder(
  accessToken: string,
  imagesFolderId: string,
  fetchFn: FetchLike
): Promise<Map<string, string>> {
  const q = `'${imagesFolderId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,appProperties)',
    spaces: 'drive',
    pageSize: '200',
  });
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken,
    {},
    fetchFn
  );
  const json = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      appProperties?: Record<string, string>;
    }>;
  };
  const map = new Map<string, string>();
  for (const f of json.files ?? []) {
    const key = f.appProperties?.tabscorePlateKey ?? f.name;
    if (key) map.set(key, f.id);
  }
  return map;
}

export async function syncArchiveToDrive(
  accessToken: string,
  state: GradebookStoreState,
  meta: DriveSyncMetadata,
  options: {
    targetRevision: number;
    existingFolderId?: string | null;
    existingImagesFolderId?: string | null;
    existingArchiveFileId?: string | null;
  },
  fetchFn: FetchLike = fetch
): Promise<{
  payload: TabScoreSyncPayload;
  folderId: string;
  imagesFolderId: string;
  archiveFileId: string;
  uploadedImageIndex: Record<string, UploadedImageRef>;
}> {
  const folderId =
    options.existingFolderId ??
    (await ensureSyncRootFolder(accessToken, meta.folderId, fetchFn));
  const imagesFolderId = await ensureImagesSubfolder(
    accessToken,
    folderId,
    options.existingImagesFolderId ?? meta.imagesFolderId,
    fetchFn
  );

  // Sync plate preview/original images as real binary files in SYNC_TabScore/tavole_immagini
  const nextImageIndex: Record<string, UploadedImageRef> = {};
  const imageManifest: ImageManifestEntry[] = [];
  let remoteImageMap: Map<string, string> | null = null;

  for (const cls of state.classes) {
    for (const plate of cls.plates) {
      if (!plate.imageDataUrl) continue;
      const plateKey = `${cls.id}::${plate.id}`;
      const imageHash = computeImageHash(plate.imageDataUrl);
      const safeName =
        plate.imageName?.trim() || `tavola_${cls.id}_${plate.number}.png`;
      const prevRef = meta.uploadedImageIndex[plateKey];

      if (prevRef && prevRef.imageHash === imageHash && prevRef.driveFileId) {
        nextImageIndex[plateKey] = prevRef;
        imageManifest.push({
          classId: cls.id,
          plateId: plate.id,
          plateNumber: plate.number,
          imageName: safeName,
          imageHash,
          driveFileId: prevRef.driveFileId,
        });
        continue;
      }

      const parsed = parseDataUrlToBytes(plate.imageDataUrl);
      if (parsed) {
        if (!remoteImageMap) {
          remoteImageMap = await listExistingImageFilesInFolder(
            accessToken,
            imagesFolderId,
            fetchFn
          );
        }
        const driveFileName = `T${plate.number}_${cls.id}_${plate.id}_${safeName}`;
        const existingImgFileId =
          prevRef?.driveFileId ??
          remoteImageMap.get(plateKey) ??
          remoteImageMap.get(driveFileName) ??
          null;

        const uploadedImg = await multipartUploadFile(
          accessToken,
          {
            existingFileId: existingImgFileId,
            metadata: {
              name: driveFileName,
              ...(existingImgFileId ? {} : { parents: [imagesFolderId] }),
              appProperties: {
                tabscoreType: 'plate_image',
                tabscorePlateKey: plateKey,
                imageHash,
              },
            },
            contentType: parsed.mimeType,
            contentBody: parsed.bytes,
          },
          fetchFn
        );

        if (!uploadedImg.id || Number(uploadedImg.size ?? '1') <= 0) {
          throw new DriveApiError(
            `Verifica caricamento immagine Tavola ${plate.number} non riuscita.`,
            0,
            'corrupt'
          );
        }

        nextImageIndex[plateKey] = {
          imageHash,
          driveFileId: uploadedImg.id,
        };
        imageManifest.push({
          classId: cls.id,
          plateId: plate.id,
          plateNumber: plate.number,
          imageName: safeName,
          imageHash,
          driveFileId: uploadedImg.id,
        });
      }
    }
  }

  const contentHash = await computeStoreContentHash(state);
  const now = new Date().toISOString();
  const payload: TabScoreSyncPayload = {
    format: DRIVE_ARCHIVE_FORMAT,
    archiveType: 'full_backup',
    version: state.version ?? STORE_VERSION,
    exportedAt: now,
    revision: options.targetRevision,
    updatedAt: now,
    deviceId: meta.deviceId,
    contentHash,
    activeClassId: state.activeClassId,
    classes: state.classes,
    auditLog: state.auditLog,
    imageManifest,
    summary: summarizeStoreState(state),
  };

  const jsonBody = JSON.stringify(payload);
  const existingFileId =
    options.existingArchiveFileId ??
    (await findArchiveFileInFolder(accessToken, folderId, fetchFn))?.id ??
    null;

  const uploadedArchive = await multipartUploadFile(
    accessToken,
    {
      existingFileId,
      metadata: {
        name: DRIVE_ARCHIVE_FILE_NAME,
        ...(existingFileId ? {} : { parents: [folderId] }),
        mimeType: 'application/json',
        appProperties: {
          tabscoreFormat: DRIVE_ARCHIVE_FORMAT,
          revision: String(payload.revision),
          contentHash: payload.contentHash,
        },
      },
      contentType: 'application/json',
      contentBody: jsonBody,
    },
    fetchFn
  );

  // Post-upload verification: confirm file ID and non-empty uploaded size
  if (!uploadedArchive.id || Number(uploadedArchive.size ?? '1') <= 0) {
    throw new DriveApiError(
      'Verifica post-salvataggio su Google Drive non riuscita.',
      0,
      'corrupt'
    );
  }

  return {
    payload,
    folderId,
    imagesFolderId,
    archiveFileId: uploadedArchive.id,
    uploadedImageIndex: nextImageIndex,
  };
}

export async function downloadAndHydrateArchiveFromDrive(
  accessToken: string,
  archiveFileId: string,
  fetchFn: FetchLike = fetch
): Promise<TabScoreSyncPayload> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      archiveFileId
    )}?alt=media`,
    accessToken,
    {},
    fetchFn
  );

  let parsedRaw: unknown;
  try {
    parsedRaw = await res.json();
  } catch {
    throw new DriveApiError(
      'Il file scaricato da Google Drive non è un JSON valido.',
      0,
      'corrupt'
    );
  }

  const validation = await validateSyncPayload(parsedRaw);
  if (!validation.ok) {
    throw new DriveApiError(validation.error, 0, 'corrupt');
  }

  const payload = validation.payload;

  // Hydrate any plate image missing inline dataUrl from its Drive binary mirror if referenced
  const manifestMap = new Map<string, ImageManifestEntry>();
  for (const entry of payload.imageManifest) {
    manifestMap.set(`${entry.classId}::${entry.plateId}`, entry);
  }

  const hydratedClasses: ClassData[] = [];
  for (const cls of payload.classes) {
    const hydratedPlates = [];
    for (const plate of cls.plates) {
      if (!plate.imageDataUrl) {
        const ref = manifestMap.get(`${cls.id}::${plate.id}`);
        if (ref?.driveFileId) {
          const imgRes = await driveFetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              ref.driveFileId
            )}?alt=media`,
            accessToken,
            {},
            fetchFn
          );
          const buf = new Uint8Array(await imgRes.arrayBuffer());
          const headerMime = imgRes.headers
            .get('content-type')
            ?.split(';')[0]
            ?.trim();
          const mime =
            headerMime && headerMime.startsWith('image/')
              ? headerMime
              : /\.jpe?g$/i.test(ref.imageName)
              ? 'image/jpeg'
              : /\.webp$/i.test(ref.imageName)
              ? 'image/webp'
              : 'image/png';
          hydratedPlates.push({
            ...plate,
            imageDataUrl: bytesToDataUrl(buf, mime),
            imageName: plate.imageName || ref.imageName,
          });
          continue;
        }
      }
      hydratedPlates.push(plate);
    }
    hydratedClasses.push({ ...cls, plates: hydratedPlates });
  }

  return {
    ...payload,
    classes: hydratedClasses,
  };
}
