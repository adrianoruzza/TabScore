import type {
  ArchivedStudentHistory,
  AuditLogEntry,
  ClassData,
  ClassSettings,
  FolderDelivery,
  FolderStudentRecord,
  GradebookStoreState,
  Plate,
  PlateEvaluation,
  Student,
  StudentTransferRecord,
} from '../types/gradebook';
import { EMPTY_EVALUATION, EMPTY_FOLDER_RECORD } from '../utils/calculations';

export type SyncDecisionKind =
  | 'up_to_date'
  | 'push_local'
  | 'pull_remote'
  | 'reconcile_both'
  | 'corrupt_remote';

export interface SyncVersionContext {
  localHash: string;
  hasLocalChanges: boolean;
  localVersionSeq: number;
  lastLocalModifiedAt: string | null;
  lastSyncedRemoteRevision: number;
  lastSyncedContentHash: string | null;
  isUntouchedLocalSeed: boolean;
  remotePayload: {
    revision: number;
    contentHash: string;
    updatedAt: string;
    lastEffectiveModifiedAt?: string;
    deviceId: string;
  } | null;
  remoteIntegrityValid: boolean;
}

export interface SyncDecisionResult {
  action: SyncDecisionKind;
  reason: string;
}

export interface MergeResult {
  outcome: 'merged' | 'conflict';
  mergedState?: GradebookStoreState;
  conflicts: string[];
  summaryText?: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return stableStringify(a) === stableStringify(b);
}

function parseIsoMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export function isUntouchedInitialLocalState(
  state: Pick<GradebookStoreState, 'classes' | 'auditLog'>
): boolean {
  if (state.classes.length === 0) return true;
  if (
    state.classes.length === 1 &&
    state.classes[0].id === 'cls_2b_dt' &&
    state.classes[0].createdAt === state.classes[0].updatedAt &&
    state.auditLog.length <= 1 &&
    (!state.auditLog[0] ||
      state.auditLog[0].action === 'Inizializzazione registro')
  ) {
    return true;
  }
  return false;
}

export function getEffectiveArchiveModifiedAt(
  state: Pick<GradebookStoreState, 'classes' | 'auditLog'>,
  fallbackIso?: string | null
): string | null {
  let maxMs = parseIsoMs(fallbackIso);
  let maxIso: string | null = maxMs > 0 ? fallbackIso ?? null : null;

  for (const cls of state.classes) {
    const ms = parseIsoMs(cls.updatedAt);
    if (ms > maxMs) {
      maxMs = ms;
      maxIso = cls.updatedAt;
    }
  }
  if (state.auditLog.length > 0) {
    const logMs = parseIsoMs(state.auditLog[0].timestamp);
    if (logMs > maxMs) {
      maxMs = logMs;
      maxIso = state.auditLog[0].timestamp;
    }
  }
  return maxIso;
}

/**
 * Deterministic version decision engine:
 * Combines content hashes, progressive remote revision numbers, local pending edit flags,
 * untouched initial seed detection, and effective modification timestamps.
 */
export function decideSyncAction(ctx: SyncVersionContext): SyncDecisionResult {
  if (!ctx.remoteIntegrityValid) {
    return {
      action: 'corrupt_remote',
      reason: 'Integrità dell’archivio remoto su Google Drive non valida.',
    };
  }

  const remote = ctx.remotePayload;
  if (!remote) {
    return {
      action: 'push_local',
      reason: 'Nessun archivio presente su Google Drive: caricamento iniziale della versione locale.',
    };
  }

  if (remote.contentHash === ctx.localHash) {
    return {
      action: 'up_to_date',
      reason: 'Archivio locale e versione su Google Drive sono già identici.',
    };
  }

  // Fresh/untouched device connecting to an existing Drive archive -> automatically adopt Drive
  if (ctx.lastSyncedRemoteRevision === 0 && !ctx.lastSyncedContentHash) {
    if (ctx.isUntouchedLocalSeed && !ctx.hasLocalChanges) {
      return {
        action: 'pull_remote',
        reason: 'Dispositivo iniziale senza modifiche utente: adozione automatica della versione presente su Google Drive.',
      };
    }
    return {
      action: 'reconcile_both',
      reason: 'Primo collegamento con dati presenti su entrambi i dispositivi: riconciliazione automatica.',
    };
  }

  const remoteAdvanced = remote.revision !== ctx.lastSyncedRemoteRevision;

  // Only local has pending edits, Drive is still at our last synced revision -> push local
  if (ctx.hasLocalChanges && !remoteAdvanced) {
    return {
      action: 'push_local',
      reason: `Modifiche locali più recenti (rev. locale ${ctx.localVersionSeq}) rispetto a Drive (rev. ${remote.revision}).`,
    };
  }

  // No local pending edits, Drive has a newer revision -> pull Drive automatically
  if (!ctx.hasLocalChanges && remoteAdvanced) {
    return {
      action: 'pull_remote',
      reason: `Versione su Google Drive più recente (rev. ${remote.revision} > base ${ctx.lastSyncedRemoteRevision}) senza modifiche locali pendenti.`,
    };
  }

  // Fallback when both hashes differ despite matching revision counter (e.g. partial crash recovery)
  if (!remoteAdvanced && !ctx.hasLocalChanges) {
    const localMs = parseIsoMs(ctx.lastLocalModifiedAt);
    const remoteMs = parseIsoMs(
      remote.lastEffectiveModifiedAt ?? remote.updatedAt
    );
    if (remoteMs > localMs) {
      return {
        action: 'pull_remote',
        reason: 'Versione su Google Drive con data di modifica effettiva più recente.',
      };
    }
    return {
      action: 'push_local',
      reason: 'Versione locale con stato più recente.',
    };
  }

  // Both devices modified since last common revision -> element-level 3-way reconciliation
  return {
    action: 'reconcile_both',
    reason: `Modifiche concorrenti rilevate (locale + Drive rev. ${remote.revision}): integrazione automatica elemento per elemento.`,
  };
}

function normalizeEvalCell(cell: PlateEvaluation | undefined | null): PlateEvaluation {
  if (!cell) return EMPTY_EVALUATION;
  return {
    status: cell.status ?? null,
    grade: cell.grade ?? null,
    wasNo: Boolean(cell.wasNo),
  };
}

function normalizeFolderRec(
  rec: FolderStudentRecord | undefined | null
): FolderStudentRecord {
  if (!rec) return EMPTY_FOLDER_RECORD;
  return {
    actualDeliveryDate: rec.actualDeliveryDate ?? '',
    manualDelayDays: rec.manualDelayDays ?? 0,
    manualFinalGrade: rec.manualFinalGrade ?? null,
    manualGradeOverridden: Boolean(rec.manualGradeOverridden),
    status: rec.status ?? 'da_consegnare',
    notes: rec.notes ?? '',
    extraMissingPlateIds: Array.isArray(rec.extraMissingPlateIds)
      ? [...rec.extraMissingPlateIds].sort()
      : [],
    confirmedSnapshot: rec.confirmedSnapshot ?? null,
  };
}

function mergeScalar3Way<T>(
  hasBase: boolean,
  baseVal: T | undefined,
  localVal: T,
  remoteVal: T
): { ok: true; value: T } | { ok: false } {
  if (deepEqual(localVal, remoteVal)) {
    return { ok: true, value: localVal };
  }
  if (hasBase) {
    if (deepEqual(localVal, baseVal)) return { ok: true, value: remoteVal };
    if (deepEqual(remoteVal, baseVal)) return { ok: true, value: localVal };
  }
  return { ok: false };
}

function mergeStudentTransferHistories(
  localList: StudentTransferRecord[] | undefined,
  remoteList: StudentTransferRecord[] | undefined
): StudentTransferRecord[] | undefined {
  const combined = [...(remoteList ?? []), ...(localList ?? [])];
  if (combined.length === 0) return undefined;
  const byId = new Map<string, StudentTransferRecord>();
  for (const item of combined) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.movedAt.localeCompare(b.movedAt)
  );
}

function mergeStudent(
  hasBase: boolean,
  base: Student | undefined,
  local: Student,
  remote: Student,
  className: string,
  conflicts: string[]
): Student {
  if (deepEqual(local, remote)) return local;

  const lastNameRes = mergeScalar3Way(
    hasBase,
    base?.lastName,
    local.lastName,
    remote.lastName
  );
  const firstNameRes = mergeScalar3Way(
    hasBase,
    base?.firstName,
    local.firstName,
    remote.firstName
  );
  const needsRes = mergeScalar3Way(
    hasBase,
    base?.supportNeeds ?? [],
    local.supportNeeds ?? [],
    remote.supportNeeds ?? []
  );

  if (!lastNameRes.ok || !firstNameRes.ok || !needsRes.ok) {
    conflicts.push(
      `${className} — Studente "${local.lastName} ${local.firstName}" modificato in modo diverso su entrambi i dispositivi`
    );
  }

  const orderRes = mergeScalar3Way(hasBase, base?.order, local.order, remote.order);
  const mergedOrder = orderRes.ok ? orderRes.value : Math.min(local.order, remote.order);
  const mergedNeeds = needsRes.ok ? needsRes.value : local.supportNeeds ?? [];
  const mergedHistory = mergeStudentTransferHistories(
    local.transferHistory,
    remote.transferHistory
  );

  const out: Student = {
    id: local.id,
    lastName: lastNameRes.ok ? lastNameRes.value : local.lastName,
    firstName: firstNameRes.ok ? firstNameRes.value : local.firstName,
    order: mergedOrder,
  };
  if (mergedNeeds.length > 0) out.supportNeeds = mergedNeeds;
  if (mergedHistory && mergedHistory.length > 0) {
    out.transferHistory = mergedHistory;
  }
  return out;
}

function mergePlate(
  hasBase: boolean,
  base: Plate | undefined,
  local: Plate,
  remote: Plate,
  className: string,
  conflicts: string[]
): Plate {
  if (deepEqual(local, remote)) return local;

  const numberRes = mergeScalar3Way(hasBase, base?.number, local.number, remote.number);
  const titleRes = mergeScalar3Way(hasBase, base?.title, local.title, remote.title);
  const assignedRes = mergeScalar3Way(
    hasBase,
    base?.assignedDate,
    local.assignedDate,
    remote.assignedDate
  );
  const dueRes = mergeScalar3Way(hasBase, base?.dueDate, local.dueDate, remote.dueDate);
  const notesRes = mergeScalar3Way(hasBase, base?.notes, local.notes, remote.notes);
  const imgDataRes = mergeScalar3Way(
    hasBase,
    base?.imageDataUrl,
    local.imageDataUrl,
    remote.imageDataUrl
  );
  const imgNameRes = mergeScalar3Way(
    hasBase,
    base?.imageName,
    local.imageName,
    remote.imageName
  );
  const orderRes = mergeScalar3Way(hasBase, base?.order, local.order, remote.order);

  if (
    !numberRes.ok ||
    !titleRes.ok ||
    !assignedRes.ok ||
    !dueRes.ok ||
    !notesRes.ok ||
    !imgDataRes.ok
  ) {
    conflicts.push(
      `${className} — Tavola ${local.number} ("${local.title}") modificata in modo incompatibile su entrambi i dispositivi`
    );
  }

  const merged: Plate = {
    id: local.id,
    number: numberRes.ok ? numberRes.value : local.number,
    title: titleRes.ok ? titleRes.value : local.title,
    assignedDate: assignedRes.ok ? assignedRes.value : local.assignedDate,
    dueDate: dueRes.ok ? dueRes.value : local.dueDate,
    notes: notesRes.ok ? notesRes.value : local.notes,
  };
  const nextOrder = orderRes.ok ? orderRes.value : local.order ?? remote.order;
  if (nextOrder !== undefined) merged.order = nextOrder;
  const nextImgData = imgDataRes.ok ? imgDataRes.value : local.imageDataUrl;
  const nextImgName = imgNameRes.ok ? imgNameRes.value : local.imageName;
  if (nextImgData) {
    merged.imageDataUrl = nextImgData;
    if (nextImgName) merged.imageName = nextImgName;
  }
  return merged;
}

function mergeFolder(
  hasBase: boolean,
  base: FolderDelivery | undefined,
  local: FolderDelivery,
  remote: FolderDelivery,
  className: string,
  conflicts: string[]
): FolderDelivery {
  if (deepEqual(local, remote)) return local;

  const titleRes = mergeScalar3Way(hasBase, base?.title, local.title, remote.title);
  const dueRes = mergeScalar3Way(hasBase, base?.dueDate, local.dueDate, remote.dueDate);
  const notesRes = mergeScalar3Way(hasBase, base?.notes, local.notes, remote.notes);

  if (!titleRes.ok || !dueRes.ok || !notesRes.ok) {
    conflicts.push(
      `${className} — Cartellina "${local.title}" modificata in modo diverso su entrambi i dispositivi`
    );
  }

  let mergedPlateIds = local.plateIds;
  if (!deepEqual(local.plateIds, remote.plateIds)) {
    if (hasBase && deepEqual(local.plateIds, base?.plateIds ?? [])) {
      mergedPlateIds = remote.plateIds;
    } else if (hasBase && deepEqual(remote.plateIds, base?.plateIds ?? [])) {
      mergedPlateIds = local.plateIds;
    } else {
      mergedPlateIds = Array.from(
        new Set([...remote.plateIds, ...local.plateIds])
      );
    }
  }

  return {
    id: local.id,
    title: titleRes.ok ? titleRes.value : local.title,
    dueDate: dueRes.ok ? dueRes.value : local.dueDate,
    plateIds: mergedPlateIds,
    notes: notesRes.ok ? notesRes.value : local.notes,
  };
}

function mergeClassSettings(
  hasBase: boolean,
  base: ClassSettings | undefined,
  local: ClassSettings,
  remote: ClassSettings,
  className: string,
  conflicts: string[]
): ClassSettings {
  if (deepEqual(local, remote)) return local;
  const keys: (keyof ClassSettings)[] = [
    'penaltyNo',
    'penaltyMissing',
    'penaltyLatePerDay',
    'toleranceDays',
    'defaultPlatesPerFolder',
    'roundingMode',
  ];
  const merged = { ...local };
  for (const key of keys) {
    const res = mergeScalar3Way(hasBase, base?.[key], local[key], remote[key]);
    if (res.ok) {
      (merged as Record<string, unknown>)[key] = res.value;
    } else {
      conflicts.push(
        `${className} — Impostazione "${String(key)}" modificata diversamente su entrambi i dispositivi`
      );
    }
  }
  return merged;
}

function mergeArchivedHistories(
  localList: ArchivedStudentHistory[] | undefined,
  remoteList: ArchivedStudentHistory[] | undefined
): ArchivedStudentHistory[] | undefined {
  const combined = [...(remoteList ?? []), ...(localList ?? [])];
  if (combined.length === 0) return undefined;
  const map = new Map<string, ArchivedStudentHistory>();
  for (const entry of combined) {
    map.set(`${entry.studentId}::${entry.movedAt}`, entry);
  }
  return Array.from(map.values());
}

function mergeClass(
  baseCls: ClassData | undefined,
  localCls: ClassData,
  remoteCls: ClassData,
  conflicts: string[]
): ClassData {
  if (deepEqual(localCls, remoteCls)) return localCls;
  const hasBase = Boolean(baseCls);
  const label = localCls.name || remoteCls.name;

  const nameRes = mergeScalar3Way(hasBase, baseCls?.name, localCls.name, remoteCls.name);
  const yearRes = mergeScalar3Way(
    hasBase,
    baseCls?.schoolYear,
    localCls.schoolYear,
    remoteCls.schoolYear
  );
  const colorRes = mergeScalar3Way(hasBase, baseCls?.color, localCls.color, remoteCls.color);
  const orderRes = mergeScalar3Way(hasBase, baseCls?.order, localCls.order, remoteCls.order);
  if (!nameRes.ok || !yearRes.ok || !colorRes.ok) {
    conflicts.push(
      `Dati generali della classe "${label}" modificati in modo diverso su entrambi i dispositivi`
    );
  }

  const mergedSettings = mergeClassSettings(
    hasBase,
    baseCls?.settings,
    localCls.settings,
    remoteCls.settings,
    label,
    conflicts
  );

  // Students 3-way merge
  const baseStuMap = new Map((baseCls?.students ?? []).map((s) => [s.id, s]));
  const localStuMap = new Map(localCls.students.map((s) => [s.id, s]));
  const remoteStuMap = new Map(remoteCls.students.map((s) => [s.id, s]));
  const allStuIds = Array.from(
    new Set([
      ...remoteCls.students.map((s) => s.id),
      ...localCls.students.map((s) => s.id),
      ...(baseCls?.students ?? []).map((s) => s.id),
    ])
  );
  const mergedStudents: Student[] = [];
  for (const stuId of allStuIds) {
    const b = baseStuMap.get(stuId);
    const l = localStuMap.get(stuId);
    const r = remoteStuMap.get(stuId);
    if (l && r) {
      mergedStudents.push(mergeStudent(hasBase, b, l, r, label, conflicts));
    } else if (l && !r) {
      if (!hasBase || !b) {
        mergedStudents.push(l);
      } else if (!deepEqual(b, l)) {
        conflicts.push(
          `${label} — Studente "${l.lastName} ${l.firstName}" eliminato su Drive ma modificato localmente`
        );
      }
    } else if (!l && r) {
      if (!hasBase || !b) {
        mergedStudents.push(r);
      } else if (!deepEqual(b, r)) {
        conflicts.push(
          `${label} — Studente "${r.lastName} ${r.firstName}" eliminato localmente ma modificato su Drive`
        );
      }
    }
  }
  mergedStudents.sort((a, b) => a.order - b.order);

  // Plates 3-way merge
  const basePltMap = new Map((baseCls?.plates ?? []).map((p) => [p.id, p]));
  const localPltMap = new Map(localCls.plates.map((p) => [p.id, p]));
  const remotePltMap = new Map(remoteCls.plates.map((p) => [p.id, p]));
  const allPltIds = Array.from(
    new Set([
      ...remoteCls.plates.map((p) => p.id),
      ...localCls.plates.map((p) => p.id),
      ...(baseCls?.plates ?? []).map((p) => p.id),
    ])
  );
  const mergedPlates: Plate[] = [];
  for (const pltId of allPltIds) {
    const b = basePltMap.get(pltId);
    const l = localPltMap.get(pltId);
    const r = remotePltMap.get(pltId);
    if (l && r) {
      mergedPlates.push(mergePlate(hasBase, b, l, r, label, conflicts));
    } else if (l && !r) {
      if (!hasBase || !b) {
        mergedPlates.push(l);
      } else if (!deepEqual(b, l)) {
        conflicts.push(
          `${label} — Tavola ${l.number} ("${l.title}") eliminata su Drive ma modificata localmente`
        );
      }
    } else if (!l && r) {
      if (!hasBase || !b) {
        mergedPlates.push(r);
      } else if (!deepEqual(b, r)) {
        conflicts.push(
          `${label} — Tavola ${r.number} ("${r.title}") eliminata localmente ma modificata su Drive`
        );
      }
    }
  }
  mergedPlates.sort((a, b) => (a.order ?? a.number) - (b.order ?? b.number));

  // Folders 3-way merge
  const baseFldMap = new Map((baseCls?.folders ?? []).map((f) => [f.id, f]));
  const localFldMap = new Map(localCls.folders.map((f) => [f.id, f]));
  const remoteFldMap = new Map(remoteCls.folders.map((f) => [f.id, f]));
  const allFldIds = Array.from(
    new Set([
      ...remoteCls.folders.map((f) => f.id),
      ...localCls.folders.map((f) => f.id),
      ...(baseCls?.folders ?? []).map((f) => f.id),
    ])
  );
  const mergedFolders: FolderDelivery[] = [];
  for (const fldId of allFldIds) {
    const b = baseFldMap.get(fldId);
    const l = localFldMap.get(fldId);
    const r = remoteFldMap.get(fldId);
    if (l && r) {
      mergedFolders.push(mergeFolder(hasBase, b, l, r, label, conflicts));
    } else if (l && !r) {
      if (!hasBase || !b) {
        mergedFolders.push(l);
      } else if (!deepEqual(b, l)) {
        conflicts.push(
          `${label} — Cartellina "${l.title}" eliminata su Drive ma modificata localmente`
        );
      }
    } else if (!l && r) {
      if (!hasBase || !b) {
        mergedFolders.push(r);
      } else if (!deepEqual(b, r)) {
        conflicts.push(
          `${label} — Cartellina "${r.title}" eliminata localmente ma modificata su Drive`
        );
      }
    }
  }

  const validPltSet = new Set(mergedPlates.map((p) => p.id));
  const stuLookup = new Map(mergedStudents.map((s) => [s.id, s]));
  const pltLookup = new Map(mergedPlates.map((p) => [p.id, p]));
  const fldLookup = new Map(mergedFolders.map((f) => [f.id, f]));

  // Evaluations 3-way cell merge
  const mergedEvaluations: ClassData['evaluations'] = {};
  for (const stu of mergedStudents) {
    const stuEvalMap: Record<string, PlateEvaluation> = {};
    for (const plt of mergedPlates) {
      const b = normalizeEvalCell(baseCls?.evaluations?.[stu.id]?.[plt.id]);
      const l = normalizeEvalCell(localCls.evaluations?.[stu.id]?.[plt.id]);
      const r = normalizeEvalCell(remoteCls.evaluations?.[stu.id]?.[plt.id]);

      if (deepEqual(l, r)) {
        if (!deepEqual(l, EMPTY_EVALUATION)) stuEvalMap[plt.id] = l;
        continue;
      }
      if (hasBase && deepEqual(l, b)) {
        if (!deepEqual(r, EMPTY_EVALUATION)) stuEvalMap[plt.id] = r;
        continue;
      }
      if (hasBase && deepEqual(r, b)) {
        if (!deepEqual(l, EMPTY_EVALUATION)) stuEvalMap[plt.id] = l;
        continue;
      }
      if (deepEqual(l, EMPTY_EVALUATION) && !deepEqual(r, EMPTY_EVALUATION)) {
        stuEvalMap[plt.id] = r;
        continue;
      }
      if (deepEqual(r, EMPTY_EVALUATION) && !deepEqual(l, EMPTY_EVALUATION)) {
        stuEvalMap[plt.id] = l;
        continue;
      }

      const stuName = stuLookup.get(stu.id)
        ? `${stu.lastName} ${stu.firstName}`
        : stu.id;
      const pltNum = pltLookup.get(plt.id)?.number ?? plt.number;
      conflicts.push(
        `${label} — ${stuName}, Tavola ${pltNum}: valutazione locale (${l.status ?? '—'} ${l.grade ?? '—'}) diversa da Drive (${r.status ?? '—'} ${r.grade ?? '—'})`
      );
      stuEvalMap[plt.id] = l;
    }
    if (Object.keys(stuEvalMap).length > 0) {
      mergedEvaluations[stu.id] = stuEvalMap;
    }
  }

  // Folder records 3-way cell merge
  const mergedFolderRecords: ClassData['folderRecords'] = {};
  for (const stu of mergedStudents) {
    const stuRecMap: Record<string, FolderStudentRecord> = {};
    for (const fld of mergedFolders) {
      const b = normalizeFolderRec(baseCls?.folderRecords?.[stu.id]?.[fld.id]);
      const l = normalizeFolderRec(localCls.folderRecords?.[stu.id]?.[fld.id]);
      const r = normalizeFolderRec(remoteCls.folderRecords?.[stu.id]?.[fld.id]);

      if (deepEqual(l, r)) {
        if (!deepEqual(l, EMPTY_FOLDER_RECORD)) stuRecMap[fld.id] = l;
        continue;
      }
      if (hasBase && deepEqual(l, b)) {
        if (!deepEqual(r, EMPTY_FOLDER_RECORD)) stuRecMap[fld.id] = r;
        continue;
      }
      if (hasBase && deepEqual(r, b)) {
        if (!deepEqual(l, EMPTY_FOLDER_RECORD)) stuRecMap[fld.id] = l;
        continue;
      }
      if (deepEqual(l, EMPTY_FOLDER_RECORD) && !deepEqual(r, EMPTY_FOLDER_RECORD)) {
        stuRecMap[fld.id] = r;
        continue;
      }
      if (deepEqual(r, EMPTY_FOLDER_RECORD) && !deepEqual(l, EMPTY_FOLDER_RECORD)) {
        stuRecMap[fld.id] = l;
        continue;
      }

      const fldTitle = fldLookup.get(fld.id)?.title ?? fld.title;
      conflicts.push(
        `${label} — ${stu.lastName} ${stu.firstName}, ${fldTitle}: consegna modificata in modo incompatibile su entrambi i dispositivi`
      );
      stuRecMap[fld.id] = l;
    }
    if (Object.keys(stuRecMap).length > 0) {
      mergedFolderRecords[stu.id] = stuRecMap;
    }
  }

  const sanitizedFolders = mergedFolders.map((f) => ({
    ...f,
    plateIds: f.plateIds.filter((pid) => validPltSet.has(pid)),
  }));

  const localUpMs = parseIsoMs(localCls.updatedAt);
  const remoteUpMs = parseIsoMs(remoteCls.updatedAt);
  const nextUpdatedAt =
    localUpMs >= remoteUpMs
      ? localCls.updatedAt || new Date().toISOString()
      : remoteCls.updatedAt || new Date().toISOString();

  const mergedHistories = mergeArchivedHistories(
    localCls.archivedStudentHistories,
    remoteCls.archivedStudentHistories
  );

  const mergedOrder = orderRes.ok
    ? orderRes.value
    : localUpMs >= remoteUpMs
    ? localCls.order
    : remoteCls.order;

  const out: ClassData = {
    id: localCls.id,
    name: nameRes.ok ? nameRes.value : label,
    schoolYear: yearRes.ok ? yearRes.value : localCls.schoolYear,
    ...(typeof mergedOrder === 'number' && Number.isFinite(mergedOrder)
      ? { order: mergedOrder }
      : {}),
    color: colorRes.ok ? colorRes.value : localCls.color,
    createdAt: remoteCls.createdAt || localCls.createdAt,
    updatedAt: nextUpdatedAt,
    settings: mergedSettings,
    students: mergedStudents,
    plates: mergedPlates,
    evaluations: mergedEvaluations,
    folders: sanitizedFolders,
    folderRecords: mergedFolderRecords,
  };
  if (mergedHistories && mergedHistories.length > 0) {
    out.archivedStudentHistories = mergedHistories;
  }
  return out;
}

function mergeAuditLogs(
  localLog: AuditLogEntry[],
  remoteLog: AuditLogEntry[]
): AuditLogEntry[] {
  const byId = new Map<string, AuditLogEntry>();
  for (const item of remoteLog) byId.set(item.id, item);
  for (const item of localLog) byId.set(item.id, item);
  return Array.from(byId.values())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 500);
}

/**
 * Performs element-level 3-way reconciliation between `local` and `remote` relative to `base`.
 * Reconciles disjoint additions/edits across classes, students, plates, grades, folders, and settings
 * automatically without data loss, raising `outcome: 'conflict'` only on true same-element collisions.
 */
export function reconcileArchives(params: {
  base: GradebookStoreState | null;
  local: GradebookStoreState;
  remote: GradebookStoreState;
}): MergeResult {
  const { base, local, remote } = params;
  const hasBase = Boolean(base);
  const conflicts: string[] = [];

  const baseClsMap = new Map((base?.classes ?? []).map((c) => [c.id, c]));
  const localClsMap = new Map(local.classes.map((c) => [c.id, c]));
  const remoteClsMap = new Map(remote.classes.map((c) => [c.id, c]));

  const allClsIds = Array.from(
    new Set([
      ...remote.classes.map((c) => c.id),
      ...local.classes.map((c) => c.id),
      ...(base?.classes ?? []).map((c) => c.id),
    ])
  );

  const mergedClasses: ClassData[] = [];
  for (const clsId of allClsIds) {
    const b = baseClsMap.get(clsId);
    const l = localClsMap.get(clsId);
    const r = remoteClsMap.get(clsId);

    if (l && r) {
      mergedClasses.push(mergeClass(b, l, r, conflicts));
    } else if (l && !r) {
      if (!hasBase || !b) {
        mergedClasses.push(l);
      } else if (!deepEqual(b, l)) {
        conflicts.push(
          `Classe "${l.name}" eliminata su Google Drive ma modificata localmente`
        );
      }
    } else if (!l && r) {
      if (!hasBase || !b) {
        mergedClasses.push(r);
      } else if (!deepEqual(b, r)) {
        conflicts.push(
          `Classe "${r.name}" eliminata localmente ma modificata su Google Drive`
        );
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      outcome: 'conflict',
      conflicts,
    };
  }

  const localOrderMap = new Map(
    local.classes.map((c, idx) => [
      c.id,
      typeof c.order === 'number' && Number.isFinite(c.order) ? c.order : idx,
    ])
  );
  const remoteOrderMap = new Map(
    remote.classes.map((c, idx) => [
      c.id,
      typeof c.order === 'number' && Number.isFinite(c.order) ? c.order : idx,
    ])
  );
  const hasExplicitOrders = mergedClasses.some(
    (c) => typeof c.order === 'number' && Number.isFinite(c.order)
  );
  if (hasExplicitOrders) {
    mergedClasses.sort((a, b) => {
      const aOrd =
        typeof a.order === 'number' && Number.isFinite(a.order)
          ? a.order
          : localOrderMap.get(a.id) ??
            remoteOrderMap.get(a.id) ??
            Number.MAX_SAFE_INTEGER;
      const bOrd =
        typeof b.order === 'number' && Number.isFinite(b.order)
          ? b.order
          : localOrderMap.get(b.id) ??
            remoteOrderMap.get(b.id) ??
            Number.MAX_SAFE_INTEGER;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return a.id.localeCompare(b.id);
    });
    for (let i = 0; i < mergedClasses.length; i++) {
      mergedClasses[i] = { ...mergedClasses[i], order: i };
    }
  }

  const nextActiveClassId =
    local.activeClassId && mergedClasses.some((c) => c.id === local.activeClassId)
      ? local.activeClassId
      : remote.activeClassId &&
        mergedClasses.some((c) => c.id === remote.activeClassId)
      ? remote.activeClassId
      : mergedClasses[0]?.id ?? null;

  const mergedState: GradebookStoreState = {
    version: Math.max(local.version ?? 1, remote.version ?? 1),
    activeClassId: nextActiveClassId,
    classes: mergedClasses,
    auditLog: mergeAuditLogs(local.auditLog ?? [], remote.auditLog ?? []),
  };

  return {
    outcome: 'merged',
    mergedState,
    conflicts: [],
    summaryText: `Unite automaticamente ${mergedClasses.length} ${
      mergedClasses.length === 1 ? 'classe' : 'classi'
    } senza perdite di dati.`,
  };
}
