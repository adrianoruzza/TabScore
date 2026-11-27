import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArchivedStudentHistory,
  AuditCategory,
  AuditLogEntry,
  ClassData,
  ClassSettings,
  FolderDelivery,
  FolderDeliveryStatus,
  FolderStudentRecord,
  FullBackupArchive,
  GradebookStoreState,
  Plate,
  PlateEvaluation,
  PlateStatus,
  SingleClassArchive,
  Student,
  StudentSupportTag,
  StudentTransferRecord,
} from '../types/gradebook';
import {
  calculateFolderEvaluation,
  computeLiveFolderEvaluation,
  EMPTY_EVALUATION,
  EMPTY_FOLDER_RECORD,
  formatGradeLabel,
  formatPlateInterval,
  sortPlates,
} from '../utils/calculations';
import { pickNextDistinctClassColorId } from '../utils/classColors';
import {
  flushArchiveEmergencySync,
  hydrateLocalArchive,
  isIndexedDbAvailable,
  persistArchiveLocally,
  requestPersistentStorageBestEffort,
  type PersistenceEngine,
} from '../utils/localDatabase';
import {
  buildStudentDedupeKey,
  normalizeNameValue,
  sortStudentsAlphabeticallyIt,
} from '../utils/studentImport';
import {
  createEmptyShellState,
  createId,
  DEFAULT_CLASS_SETTINGS,
  normalizeClassData,
  sortAndNormalizeClasses,
} from '../utils/storage';
import { loadUiSession, updateUiSession } from '../utils/uiSessionState';

function makeLog(
  classId: string | null,
  className: string,
  category: AuditCategory,
  action: string,
  details: string
): AuditLogEntry {
  return {
    id: createId('log'),
    timestamp: new Date().toISOString(),
    classId,
    className,
    category,
    action,
    details,
  };
}

export type PlateImportMode = 'append' | 'replace';

export interface PlateImportResult {
  ok: boolean;
  importedCount: number;
  skippedCount: number;
  error?: string;
}

export interface HistoryEntry {
  state: GradebookStoreState;
  label: string;
  timestamp: number;
  coalesceKey?: string;
}

export interface StoreHistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const EMPTY_STORE_HISTORY: StoreHistoryState = {
  past: [],
  future: [],
};

export const MAX_UNDO_HISTORY = 50;
export const UNDO_COALESCE_WINDOW_MS = 1200;

export function pushHistoryEntry(
  history: StoreHistoryState,
  prevState: GradebookStoreState,
  nextState: GradebookStoreState,
  options?: {
    label?: string;
    coalesceKey?: string;
    nowMs?: number;
  }
): StoreHistoryState {
  const nowMs = options?.nowMs ?? Date.now();
  const inferredLabel =
    options?.label ||
    (nextState.auditLog[0] &&
    nextState.auditLog[0].id !== prevState.auditLog[0]?.id
      ? nextState.auditLog[0].action
      : 'Modifica dati');

  const coalesceKey = options?.coalesceKey;
  if (coalesceKey && history.past.length > 0) {
    const top = history.past[history.past.length - 1];
    if (
      top.coalesceKey === coalesceKey &&
      nowMs - top.timestamp <= UNDO_COALESCE_WINDOW_MS
    ) {
      const nextPast = [...history.past];
      nextPast[nextPast.length - 1] = {
        ...top,
        label: inferredLabel,
        timestamp: nowMs,
      };
      return {
        past: nextPast,
        future: [],
      };
    }
  }

  const nextPast = [
    ...history.past,
    {
      state: prevState,
      label: inferredLabel,
      timestamp: nowMs,
      ...(coalesceKey ? { coalesceKey } : {}),
    },
  ];
  return {
    past:
      nextPast.length > MAX_UNDO_HISTORY
        ? nextPast.slice(nextPast.length - MAX_UNDO_HISTORY)
        : nextPast,
    future: [],
  };
}

export function applyUndoHistory(
  currentState: GradebookStoreState,
  history: StoreHistoryState,
  nowMs: number = Date.now()
): {
  state: GradebookStoreState;
  history: StoreHistoryState;
  label: string;
} | null {
  if (history.past.length === 0) return null;
  const entry = history.past[history.past.length - 1];
  const nextPast = history.past.slice(0, -1);
  const nextFuture = [
    ...history.future,
    {
      state: currentState,
      label: entry.label,
      timestamp: nowMs,
    },
  ];
  return {
    state: entry.state,
    history: {
      past: nextPast,
      future:
        nextFuture.length > MAX_UNDO_HISTORY
          ? nextFuture.slice(nextFuture.length - MAX_UNDO_HISTORY)
          : nextFuture,
    },
    label: entry.label,
  };
}

export function applyRedoHistory(
  currentState: GradebookStoreState,
  history: StoreHistoryState,
  nowMs: number = Date.now()
): {
  state: GradebookStoreState;
  history: StoreHistoryState;
  label: string;
} | null {
  if (history.future.length === 0) return null;
  const entry = history.future[history.future.length - 1];
  const nextFuture = history.future.slice(0, -1);
  const nextPast = [
    ...history.past,
    {
      state: currentState,
      label: entry.label,
      timestamp: nowMs,
    },
  ];
  return {
    state: entry.state,
    history: {
      past:
        nextPast.length > MAX_UNDO_HISTORY
          ? nextPast.slice(nextPast.length - MAX_UNDO_HISTORY)
          : nextPast,
      future: nextFuture,
    },
    label: entry.label,
  };
}

function normalizePlateTitleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function realignFolderPlateIdsBySlots(
  folders: FolderDelivery[],
  oldSortedPlates: Plate[],
  newSortedPlates: Plate[]
): FolderDelivery[] {
  const oldIndexByPlateId = new Map<string, number>();
  oldSortedPlates.forEach((p, idx) => {
    oldIndexByPlateId.set(p.id, idx);
  });

  return folders.map((folder) => {
    const slotIndices = Array.from(
      new Set(
        folder.plateIds
          .map((pid) => oldIndexByPlateId.get(pid))
          .filter((idx): idx is number => idx !== undefined)
      )
    ).sort((a, b) => a - b);

    const nextPlateIds: string[] = [];
    for (const slotIdx of slotIndices) {
      if (slotIdx >= 0 && slotIdx < newSortedPlates.length) {
        nextPlateIds.push(newSortedPlates[slotIdx].id);
      }
    }

    return {
      ...folder,
      plateIds: nextPlateIds,
    };
  });
}

function pruneFolderRecordsExtraMissing(
  folderRecords: ClassData['folderRecords'],
  validPlateIds: Set<string>
): ClassData['folderRecords'] {
  const next: ClassData['folderRecords'] = {};
  for (const [stuId, byFolder] of Object.entries(folderRecords)) {
    const nextByFolder: Record<string, FolderStudentRecord> = {};
    for (const [folderId, rec] of Object.entries(byFolder)) {
      if (
        Array.isArray(rec.extraMissingPlateIds) &&
        rec.extraMissingPlateIds.some((pid) => !validPlateIds.has(pid))
      ) {
        nextByFolder[folderId] = {
          ...rec,
          extraMissingPlateIds: rec.extraMissingPlateIds.filter((pid) =>
            validPlateIds.has(pid)
          ),
        };
      } else {
        nextByFolder[folderId] = rec;
      }
    }
    next[stuId] = nextByFolder;
  }
  return next;
}

export function applyDeletePlate(
  prevState: GradebookStoreState,
  classId: string,
  plateId: string,
  now: string = new Date().toISOString()
): GradebookStoreState {
  const target = prevState.classes.find((c) => c.id === classId);
  const plate = target?.plates.find((p) => p.id === plateId);
  if (!target || !plate) return prevState;

  const oldSortedPlates = sortPlates(target.plates);
  const remainingPlates = oldSortedPlates.filter((p) => p.id !== plateId);
  const renumberedPlates: Plate[] = remainingPlates.map((p, idx) => ({
    ...p,
    number: idx + 1,
    order: idx,
  }));

  const validPlateIds = new Set(renumberedPlates.map((p) => p.id));

  const nextEvals: ClassData['evaluations'] = {};
  for (const [stuId, map] of Object.entries(target.evaluations)) {
    const copy = { ...map };
    delete copy[plateId];
    nextEvals[stuId] = copy;
  }

  const nextFolders = realignFolderPlateIdsBySlots(
    target.folders,
    oldSortedPlates,
    renumberedPlates
  );

  const nextFolderRecords = pruneFolderRecordsExtraMissing(
    target.folderRecords,
    validPlateIds
  );

  const renumberedCount = oldSortedPlates.filter(
    (p, idx) =>
      p.id !== plateId &&
      idx > oldSortedPlates.findIndex((x) => x.id === plateId)
  ).length;
  const renumberDetail =
    renumberedCount > 0
      ? ` Rinumerate ${renumberedCount} ${
          renumberedCount === 1 ? 'tavola successiva' : 'tavole successive'
        }${
          target.folders.length > 0
            ? ' e riallineati gli intervalli delle cartelline'
            : ''
        }.`
      : '';

  return {
    ...prevState,
    classes: prevState.classes.map((c) =>
      c.id === classId
        ? {
            ...c,
            plates: renumberedPlates,
            evaluations: nextEvals,
            folders: nextFolders,
            folderRecords: nextFolderRecords,
            updatedAt: now,
          }
        : c
    ),
    auditLog: [
      makeLog(
        classId,
        target.name,
        'tavola',
        'Eliminazione tavola',
        `Eliminata Tavola ${plate.number}: "${plate.title}".${renumberDetail}`
      ),
      ...prevState.auditLog,
    ].slice(0, 500),
  };
}

export function clonePlatesForImport(
  sourcePlates: Plate[],
  options?: {
    includeAttachments?: boolean;
    startOrder?: number;
    startNumber?: number;
    reservedNumbers?: Set<number>;
    preservePlateSlots?: Plate[];
  }
): Plate[] {
  const sorted = sortPlates(sourcePlates);
  const startOrder = options?.startOrder ?? 0;
  const usedNumbers = new Set<number>(options?.reservedNumbers ?? []);
  const includeAttachments = Boolean(options?.includeAttachments);
  const preservePlateSlots = options?.preservePlateSlots ?? [];
  let nextNumber = Math.max(1, options?.startNumber ?? 1);

  return sorted.map((src, idx) => {
    while (usedNumbers.has(nextNumber)) {
      nextNumber += 1;
    }
    const assignedNumber = nextNumber;
    usedNumbers.add(assignedNumber);
    nextNumber += 1;

    const existingSlot = preservePlateSlots[idx];

    const cloned: Plate = {
      id: existingSlot ? existingSlot.id : createId('plt'),
      number: assignedNumber,
      order: startOrder + idx,
      title: src.title.trim(),
      assignedDate: existingSlot ? existingSlot.assignedDate : '',
      dueDate: existingSlot ? existingSlot.dueDate : '',
      notes: src.notes,
      ...(includeAttachments && src.imageDataUrl
        ? {
            imageDataUrl: src.imageDataUrl,
            ...(src.imageName ? { imageName: src.imageName } : {}),
          }
        : {}),
    };
    return cloned;
  });
}

export function applyImportPlatesFromClass(
  prevState: GradebookStoreState,
  input: {
    targetClassId: string;
    sourceClassId: string;
    mode: PlateImportMode;
    includeAttachments?: boolean;
    now?: string;
  }
): { nextState: GradebookStoreState; result: PlateImportResult } {
  const { targetClassId, sourceClassId, mode, includeAttachments } = input;
  if (targetClassId === sourceClassId) {
    return {
      nextState: prevState,
      result: {
        ok: false,
        importedCount: 0,
        skippedCount: 0,
        error: 'Seleziona una classe sorgente diversa dalla classe di destinazione.',
      },
    };
  }

  const targetClass = prevState.classes.find((c) => c.id === targetClassId);
  const sourceClass = prevState.classes.find((c) => c.id === sourceClassId);
  if (!targetClass || !sourceClass) {
    return {
      nextState: prevState,
      result: {
        ok: false,
        importedCount: 0,
        skippedCount: 0,
        error: 'Classe di origine o destinazione non trovata.',
      },
    };
  }

  const sortedSource = sortPlates(sourceClass.plates);
  if (sortedSource.length === 0) {
    return {
      nextState: prevState,
      result: {
        ok: false,
        importedCount: 0,
        skippedCount: 0,
        error: `La classe "${sourceClass.name}" non contiene tavole da importare.`,
      },
    };
  }

  const now = input.now ?? new Date().toISOString();

  if (mode === 'replace') {
    const oldSortedPlates = sortPlates(targetClass.plates);
    const clonedPlates = clonePlatesForImport(sortedSource, {
      includeAttachments,
      startOrder: 0,
      startNumber: 1,
      preservePlateSlots: oldSortedPlates,
    });
    const validPlateIds = new Set(clonedPlates.map((p) => p.id));

    // Preserve recorded evaluations for surviving plate slots; remove only pruned trailing slots
    const nextEvaluations: ClassData['evaluations'] = {};
    for (const [stuId, stuMap] of Object.entries(targetClass.evaluations)) {
      const kept: Record<string, PlateEvaluation> = {};
      for (const [pid, ev] of Object.entries(stuMap)) {
        if (validPlateIds.has(pid)) {
          kept[pid] = ev;
        }
      }
      nextEvaluations[stuId] = kept;
    }

    // Preserve ALL existing destination folders, their order, names, and plate intervals
    const nextFolders = realignFolderPlateIdsBySlots(
      targetClass.folders,
      oldSortedPlates,
      clonedPlates
    );

    const nextFolderRecords = pruneFolderRecordsExtraMissing(
      targetClass.folderRecords,
      validPlateIds
    );

    const nextState: GradebookStoreState = {
      ...prevState,
      classes: prevState.classes.map((c) =>
        c.id === targetClassId
          ? {
              ...c,
              plates: clonedPlates,
              evaluations: nextEvaluations,
              folders: nextFolders,
              folderRecords: nextFolderRecords,
              updatedAt: now,
            }
          : c
      ),
      auditLog: [
        makeLog(
          targetClass.id,
          targetClass.name,
          'tavola',
          'Sostituzione elenco tavole',
          `Aggiornato elenco con ${clonedPlates.length} tavole da "${sourceClass.name}" (cartelline, intervalli, consegne e dati esistenti preservati).`
        ),
        ...prevState.auditLog,
      ].slice(0, 500),
    };

    return {
      nextState,
      result: {
        ok: true,
        importedCount: clonedPlates.length,
        skippedCount: 0,
      },
    };
  }

  // Append mode: deduplicate by normalized plate title, reconstruct progressive numbering,
  // and leave existing destination plates, folders, intervals, evaluations and folderRecords untouched.
  const existingTitles = new Set(
    targetClass.plates.map((p) => normalizePlateTitleKey(p.title))
  );
  const platesToAppend = sortedSource.filter(
    (p) => !existingTitles.has(normalizePlateTitleKey(p.title))
  );
  const skippedCount = sortedSource.length - platesToAppend.length;

  if (platesToAppend.length === 0) {
    return {
      nextState: prevState,
      result: {
        ok: false,
        importedCount: 0,
        skippedCount,
        error: 'Tutte le tavole della classe selezionata sono già presenti in questa classe.',
      },
    };
  }

  const maxOrder = targetClass.plates.reduce(
    (max, p, idx) => Math.max(max, p.order ?? idx),
    -1
  );
  const maxNumber = targetClass.plates.reduce(
    (max, p) => Math.max(max, p.number),
    0
  );
  const reservedNumbers = new Set(targetClass.plates.map((p) => p.number));
  const clonedPlates = clonePlatesForImport(platesToAppend, {
    includeAttachments,
    startOrder: maxOrder + 1,
    startNumber: maxNumber + 1,
    reservedNumbers,
  });

  const nextState: GradebookStoreState = {
    ...prevState,
    classes: prevState.classes.map((c) =>
      c.id === targetClassId
        ? {
            ...c,
            plates: [...c.plates, ...clonedPlates],
            updatedAt: now,
          }
        : c
    ),
    auditLog: [
      makeLog(
        targetClass.id,
        targetClass.name,
        'tavola',
        'Importazione elenco tavole',
        `Aggiunte ${clonedPlates.length} tavole da "${sourceClass.name}"${
          skippedCount > 0 ? ` (${skippedCount} già presenti saltate)` : ''
        } (cartelline esistenti preservate).`
      ),
      ...prevState.auditLog,
    ].slice(0, 500),
  };

  return {
    nextState,
    result: {
      ok: true,
      importedCount: clonedPlates.length,
      skippedCount,
    },
  };
}

export interface ExternalPlateEntry {
  title: string;
  number?: number;
}

export function buildPlatesFromExternalEntries(
  entries: ExternalPlateEntry[],
  options?: {
    startOrder?: number;
    reservedNumbers?: Set<number>;
    existingTitleKeys?: Set<string>;
  }
): { plates: Plate[]; skippedCount: number } {
  const startOrder = options?.startOrder ?? 0;
  const usedNumbers = new Set<number>(options?.reservedNumbers ?? []);
  const existingKeys = new Set<string>(options?.existingTitleKeys ?? []);
  const batchKeys = new Set<string>();
  let nextSeq =
    usedNumbers.size > 0 ? Math.max(...Array.from(usedNumbers)) + 1 : 1;

  const plates: Plate[] = [];
  let skippedCount = 0;

  for (const raw of entries) {
    const title = raw.title.replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const key = normalizePlateTitleKey(title);
    if (existingKeys.has(key) || batchKeys.has(key)) {
      skippedCount += 1;
      continue;
    }
    batchKeys.add(key);

    let assignedNumber: number;
    if (
      typeof raw.number === 'number' &&
      Number.isInteger(raw.number) &&
      raw.number >= 1 &&
      !usedNumbers.has(raw.number)
    ) {
      assignedNumber = raw.number;
      if (assignedNumber >= nextSeq) {
        nextSeq = assignedNumber + 1;
      }
    } else {
      while (usedNumbers.has(nextSeq)) {
        nextSeq += 1;
      }
      assignedNumber = nextSeq;
      nextSeq += 1;
    }
    usedNumbers.add(assignedNumber);

    plates.push({
      id: createId('plt'),
      number: assignedNumber,
      order: startOrder + plates.length,
      title,
      assignedDate: '',
      dueDate: '',
      notes: '',
    });
  }

  return { plates, skippedCount };
}

export function applyImportPlatesFromExternalList(
  prevState: GradebookStoreState,
  input: {
    targetClassId: string;
    entries: ExternalPlateEntry[];
    mode: PlateImportMode;
    sourceFileName?: string;
    now?: string;
  }
): { nextState: GradebookStoreState; result: PlateImportResult } {
  const { targetClassId, entries, mode, sourceFileName } = input;
  const targetClass = prevState.classes.find((c) => c.id === targetClassId);
  if (!targetClass) {
    return {
      nextState: prevState,
      result: {
        ok: false,
        importedCount: 0,
        skippedCount: 0,
        error: 'Classe di destinazione non trovata.',
      },
    };
  }

  if (entries.length === 0) {
    return {
      nextState: prevState,
      result: {
        ok: false,
        importedCount: 0,
        skippedCount: 0,
        error: 'Nessuna tavola valida selezionata per l’importazione.',
      },
    };
  }

  const now = input.now ?? new Date().toISOString();
  const fileLabel = sourceFileName?.trim()
    ? ` dal file "${sourceFileName.trim()}"`
    : ' da file esterno';

  if (mode === 'replace') {
    const oldSortedPlates = sortPlates(targetClass.plates);
    const { plates: rawBuiltPlates, skippedCount } = buildPlatesFromExternalEntries(
      entries,
      { startOrder: 0 }
    );
    if (rawBuiltPlates.length === 0) {
      return {
        nextState: prevState,
        result: {
          ok: false,
          importedCount: 0,
          skippedCount,
          error: 'Nessun titolo di tavola valido da importare.',
        },
      };
    }

    const builtPlates: Plate[] = rawBuiltPlates.map((p, idx) => {
      const existingSlot = oldSortedPlates[idx];
      if (!existingSlot) return p;
      return {
        ...p,
        id: existingSlot.id,
        assignedDate: existingSlot.assignedDate,
        dueDate: existingSlot.dueDate,
      };
    });
    const validPlateIds = new Set(builtPlates.map((p) => p.id));

    const nextEvaluations: ClassData['evaluations'] = {};
    for (const [stuId, stuMap] of Object.entries(targetClass.evaluations)) {
      const kept: Record<string, PlateEvaluation> = {};
      for (const [pid, ev] of Object.entries(stuMap)) {
        if (validPlateIds.has(pid)) {
          kept[pid] = ev;
        }
      }
      nextEvaluations[stuId] = kept;
    }
    const nextFolders = realignFolderPlateIdsBySlots(
      targetClass.folders,
      oldSortedPlates,
      builtPlates
    );
    const nextFolderRecords = pruneFolderRecordsExtraMissing(
      targetClass.folderRecords,
      validPlateIds
    );

    const nextState: GradebookStoreState = {
      ...prevState,
      classes: prevState.classes.map((c) =>
        c.id === targetClassId
          ? {
              ...c,
              plates: builtPlates,
              evaluations: nextEvaluations,
              folders: nextFolders,
              folderRecords: nextFolderRecords,
              updatedAt: now,
            }
          : c
      ),
      auditLog: [
        makeLog(
          targetClass.id,
          targetClass.name,
          'tavola',
          'Sostituzione elenco tavole da file',
          `Importate ${builtPlates.length} ${
            builtPlates.length === 1 ? 'tavola' : 'tavole'
          }${fileLabel} in modalità sostituzione (studenti, cartelline e intervalli preservati).`
        ),
        ...prevState.auditLog,
      ].slice(0, 500),
    };

    return {
      nextState,
      result: {
        ok: true,
        importedCount: builtPlates.length,
        skippedCount,
      },
    };
  }

  // Append mode: deduplicate against existing plates & avoid number collisions
  const existingTitleKeys = new Set(
    targetClass.plates.map((p) => normalizePlateTitleKey(p.title))
  );
  const reservedNumbers = new Set(targetClass.plates.map((p) => p.number));
  const maxOrder = targetClass.plates.reduce(
    (max, p, idx) => Math.max(max, p.order ?? idx),
    -1
  );

  const { plates: builtPlates, skippedCount } = buildPlatesFromExternalEntries(
    entries,
    {
      startOrder: maxOrder + 1,
      reservedNumbers,
      existingTitleKeys,
    }
  );

  if (builtPlates.length === 0) {
    return {
      nextState: prevState,
      result: {
        ok: false,
        importedCount: 0,
        skippedCount,
        error:
          'Tutte le tavole selezionate sono già presenti in questa classe.',
      },
    };
  }

  const nextState: GradebookStoreState = {
    ...prevState,
    classes: prevState.classes.map((c) =>
      c.id === targetClassId
        ? {
            ...c,
            plates: [...c.plates, ...builtPlates],
            updatedAt: now,
          }
        : c
    ),
    auditLog: [
      makeLog(
        targetClass.id,
        targetClass.name,
        'tavola',
        'Importazione elenco tavole da file',
        `Aggiunte ${builtPlates.length} ${
          builtPlates.length === 1 ? 'tavola' : 'tavole'
        }${fileLabel}${
          skippedCount > 0 ? ` (${skippedCount} già presenti saltate)` : ''
        }.`
      ),
      ...prevState.auditLog,
    ].slice(0, 500),
  };

  return {
    nextState,
    result: {
      ok: true,
      importedCount: builtPlates.length,
      skippedCount,
    },
  };
}

export interface CreateClassInput {
  name: string;
  schoolYear: string;
  color?: string;
  sourcePlatesClassId?: string;
  includePlateAttachments?: boolean;
  initialPlates?: ExternalPlateEntry[];
  initialPlatesSourceFile?: string;
  initialStudents?: Array<{ lastName: string; firstName: string }>;
  initialStudentsSourceFile?: string;
}

export function applyCreateClass(
  prev: GradebookStoreState,
  input: CreateClassInput,
  createdId: string = createId('cls')
): GradebookStoreState {
  const now = new Date().toISOString();
  const chosenColor =
    input.color ||
    pickNextDistinctClassColorId(prev.classes.map((c) => c.color));
  const sourceClass = input.sourcePlatesClassId
    ? prev.classes.find((c) => c.id === input.sourcePlatesClassId)
    : undefined;
  const importedPlates =
    input.initialPlates && input.initialPlates.length > 0
      ? buildPlatesFromExternalEntries(input.initialPlates, { startOrder: 0 })
          .plates
      : sourceClass
      ? clonePlatesForImport(sourceClass.plates, {
          includeAttachments: input.includePlateAttachments,
        })
      : [];

  // Deduplicate & sanitize initial students (only lastName + firstName, alphabetical)
  const batchKeys = new Set<string>();
  const cleanInitialEntries: Array<{ lastName: string; firstName: string }> = [];
  for (const raw of input.initialStudents ?? []) {
    const lastName = normalizeNameValue(raw.lastName);
    const firstName = normalizeNameValue(raw.firstName);
    if (!lastName && !firstName) continue;
    const key = buildStudentDedupeKey(lastName, firstName);
    if (batchKeys.has(key)) continue;
    batchKeys.add(key);
    cleanInitialEntries.push({ lastName, firstName });
  }
  const sortedInitial = sortStudentsAlphabeticallyIt(cleanInitialEntries);
  const initialStudents: Student[] = sortedInitial.map((entry, idx) => ({
    id: createId('stu'),
    lastName: entry.lastName,
    firstName: entry.firstName,
    order: idx,
  }));

  const maxOrder = prev.classes.reduce(
    (max, c, idx) =>
      Math.max(
        max,
        typeof c.order === 'number' && Number.isFinite(c.order) ? c.order : idx
      ),
    -1
  );

  const newClass: ClassData = {
    id: createdId,
    name: input.name.trim(),
    schoolYear: input.schoolYear.trim() || '2026/2027',
    order: maxOrder + 1,
    color: chosenColor,
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_CLASS_SETTINGS },
    students: initialStudents,
    plates: importedPlates,
    evaluations: {},
    folders: [],
    folderRecords: {},
  };

  const platesNote =
    input.initialPlates && input.initialPlates.length > 0 && importedPlates.length > 0
      ? ` Con ${importedPlates.length} ${
          importedPlates.length === 1 ? 'tavola importata' : 'tavole importate'
        }${
          input.initialPlatesSourceFile?.trim()
            ? ` da "${input.initialPlatesSourceFile.trim()}"`
            : ' da file esterno'
        }.`
      : sourceClass && importedPlates.length > 0
      ? ` Con ${importedPlates.length} tavole importate da "${sourceClass.name}".`
      : '';
  const studentsNote =
    initialStudents.length > 0
      ? ` Con ${initialStudents.length} ${
          initialStudents.length === 1 ? 'studente importato' : 'studenti importati'
        }${
          input.initialStudentsSourceFile?.trim()
            ? ` da "${input.initialStudentsSourceFile.trim()}"`
            : ''
        }.`
      : '';

  return {
    ...prev,
    activeClassId: newClass.id,
    classes: [...prev.classes, newClass],
    auditLog: [
      makeLog(
        newClass.id,
        newClass.name,
        'classe',
        'Creazione classe',
        `Creata nuova classe "${newClass.name}" (${newClass.schoolYear}).${studentsNote}${platesNote}`
      ),
      ...prev.auditLog,
    ],
  };
}

export function applyReorderClasses(
  prev: GradebookStoreState,
  fromIndex: number,
  toIndex: number
): GradebookStoreState {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= prev.classes.length ||
    toIndex >= prev.classes.length ||
    fromIndex === toIndex
  ) {
    return prev;
  }

  const nextClasses = [...prev.classes];
  const [moved] = nextClasses.splice(fromIndex, 1);
  nextClasses.splice(toIndex, 0, moved);
  const now = new Date().toISOString();

  const normalized = nextClasses.map((cls, idx) => {
    const prevOrder = cls.order;
    const orderChanged = prevOrder !== idx;
    if (cls.id === moved.id || orderChanged) {
      return {
        ...cls,
        order: idx,
        updatedAt: now,
      };
    }
    return cls;
  });

  return {
    ...prev,
    classes: normalized,
    auditLog: [
      makeLog(
        moved.id,
        moved.name,
        'classe',
        'Riordino classi',
        `Spostata classe "${moved.name}" dalla posizione ${fromIndex + 1} alla posizione ${toIndex + 1}.`
      ),
      ...prev.auditLog,
    ],
  };
}

export function useGradebookStore() {
  // Always start with an in-memory placeholder shell while IndexedDB hydrates.
  // Never generate or write demo data synchronously before reading IndexedDB.
  const [storeRecord, setStoreRecord] = useState<{
    state: GradebookStoreState;
    history: StoreHistoryState;
  }>(() => ({
    state: createEmptyShellState(),
    history: EMPTY_STORE_HISTORY,
  }));
  const [storageReady, setStorageReady] = useState<boolean>(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState<number>(0);
  const [storageEngine, setStorageEngine] = useState<PersistenceEngine>(() =>
    isIndexedDbAvailable() ? 'indexeddb' : 'localstorage'
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const state = storeRecord.state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const canPersistRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueuePersist = useCallback((nextState: GradebookStoreState) => {
    if (!canPersistRef.current) return;
    persistQueueRef.current = persistQueueRef.current
      .then(async () => {
        const res = await persistArchiveLocally(nextState);
        if (res.ok) {
          setStorageEngine(res.engine);
          setLastSavedAt(res.savedAt);
          setStorageError(null);
        } else if (res.error) {
          setStorageError(res.error);
        }
      })
      .catch(() => {
        setStorageError(
          'Errore durante il salvataggio locale dei dati sul dispositivo.'
        );
      });
  }, []);

  useEffect(() => {
    let active = true;
    canPersistRef.current = false;
    setStorageReady(false);
    setHydrationError(null);

    void requestPersistentStorageBestEffort();
    void hydrateLocalArchive()
      .then((res) => {
        if (!active) return;
        setStorageEngine(res.engine);
        if (res.savedAt) {
          setLastSavedAt(res.savedAt);
        }
        if (res.warning) {
          setStorageError(res.warning);
        }
        // Restore last viewed class from UI session state in memory without modifying the school archive
        const savedUiSession = loadUiSession();
        const restoredActiveClassId =
          savedUiSession.activeClassId &&
          res.state.classes.some((c) => c.id === savedUiSession.activeClassId)
            ? savedUiSession.activeClassId
            : res.state.activeClassId;
        const hydratedState =
          restoredActiveClassId !== res.state.activeClassId
            ? { ...res.state, activeClassId: restoredActiveClassId }
            : res.state;

        stateRef.current = hydratedState;
        setStoreRecord({
          state: hydratedState,
          history: EMPTY_STORE_HISTORY,
        });
        canPersistRef.current = true;
        setHydrationError(null);
        setStorageReady(true);
      })
      .catch((err) => {
        if (!active) return;
        canPersistRef.current = false;
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Impossibile caricare i dati salvati da IndexedDB. I dati esistenti non sono stati cancellati.';
        setHydrationError(message);
        setStorageReady(true);
      });

    return () => {
      active = false;
    };
  }, [hydrationAttempt]);

  // Emergency save on tab close / reload / app backgrounding
  useEffect(() => {
    const flushNow = () => {
      if (!canPersistRef.current) return;
      flushArchiveEmergencySync(stateRef.current);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushNow();
      }
    };

    window.addEventListener('beforeunload', flushNow);
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', flushNow);
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const retryHydration = useCallback(() => {
    setHydrationAttempt((n) => n + 1);
  }, []);

  const clearStorageError = useCallback(() => setStorageError(null), []);

  const commit = useCallback(
    (
      updater: (prev: GradebookStoreState) => GradebookStoreState,
      options?: {
        recordHistory?: boolean;
        label?: string;
        coalesceKey?: string;
      }
    ) => {
      if (!canPersistRef.current) return;
      const recordHistory = options?.recordHistory !== false;
      setStoreRecord((prev) => {
        const rawNext = updater(prev.state);
        if (rawNext === prev.state) return prev;
        const next =
          rawNext.auditLog.length > 500
            ? { ...rawNext, auditLog: rawNext.auditLog.slice(0, 500) }
            : rawNext;
        stateRef.current = next;
        enqueuePersist(next);
        const nextHistory = recordHistory
          ? pushHistoryEntry(prev.history, prev.state, next, {
              label: options?.label,
              coalesceKey: options?.coalesceKey,
            })
          : prev.history;
        return {
          state: next,
          history: nextHistory,
        };
      });
    },
    [enqueuePersist]
  );

  const undo = useCallback(() => {
    if (!canPersistRef.current) return;
    setStoreRecord((prev) => {
      const result = applyUndoHistory(prev.state, prev.history);
      if (!result) return prev;
      stateRef.current = result.state;
      enqueuePersist(result.state);
      return {
        state: result.state,
        history: result.history,
      };
    });
  }, [enqueuePersist]);

  const redo = useCallback(() => {
    if (!canPersistRef.current) return;
    setStoreRecord((prev) => {
      const result = applyRedoHistory(prev.state, prev.history);
      if (!result) return prev;
      stateRef.current = result.state;
      enqueuePersist(result.state);
      return {
        state: result.state,
        history: result.history,
      };
    });
  }, [enqueuePersist]);

  const canUndo = storeRecord.history.past.length > 0;
  const canRedo = storeRecord.history.future.length > 0;
  const undoLabel = canUndo
    ? storeRecord.history.past[storeRecord.history.past.length - 1].label
    : null;
  const redoLabel = canRedo
    ? storeRecord.history.future[storeRecord.history.future.length - 1].label
    : null;

  const activeClass = useMemo(
    () =>
      state.classes.find((c) => c.id === state.activeClassId) ??
      state.classes[0] ??
      null,
    [state.classes, state.activeClassId]
  );

  // --- CLASS OPERATIONS ---
  const setActiveClass = useCallback(
    (classId: string) => {
      updateUiSession(
        (prev) =>
          prev.activeClassId === classId ? prev : { ...prev, activeClassId: classId },
        { immediate: true }
      );
      commit(
        (prev) => {
          if (prev.activeClassId === classId) return prev;
          return {
            ...prev,
            activeClassId: classId,
          };
        },
        { recordHistory: false }
      );
    },
    [commit]
  );

  const createClass = useCallback(
    (input: CreateClassInput) => {
      const createdId = createId('cls');
      commit((prev) => applyCreateClass(prev, input, createdId));
      return createdId;
    },
    [commit]
  );

  const updateClass = useCallback(
    (
      classId: string,
      input: { name: string; schoolYear: string; color?: string }
    ) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        const nextName = input.name.trim();
        return {
          ...prev,
          classes: prev.classes.map((c) => {
            if (c.id !== classId) return c;
            const nextClass: ClassData = {
              ...c,
              name: nextName,
              schoolYear: input.schoolYear.trim(),
              color: input.color ?? c.color,
              updatedAt: new Date().toISOString(),
            };
            delete nextClass.subject;
            return nextClass;
          }),
          auditLog: [
            makeLog(
              classId,
              nextName,
              'classe',
              'Modifica classe',
              `Aggiornati dati classe "${target.name}" → "${nextName}".`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const reorderClasses = useCallback(
    (fromIndex: number, toIndex: number) => {
      commit((prev) => applyReorderClasses(prev, fromIndex, toIndex));
    },
    [commit]
  );

  const deleteClass = useCallback(
    (classId: string) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        const hasOrders = prev.classes.some(
          (c) => typeof c.order === 'number' && Number.isFinite(c.order)
        );
        const remaining = prev.classes
          .filter((c) => c.id !== classId)
          .map((c, idx) => (hasOrders ? { ...c, order: idx } : c));
        const nextActive =
          prev.activeClassId === classId
            ? remaining[0]?.id ?? null
            : prev.activeClassId;
        return {
          ...prev,
          activeClassId: nextActive,
          classes: remaining,
          auditLog: [
            makeLog(
              classId,
              target.name,
              'classe',
              'Eliminazione classe',
              `Eliminata classe "${target.name}" (${target.students.length} studenti, ${target.plates.length} tavole).`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  // --- STUDENT OPERATIONS ---
  const addStudent = useCallback(
    (
      classId: string,
      input: {
        lastName: string;
        firstName: string;
        supportNeeds?: StudentSupportTag[];
        exemptFromPenalties?: boolean;
      }
    ) => {
      const normalizedTags: StudentSupportTag[] = (['DSA', 'BES', 'H'] as const).filter(
        (tag) => input.supportNeeds?.includes(tag)
      );
      const effectiveExempt =
        normalizedTags.length > 0 && Boolean(input.exemptFromPenalties);
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        const maxOrder = target.students.reduce(
          (max, s) => Math.max(max, s.order),
          -1
        );
        const student: Student = {
          id: createId('stu'),
          lastName: input.lastName.trim(),
          firstName: input.firstName.trim(),
          order: maxOrder + 1,
          ...(normalizedTags.length > 0 ? { supportNeeds: normalizedTags } : {}),
          ...(effectiveExempt ? { exemptFromPenalties: true } : {}),
        };
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  students: [...c.students, student],
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'studente',
              'Inserimento studente',
              `Aggiunto studente: ${student.lastName} ${student.firstName}${
                normalizedTags.length > 0
                  ? ` (${normalizedTags.join(', ')}${
                      effectiveExempt ? ', esente penalità' : ''
                    })`
                  : ''
              }.`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const importStudents = useCallback(
    (
      classId: string,
      entries: Array<{ lastName: string; firstName: string }>,
      sourceFileName?: string
    ) => {
      if (entries.length === 0) return;
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;

        const existingKeys = new Set(
          target.students.map((s) =>
            buildStudentDedupeKey(s.lastName, s.firstName)
          )
        );
        const batchKeys = new Set<string>();
        const cleanEntries: Array<{ lastName: string; firstName: string }> = [];

        for (const raw of entries) {
          const lastName = normalizeNameValue(raw.lastName);
          const firstName = normalizeNameValue(raw.firstName);
          if (!lastName && !firstName) continue;
          const key = buildStudentDedupeKey(lastName, firstName);
          if (existingKeys.has(key) || batchKeys.has(key)) continue;
          batchKeys.add(key);
          cleanEntries.push({ lastName, firstName });
        }

        if (cleanEntries.length === 0) return prev;

        const sortedNew = sortStudentsAlphabeticallyIt(cleanEntries);
        const maxOrder = target.students.reduce(
          (max, s) => Math.max(max, s.order),
          -1
        );

        const newStudents: Student[] = sortedNew.map((entry, idx) => ({
          id: createId('stu'),
          lastName: entry.lastName,
          firstName: entry.firstName,
          order: maxOrder + 1 + idx,
        }));

        const now = new Date().toISOString();
        const fileLabel = sourceFileName?.trim()
          ? ` da "${sourceFileName.trim()}"`
          : '';

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  students: [...c.students, ...newStudents],
                  updatedAt: now,
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'studente',
              'Importazione elenco studenti',
              `Importati ${newStudents.length} ${
                newStudents.length === 1 ? 'studente' : 'studenti'
              }${fileLabel} in ordine alfabetico.`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const updateStudent = useCallback(
    (
      classId: string,
      studentId: string,
      input: {
        lastName: string;
        firstName: string;
        supportNeeds?: StudentSupportTag[];
        exemptFromPenalties?: boolean;
      }
    ) => {
      const normalizedTags: StudentSupportTag[] = (['DSA', 'BES', 'H'] as const).filter(
        (tag) => input.supportNeeds?.includes(tag)
      );
      const effectiveExempt =
        normalizedTags.length > 0 && Boolean(input.exemptFromPenalties);
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const stu = target?.students.find((s) => s.id === studentId);
        if (!target || !stu) return prev;
        const nextLast = input.lastName.trim();
        const nextFirst = input.firstName.trim();
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  students: c.students.map((s) => {
                    if (s.id !== studentId) return s;
                    const updated: Student = {
                      ...s,
                      lastName: nextLast,
                      firstName: nextFirst,
                    };
                    if (normalizedTags.length > 0) {
                      updated.supportNeeds = normalizedTags;
                    } else {
                      delete updated.supportNeeds;
                    }
                    if (effectiveExempt) {
                      updated.exemptFromPenalties = true;
                    } else {
                      delete updated.exemptFromPenalties;
                    }
                    return updated;
                  }),
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'studente',
              'Modifica studente',
              `Aggiornato "${stu.lastName} ${stu.firstName}" → "${nextLast} ${nextFirst}"${
                normalizedTags.length > 0
                  ? ` (${normalizedTags.join(', ')}${
                      effectiveExempt ? ', esente penalità' : ''
                    })`
                  : ''
              }.`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const deleteStudent = useCallback(
    (classId: string, studentId: string) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const stu = target?.students.find((s) => s.id === studentId);
        if (!target || !stu) return prev;
        const nextEvals = { ...target.evaluations };
        delete nextEvals[studentId];
        const nextFolderRecords = { ...target.folderRecords };
        delete nextFolderRecords[studentId];

        const reindexed = target.students
          .filter((s) => s.id !== studentId)
          .sort((a, b) => a.order - b.order)
          .map((s, idx) => ({ ...s, order: idx }));

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  students: reindexed,
                  evaluations: nextEvals,
                  folderRecords: nextFolderRecords,
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'studente',
              'Eliminazione studente',
              `Eliminato studente: ${stu.lastName} ${stu.firstName}.`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const reorderStudent = useCallback(
    (classId: string, fromIndex: number, toIndex: number) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        const sorted = [...target.students].sort((a, b) => a.order - b.order);
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= sorted.length ||
          toIndex >= sorted.length ||
          fromIndex === toIndex
        ) {
          return prev;
        }
        const [moved] = sorted.splice(fromIndex, 1);
        sorted.splice(toIndex, 0, moved);
        const reindexed = sorted.map((s, idx) => ({ ...s, order: idx }));
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  students: reindexed,
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'studente',
              'Riordino studenti',
              `Spostato "${moved.lastName} ${moved.firstName}" dalla posizione ${fromIndex + 1} alla ${toIndex + 1}.`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );


  const moveStudentToClass = useCallback(
    (
      sourceClassId: string,
      studentId: string,
      targetClassId: string,
      latestIdentity?: {
        lastName: string;
        firstName: string;
        supportNeeds?: StudentSupportTag[];
        exemptFromPenalties?: boolean;
      }
    ) => {
      if (sourceClassId === targetClassId) return;
      commit((prev) => {
        const sourceClass = prev.classes.find((c) => c.id === sourceClassId);
        const targetClass = prev.classes.find((c) => c.id === targetClassId);
        const stu = sourceClass?.students.find((s) => s.id === studentId);
        if (!sourceClass || !targetClass || !stu) return prev;

        const nextLast = (
          latestIdentity ? latestIdentity.lastName : stu.lastName
        ).trim();
        const nextFirst = (
          latestIdentity ? latestIdentity.firstName : stu.firstName
        ).trim();
        const rawTags = latestIdentity
          ? latestIdentity.supportNeeds
          : stu.supportNeeds;
        const normalizedTags: StudentSupportTag[] = (
          ['DSA', 'BES', 'H'] as const
        ).filter((tag) => rawTags?.includes(tag));
        const rawExempt =
          latestIdentity && latestIdentity.exemptFromPenalties !== undefined
            ? latestIdentity.exemptFromPenalties
            : stu.exemptFromPenalties;
        const effectiveExempt = normalizedTags.length > 0 && Boolean(rawExempt);

        const now = new Date().toISOString();
        const sourceEvaluations = sourceClass.evaluations[studentId] ?? {};
        const sourceFolderRecords = sourceClass.folderRecords[studentId] ?? {};

        const plateSnapshots = sortPlates(sourceClass.plates)
          .map((p) => {
            const cell = sourceEvaluations[p.id];
            if (!cell) return null;
            if (cell.status === null && cell.grade === null && !cell.wasNo) {
              return null;
            }
            return {
              plateId: p.id,
              plateNumber: p.number,
              plateTitle: p.title,
              status: cell.status,
              grade: cell.grade,
              wasNo: cell.wasNo,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        const folderSnapshots = sourceClass.folders
          .map((f) => {
            const rec = sourceFolderRecords[f.id];
            const calc = calculateFolderEvaluation(sourceClass, studentId, f);
            if (!rec && calc.finalGrade === null && calc.gradedCount === 0) {
              return null;
            }
            return {
              folderId: f.id,
              folderTitle: f.title,
              status: rec?.status ?? EMPTY_FOLDER_RECORD.status,
              actualDeliveryDate: rec?.actualDeliveryDate ?? '',
              manualDelayDays: calc.chargeableDelayDays,
              finalGrade: calc.finalGrade,
              isConfirmed: calc.isConfirmed,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        const transferRecord: StudentTransferRecord = {
          id: createId('trf'),
          fromClassId: sourceClass.id,
          fromClassName: sourceClass.name,
          toClassId: targetClass.id,
          toClassName: targetClass.name,
          movedAt: now,
          plates: plateSnapshots,
          folders: folderSnapshots,
        };

        const archivedEntry: ArchivedStudentHistory = {
          studentId: stu.id,
          lastName: nextLast,
          firstName: nextFirst,
          ...(normalizedTags.length > 0 ? { supportNeeds: normalizedTags } : {}),
          ...(effectiveExempt ? { exemptFromPenalties: true } : {}),
          movedAt: now,
          toClassId: targetClass.id,
          toClassName: targetClass.name,
          evaluations: { ...sourceEvaluations },
          folderRecords: { ...sourceFolderRecords },
        };

        const reindexedSourceStudents = sourceClass.students
          .filter((s) => s.id !== studentId)
          .sort((a, b) => a.order - b.order)
          .map((s, idx) => ({ ...s, order: idx }));

        const hasTargetIdCollision = targetClass.students.some(
          (s) => s.id === stu.id
        );
        const targetStudentId = hasTargetIdCollision ? createId('stu') : stu.id;
        const targetMaxOrder = targetClass.students.reduce(
          (max, s) => Math.max(max, s.order),
          -1
        );

        const movedStudent: Student = {
          id: targetStudentId,
          lastName: nextLast,
          firstName: nextFirst,
          order: targetMaxOrder + 1,
          ...(normalizedTags.length > 0 ? { supportNeeds: normalizedTags } : {}),
          ...(effectiveExempt ? { exemptFromPenalties: true } : {}),
          transferHistory: [...(stu.transferHistory ?? []), transferRecord],
        };

        const fullName = `${nextLast} ${nextFirst}`.trim();

        return {
          ...prev,
          classes: prev.classes.map((c) => {
            if (c.id === sourceClassId) {
              return {
                ...c,
                students: reindexedSourceStudents,
                archivedStudentHistories: [
                  ...(c.archivedStudentHistories ?? []),
                  archivedEntry,
                ],
                updatedAt: now,
              };
            }
            if (c.id === targetClassId) {
              return {
                ...c,
                students: [...c.students, movedStudent],
                updatedAt: now,
              };
            }
            return c;
          }),
          auditLog: [
            makeLog(
              targetClass.id,
              targetClass.name,
              'studente',
              'Spostamento studente',
              `Trasferito "${fullName}" da "${sourceClass.name}" a "${targetClass.name}" (${plateSnapshots.length} valutazioni tavole e ${folderSnapshots.length} cartelline conservate nello storico).`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  // --- PLATE OPERATIONS ---
  const addPlate = useCallback(
    (
      classId: string,
      input: Omit<Plate, 'id'>
    ) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        const maxOrder = target.plates.reduce(
          (max, p, idx) => Math.max(max, p.order ?? idx),
          -1
        );
        const plate: Plate = {
          id: createId('plt'),
          number: input.number,
          order: maxOrder + 1,
          title: input.title.trim(),
          assignedDate: input.assignedDate,
          dueDate: input.dueDate,
          notes: input.notes.trim(),
        };
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  plates: [...c.plates, plate],
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'tavola',
              'Nuova tavola',
              `Aggiunta Tavola ${plate.number}: "${plate.title}".`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const updatePlate = useCallback(
    (classId: string, plateId: string, input: Omit<Plate, 'id'>) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const existing = target?.plates.find((p) => p.id === plateId);
        if (!target || !existing) return prev;
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  plates: c.plates.map((p) =>
                    p.id === plateId
                      ? {
                          ...p,
                          number: input.number,
                          title: input.title.trim(),
                          assignedDate: input.assignedDate,
                          dueDate: input.dueDate,
                          notes: input.notes.trim(),
                        }
                      : p
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'tavola',
              'Modifica tavola',
              `Aggiornata Tavola ${input.number}: "${input.title.trim()}" (dati studenti preservati).`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const deletePlate = useCallback(
    (classId: string, plateId: string) => {
      commit((prev) => applyDeletePlate(prev, classId, plateId));
    },
    [commit]
  );

  const updatePlateTitle = useCallback(
    (classId: string, plateId: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      if (!trimmed) return;
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const existing = target?.plates.find((p) => p.id === plateId);
        if (!target || !existing || existing.title === trimmed) return prev;
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  plates: c.plates.map((p) =>
                    p.id === plateId ? { ...p, title: trimmed } : p
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'tavola',
              'Rinomina tavola',
              `Tavola ${existing.number}: "${existing.title}" → "${trimmed}".`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const updatePlateImage = useCallback(
    (
      classId: string,
      plateId: string,
      image: { dataUrl: string; fileName: string } | null
    ): boolean => {
      const current = stateRef.current;
      const target = current.classes.find((c) => c.id === classId);
      const existing = target?.plates.find((p) => p.id === plateId);
      if (!target || !existing) return true;
      if (!image && !existing.imageDataUrl) return true;
      if (
        image &&
        existing.imageDataUrl === image.dataUrl &&
        existing.imageName === image.fileName
      ) {
        return true;
      }

      const isPdf = Boolean(
        image?.dataUrl.startsWith('data:application/pdf')
      );
      const actionLabel = !image
        ? 'Rimozione allegato tavola'
        : existing.imageDataUrl
        ? isPdf
          ? 'Sostituzione PDF tavola'
          : 'Sostituzione immagine tavola'
        : isPdf
        ? 'Caricamento PDF tavola'
        : 'Caricamento immagine tavola';

      const nextState: GradebookStoreState = {
        ...current,
        classes: current.classes.map((c) =>
          c.id === classId
            ? {
                ...c,
                plates: c.plates.map((p) => {
                  if (p.id !== plateId) return p;
                  if (image) {
                    return {
                      ...p,
                      imageDataUrl: image.dataUrl,
                      imageName: image.fileName,
                    };
                  }
                  const rest = { ...p };
                  delete rest.imageDataUrl;
                  delete rest.imageName;
                  return rest;
                }),
                updatedAt: new Date().toISOString(),
              }
            : c
        ),
        auditLog: [
          makeLog(
            classId,
            target.name,
            'tavola',
            actionLabel,
            image
              ? `Tavola ${existing.number}: associato ${isPdf ? 'PDF' : 'allegato'} "${image.fileName}".`
              : `Tavola ${existing.number}: rimosso allegato di anteprima.`
          ),
          ...current.auditLog,
        ].slice(0, 500),
      };

      if (!canPersistRef.current) return false;
      stateRef.current = nextState;
      enqueuePersist(nextState);
      setStoreRecord((prev) => ({
        state: nextState,
        history: pushHistoryEntry(prev.history, prev.state, nextState, {
          label: actionLabel,
        }),
      }));
      return true;
    },
    [enqueuePersist]
  );

  const importPlatesFromClass = useCallback(
    (
      targetClassId: string,
      sourceClassId: string,
      mode: PlateImportMode,
      includeAttachments = false
    ): PlateImportResult => {
      if (!canPersistRef.current) {
        return {
          ok: false,
          importedCount: 0,
          skippedCount: 0,
          error: 'Archivio locale non ancora pronto. Riprova tra un istante.',
        };
      }
      const current = stateRef.current;
      const { nextState, result } = applyImportPlatesFromClass(current, {
        targetClassId,
        sourceClassId,
        mode,
        includeAttachments,
      });
      if (!result.ok) {
        return result;
      }
      stateRef.current = nextState;
      enqueuePersist(nextState);
      setStoreRecord((prev) => ({
        state: nextState,
        history: pushHistoryEntry(prev.history, prev.state, nextState),
      }));
      return result;
    },
    [enqueuePersist]
  );

  const importPlatesFromFile = useCallback(
    (
      targetClassId: string,
      entries: ExternalPlateEntry[],
      mode: PlateImportMode,
      sourceFileName?: string
    ): PlateImportResult => {
      if (!canPersistRef.current) {
        return {
          ok: false,
          importedCount: 0,
          skippedCount: 0,
          error: 'Archivio locale non ancora pronto. Riprova tra un istante.',
        };
      }
      const current = stateRef.current;
      const { nextState, result } = applyImportPlatesFromExternalList(current, {
        targetClassId,
        entries,
        mode,
        sourceFileName,
      });
      if (!result.ok) {
        return result;
      }
      stateRef.current = nextState;
      enqueuePersist(nextState);
      setStoreRecord((prev) => ({
        state: nextState,
        history: pushHistoryEntry(prev.history, prev.state, nextState),
      }));
      return result;
    },
    [enqueuePersist]
  );

  const reorderPlate = useCallback(
    (classId: string, plateId: string, direction: 'left' | 'right') => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        const sorted = sortPlates(target.plates);
        const idx = sorted.findIndex((p) => p.id === plateId);
        if (idx === -1) return prev;
        const swapIdx = direction === 'left' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= sorted.length) return prev;

        const copy = [...sorted];
        const [moved] = copy.splice(idx, 1);
        copy.splice(swapIdx, 0, moved);
        const reindexed = copy.map((p, i) => ({ ...p, order: i }));

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  plates: reindexed,
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'tavola',
              'Riordino tavole',
              `Spostata Tavola ${moved.number} ("${moved.title}") dalla posizione ${idx + 1} alla ${swapIdx + 1}.`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  // --- CELL EVALUATION (INDEPENDENT STATUS & GRADE) ---
  const setCellEvaluation = useCallback(
    (
      classId: string,
      studentId: string,
      plateId: string,
      patch: Partial<PlateEvaluation> & { explicitWasNo?: boolean }
    ) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const stu = target?.students.find((s) => s.id === studentId);
        const plate = target?.plates.find((p) => p.id === plateId);
        if (!target || !stu || !plate) return prev;

        const prevCell = target.evaluations[studentId]?.[plateId] ?? EMPTY_EVALUATION;

        const nextStatus: PlateStatus | null =
          patch.status !== undefined ? patch.status : prevCell.status;
        const nextGrade: number | null =
          patch.grade !== undefined ? patch.grade : prevCell.grade;

        let nextWasNo = prevCell.wasNo;
        if (patch.explicitWasNo !== undefined) {
          nextWasNo = patch.explicitWasNo;
        } else if (patch.status !== undefined) {
          if (patch.status === 'NO') {
            nextWasNo = true;
          } else if (patch.status === 'SI') {
            // When recovering from NO -> SI, keep wasNo = true so the NO penalty persists
            // while removing the "missing at final delivery" penalty.
            // When recovering from ASS -> SI or WIP -> SI, wasNo stays false.
            nextWasNo = prevCell.wasNo;
          } else {
            // ASS, WIP, or null must never carry any NO penalty.
            nextWasNo = false;
          }
        }

        const nextCell: PlateEvaluation = {
          status: nextStatus,
          grade: nextGrade,
          wasNo: nextWasNo,
        };

        const changes: string[] = [];
        if (nextStatus !== prevCell.status) {
          changes.push(`Stato: ${prevCell.status ?? '—'} → ${nextStatus ?? '—'}`);
        }
        if (nextGrade !== prevCell.grade) {
          changes.push(
            `Voto: ${formatGradeLabel(prevCell.grade)} → ${formatGradeLabel(nextGrade)}`
          );
        }
        if (nextWasNo !== prevCell.wasNo && patch.explicitWasNo !== undefined) {
          changes.push(`Storico NO: ${nextWasNo ? 'attivo' : 'rimosso'}`);
        }
        if (changes.length === 0) return prev;

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  evaluations: {
                    ...c.evaluations,
                    [studentId]: {
                      ...(c.evaluations[studentId] ?? {}),
                      [plateId]: nextCell,
                    },
                  },
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'valutazione',
              `Valutazione T${plate.number} (${stu.lastName} ${stu.firstName})`,
              changes.join(' · ')
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  // --- FOLDER DELIVERY (CARTELLINA) OPERATIONS ---
  const addFolder = useCallback(
    (classId: string, input: Omit<FolderDelivery, 'id'>) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        const folder: FolderDelivery = {
          id: createId('fld'),
          title: input.title.trim(),
          dueDate: input.dueDate,
          plateIds: Array.from(new Set(input.plateIds)),
          notes: input.notes.trim(),
        };
        const interval = formatPlateInterval(folder.plateIds, target.plates);
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  folders: [...c.folders, folder],
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'cartellina',
              'Nuova consegna cartellina',
              `Creata "${folder.title}" (${interval}, scadenza ${folder.dueDate || 'non impostata'}).`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const updateFolder = useCallback(
    (classId: string, folderId: string, input: Omit<FolderDelivery, 'id'>) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const existing = target?.folders.find((f) => f.id === folderId);
        if (!target || !existing) return prev;
        const uniquePlates = Array.from(new Set(input.plateIds));
        const interval = formatPlateInterval(uniquePlates, target.plates);
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  folders: c.folders.map((f) =>
                    f.id === folderId
                      ? {
                          ...f,
                          title: input.title.trim(),
                          dueDate: input.dueDate,
                          plateIds: uniquePlates,
                          notes: input.notes.trim(),
                        }
                      : f
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'cartellina',
              'Modifica consegna cartellina',
              `Aggiornata "${input.title.trim()}" (${interval}, scadenza ${input.dueDate || 'non impostata'}).`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const deleteFolder = useCallback(
    (classId: string, folderId: string) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const folder = target?.folders.find((f) => f.id === folderId);
        if (!target || !folder) return prev;

        const nextRecords: ClassData['folderRecords'] = {};
        for (const [stuId, recMap] of Object.entries(target.folderRecords)) {
          const copy = { ...recMap };
          delete copy[folderId];
          nextRecords[stuId] = copy;
        }

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  folders: c.folders.filter((f) => f.id !== folderId),
                  folderRecords: nextRecords,
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'cartellina',
              'Eliminazione cartellina',
              `Eliminata consegna "${folder.title}".`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const updateFolderStudentRecord = useCallback(
    (
      classId: string,
      studentId: string,
      folderId: string,
      patch: {
        actualDeliveryDate?: string;
        manualDelayDays?: number;
        manualFinalGrade?: number | null;
        manualGradeOverridden?: boolean;
        status?: FolderDeliveryStatus;
        notes?: string;
        extraMissingPlateIds?: string[];
      }
    ) => {
      const patchKeys = Object.keys(patch).filter(
        (k) => patch[k as keyof typeof patch] !== undefined
      );
      const isNotesOnlyPatch =
        patchKeys.length === 1 && patchKeys[0] === 'notes';
      commit(
        (prev) => {
          const target = prev.classes.find((c) => c.id === classId);
          const stu = target?.students.find((s) => s.id === studentId);
          const folder = target?.folders.find((f) => f.id === folderId);
          if (!target || !stu || !folder) return prev;

          const prevRec =
            target.folderRecords[studentId]?.[folderId] ?? EMPTY_FOLDER_RECORD;
          if (prevRec.confirmedSnapshot) {
            // Confirmed evaluations are locked until explicitly reopened
            return prev;
          }

          const sanitizedPatch = { ...patch };
          if (sanitizedPatch.manualDelayDays !== undefined) {
            sanitizedPatch.manualDelayDays = Math.min(
              10,
              Math.max(0, Math.floor(sanitizedPatch.manualDelayDays || 0))
            );
            if (
              sanitizedPatch.status === undefined &&
              sanitizedPatch.manualDelayDays > 0 &&
              prevRec.status === 'da_consegnare'
            ) {
              sanitizedPatch.status = 'consegnata_ritardo';
            }
          }
          if (
            sanitizedPatch.manualFinalGrade !== undefined &&
            sanitizedPatch.manualGradeOverridden === undefined
          ) {
            sanitizedPatch.manualGradeOverridden =
              sanitizedPatch.manualFinalGrade !== null;
          }

          const nextRec = {
            ...prevRec,
            ...sanitizedPatch,
          };

          const detailsParts = [
            `Stato: ${nextRec.status}`,
            `Data: ${nextRec.actualDeliveryDate || '—'}`,
            `Ritardo: ${nextRec.manualDelayDays ?? 0} gg`,
          ];
          if (
            nextRec.manualGradeOverridden &&
            nextRec.manualFinalGrade !== undefined &&
            nextRec.manualFinalGrade !== null
          ) {
            detailsParts.push(
              `Voto manuale: ${formatGradeLabel(nextRec.manualFinalGrade)}`
            );
          }

          return {
            ...prev,
            classes: prev.classes.map((c) =>
              c.id === classId
                ? {
                    ...c,
                    folderRecords: {
                      ...c.folderRecords,
                      [studentId]: {
                        ...(c.folderRecords[studentId] ?? {}),
                        [folderId]: nextRec,
                      },
                    },
                    updatedAt: new Date().toISOString(),
                  }
                : c
            ),
            auditLog: [
              makeLog(
                classId,
                target.name,
                'cartellina',
                `Aggiornamento ${folder.title} (${stu.lastName} ${stu.firstName})`,
                `${detailsParts.join(' · ')}.`
              ),
              ...prev.auditLog,
            ],
          };
        },
        isNotesOnlyPatch
          ? { coalesceKey: `folder-notes:${classId}:${studentId}:${folderId}` }
          : undefined
      );
    },
    [commit]
  );

  const confirmStudentFolder = useCallback(
    (classId: string, studentId: string, folderId: string) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const stu = target?.students.find((s) => s.id === studentId);
        const folder = target?.folders.find((f) => f.id === folderId);
        if (!target || !stu || !folder) return prev;

        const prevRec =
          target.folderRecords[studentId]?.[folderId] ?? EMPTY_FOLDER_RECORD;
        const live = computeLiveFolderEvaluation(
          target,
          studentId,
          folder,
          target.settings
        );
        const now = new Date().toISOString();
        const snapshot = {
          ...live,
          isConfirmed: true,
          confirmedAt: now,
        };

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  folderRecords: {
                    ...c.folderRecords,
                    [studentId]: {
                      ...(c.folderRecords[studentId] ?? {}),
                      [folderId]: {
                        ...prevRec,
                        confirmedSnapshot: snapshot,
                      },
                    },
                  },
                  updatedAt: now,
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'cartellina',
              `Conferma ${folder.title} (${stu.lastName} ${stu.firstName})`,
              `Valutazione bloccata a ${formatGradeLabel(snapshot.finalGrade)} (non modificabile da future variazioni impostazioni).`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const reopenStudentFolder = useCallback(
    (classId: string, studentId: string, folderId: string) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const stu = target?.students.find((s) => s.id === studentId);
        const folder = target?.folders.find((f) => f.id === folderId);
        if (!target || !stu || !folder) return prev;

        const prevRec =
          target.folderRecords[studentId]?.[folderId] ?? EMPTY_FOLDER_RECORD;

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  folderRecords: {
                    ...c.folderRecords,
                    [studentId]: {
                      ...(c.folderRecords[studentId] ?? {}),
                      [folderId]: {
                        ...prevRec,
                        confirmedSnapshot: null,
                      },
                    },
                  },
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'cartellina',
              `Riapertura ${folder.title} (${stu.lastName} ${stu.firstName})`,
              `Valutazione sbloccata: ricalcolo dinamico con i parametri attuali della classe.`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const confirmAllStudentsInFolder = useCallback(
    (classId: string, folderId: string) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const folder = target?.folders.find((f) => f.id === folderId);
        if (!target || !folder) return prev;

        const now = new Date().toISOString();
        const nextFolderRecords = { ...target.folderRecords };

        for (const stu of target.students) {
          const prevRec = nextFolderRecords[stu.id]?.[folderId] ?? EMPTY_FOLDER_RECORD;
          if (!prevRec.confirmedSnapshot) {
            const live = computeLiveFolderEvaluation(
              target,
              stu.id,
              folder,
              target.settings
            );
            nextFolderRecords[stu.id] = {
              ...(nextFolderRecords[stu.id] ?? {}),
              [folderId]: {
                ...prevRec,
                confirmedSnapshot: {
                  ...live,
                  isConfirmed: true,
                  confirmedAt: now,
                },
              },
            };
          }
        }

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? { ...c, folderRecords: nextFolderRecords, updatedAt: now }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'cartellina',
              `Chiusura e conferma "${folder.title}"`,
              `Confermate e bloccate tutte le valutazioni della classe per "${folder.title}".`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  const reopenAllStudentsInFolder = useCallback(
    (classId: string, folderId: string) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const folder = target?.folders.find((f) => f.id === folderId);
        if (!target || !folder) return prev;

        const nextFolderRecords = { ...target.folderRecords };
        for (const stu of target.students) {
          const prevRec = nextFolderRecords[stu.id]?.[folderId];
          if (prevRec?.confirmedSnapshot) {
            nextFolderRecords[stu.id] = {
              ...(nextFolderRecords[stu.id] ?? {}),
              [folderId]: {
                ...prevRec,
                confirmedSnapshot: null,
              },
            };
          }
        }

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  folderRecords: nextFolderRecords,
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'cartellina',
              `Riapertura "${folder.title}"`,
              `Sbloccate tutte le valutazioni della classe per "${folder.title}".`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  // --- SETTINGS ---
  const updateClassSettings = useCallback(
    (classId: string, settings: ClassSettings) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  settings: { ...settings },
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'impostazioni',
              'Modifica parametri di valutazione',
              `NO: -${settings.penaltyNo.toFixed(2)}, Mancante: -${settings.penaltyMissing.toFixed(2)}, Ritardo: -${settings.penaltyLatePerDay.toFixed(2)}/g (tolleranza ${settings.toleranceDays}g), Arrotondamento: ${settings.roundingMode}.`
            ),
            ...prev.auditLog,
          ],
        };
      });
    },
    [commit]
  );

  // --- IMPORT / EXPORT LOGGING ---
  const importSingleClass = useCallback(
    (archive: SingleClassArchive, mode: 'add_new' | 'replace_existing') => {
      commit((prev) => {
        const incoming = normalizeClassData(archive.classData);
        const existingIndex = prev.classes.findIndex((c) => c.id === incoming.id);
        const exists = existingIndex !== -1;
        let nextClass: ClassData;
        let nextClasses: ClassData[];

        if (mode === 'replace_existing' && exists) {
          const prevOrder = prev.classes[existingIndex].order;
          nextClass = {
            ...incoming,
            ...(typeof prevOrder === 'number' ? { order: prevOrder } : {}),
            updatedAt: new Date().toISOString(),
          };
          nextClasses = prev.classes.map((c) =>
            c.id === incoming.id ? nextClass : c
          );
        } else {
          const newId = exists ? createId('cls') : incoming.id;
          const suffix = exists ? ' (Importata)' : '';
          const maxOrder = prev.classes.reduce(
            (max, c, idx) =>
              Math.max(
                max,
                typeof c.order === 'number' && Number.isFinite(c.order)
                  ? c.order
                  : idx
              ),
            -1
          );
          nextClass = {
            ...incoming,
            id: newId,
            name: `${incoming.name}${suffix}`,
            order: maxOrder + 1,
            updatedAt: new Date().toISOString(),
          };
          nextClasses = [...prev.classes, nextClass];
        }

        const importedLogs = (archive.classAuditLog ?? []).map((l) => ({
          ...l,
          classId: nextClass.id,
        }));

        return {
          ...prev,
          activeClassId: nextClass.id,
          classes: nextClasses,
          auditLog: [
            makeLog(
              nextClass.id,
              nextClass.name,
              'archivio',
              'Importazione classe',
              `Importata classe "${nextClass.name}" (${nextClass.students.length} studenti, ${nextClass.plates.length} tavole).`
            ),
            ...prev.auditLog,
            ...importedLogs.filter(
              (il) => !prev.auditLog.some((pl) => pl.id === il.id)
            ),
          ],
        };
      });
    },
    [commit]
  );

  const importFullBackup = useCallback(
    (backup: FullBackupArchive) => {
      commit((prev) => {
        const normalizedClasses = sortAndNormalizeClasses(backup.classes);
        return {
          version: backup.version ?? prev.version,
          activeClassId: normalizedClasses[0]?.id ?? null,
          classes: normalizedClasses,
          auditLog: [
            makeLog(
              null,
              'Archivio completo',
              'archivio',
              'Ripristino backup completo',
              `Ripristinate ${normalizedClasses.length} classi dal backup del ${backup.exportedAt.slice(0, 10)}.`
            ),
            ...(backup.auditLog ?? []),
          ],
        };
      });
    },
    [commit]
  );

  const recordAuditAction = useCallback(
    (
      classId: string | null,
      className: string,
      category: AuditCategory,
      action: string,
      details: string
    ) => {
      commit(
        (prev) => ({
          ...prev,
          auditLog: [
            makeLog(classId, className, category, action, details),
            ...prev.auditLog,
          ],
        }),
        { recordHistory: false }
      );
    },
    [commit]
  );

  return {
    state,
    storageReady,
    hydrationError,
    retryHydration,
    storageEngine,
    lastSavedAt,
    storageError,
    clearStorageError,
    activeClass,
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    setActiveClass,
    createClass,
    updateClass,
    reorderClasses,
    deleteClass,
    addStudent,
    importStudents,
    updateStudent,
    deleteStudent,
    reorderStudent,
    moveStudentToClass,
    addPlate,
    updatePlate,
    updatePlateTitle,
    updatePlateImage,
    importPlatesFromClass,
    importPlatesFromFile,
    reorderPlate,
    deletePlate,
    setCellEvaluation,
    addFolder,
    updateFolder,
    deleteFolder,
    updateFolderStudentRecord,
    confirmStudentFolder,
    reopenStudentFolder,
    confirmAllStudentsInFolder,
    reopenAllStudentsInFolder,
    updateClassSettings,
    importSingleClass,
    importFullBackup,
    recordAuditAction,
  };
}
