import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  ArchivedStudentHistory,
  AuditCategory,
  AuditLogEntry,
  ClassData,
  ClassSettings,
  FolderDelivery,
  FolderDeliveryStatus,
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
  buildStudentDedupeKey,
  normalizeNameValue,
  sortStudentsAlphabeticallyIt,
} from '../utils/studentImport';
import {
  createId,
  DEFAULT_CLASS_SETTINGS,
  loadStoreState,
  normalizeClassData,
  saveStoreState,
  STORE_VERSION,
} from '../utils/storage';

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

export type StoreMutationSource = 'init' | 'user' | 'cloud_restore';

export type PlateImportMode = 'append' | 'replace';

export interface PlateImportResult {
  ok: boolean;
  importedCount: number;
  skippedCount: number;
  error?: string;
}

function normalizePlateTitleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function clonePlatesForImport(
  sourcePlates: Plate[],
  options?: {
    includeAttachments?: boolean;
    startOrder?: number;
    reservedNumbers?: Set<number>;
  }
): Plate[] {
  const sorted = sortPlates(sourcePlates);
  const startOrder = options?.startOrder ?? 0;
  const usedNumbers = new Set<number>(options?.reservedNumbers ?? []);
  const includeAttachments = Boolean(options?.includeAttachments);

  return sorted.map((src, idx) => {
    let nextNumber = src.number;
    if (usedNumbers.has(nextNumber)) {
      const maxExisting = usedNumbers.size > 0 ? Math.max(...usedNumbers) : 0;
      nextNumber = Math.max(1, maxExisting + 1);
    }
    usedNumbers.add(nextNumber);

    const cloned: Plate = {
      id: createId('plt'),
      number: nextNumber,
      order: startOrder + idx,
      title: src.title,
      assignedDate: src.assignedDate,
      dueDate: src.dueDate,
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
    const clonedPlates = clonePlatesForImport(sortedSource, {
      includeAttachments,
      startOrder: 0,
    });
    const nextEvaluations: ClassData['evaluations'] = {};
    for (const stuId of Object.keys(targetClass.evaluations)) {
      nextEvaluations[stuId] = {};
    }
    const nextFolders = targetClass.folders.map((f) => ({
      ...f,
      plateIds: [],
    }));

    const nextState: GradebookStoreState = {
      ...prevState,
      classes: prevState.classes.map((c) =>
        c.id === targetClassId
          ? {
              ...c,
              plates: clonedPlates,
              evaluations: nextEvaluations,
              folders: nextFolders,
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
          `Importate ${clonedPlates.length} tavole da "${sourceClass.name}" in modalità sostituzione (studenti e cartelline preservati).`
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

  // Append mode: deduplicate by normalized plate title and avoid number collisions
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
  const reservedNumbers = new Set(targetClass.plates.map((p) => p.number));
  const clonedPlates = clonePlatesForImport(platesToAppend, {
    includeAttachments,
    startOrder: maxOrder + 1,
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
        }.`
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

export function useGradebookStore() {
  const [storeRecord, setStoreRecord] = useState<{
    state: GradebookStoreState;
    mutationSeq: number;
    mutationSource: StoreMutationSource;
  }>(() => ({
    state: loadStoreState(),
    mutationSeq: 0,
    mutationSource: 'init',
  }));
  const state = storeRecord.state;
  const stateRef = useRef(state);
  stateRef.current = state;

  const commit = useCallback(
    (updater: (prev: GradebookStoreState) => GradebookStoreState) => {
      setStoreRecord((prev) => {
        const rawNext = updater(prev.state);
        if (rawNext === prev.state) return prev;
        const next =
          rawNext.auditLog.length > 500
            ? { ...rawNext, auditLog: rawNext.auditLog.slice(0, 500) }
            : rawNext;
        saveStoreState(next);
        stateRef.current = next;
        return {
          state: next,
          mutationSeq: prev.mutationSeq + 1,
          mutationSource: 'user',
        };
      });
    },
    []
  );

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
      commit((prev) => {
        if (prev.activeClassId === classId) return prev;
        return {
          ...prev,
          activeClassId: classId,
        };
      });
    },
    [commit]
  );

  const createClass = useCallback(
    (input: {
      name: string;
      schoolYear: string;
      color?: string;
      sourcePlatesClassId?: string;
      includePlateAttachments?: boolean;
    }) => {
      const now = new Date().toISOString();
      const createdId = createId('cls');
      commit((prev) => {
        const chosenColor =
          input.color ||
          pickNextDistinctClassColorId(prev.classes.map((c) => c.color));
        const sourceClass = input.sourcePlatesClassId
          ? prev.classes.find((c) => c.id === input.sourcePlatesClassId)
          : undefined;
        const importedPlates = sourceClass
          ? clonePlatesForImport(sourceClass.plates, {
              includeAttachments: input.includePlateAttachments,
            })
          : [];

        const newClass: ClassData = {
          id: createdId,
          name: input.name.trim(),
          schoolYear: input.schoolYear.trim() || '2026/2027',
          color: chosenColor,
          createdAt: now,
          updatedAt: now,
          settings: { ...DEFAULT_CLASS_SETTINGS },
          students: [],
          plates: importedPlates,
          evaluations: {},
          folders: [],
          folderRecords: {},
        };
        const platesNote =
          sourceClass && importedPlates.length > 0
            ? ` Con ${importedPlates.length} tavole importate da "${sourceClass.name}".`
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
              `Creata nuova classe "${newClass.name}" (${newClass.schoolYear}).${platesNote}`
            ),
            ...prev.auditLog,
          ],
        };
      });
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

  const deleteClass = useCallback(
    (classId: string) => {
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        const remaining = prev.classes.filter((c) => c.id !== classId);
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
      }
    ) => {
      const normalizedTags: StudentSupportTag[] = (['DSA', 'BES', 'H'] as const).filter(
        (tag) => input.supportNeeds?.includes(tag)
      );
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        if (!target) return prev;
        const maxOrder = target.students.reduce(
          (max, s) => Math.max(max, s.order),
          -1
        );
        const student = {
          id: createId('stu'),
          lastName: input.lastName.trim(),
          firstName: input.firstName.trim(),
          order: maxOrder + 1,
          ...(normalizedTags.length > 0 ? { supportNeeds: normalizedTags } : {}),
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
                  ? ` (${normalizedTags.join(', ')})`
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
      }
    ) => {
      const normalizedTags: StudentSupportTag[] = (['DSA', 'BES', 'H'] as const).filter(
        (tag) => input.supportNeeds?.includes(tag)
      );
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
                    const updated = {
                      ...s,
                      lastName: nextLast,
                      firstName: nextFirst,
                    };
                    if (normalizedTags.length > 0) {
                      updated.supportNeeds = normalizedTags;
                    } else {
                      delete updated.supportNeeds;
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
                  ? ` (${normalizedTags.join(', ')})`
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
      commit((prev) => {
        const target = prev.classes.find((c) => c.id === classId);
        const plate = target?.plates.find((p) => p.id === plateId);
        if (!target || !plate) return prev;

        const nextEvals: ClassData['evaluations'] = {};
        for (const [stuId, map] of Object.entries(target.evaluations)) {
          const copy = { ...map };
          delete copy[plateId];
          nextEvals[stuId] = copy;
        }

        const nextFolders = target.folders.map((f) => ({
          ...f,
          plateIds: f.plateIds.filter((id) => id !== plateId),
        }));

        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  plates: c.plates.filter((p) => p.id !== plateId),
                  evaluations: nextEvals,
                  folders: nextFolders,
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
          auditLog: [
            makeLog(
              classId,
              target.name,
              'tavola',
              'Eliminazione tavola',
              `Eliminata Tavola ${plate.number}: "${plate.title}".`
            ),
            ...prev.auditLog,
          ],
        };
      });
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

      const savedOk = saveStoreState(nextState);
      if (!savedOk) return false;
      stateRef.current = nextState;
      setStoreRecord((prev) => ({
        state: nextState,
        mutationSeq: prev.mutationSeq + 1,
        mutationSource: 'user',
      }));
      return true;
    },
    []
  );

  const importPlatesFromClass = useCallback(
    (
      targetClassId: string,
      sourceClassId: string,
      mode: PlateImportMode,
      includeAttachments = false
    ): PlateImportResult => {
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
      const savedOk = saveStoreState(nextState);
      if (!savedOk) {
        return {
          ok: false,
          importedCount: 0,
          skippedCount: 0,
          error:
            'Spazio locale insufficiente per copiare anche gli allegati. Riprova importando solo la struttura delle tavole.',
        };
      }
      stateRef.current = nextState;
      setStoreRecord((prev) => ({
        state: nextState,
        mutationSeq: prev.mutationSeq + 1,
        mutationSource: 'user',
      }));
      return result;
    },
    []
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
      commit((prev) => {
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
      });
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
        const exists = prev.classes.some((c) => c.id === incoming.id);
        let nextClass: ClassData;
        let nextClasses: ClassData[];

        if (mode === 'replace_existing' && exists) {
          nextClass = { ...incoming, updatedAt: new Date().toISOString() };
          nextClasses = prev.classes.map((c) =>
            c.id === incoming.id ? nextClass : c
          );
        } else {
          const newId = exists ? createId('cls') : incoming.id;
          const suffix = exists ? ' (Importata)' : '';
          nextClass = {
            ...incoming,
            id: newId,
            name: `${incoming.name}${suffix}`,
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
        const normalizedClasses = backup.classes.map((cls, idx) =>
          normalizeClassData(cls, idx)
        );
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

  const restoreFromCloudArchive = useCallback(
    (
      payload: {
        version?: number;
        activeClassId: string | null;
        classes: ClassData[];
        auditLog?: AuditLogEntry[];
      },
      sourceLabel = 'Google Drive'
    ): GradebookStoreState => {
      const normalizedClasses = payload.classes.map((cls, idx) =>
        normalizeClassData(cls, idx)
      );
      const restoredActiveId =
        payload.activeClassId &&
        normalizedClasses.some((c) => c.id === payload.activeClassId)
          ? payload.activeClassId
          : normalizedClasses[0]?.id ?? null;

      const isCloudRestore = sourceLabel === 'Google Drive';
      const baseLogs = Array.isArray(payload.auditLog) ? payload.auditLog : [];
      const nextState: GradebookStoreState = {
        version: payload.version ?? STORE_VERSION,
        activeClassId: restoredActiveId,
        classes: normalizedClasses,
        auditLog: isCloudRestore
          ? baseLogs.slice(0, 500)
          : [
              makeLog(
                null,
                'Archivio completo',
                'archivio',
                `Ripristino da ${sourceLabel}`,
                `Ripristinate ${normalizedClasses.length} classi complete di valutazioni, immagini e cartelline da ${sourceLabel}.`
              ),
              ...baseLogs,
            ].slice(0, 500),
      };

      saveStoreState(nextState);
      stateRef.current = nextState;
      setStoreRecord((prev) => ({
        state: nextState,
        mutationSeq: isCloudRestore ? prev.mutationSeq : prev.mutationSeq + 1,
        mutationSource: isCloudRestore ? 'cloud_restore' : 'user',
      }));
      return nextState;
    },
    []
  );

  const recordAuditAction = useCallback(
    (
      classId: string | null,
      className: string,
      category: AuditCategory,
      action: string,
      details: string
    ) => {
      commit((prev) => ({
        ...prev,
        auditLog: [
          makeLog(classId, className, category, action, details),
          ...prev.auditLog,
        ],
      }));
    },
    [commit]
  );

  return {
    state,
    mutationSeq: storeRecord.mutationSeq,
    mutationSource: storeRecord.mutationSource,
    activeClass,
    setActiveClass,
    createClass,
    updateClass,
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
    restoreFromCloudArchive,
    recordAuditAction,
  };
}
