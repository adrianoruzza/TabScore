import type { AuditCategory, ClassData } from '../types/gradebook';
import type { YearFilterValue } from './schoolDataAnalytics';

export const UI_SESSION_STORAGE_KEY = 'tabscore_ui_session_v1';
export const UI_SESSION_VERSION = 1;

// Legacy keys read once for transparent migration on app updates
const LEGACY_UI_PREFS_KEY = 'tabscore_ui_prefs_v1';
const LEGACY_COLLAPSED_FOLDERS_KEY = 'tabscore_collapsed_folders_v1';
const LEGACY_APP_ZOOM_KEY = 'tabscore_ui_zoom_v1';

const APP_ZOOM_MIN = 0.7;
const APP_ZOOM_MAX = 1.75;
const APP_ZOOM_DEFAULT = 1;

export type ActiveAppSection = 'gradebook' | 'data';
export type MobileViewMode = 'table' | 'cards';
export type ClassStatsTabId = 'panoramica' | 'tavole' | 'studenti';

export type RestorableUiPanel =
  | {
      kind: 'folder_drawer';
      classId: string;
      studentId: string;
      folderId: string;
      scrollTop?: number;
    }
  | {
      kind: 'class_stats';
      classId: string;
    }
  | {
      kind: 'student_stats';
      classId: string;
      studentId: string;
    }
  | {
      kind: 'folder_stats';
      classId: string;
      folderId: string;
    }
  | {
      kind: 'audit_log';
    };

export interface ClassUiSessionState {
  collapsedFolderIds: string[];
  highlightedStudentId: string | null;
  focusedGradeCell: { studentId: string; plateId: string } | null;
  gridScroll: { left: number; top: number };
  mobileSelectedColumnKey: string | null;
  mobileHighlightedStudentId: string | null;
  mobileScrollTop: number;
}

export interface UiSessionState {
  version: number;
  updatedAt: string;
  activeClassId: string | null;
  activeSection: ActiveAppSection;
  mobileMode: MobileViewMode;
  zoom: number;
  dataFilter: {
    yearLevel: YearFilterValue;
    selectedClassId: string | null;
  };
  dataScrollTop: number;
  classStatsTab: ClassStatsTabId;
  auditFilter: {
    category: AuditCategory | 'all';
    onlyActiveClass: boolean;
  };
  openPanel: RestorableUiPanel | null;
  byClass: Record<string, ClassUiSessionState>;
}

const VALID_AUDIT_CATEGORIES = new Set<AuditCategory | 'all'>([
  'all',
  'valutazione',
  'cartellina',
  'tavola',
  'studente',
  'classe',
  'impostazioni',
  'archivio',
]);

const VALID_STATS_TABS = new Set<ClassStatsTabId>([
  'panoramica',
  'tavole',
  'studenti',
]);

function clampZoomValue(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return APP_ZOOM_DEFAULT;
  const clamped = Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, num));
  return Math.round(clamped * 100) / 100;
}

function sanitizeScrollNumber(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

function sanitizeNonEmptyString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

function sanitizeYearFilterValue(raw: unknown): YearFilterValue {
  if (
    raw === 'all' ||
    raw === 'unclassified' ||
    raw === 1 ||
    raw === 2 ||
    raw === 3 ||
    raw === 4 ||
    raw === 5
  ) {
    return raw;
  }
  return 'all';
}

export function createDefaultClassUiSession(): ClassUiSessionState {
  return {
    collapsedFolderIds: [],
    highlightedStudentId: null,
    focusedGradeCell: null,
    gridScroll: { left: 0, top: 0 },
    mobileSelectedColumnKey: null,
    mobileHighlightedStudentId: null,
    mobileScrollTop: 0,
  };
}

export function createDefaultUiSession(): UiSessionState {
  return {
    version: UI_SESSION_VERSION,
    updatedAt: '',
    activeClassId: null,
    activeSection: 'gradebook',
    mobileMode: 'table',
    zoom: APP_ZOOM_DEFAULT,
    dataFilter: {
      yearLevel: 'all',
      selectedClassId: null,
    },
    dataScrollTop: 0,
    classStatsTab: 'panoramica',
    auditFilter: {
      category: 'all',
      onlyActiveClass: false,
    },
    openPanel: null,
    byClass: {},
  };
}

function sanitizeClassUiSession(raw: unknown): ClassUiSessionState {
  const fallback = createDefaultClassUiSession();
  if (!raw || typeof raw !== 'object') return fallback;
  const src = raw as Record<string, unknown>;

  const collapsedFolderIds = Array.isArray(src.collapsedFolderIds)
    ? Array.from(
        new Set(
          src.collapsedFolderIds.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0
          )
        )
      )
    : [];

  const highlightedStudentId = sanitizeNonEmptyString(src.highlightedStudentId);

  let focusedGradeCell: ClassUiSessionState['focusedGradeCell'] = null;
  if (src.focusedGradeCell && typeof src.focusedGradeCell === 'object') {
    const fc = src.focusedGradeCell as Record<string, unknown>;
    const studentId = sanitizeNonEmptyString(fc.studentId);
    const plateId = sanitizeNonEmptyString(fc.plateId);
    if (studentId && plateId) {
      focusedGradeCell = { studentId, plateId };
    }
  }

  let gridScroll = { left: 0, top: 0 };
  if (src.gridScroll && typeof src.gridScroll === 'object') {
    const gs = src.gridScroll as Record<string, unknown>;
    gridScroll = {
      left: sanitizeScrollNumber(gs.left),
      top: sanitizeScrollNumber(gs.top),
    };
  }

  const rawColKey = sanitizeNonEmptyString(src.mobileSelectedColumnKey);
  const mobileSelectedColumnKey =
    rawColKey &&
    (rawColKey.startsWith('plate:') || rawColKey.startsWith('folder:'))
      ? rawColKey
      : null;

  const mobileHighlightedStudentId = sanitizeNonEmptyString(
    src.mobileHighlightedStudentId
  );

  const mobileScrollTop = sanitizeScrollNumber(src.mobileScrollTop);

  return {
    collapsedFolderIds,
    highlightedStudentId,
    focusedGradeCell,
    gridScroll,
    mobileSelectedColumnKey,
    mobileHighlightedStudentId,
    mobileScrollTop,
  };
}

function sanitizeOpenPanel(raw: unknown): RestorableUiPanel | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  switch (src.kind) {
    case 'folder_drawer': {
      const classId = sanitizeNonEmptyString(src.classId);
      const studentId = sanitizeNonEmptyString(src.studentId);
      const folderId = sanitizeNonEmptyString(src.folderId);
      if (!classId || !studentId || !folderId) return null;
      const scrollTop = sanitizeScrollNumber(src.scrollTop);
      return scrollTop > 0
        ? { kind: 'folder_drawer', classId, studentId, folderId, scrollTop }
        : { kind: 'folder_drawer', classId, studentId, folderId };
    }
    case 'class_stats': {
      const classId = sanitizeNonEmptyString(src.classId);
      return classId ? { kind: 'class_stats', classId } : null;
    }
    case 'student_stats': {
      const classId = sanitizeNonEmptyString(src.classId);
      const studentId = sanitizeNonEmptyString(src.studentId);
      return classId && studentId
        ? { kind: 'student_stats', classId, studentId }
        : null;
    }
    case 'folder_stats': {
      const classId = sanitizeNonEmptyString(src.classId);
      const folderId = sanitizeNonEmptyString(src.folderId);
      return classId && folderId
        ? { kind: 'folder_stats', classId, folderId }
        : null;
    }
    case 'audit_log':
      return { kind: 'audit_log' };
    default:
      // Unknown or retired panel type after an app update -> safely ignore
      return null;
  }
}

export function sanitizeUiSession(raw: unknown): UiSessionState {
  const defaults = createDefaultUiSession();
  if (!raw || typeof raw !== 'object') return defaults;
  const src = raw as Record<string, unknown>;

  const activeSection: ActiveAppSection =
    src.activeSection === 'data' ? 'data' : 'gradebook';
  const mobileMode: MobileViewMode =
    src.mobileMode === 'cards' ? 'cards' : 'table';

  const rawDataFilter =
    src.dataFilter && typeof src.dataFilter === 'object'
      ? (src.dataFilter as Record<string, unknown>)
      : {};
  const dataFilter = {
    yearLevel: sanitizeYearFilterValue(rawDataFilter.yearLevel),
    selectedClassId: sanitizeNonEmptyString(rawDataFilter.selectedClassId),
  };

  const rawClassStatsTab = src.classStatsTab;
  const classStatsTab: ClassStatsTabId =
    typeof rawClassStatsTab === 'string' &&
    VALID_STATS_TABS.has(rawClassStatsTab as ClassStatsTabId)
      ? (rawClassStatsTab as ClassStatsTabId)
      : 'panoramica';

  const rawAuditFilter =
    src.auditFilter && typeof src.auditFilter === 'object'
      ? (src.auditFilter as Record<string, unknown>)
      : {};
  const auditCategory =
    typeof rawAuditFilter.category === 'string' &&
    VALID_AUDIT_CATEGORIES.has(rawAuditFilter.category as AuditCategory | 'all')
      ? (rawAuditFilter.category as AuditCategory | 'all')
      : 'all';

  const byClass: Record<string, ClassUiSessionState> = {};
  if (src.byClass && typeof src.byClass === 'object') {
    for (const [classId, value] of Object.entries(
      src.byClass as Record<string, unknown>
    )) {
      if (classId.trim().length > 0) {
        byClass[classId] = sanitizeClassUiSession(value);
      }
    }
  }

  return {
    version: UI_SESSION_VERSION,
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : '',
    activeClassId: sanitizeNonEmptyString(src.activeClassId),
    activeSection,
    mobileMode,
    zoom: clampZoomValue(src.zoom),
    dataFilter,
    dataScrollTop: sanitizeScrollNumber(src.dataScrollTop),
    classStatsTab,
    auditFilter: {
      category: auditCategory,
      onlyActiveClass: Boolean(rawAuditFilter.onlyActiveClass),
    },
    openPanel: sanitizeOpenPanel(src.openPanel),
    byClass,
  };
}

/**
 * Migrates older separate UI keys (ui_prefs, collapsed_folders, ui_zoom) into
 * the single consolidated UI session structure on first load after an update.
 */
function readLegacyUiSessionFallback(): UiSessionState {
  const session = createDefaultUiSession();
  if (typeof localStorage === 'undefined') return session;

  try {
    const rawPrefs = localStorage.getItem(LEGACY_UI_PREFS_KEY);
    if (rawPrefs) {
      const parsed = JSON.parse(rawPrefs) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        session.activeSection =
          parsed.activeSection === 'data' ? 'data' : 'gradebook';
        session.mobileMode =
          parsed.mobileMode === 'cards' ? 'cards' : 'table';
        session.dataFilter = {
          yearLevel: sanitizeYearFilterValue(parsed.dataYearLevel),
          selectedClassId: sanitizeNonEmptyString(parsed.dataSelectedClassId),
        };
      }
    }
  } catch {
    // Ignore corrupted legacy prefs
  }

  try {
    const rawCollapsed = localStorage.getItem(LEGACY_COLLAPSED_FOLDERS_KEY);
    if (rawCollapsed) {
      const parsed = JSON.parse(rawCollapsed) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        for (const [classId, list] of Object.entries(parsed)) {
          if (classId.trim().length > 0 && Array.isArray(list)) {
            session.byClass[classId] = sanitizeClassUiSession({
              collapsedFolderIds: list,
            });
          }
        }
      }
    }
  } catch {
    // Ignore corrupted legacy collapsed folders
  }

  try {
    const rawZoom = localStorage.getItem(LEGACY_APP_ZOOM_KEY);
    if (rawZoom) {
      session.zoom = clampZoomValue(Number(rawZoom));
    }
  } catch {
    // Ignore corrupted legacy zoom
  }

  return session;
}

// --- In-memory cache & throttled/debounced local persistence ---
let cachedSession: UiSessionState | null = null;
let isDirty = false;
let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;

function writeSessionToStorage(session: UiSessionState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(UI_SESSION_STORAGE_KEY, JSON.stringify(session));
    isDirty = false;
  } catch {
    // Never crash or interfere with school archive on storage quota / privacy mode errors
  }
}

export function resetUiSessionMemoryCache(): void {
  if (pendingSaveTimer !== null) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  cachedSession = null;
  isDirty = false;
}

export function loadUiSession(): UiSessionState {
  if (cachedSession) return cachedSession;
  if (typeof localStorage === 'undefined') {
    cachedSession = createDefaultUiSession();
    return cachedSession;
  }

  try {
    const raw = localStorage.getItem(UI_SESSION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      cachedSession = sanitizeUiSession(parsed);
      return cachedSession;
    }
  } catch {
    // Corrupted JSON -> safely recover with defaults without throwing
    cachedSession = createDefaultUiSession();
    return cachedSession;
  }

  // First boot on this consolidated schema: migrate any legacy UI keys cleanly
  cachedSession = readLegacyUiSessionFallback();
  return cachedSession;
}

export function flushUiSessionNow(): void {
  if (pendingSaveTimer !== null) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  if (!isDirty || !cachedSession) return;
  writeSessionToStorage(cachedSession);
}

export function updateUiSession(
  updater: (prev: UiSessionState) => UiSessionState,
  options?: { immediate?: boolean; debounceMs?: number }
): UiSessionState {
  const prev = loadUiSession();
  const nextRaw = updater(prev);
  if (nextRaw === prev) return prev;

  const next: UiSessionState = {
    ...nextRaw,
    version: UI_SESSION_VERSION,
    updatedAt: new Date().toISOString(),
  };

  cachedSession = next;
  isDirty = true;

  const immediate = options?.immediate !== false;
  if (immediate) {
    flushUiSessionNow();
  } else {
    const debounceMs = Math.max(40, options?.debounceMs ?? 160);
    if (pendingSaveTimer !== null) {
      clearTimeout(pendingSaveTimer);
    }
    pendingSaveTimer = setTimeout(() => {
      pendingSaveTimer = null;
      flushUiSessionNow();
    }, debounceMs);
  }

  return next;
}

export function getClassUiSession(classId: string): ClassUiSessionState {
  const session = loadUiSession();
  return session.byClass[classId] ?? createDefaultClassUiSession();
}

export function updateClassUiSession(
  classId: string,
  updater: (prev: ClassUiSessionState) => ClassUiSessionState,
  options?: { immediate?: boolean; debounceMs?: number }
): ClassUiSessionState {
  if (!classId) return createDefaultClassUiSession();
  const updated = updateUiSession(
    (prev) => {
      const curClass = prev.byClass[classId] ?? createDefaultClassUiSession();
      const nextClass = updater(curClass);
      if (nextClass === curClass) return prev;
      return {
        ...prev,
        byClass: {
          ...prev.byClass,
          [classId]: nextClass,
        },
      };
    },
    options
  );
  return updated.byClass[classId] ?? createDefaultClassUiSession();
}

/**
 * Validates a saved UI session against the real classes currently loaded from
 * the school archive. Automatically clears stale references (deleted class,
 * student, plate, or folder) and falls back to the closest valid state without
 * ever modifying or touching the school archive data.
 */
export function reconcileUiSessionWithClasses(
  session: UiSessionState,
  classes: ClassData[]
): {
  session: UiSessionState;
  changed: boolean;
} {
  const classMap = new Map<string, ClassData>();
  for (const cls of classes) {
    classMap.set(cls.id, cls);
  }

  let changed = false;

  // 1. Validate activeClassId
  let resolvedActiveClassId: string | null = session.activeClassId;
  if (resolvedActiveClassId && !classMap.has(resolvedActiveClassId)) {
    resolvedActiveClassId = classes[0]?.id ?? null;
    changed = true;
  } else if (!resolvedActiveClassId && classes.length > 0) {
    resolvedActiveClassId = classes[0].id;
    changed = true;
  }

  // 2. Validate DataDashboard selectedClassId
  let resolvedDataSelectedClassId = session.dataFilter.selectedClassId;
  if (
    resolvedDataSelectedClassId &&
    !classMap.has(resolvedDataSelectedClassId)
  ) {
    resolvedDataSelectedClassId = null;
    changed = true;
  }

  // 3. Validate openPanel (must belong to an existing class/student/folder and match activeClass)
  let resolvedOpenPanel: RestorableUiPanel | null = session.openPanel;
  if (resolvedOpenPanel) {
    const panel = resolvedOpenPanel;
    if (panel.kind === 'audit_log') {
      // Always valid
    } else {
      const targetClass = classMap.get(panel.classId);
      if (!targetClass || targetClass.id !== resolvedActiveClassId) {
        resolvedOpenPanel = null;
        changed = true;
      } else if (panel.kind === 'folder_drawer') {
        const hasStudent = targetClass.students.some(
          (s) => s.id === panel.studentId
        );
        const hasFolder = targetClass.folders.some(
          (f) => f.id === panel.folderId
        );
        if (!hasStudent || !hasFolder) {
          resolvedOpenPanel = null;
          changed = true;
        }
      } else if (panel.kind === 'student_stats') {
        const hasStudent = targetClass.students.some(
          (s) => s.id === panel.studentId
        );
        if (!hasStudent) {
          resolvedOpenPanel = null;
          changed = true;
        }
      } else if (panel.kind === 'folder_stats') {
        const hasFolder = targetClass.folders.some(
          (f) => f.id === panel.folderId
        );
        if (!hasFolder) {
          resolvedOpenPanel = null;
          changed = true;
        }
      }
    }
  }

  // 4. Validate per-class UI state and prune references to deleted classes/students/plates/folders
  const nextByClass: Record<string, ClassUiSessionState> = {};
  for (const [cid, clsUi] of Object.entries(session.byClass)) {
    const cls = classMap.get(cid);
    if (!cls) {
      changed = true;
      continue;
    }

    const studentIds = new Set(cls.students.map((s) => s.id));
    const plateIds = new Set(cls.plates.map((p) => p.id));
    const folderIds = new Set(cls.folders.map((f) => f.id));

    const validCollapsed = clsUi.collapsedFolderIds.filter((fid) =>
      folderIds.has(fid)
    );
    if (validCollapsed.length !== clsUi.collapsedFolderIds.length) {
      changed = true;
    }

    let validHighlighted = clsUi.highlightedStudentId;
    if (validHighlighted && !studentIds.has(validHighlighted)) {
      validHighlighted = null;
      changed = true;
    }

    let validFocusedCell = clsUi.focusedGradeCell;
    if (
      validFocusedCell &&
      (!studentIds.has(validFocusedCell.studentId) ||
        !plateIds.has(validFocusedCell.plateId))
    ) {
      validFocusedCell = null;
      changed = true;
    }

    let validMobileCol = clsUi.mobileSelectedColumnKey;
    if (validMobileCol) {
      if (validMobileCol.startsWith('plate:')) {
        const pid = validMobileCol.slice('plate:'.length);
        if (!plateIds.has(pid)) {
          validMobileCol = null;
          changed = true;
        }
      } else if (validMobileCol.startsWith('folder:')) {
        const fid = validMobileCol.slice('folder:'.length);
        if (!folderIds.has(fid)) {
          validMobileCol = null;
          changed = true;
        }
      } else {
        validMobileCol = null;
        changed = true;
      }
    }

    let validMobileHighlighted = clsUi.mobileHighlightedStudentId;
    if (validMobileHighlighted && !studentIds.has(validMobileHighlighted)) {
      validMobileHighlighted = null;
      changed = true;
    }

    nextByClass[cid] = {
      ...clsUi,
      collapsedFolderIds: validCollapsed,
      highlightedStudentId: validHighlighted,
      focusedGradeCell: validFocusedCell,
      mobileSelectedColumnKey: validMobileCol,
      mobileHighlightedStudentId: validMobileHighlighted,
    };
  }

  if (!changed) {
    return { session, changed: false };
  }

  return {
    changed: true,
    session: {
      ...session,
      activeClassId: resolvedActiveClassId,
      dataFilter: {
        ...session.dataFilter,
        selectedClassId: resolvedDataSelectedClassId,
      },
      openPanel: resolvedOpenPanel,
      byClass: nextByClass,
    },
  };
}
