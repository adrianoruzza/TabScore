import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronRight,
  FolderCheck,
  FolderPlus,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  ClassData,
  FolderDelivery,
  FolderDeliveryStatus,
  Plate,
  PlateEvaluation,
  Student,
} from '../types/gradebook';
import {
  calculateFolderEvaluation,
  EMPTY_EVALUATION,
  EMPTY_FOLDER_RECORD,
  formatDecimalIt,
  formatGradeLabel,
  formatPlateInterval,
  formatShortMonthDateIt,
  sortPlates,
  STATUS_META,
} from '../utils/calculations';
import { getClassColorOption } from '../utils/classColors';
import { getGradeColorStyle } from '../utils/gradeColors';
import { isPdfDataUrl } from '../utils/pdfViewer';
import { CellPopover } from './CellPopover';
import { FolderDatePopover } from './FolderDatePopover';
import { FolderGradePopover } from './FolderGradePopover';
import { PlateImageViewerModal } from './PlateImageViewerModal';
import { PlatePreviewPopover } from './PlatePreviewPopover';

interface GradeTableProps {
  classData: ClassData;
  onEditStudent: (student: Student) => void;
  onDeleteStudent: (student: Student) => void;
  onOpenStudentStats: (student: Student) => void;
  onReorderStudent: (fromIndex: number, toIndex: number) => void;
  onAddStudent: () => void;
  onEditPlate: (plate: Plate) => void;
  onUpdatePlateTitle: (plateId: string, newTitle: string) => void;
  onUpdatePlateImage: (
    plateId: string,
    image: { dataUrl: string; fileName: string } | null
  ) => boolean;
  onReorderPlate: (plateId: string, direction: 'left' | 'right') => void;
  onAddPlate: () => void;
  onEditFolder: (folder: FolderDelivery) => void;
  onAddFolder: () => void;
  onOpenStats: () => void;
  onOpenFolderStats: (folder: FolderDelivery) => void;
  onUpdateCell: (
    studentId: string,
    plateId: string,
    patch: Partial<PlateEvaluation> & { explicitWasNo?: boolean }
  ) => void;
  onUpdateFolderStudentRecord: (
    studentId: string,
    folderId: string,
    patch: {
      actualDeliveryDate?: string;
      status?: FolderDeliveryStatus;
      manualDelayDays?: number;
      manualFinalGrade?: number | null;
      manualGradeOverridden?: boolean;
    }
  ) => void;
  onOpenFolderStudent: (studentId: string, folder: FolderDelivery) => void;
  suppressKeyboardShortcuts?: boolean;
}

type ColumnItem =
  | {
      kind: 'plate';
      plate: Plate;
      groupIdx: number;
      plateIndex: number;
      visiblePlateIndex: number;
    }
  | { kind: 'folder'; folder: FolderDelivery };

interface ActiveCellPopover {
  mode: 'status' | 'grade';
  studentId: string;
  plateId: string;
  rect: DOMRect;
}

interface ActiveFolderDatePopover {
  studentId: string;
  folderId: string;
  rect: DOMRect;
}

interface ActiveFolderGradePopover {
  studentId: string;
  folderId: string;
  rect: DOMRect;
}

interface FixedTableDims {
  stColW: number;
  gradeColW: number;
  dateColW: number;
  delayColW: number;
  avgColW: number;
  finalColW: number;
}

const FIXED_COL_DIMS: FixedTableDims = {
  stColW: 28,
  gradeColW: 38,
  dateColW: 54,
  delayColW: 40,
  avgColW: 52,
  finalColW: 54,
};

const STUDENT_COL_MIN_W = 192;
const STUDENT_COL_MAX_W = 360;
const HOLD_HIGHLIGHT_DELAY_MS = 180;
const HOLD_MOVE_CANCEL_PX = 8;
const COLLAPSED_FOLDERS_STORAGE_KEY = 'tabscore_collapsed_folders_v1';

function loadCollapsedFoldersMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(COLLAPSED_FOLDERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCollapsedFoldersMap(map: Record<string, string[]>): void {
  try {
    localStorage.setItem(COLLAPSED_FOLDERS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

let textMeasureCtx: CanvasRenderingContext2D | null = null;

function measureTextPx(
  text: string,
  font: string,
  fallbackCharW: number
): number {
  if (!text) return 0;
  if (typeof document !== 'undefined') {
    if (!textMeasureCtx) {
      const canvas = document.createElement('canvas');
      textMeasureCtx = canvas.getContext('2d');
    }
    if (textMeasureCtx) {
      textMeasureCtx.font = font;
      return textMeasureCtx.measureText(text).width;
    }
  }
  return text.length * fallbackCharW;
}

export function GradeTable({
  classData,
  onEditStudent,
  onDeleteStudent,
  onOpenStudentStats,
  onReorderStudent,
  onAddStudent,
  onEditPlate,
  onUpdatePlateTitle,
  onUpdatePlateImage,
  onReorderPlate,
  onAddPlate,
  onEditFolder,
  onAddFolder,
  onOpenStats,
  onOpenFolderStats,
  onUpdateCell,
  onUpdateFolderStudentRecord,
  onOpenFolderStudent,
  suppressKeyboardShortcuts = false,
}: GradeTableProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRow1Ref = useRef<HTMLTableRowElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdStateRef = useRef<{
    studentId: string;
    pointerId: number;
    startX: number;
    startY: number;
    activated: boolean;
  } | null>(null);

  const [activePopover, setActivePopover] = useState<ActiveCellPopover | null>(
    null
  );
  const activePopoverRef = useRef<ActiveCellPopover | null>(null);
  activePopoverRef.current = activePopover;
  const [activeDatePopover, setActiveDatePopover] =
    useState<ActiveFolderDatePopover | null>(null);
  const [activeFolderGradePopover, setActiveFolderGradePopover] =
    useState<ActiveFolderGradePopover | null>(null);
  const [activePlatePreview, setActivePlatePreview] = useState<{
    plateId: string;
    rect: DOMRect;
  } | null>(null);
  const [viewerPlateId, setViewerPlateId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingTitlePlateId, setEditingTitlePlateId] = useState<string | null>(
    null
  );
  const [titleDraft, setTitleDraft] = useState('');
  const [highlightedStudentId, setHighlightedStudentId] = useState<
    string | null
  >(null);
  const [collapsedFoldersByClass, setCollapsedFoldersByClass] = useState<
    Record<string, string[]>
  >(() => loadCollapsedFoldersMap());
  const [focusedGradeCell, setFocusedGradeCell] = useState<{
    studentId: string;
    plateId: string;
  } | null>(null);
  const [fontsReadyTick, setFontsReadyTick] = useState(0);

  const collapsedFolderSet = useMemo(() => {
    const list = collapsedFoldersByClass[classData.id] ?? [];
    return new Set(list);
  }, [collapsedFoldersByClass, classData.id]);

  const toggleFolderCollapse = (folderId: string) => {
    setCollapsedFoldersByClass((prev) => {
      const current = prev[classData.id] ?? [];
      const exists = current.includes(folderId);
      const nextList = exists
        ? current.filter((id) => id !== folderId)
        : [...current, folderId];
      const nextMap = { ...prev, [classData.id]: nextList };
      saveCollapsedFoldersMap(nextMap);
      return nextMap;
    });
  };

  useEffect(() => {
    let active = true;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (active) setFontsReadyTick((t) => t + 1);
      });
    }
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setHighlightedStudentId(null);
    setActivePlatePreview(null);
    setViewerPlateId(null);
    setFocusedGradeCell(null);
  }, [classData.id]);

  // Press-and-hold activates persistent highlight; releasing does NOT turn it off
  useEffect(() => {
    const cancelPendingTimer = (pointerId?: number) => {
      const current = holdStateRef.current;
      if (!current) return;
      if (pointerId !== undefined && current.pointerId !== pointerId) return;
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      holdStateRef.current = null;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const current = holdStateRef.current;
      if (!current || current.pointerId !== e.pointerId) return;
      if (!current.activated) {
        const dist = Math.hypot(
          e.clientX - current.startX,
          e.clientY - current.startY
        );
        if (dist > HOLD_MOVE_CANCEL_PX) {
          cancelPendingTimer(e.pointerId);
        }
      }
    };

    const handlePointerUp = (e: PointerEvent) => cancelPendingTimer(e.pointerId);
    const handlePointerCancel = (e: PointerEvent) =>
      cancelPendingTimer(e.pointerId);
    const handleWindowBlur = () => cancelPendingTimer();

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  // Allow Escape to exit persistent student highlight when no modal/popover is open
  useEffect(() => {
    if (!highlightedStudentId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !activePopover &&
        !activeDatePopover &&
        !activeFolderGradePopover &&
        !activePlatePreview &&
        !viewerPlateId &&
        !editingTitlePlateId
      ) {
        setHighlightedStudentId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    highlightedStudentId,
    activePopover,
    activeDatePopover,
    activeFolderGradePopover,
    activePlatePreview,
    viewerPlateId,
    editingTitlePlateId,
  ]);

  const handleStudentHoldStart = (
    e: ReactPointerEvent<HTMLTableCellElement>,
    studentId: string
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, [data-no-row-highlight="true"]')) {
      return;
    }

    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    const pointerId = e.pointerId;
    holdStateRef.current = {
      studentId,
      pointerId,
      startX: e.clientX,
      startY: e.clientY,
      activated: false,
    };

    holdTimerRef.current = window.setTimeout(() => {
      if (
        holdStateRef.current &&
        holdStateRef.current.pointerId === pointerId
      ) {
        holdStateRef.current.activated = true;
        setHighlightedStudentId(studentId);
      }
    }, HOLD_HIGHLIGHT_DELAY_MS);
  };

  const studentW = useMemo(() => {
    const _fontTick = fontsReadyTick;
    void _fontTick;
    let maxNamePx = 0;
    for (const stu of classData.students) {
      const fullName = `${stu.lastName} ${stu.firstName}`.trim();
      const w = measureTextPx(
        fullName,
        '500 12.5px "DM Sans", system-ui, sans-serif',
        7.2
      );
      if (w > maxNamePx) maxNamePx = w;
    }
    return Math.min(
      STUDENT_COL_MAX_W,
      Math.max(STUDENT_COL_MIN_W, Math.ceil(maxNamePx) + 64)
    );
  }, [classData.students, fontsReadyTick]);

  const dims = useMemo(
    () => ({
      studentW,
      ...FIXED_COL_DIMS,
    }),
    [studentW]
  );

  const defaultRow1Height = 156;
  const row1HeightClass = 'h-px min-h-[156px]';
  const row1InnerMinHClass = 'min-h-[150px]';
  const [row1Height, setRow1Height] = useState<number>(defaultRow1Height);

  useLayoutEffect(() => {
    const rowEl = headerRow1Ref.current;
    if (!rowEl) {
      setRow1Height(defaultRow1Height);
      return;
    }
    const measure = () => {
      const h = Math.round(rowEl.getBoundingClientRect().height);
      if (h > 0) {
        setRow1Height((prev) => (prev === h ? prev : h));
      }
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(rowEl);
      return () => ro.disconnect();
    }
  }, [
    classData.id,
    classData.folders,
    classData.plates.length,
    collapsedFolderSet,
  ]);

  const sortedStudents = useMemo(
    () => [...classData.students].sort((a, b) => a.order - b.order),
    [classData.students]
  );

  const studentIndexMap = useMemo(
    () => new Map(sortedStudents.map((s, idx) => [s.id, idx])),
    [sortedStudents]
  );

  const orderedPlates = useMemo(
    () => sortPlates(classData.plates),
    [classData.plates]
  );

  const folderEvalMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateFolderEvaluation>>();
    if (classData.folders.length === 0 || classData.students.length === 0) {
      return map;
    }
    for (const stu of classData.students) {
      for (const folder of classData.folders) {
        map.set(
          `${stu.id}::${folder.id}`,
          calculateFolderEvaluation(classData, stu.id, folder)
        );
      }
    }
    return map;
  }, [classData]);

  // Assign each plate to a folder group index for subtle visual grouping
  const plateGroupMap = useMemo(() => {
    const map = new Map<string, number>();
    classData.folders.forEach((f, fIdx) => {
      f.plateIds.forEach((pid) => {
        if (!map.has(pid)) map.set(pid, fIdx);
      });
    });
    return map;
  }, [classData.folders]);

  // Interleave each Cartellina block right after its last included plate, hiding plates of collapsed folders
  const columns: ColumnItem[] = useMemo(() => {
    const plateIndexMap = new Map(orderedPlates.map((p, idx) => [p.id, idx]));
    const foldersAfterPlateIdx = new Map<number, FolderDelivery[]>();
    const unattachedFolders: FolderDelivery[] = [];
    const platesInCollapsed = new Set<string>();
    const platesInExpanded = new Set<string>();

    classData.folders.forEach((folder) => {
      const isCollapsed = collapsedFolderSet.has(folder.id);
      let maxIdx = -1;
      folder.plateIds.forEach((pid) => {
        if (isCollapsed) {
          platesInCollapsed.add(pid);
        } else {
          platesInExpanded.add(pid);
        }
        const idx = plateIndexMap.get(pid);
        if (idx !== undefined && idx > maxIdx) {
          maxIdx = idx;
        }
      });
      if (maxIdx >= 0) {
        const list = foldersAfterPlateIdx.get(maxIdx) ?? [];
        list.push(folder);
        foldersAfterPlateIdx.set(maxIdx, list);
      } else {
        unattachedFolders.push(folder);
      }
    });

    const result: ColumnItem[] = [];
    let visiblePlateIdx = 0;
    orderedPlates.forEach((plate, idx) => {
      const isHidden =
        platesInCollapsed.has(plate.id) && !platesInExpanded.has(plate.id);
      if (!isHidden) {
        result.push({
          kind: 'plate',
          plate,
          plateIndex: idx,
          visiblePlateIndex: visiblePlateIdx++,
          groupIdx: plateGroupMap.get(plate.id) ?? -1,
        });
      }
      const attached = foldersAfterPlateIdx.get(idx);
      if (attached) {
        attached.forEach((folder) => result.push({ kind: 'folder', folder }));
      }
    });
    unattachedFolders.forEach((folder) =>
      result.push({ kind: 'folder', folder })
    );

    return result;
  }, [orderedPlates, classData.folders, plateGroupMap, collapsedFolderSet]);


  const activePopoverData = useMemo(() => {
    if (!activePopover) return null;
    const student = classData.students.find(
      (s) => s.id === activePopover.studentId
    );
    const plate = classData.plates.find((p) => p.id === activePopover.plateId);
    if (!student || !plate) return null;
    const evaluation =
      classData.evaluations[student.id]?.[plate.id] ?? EMPTY_EVALUATION;
    return {
      mode: activePopover.mode,
      student,
      plate,
      evaluation,
      rect: activePopover.rect,
    };
  }, [activePopover, classData]);

  const activeDatePopoverData = useMemo(() => {
    if (!activeDatePopover) return null;
    const student = classData.students.find(
      (s) => s.id === activeDatePopover.studentId
    );
    const folder = classData.folders.find(
      (f) => f.id === activeDatePopover.folderId
    );
    if (!student || !folder) return null;
    const rec =
      classData.folderRecords[student.id]?.[folder.id] ?? EMPTY_FOLDER_RECORD;
    const calc = calculateFolderEvaluation(classData, student.id, folder);
    return {
      student,
      folder,
      record: rec,
      isLocked: calc.isConfirmed,
      rect: activeDatePopover.rect,
    };
  }, [activeDatePopover, classData]);

  const activeFolderGradePopoverData = useMemo(() => {
    if (!activeFolderGradePopover) return null;
    const student = classData.students.find(
      (s) => s.id === activeFolderGradePopover.studentId
    );
    const folder = classData.folders.find(
      (f) => f.id === activeFolderGradePopover.folderId
    );
    if (!student || !folder) return null;
    const rec =
      classData.folderRecords[student.id]?.[folder.id] ?? EMPTY_FOLDER_RECORD;
    const calc = calculateFolderEvaluation(classData, student.id, folder);
    return {
      student,
      folder,
      record: rec,
      calc,
      rect: activeFolderGradePopover.rect,
    };
  }, [activeFolderGradePopover, classData]);

  const activePlatePreviewPlate = useMemo(() => {
    if (!activePlatePreview) return null;
    return (
      classData.plates.find((p) => p.id === activePlatePreview.plateId) ?? null
    );
  }, [activePlatePreview, classData.plates]);

  const viewerPlate = useMemo(() => {
    if (!viewerPlateId) return null;
    return classData.plates.find((p) => p.id === viewerPlateId) ?? null;
  }, [viewerPlateId, classData.plates]);

  const highlightedStudent = useMemo(() => {
    if (!highlightedStudentId) return null;
    return (
      classData.students.find((s) => s.id === highlightedStudentId) ?? null
    );
  }, [highlightedStudentId, classData.students]);

  const commitInlineTitle = (plate: Plate) => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== plate.title) {
      onUpdatePlateTitle(plate.id, trimmed);
    }
    setEditingTitlePlateId(null);
  };

  const handleFocusGradeCell = useCallback(
    (studentId: string, plateId: string) => {
      setFocusedGradeCell({ studentId, plateId });
    },
    []
  );

  const handleClearFocusGradeCell = useCallback(() => {
    setFocusedGradeCell(null);
  }, []);

  const handleBlurGradeCell = useCallback(
    (relatedTarget: EventTarget | null) => {
      window.requestAnimationFrame(() => {
        if (activePopoverRef.current) return;
        const el = relatedTarget as HTMLElement | null;
        if (el && el.closest?.('[data-grade-cell]')) return;
        setFocusedGradeCell(null);
      });
    },
    []
  );

  const handleOpenCellStatus = useCallback(
    (studentId: string, plateId: string, rect: DOMRect) => {
      setFocusedGradeCell(null);
      setActivePopover({ mode: 'status', studentId, plateId, rect });
    },
    []
  );

  const handleOpenCellGrade = useCallback(
    (studentId: string, plateId: string, rect: DOMRect) => {
      setFocusedGradeCell({ studentId, plateId });
      setActivePopover({ mode: 'grade', studentId, plateId, rect });
    },
    []
  );

  const handleOpenFolderDate = useCallback(
    (studentId: string, folderId: string, rect: DOMRect) => {
      setFocusedGradeCell(null);
      setActiveDatePopover({ studentId, folderId, rect });
    },
    []
  );

  const handleChangeFolderDelayDays = useCallback(
    (studentId: string, folderId: string, days: number) => {
      onUpdateFolderStudentRecord(studentId, folderId, {
        manualDelayDays: days,
      });
    },
    [onUpdateFolderStudentRecord]
  );

  const handleOpenFolderGrade = useCallback(
    (studentId: string, folderId: string, rect: DOMRect) => {
      setFocusedGradeCell(null);
      setActiveFolderGradePopover({ studentId, folderId, rect });
    },
    []
  );

  const handleOpenFolderDetail = useCallback(
    (studentId: string, folder: FolderDelivery) => {
      setFocusedGradeCell(null);
      onOpenFolderStudent(studentId, folder);
    },
    [onOpenFolderStudent]
  );

  const visiblePlatesInOrder = useMemo(
    () =>
      columns
        .filter((c): c is Extract<ColumnItem, { kind: 'plate' }> => c.kind === 'plate')
        .map((c) => c.plate),
    [columns]
  );

  // Keyboard grade deletion via Canc (Delete) and arrow-key navigation across grade cells
  useEffect(() => {
    const isEditableElement = (el: HTMLElement | null) =>
      Boolean(
        el &&
          (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' ||
            el.isContentEditable ||
            el.closest('[contenteditable="true"]'))
      );

    const handleKeyDown = (e: KeyboardEvent) => {
      if (suppressKeyboardShortcuts) return;
      if (
        activeDatePopover ||
        activeFolderGradePopover ||
        activePlatePreview ||
        viewerPlateId ||
        editingTitlePlateId
      ) {
        return;
      }

      const targetEl = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;
      if (isEditableElement(targetEl) || isEditableElement(activeEl)) return;

      // 1. Delete (Canc) removes ONLY the grade of the single selected/focused grade cell
      if (e.key === 'Delete') {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        // Let CellPopover status mode handle status clearing without interference
        if (activePopover?.mode === 'status') return;

        let targetCell: { studentId: string; plateId: string } | null = null;
        if (activePopover?.mode === 'grade') {
          targetCell = {
            studentId: activePopover.studentId,
            plateId: activePopover.plateId,
          };
        } else {
          const gradeBtn =
            (activeEl?.closest('[data-grade-cell]') as HTMLElement | null) ??
            (targetEl?.closest('[data-grade-cell]') as HTMLElement | null);
          const attr = gradeBtn?.getAttribute('data-grade-cell');
          if (attr) {
            const sepIdx = attr.indexOf('::');
            if (sepIdx > 0) {
              targetCell = {
                studentId: attr.slice(0, sepIdx),
                plateId: attr.slice(sepIdx + 2),
              };
            }
          }
        }

        if (!targetCell) return;

        const cellKey = `${targetCell.studentId}::${targetCell.plateId}`;
        const existingCell =
          classData.evaluations[targetCell.studentId]?.[targetCell.plateId];

        if (existingCell && existingCell.grade !== null) {
          e.preventDefault();
          e.stopPropagation();
          onUpdateCell(targetCell.studentId, targetCell.plateId, { grade: null });
          if (activePopover?.mode === 'grade') {
            setActivePopover(null);
          }
          setFocusedGradeCell(targetCell);
          window.requestAnimationFrame(() => {
            const btn = scrollContainerRef.current?.querySelector(
              `[data-grade-cell="${cellKey}"]`
            ) as HTMLElement | null;
            btn?.focus();
          });
        } else if (activePopover?.mode === 'grade') {
          e.preventDefault();
          setActivePopover(null);
          window.requestAnimationFrame(() => {
            const btn = scrollContainerRef.current?.querySelector(
              `[data-grade-cell="${cellKey}"]`
            ) as HTMLElement | null;
            btn?.focus();
          });
        }
        return;
      }

      // 2. Arrow keys move focus across visible VOTO cells when no popover is open
      if (
        !activePopover &&
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight')
      ) {
        const gradeBtn = activeEl?.closest('[data-grade-cell]') as HTMLElement | null;
        const attr = gradeBtn?.getAttribute('data-grade-cell');
        if (!attr) return;
        const sepIdx = attr.indexOf('::');
        if (sepIdx <= 0) return;
        const stuId = attr.slice(0, sepIdx);
        const pltId = attr.slice(sepIdx + 2);

        const sIdx = sortedStudents.findIndex((s) => s.id === stuId);
        const pIdx = visiblePlatesInOrder.findIndex((p) => p.id === pltId);
        if (sIdx === -1 || pIdx === -1) return;

        let nextS = sIdx;
        let nextP = pIdx;
        if (e.key === 'ArrowUp') nextS = Math.max(0, sIdx - 1);
        else if (e.key === 'ArrowDown')
          nextS = Math.min(sortedStudents.length - 1, sIdx + 1);
        else if (e.key === 'ArrowLeft') nextP = Math.max(0, pIdx - 1);
        else if (e.key === 'ArrowRight')
          nextP = Math.min(visiblePlatesInOrder.length - 1, pIdx + 1);

        if (nextS === sIdx && nextP === pIdx) return;
        e.preventDefault();
        const nextKey = `${sortedStudents[nextS].id}::${visiblePlatesInOrder[nextP].id}`;
        const nextBtn = scrollContainerRef.current?.querySelector(
          `[data-grade-cell="${nextKey}"]`
        ) as HTMLElement | null;
        nextBtn?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    suppressKeyboardShortcuts,
    activePopover,
    activeDatePopover,
    activeFolderGradePopover,
    activePlatePreview,
    viewerPlateId,
    editingTitlePlateId,
    classData.evaluations,
    sortedStudents,
    visiblePlatesInOrder,
    onUpdateCell,
  ]);

  const classColor = useMemo(
    () => getClassColorOption(classData.color),
    [classData.color]
  );

  if (classData.students.length === 0 && classData.plates.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-16 text-center">
        <div
          style={{
            backgroundColor: classColor.softBg,
            borderColor: classColor.border,
            color: classColor.text,
          }}
          className="inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5"
        >
          <span
            aria-hidden="true"
            style={{ backgroundColor: classColor.accent }}
            className="h-3 w-3 shrink-0 rounded-sm"
          />
          <h3 className="font-display text-lg font-bold">{classData.name}</h3>
        </div>
        <p className="mt-1.5 max-w-md text-sm text-slate-500">
          Il registro di questa classe è vuoto. Inserisci gli studenti, le tavole o una nuova cartellina per iniziare.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onAddStudent}
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Aggiungi studente
          </button>
          <button
            type="button"
            onClick={onAddPlate}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Aggiungi tavola
          </button>
          <button
            type="button"
            onClick={onAddFolder}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap"
          >
            <FolderPlus className="h-4 w-4" />
            Crea cartellina
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white">
      {/* Persistent Student Highlight Banner */}
      {highlightedStudent && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-blue-200 bg-blue-50 px-3 py-1.5 text-xs">
          <div className="min-w-0 text-blue-950">
            <span className="font-medium">Evidenziazione attiva: </span>
            <strong className="font-semibold">
              {`${highlightedStudent.lastName} ${highlightedStudent.firstName}`.trim()}
            </strong>
          </div>
          <button
            type="button"
            onClick={() => setHighlightedStudentId(null)}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-blue-300 bg-white px-3 py-1 text-xs font-semibold text-blue-900 shadow-xs hover:bg-blue-100 whitespace-nowrap shrink-0"
          >
            <X className="h-3.5 w-3.5" />
            Esci dall’evidenziazione
          </button>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="grade-grid-scroll min-h-0 flex-1 overflow-auto"
      >
        <table className="w-max table-fixed border-separate border-spacing-0 text-left text-sm">
          <thead>
            {/* HEADER ROW 1: Student corner (rowSpan 2) + Plate titles (colSpan 2) + Cartelline (colSpan 4) */}
            <tr ref={headerRow1Ref}>
              <th
                scope="col"
                rowSpan={2}
                style={{
                  width: dims.studentW,
                  minWidth: dims.studentW,
                  maxWidth: dims.studentW,
                  borderTop: `3px solid ${classColor.accent}`,
                }}
                className="sticky top-0 left-0 z-40 h-px border-r-2 border-b border-slate-300 bg-slate-100 px-2.5 pt-2 pb-2 align-top shadow-[2px_0_5px_-2px_rgba(15,23,42,0.12)]"
              >
                <div className="flex h-full min-h-[164px] flex-col justify-between gap-2">
                  {/* Top-anchored Class Name with custom color identification */}
                  <div className="min-w-0 space-y-2">
                    <div
                      style={{
                        backgroundColor: classColor.softBg,
                        borderColor: classColor.border,
                      }}
                      className="rounded-md border px-2 py-1.5"
                    >
                      <div className="flex items-start gap-1.5">
                        <span
                          aria-hidden="true"
                          style={{ backgroundColor: classColor.accent }}
                          className="mt-1 h-3 w-3 shrink-0 rounded-sm"
                        />
                        <div
                          style={{ color: classColor.text }}
                          className="font-display line-clamp-2 break-words text-[20px] font-extrabold leading-[1.1] tracking-tight sm:text-[22px]"
                          title={classData.name}
                        >
                          {classData.name}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={onOpenStats}
                      className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 whitespace-nowrap"
                    >
                      <BarChart3 className="h-3.5 w-3.5 text-blue-700" />
                      Statistiche classe
                    </button>
                  </div>

                  {/* Student column label + quick add */}
                  <div className="flex items-end justify-between gap-1.5 border-t border-slate-200/90 pt-1.5">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-slate-800 whitespace-nowrap">
                        N° · Studente
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onAddStudent}
                      title="Aggiungi studente"
                      className="inline-flex h-6 items-center gap-1 rounded border border-slate-300 bg-white px-1.5 text-[10.5px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      Studente
                    </button>
                  </div>
                </div>
              </th>

              {columns.map((col, colIdx) => {
                if (col.kind === 'plate') {
                  const p = col.plate;
                  const plateW = dims.stColW + dims.gradeColW;
                  const isEditingTitle = editingTitlePlateId === p.id;
                  const nextCol = columns[colIdx + 1];
                  const endsGroup =
                    nextCol &&
                    (nextCol.kind === 'folder' ||
                      (nextCol.kind === 'plate' &&
                        nextCol.groupIdx !== col.groupIdx));

                  const plateHeaderBg =
                    col.visiblePlateIndex % 2 === 0
                      ? 'bg-[#f4f6f9]'
                      : 'bg-[#e8edf3]';

                  return (
                    <th
                      key={`h1-${p.id}`}
                      scope="colgroup"
                      colSpan={2}
                      style={{
                        width: plateW,
                        minWidth: plateW,
                        maxWidth: plateW,
                      }}
                      className={`group/ph sticky top-0 ${
                        isEditingTitle ? 'z-30' : 'z-20'
                      } ${row1HeightClass} border-b border-slate-300 px-0.5 py-0.5 align-top transition-colors ${
                        endsGroup
                          ? 'border-r-2 border-r-slate-500'
                          : 'border-r-2 border-r-slate-400'
                      } ${plateHeaderBg}`}
                    >
                      <div className={`relative flex h-full ${row1InnerMinHClass} flex-col justify-between`}>
                        {/* Hover/Focus Reorder Controls (top-right so upper title & bottom info bar stay clear) */}
                        <div className="absolute top-0.5 right-0.5 z-10 hidden items-center gap-0.5 rounded border border-slate-200 bg-white/95 px-0.5 py-0.5 shadow-sm group-hover/ph:flex group-focus-within/ph:flex">
                          <button
                            type="button"
                            disabled={col.plateIndex === 0}
                            onClick={() => onReorderPlate(p.id, 'left')}
                            title="Sposta tavola a sinistra"
                            className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
                          >
                            <ArrowLeft className="h-2.5 w-2.5" />
                          </button>
                          <button
                            type="button"
                            disabled={
                              col.plateIndex === orderedPlates.length - 1
                            }
                            onClick={() => onReorderPlate(p.id, 'right')}
                            title="Sposta tavola a destra"
                            className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
                          >
                            <ArrowRight className="h-2.5 w-2.5" />
                          </button>
                        </div>

                        {/* Upper Area: Vertical Plate Title (90° Vertical) */}
                        {isEditingTitle ? (
                          <div className="absolute top-1 left-0 z-40 w-[186px] rounded bg-white p-1 shadow-lg ring-1 ring-slate-300">
                            <input
                              type="text"
                              autoFocus
                              value={titleDraft}
                              onChange={(e) => setTitleDraft(e.target.value)}
                              onBlur={() => commitInlineTitle(p)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineTitle(p);
                                if (e.key === 'Escape')
                                  setEditingTitlePlateId(null);
                              }}
                              className="h-7 w-full rounded border border-blue-600 bg-white px-1.5 text-[11px] font-medium text-slate-900 focus:outline-none"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (p.imageDataUrl) {
                                setActivePlatePreview(null);
                                setViewerPlateId(p.id);
                              } else {
                                setEditingTitlePlateId(p.id);
                                setTitleDraft(p.title);
                              }
                            }}
                            title={
                              p.imageDataUrl
                                ? isPdfDataUrl(p.imageDataUrl)
                                  ? `${p.title} — Clicca per aprire il PDF`
                                  : `${p.title} — Clicca per aprire l’immagine ingrandita`
                                : `${p.title} — Clicca per modificare il titolo`
                            }
                            className="flex min-h-0 flex-1 w-full items-end justify-start overflow-hidden rounded px-1 pt-1 pb-0.5 hover:bg-white/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600"
                          >
                            <span
                              style={{
                                writingMode: 'vertical-rl',
                                transform: 'rotate(180deg)',
                                maxHeight: '116px',
                                maxWidth: `${plateW - 8}px`,
                              }}
                              className="overflow-hidden text-ellipsis text-left text-[12px] font-medium leading-[1.18] text-slate-800 hover:text-blue-800"
                            >
                              {p.title}
                            </span>
                          </button>
                        )}

                        {/* Bottom Info Row: TXX + sheet preview icon + edit pencil */}
                        <div className="flex shrink-0 items-center justify-between gap-0.5 pt-0.5">
                          <span className="font-mono text-[14px] font-extrabold leading-none tracking-tight text-blue-950">
                            T{p.number}
                          </span>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              data-plate-preview-trigger={p.id}
                              onClick={(e) => {
                                const rect =
                                  e.currentTarget.getBoundingClientRect();
                                setActivePlatePreview((prev) =>
                                  prev?.plateId === p.id
                                    ? null
                                    : { plateId: p.id, rect }
                                );
                              }}
                              aria-expanded={
                                activePlatePreview?.plateId === p.id
                              }
                              title={
                                p.imageDataUrl
                                  ? isPdfDataUrl(p.imageDataUrl)
                                    ? `Anteprima PDF Tav. ${p.number} (clicca per aprire o chiudere)`
                                    : `Anteprima immagine Tav. ${p.number} (clicca per aprire o chiudere)`
                                  : `Apri area anteprima / carica PNG, JPG o PDF per Tav. ${p.number}`
                              }
                              className={`rounded p-0.5 transition-colors ${
                                activePlatePreview?.plateId === p.id
                                  ? 'bg-blue-700 text-white'
                                  : p.imageDataUrl
                                  ? 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                                  : p.notes
                                  ? 'text-amber-600 hover:bg-white hover:text-amber-700'
                                  : 'text-slate-400 hover:bg-white hover:text-blue-700'
                              }`}
                            >
                              <StickyNote className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onEditPlate(p)}
                              title="Modifica dettagli e date tavola"
                              className="rounded p-0.5 text-slate-500 hover:bg-white hover:text-blue-700"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </th>
                  );
                }

                // Compact Cartellina Group Header (colSpan 4)
                const f = col.folder;
                const folderW =
                  dims.dateColW +
                  dims.delayColW +
                  dims.avgColW +
                  dims.finalColW;
                const interval = formatPlateInterval(
                  f.plateIds,
                  classData.plates
                );
                const isCollapsed = collapsedFolderSet.has(f.id);

                return (
                  <th
                    key={`h1-${f.id}`}
                    scope="colgroup"
                    colSpan={4}
                    style={{
                      width: folderW,
                      minWidth: folderW,
                      maxWidth: folderW,
                    }}
                    className={`sticky top-0 z-20 ${row1HeightClass} border-r-2 border-b border-l-2 border-blue-300 px-1.5 py-1.5 align-top transition-colors ${
                      isCollapsed ? 'bg-blue-100/85' : 'bg-blue-50'
                    }`}
                  >
                    <div className={`flex h-full ${row1InnerMinHClass} flex-col justify-between gap-2`}>
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex min-w-0 flex-1 items-start gap-1 text-[11.5px] font-bold leading-[1.25] text-blue-950">
                          <FolderCheck className="mt-[2px] h-3.5 w-3.5 shrink-0 text-blue-700" />
                          <span className="min-w-0 flex-1 break-words whitespace-normal">
                            {f.title}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => toggleFolderCollapse(f.id)}
                            aria-expanded={!isCollapsed}
                            aria-label={
                              isCollapsed
                                ? `Espandi tavole di ${f.title}`
                                : `Compatta tavole di ${f.title}`
                            }
                            title={
                              isCollapsed
                                ? `Espandi le tavole di ${f.title}`
                                : `Compatta/nascondi le tavole di ${f.title}`
                            }
                            className={`inline-flex items-center rounded border p-1 transition-colors ${
                              isCollapsed
                                ? 'border-blue-400 bg-blue-700 text-white hover:bg-blue-800'
                                : 'border-blue-200 bg-white text-blue-800 hover:bg-blue-100'
                            }`}
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditFolder(f)}
                            title={`Configura ${f.title}`}
                            className="inline-flex items-center rounded border border-blue-200 bg-white p-1 text-blue-800 hover:bg-blue-100"
                          >
                            <Pencil className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1 text-[10px]">
                        <div className="break-words font-medium leading-tight text-blue-800">
                          {interval}
                        </div>
                        {isCollapsed && (
                          <div className="inline-flex items-center gap-1 rounded border border-blue-300 bg-white/90 px-1.5 py-0.5 text-[9.5px] font-semibold text-blue-900">
                            Compattata · {f.plateIds.length} tav. nascoste
                          </div>
                        )}
                        <div className="font-mono tabular-nums text-blue-900">
                          Prev.{' '}
                          <strong>
                            {f.dueDate
                              ? formatShortMonthDateIt(f.dueDate)
                              : '—'}
                          </strong>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenFolderStats(f)}
                          title={`Statistiche classe per ${f.title}`}
                          className="inline-flex w-full items-center justify-center gap-1 rounded border border-blue-200 bg-white px-2 py-1 text-[10.5px] font-semibold text-blue-900 shadow-2xs transition-colors hover:border-blue-300 hover:bg-blue-100/70 whitespace-nowrap"
                        >
                          <BarChart3 className="h-3 w-3 shrink-0 text-blue-700" />
                          Statistiche classe
                        </button>
                      </div>
                    </div>
                  </th>
                );
              })}

              {/* End quick-add column */}
              <th
                scope="col"
                rowSpan={2}
                className="sticky top-0 z-20 w-[86px] min-w-[86px] border-r border-b border-slate-300 bg-slate-100 px-1 py-1.5 align-middle"
              >
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={onAddPlate}
                    className="inline-flex items-center justify-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[10.5px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Plus className="h-3 w-3" />
                    Tavola
                  </button>
                  <button
                    type="button"
                    onClick={onAddFolder}
                    className="inline-flex items-center justify-center gap-1 rounded border border-blue-300 bg-blue-50 px-1.5 py-1 text-[10.5px] font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap"
                  >
                    <Plus className="h-3 w-3" />
                    Cartellina
                  </button>
                </div>
              </th>
            </tr>

            {/* HEADER ROW 2: Subcolumns (STATO | VOTO) and (Data | Rit. | Media | Voto) */}
            <tr>
              {columns.map((col, colIdx) => {
                if (col.kind === 'plate') {
                  const p = col.plate;
                  const nextCol = columns[colIdx + 1];
                  const endsGroup =
                    nextCol &&
                    (nextCol.kind === 'folder' ||
                      (nextCol.kind === 'plate' &&
                        nextCol.groupIdx !== col.groupIdx));
                  return (
                    <FragmentSubHeaders
                      key={`h2-${p.id}`}
                      stColW={dims.stColW}
                      gradeColW={dims.gradeColW}
                      topPx={row1Height}
                      endsGroup={Boolean(endsGroup)}
                    />
                  );
                }

                const f = col.folder;
                return (
                  <FragmentFolderSubHeaders
                    key={`h2-${f.id}`}
                    dims={dims}
                    topPx={row1Height}
                  />
                );
              })}
            </tr>
          </thead>

          <tbody>
            {sortedStudents.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    columns.reduce(
                      (acc, c) => acc + (c.kind === 'plate' ? 2 : 4),
                      0
                    ) + 2
                  }
                  className="px-6 py-12 text-center text-sm text-slate-500"
                >
                  Nessuno studente inserito in questa classe.
                </td>
              </tr>
            ) : (
              sortedStudents.map((stu, visibleIdx) => {
                const fullName = `${stu.lastName} ${stu.firstName}`.trim();
                const realIdx = studentIndexMap.get(stu.id) ?? visibleIdx;
                const canReorder = true;
                const hasRowHighlight = highlightedStudentId !== null;
                const isRowHighlighted = highlightedStudentId === stu.id;
                const isRowDimmed = hasRowHighlight && !isRowHighlighted;

                return (
                  <tr
                    key={stu.id}
                    onDragOver={(e) => {
                      if (dragIndex !== null) e.preventDefault();
                    }}
                    onDrop={() => {
                      if (dragIndex !== null && dragIndex !== realIdx) {
                        onReorderStudent(dragIndex, realIdx);
                      }
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className={`group/row transition-colors duration-150 ${
                      isRowHighlighted
                        ? 'bg-blue-50/50'
                        : isRowDimmed
                        ? '[&_button]:opacity-40 [&_button]:grayscale-[40%] [&_input]:opacity-40'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    {/* Sticky Student Name Column */}
                    <td
                      onPointerDown={(e) => handleStudentHoldStart(e, stu.id)}
                      onContextMenu={(e) => e.preventDefault()}
                      style={{
                        width: dims.studentW,
                        minWidth: dims.studentW,
                        maxWidth: dims.studentW,
                        WebkitUserSelect: 'none',
                        WebkitTouchCallout: 'none',
                        userSelect: 'none',
                      }}
                      className={`sticky left-0 z-10 h-[34px] select-none border-r-2 border-b border-slate-200 border-r-slate-300 px-1.5 py-0 transition-colors duration-150 ${
                        isRowHighlighted
                          ? 'bg-blue-100 text-blue-950 shadow-[inset_0_2px_0_0_#2563eb,inset_0_-2px_0_0_#2563eb,inset_2px_0_0_0_#2563eb,2px_0_6px_-2px_rgba(37,99,235,0.28)]'
                          : isRowDimmed
                          ? 'bg-slate-200/95 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.06)]'
                          : 'bg-white group-hover/row:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)]'
                      }`}
                    >
                      <div
                        className={`relative flex h-full items-center gap-1 transition-opacity duration-150 ${
                          isRowDimmed ? 'opacity-45' : ''
                        }`}
                      >
                        {canReorder && (
                          <span
                            data-no-row-highlight="true"
                            draggable={canReorder}
                            onDragStart={(e) => {
                              setDragIndex(realIdx);
                              const row = e.currentTarget.closest('tr');
                              if (row && e.dataTransfer) {
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData(
                                  'text/plain',
                                  String(realIdx)
                                );
                                e.dataTransfer.setDragImage(row, 16, 16);
                              }
                            }}
                            onDragEnd={() => setDragIndex(null)}
                            className="shrink-0 cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                            title="Trascina per riordinare"
                          >
                            <GripVertical className="h-3 w-3" />
                          </span>
                        )}
                        <span
                          className={`w-6 shrink-0 font-mono text-[10px] tabular-nums ${
                            isRowHighlighted
                              ? 'font-semibold text-blue-800'
                              : 'text-slate-400'
                          }`}
                          title={
                            stu.supportNeeds && stu.supportNeeds.length > 0
                              ? `Indicazioni: ${stu.supportNeeds.join(', ')}`
                              : undefined
                          }
                        >
                          {visibleIdx + 1}.
                          {stu.supportNeeds && stu.supportNeeds.length > 0 && (
                            <span
                              aria-label={`Indicazioni: ${stu.supportNeeds.join(', ')}`}
                              className="ml-0.5 font-sans text-[11px] font-bold text-amber-600"
                            >
                              *
                            </span>
                          )}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-[12.5px] ${
                            isRowHighlighted
                              ? 'font-semibold text-blue-950'
                              : 'font-medium text-slate-900'
                          }`}
                          title={fullName}
                        >
                          {fullName}
                        </span>

                        <div
                          data-no-row-highlight="true"
                          className={`absolute top-1/2 right-0 -translate-y-1/2 items-center gap-0.5 rounded border border-slate-200 bg-slate-50/95 px-0.5 py-0.5 shadow-sm ${
                            isRowHighlighted
                              ? 'flex'
                              : 'hidden group-hover/row:flex group-focus-within/row:flex'
                          }`}
                        >
                          {canReorder && (
                            <>
                              <button
                                type="button"
                                disabled={realIdx === 0}
                                onClick={() =>
                                  onReorderStudent(realIdx, realIdx - 1)
                                }
                                title="Sposta su"
                                className="rounded p-0.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 disabled:opacity-30"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                disabled={
                                  realIdx === sortedStudents.length - 1
                                }
                                onClick={() =>
                                  onReorderStudent(realIdx, realIdx + 1)
                                }
                                title="Sposta giù"
                                className="rounded p-0.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 disabled:opacity-30"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenStudentStats(stu)}
                            title="Statistiche"
                            aria-label={`Statistiche di ${fullName}`}
                            className="rounded p-0.5 text-slate-500 hover:bg-slate-200/70 hover:text-blue-700"
                          >
                            <BarChart3 className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditStudent(stu)}
                            title="Modifica studente"
                            className="rounded p-0.5 text-slate-500 hover:bg-slate-200/70 hover:text-blue-700"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteStudent(stu)}
                            title="Elimina studente"
                            className="rounded p-0.5 text-slate-500 hover:bg-rose-100 hover:text-rose-700"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Plate & Cartellina Cells */}
                    {columns.map((col, colIdx) => {
                      if (col.kind === 'plate') {
                        const p = col.plate;
                        const cell =
                          classData.evaluations[stu.id]?.[p.id] ??
                          EMPTY_EVALUATION;
                        const statusMeta = cell.status
                          ? STATUS_META[cell.status]
                          : null;

                        const nextCol = columns[colIdx + 1];
                        const endsGroup =
                          nextCol &&
                          (nextCol.kind === 'folder' ||
                            (nextCol.kind === 'plate' &&
                              nextCol.groupIdx !== col.groupIdx));

                        const isStatusSelected =
                          activePopover?.mode === 'status' &&
                          activePopover.studentId === stu.id &&
                          activePopover.plateId === p.id;

                        const isGradeSelected =
                          (activePopover?.mode === 'grade' &&
                            activePopover.studentId === stu.id &&
                            activePopover.plateId === p.id) ||
                          (!activePopover &&
                            focusedGradeCell?.studentId === stu.id &&
                            focusedGradeCell?.plateId === p.id);

                        const statusCellBg = statusMeta
                          ? cell.status === 'SI'
                            ? cell.wasNo
                              ? 'bg-lime-200/80 text-lime-950 hover:bg-lime-300/75'
                              : 'bg-emerald-100/85 text-emerald-950 hover:bg-emerald-200/70'
                            : cell.status === 'NO'
                            ? 'bg-rose-100/85 text-rose-950 hover:bg-rose-200/70'
                            : cell.status === 'ASS'
                            ? 'bg-yellow-100/90 text-yellow-950 hover:bg-yellow-200/70'
                            : 'bg-orange-100/85 text-orange-950 hover:bg-orange-200/70'
                          : isRowHighlighted
                          ? 'bg-blue-50/50 text-slate-300 hover:bg-blue-100/70'
                          : 'bg-white text-slate-300 hover:bg-slate-100';

                        return (
                          <FragmentPlateCells
                            key={`cell-${stu.id}-${p.id}`}
                            studentId={stu.id}
                            plateId={p.id}
                            stColW={dims.stColW}
                            gradeColW={dims.gradeColW}
                            endsGroup={Boolean(endsGroup)}
                            statusCellBg={statusCellBg}
                            isStatusSelected={isStatusSelected}
                            isGradeSelected={isGradeSelected}
                            isRowHighlighted={isRowHighlighted}
                            isRowDimmed={isRowDimmed}
                            cell={cell}
                            statusLabel={
                              statusMeta ? statusMeta.label : 'Nessuno stato'
                            }
                            studentName={fullName}
                            plateNumber={p.number}
                            onClickStatus={handleOpenCellStatus}
                            onClickGrade={handleOpenCellGrade}
                            onFocusGrade={handleFocusGradeCell}
                            onBlurGrade={handleBlurGradeCell}
                            onFocusStatus={handleClearFocusGradeCell}
                          />
                        );
                      }

                      // Compact Cartellina 4 subcolumns
                      const f = col.folder;
                      const rec =
                        classData.folderRecords[stu.id]?.[f.id] ??
                        EMPTY_FOLDER_RECORD;
                      const calc =
                        folderEvalMap.get(`${stu.id}::${f.id}`) ??
                        calculateFolderEvaluation(classData, stu.id, f);
                      const isDateSelected =
                        activeDatePopover?.studentId === stu.id &&
                        activeDatePopover.folderId === f.id;
                      const isFolderGradeSelected =
                        activeFolderGradePopover?.studentId === stu.id &&
                        activeFolderGradePopover.folderId === f.id;
                      const totalPenalty =
                        calc.penaltyNoTotal +
                        calc.penaltyMissingTotal +
                        calc.penaltyDelayTotal;

                      return (
                        <FragmentFolderCells
                          key={`fcell-${stu.id}-${f.id}`}
                          studentId={stu.id}
                          folder={f}
                          dims={dims}
                          actualDeliveryDate={rec.actualDeliveryDate}
                          status={rec.status}
                          manualDelayDays={rec.manualDelayDays ?? 0}
                          initialAverage={calc.initialAverage}
                          totalPenalty={totalPenalty}
                          finalGrade={calc.finalGrade}
                          isManualOverride={Boolean(calc.isManualOverride)}
                          isConfirmed={calc.isConfirmed}
                          isDateSelected={isDateSelected}
                          isFolderGradeSelected={isFolderGradeSelected}
                          isRowHighlighted={isRowHighlighted}
                          isRowDimmed={isRowDimmed}
                          studentName={fullName}
                          folderTitle={f.title}
                          onClickDate={handleOpenFolderDate}
                          onChangeDelayDays={handleChangeFolderDelayDays}
                          onClickFinalGrade={handleOpenFolderGrade}
                          onOpenDetail={handleOpenFolderDetail}
                        />
                      );
                    })}

                    <td
                      className={`h-[34px] w-[86px] min-w-[86px] border-r border-b border-slate-200 p-0 transition-colors duration-150 ${
                        isRowHighlighted
                          ? 'bg-blue-50/55 shadow-[inset_0_2px_0_0_#2563eb,inset_0_-2px_0_0_#2563eb,inset_-2px_0_0_0_#2563eb]'
                          : isRowDimmed
                          ? 'bg-slate-200/75'
                          : 'bg-slate-50/30'
                      }`}
                    />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Compact bottom legend + always-accessible Add Student / Folder actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-slate-700">Legenda:</span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3.5 w-5 rounded-sm border border-emerald-200 bg-emerald-100 text-center font-mono text-[9px] font-bold leading-[13px] text-emerald-900">
              SI
            </span>
            Consegnata
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3.5 w-5 rounded-sm border border-rose-200 bg-rose-100 text-center font-mono text-[9px] font-bold leading-[13px] text-rose-900">
              NO
            </span>
            Non cons. (penalità)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3.5 w-6 rounded-sm border border-yellow-300 bg-yellow-100 text-center font-mono text-[9px] font-bold leading-[13px] text-yellow-900">
              ASS
            </span>
            Assente (no pen.)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3.5 w-6 rounded-sm border border-orange-200 bg-orange-100 text-center font-mono text-[9px] font-bold leading-[13px] text-orange-900">
              WIP
            </span>
            In corso (no pen.)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3.5 w-6 rounded-sm border border-sky-200 bg-sky-100 text-center font-mono text-[9px] font-bold leading-[13px] text-sky-950">
              7+
            </span>
            Voto
          </span>
          <span className="inline-flex items-center gap-1 text-slate-500">
            <span className="relative inline-flex h-3.5 w-6 items-center justify-center rounded-sm border border-lime-300 bg-lime-200/85 font-mono text-[9px] font-bold text-lime-950">
              SI
              <span className="absolute -top-0.5 right-0.5 font-mono text-[11px] font-black leading-none text-rose-600">
                *
              </span>
            </span>
            <span>= ex-NO</span>
          </span>
          <span className="inline-flex items-center gap-1 text-slate-500">
            <span className="font-mono text-[10px] font-semibold text-slate-600">
              N°<span className="font-sans font-bold text-amber-600">*</span>
            </span>
            <span>= DSA / BES / H</span>
          </span>
        </div>
      </div>

      {/* Plate Image Preview & Upload Popover */}
      {activePlatePreview && activePlatePreviewPlate && (
        <PlatePreviewPopover
          plate={activePlatePreviewPlate}
          anchorRect={activePlatePreview.rect}
          onUpdateTitle={(newTitle) =>
            onUpdatePlateTitle(activePlatePreviewPlate.id, newTitle)
          }
          onUpdateImage={(img) =>
            onUpdatePlateImage(activePlatePreviewPlate.id, img)
          }
          onOpenFullViewer={() => setViewerPlateId(activePlatePreviewPlate.id)}
          onClose={() => setActivePlatePreview(null)}
        />
      )}

      {/* Fullscreen Zoomable Plate Image Viewer */}
      <PlateImageViewerModal
        plate={viewerPlate}
        onClose={() => setViewerPlateId(null)}
      />

      {/* Inline Status / Grade Popover */}
      {activePopoverData && (
        <CellPopover
          mode={activePopoverData.mode}
          anchorRect={activePopoverData.rect}
          studentName={`${activePopoverData.student.lastName} ${activePopoverData.student.firstName}`}
          plateNumber={activePopoverData.plate.number}
          plateTitle={activePopoverData.plate.title}
          evaluation={activePopoverData.evaluation}
          onChange={(patch) =>
            onUpdateCell(
              activePopoverData.student.id,
              activePopoverData.plate.id,
              patch
            )
          }
          onClose={() => {
            const closing = activePopoverData;
            setActivePopover(null);
            if (closing?.mode === 'grade') {
              const cellKey = `${closing.student.id}::${closing.plate.id}`;
              window.requestAnimationFrame(() => {
                const btn = scrollContainerRef.current?.querySelector(
                  `[data-grade-cell="${cellKey}"]`
                ) as HTMLElement | null;
                btn?.focus();
              });
            }
          }}
        />
      )}

      {/* Inline Cartellina Date & Status Popover */}
      {activeDatePopoverData && (
        <FolderDatePopover
          anchorRect={activeDatePopoverData.rect}
          studentName={`${activeDatePopoverData.student.lastName} ${activeDatePopoverData.student.firstName}`}
          folderTitle={activeDatePopoverData.folder.title}
          dueDate={activeDatePopoverData.folder.dueDate}
          actualDeliveryDate={activeDatePopoverData.record.actualDeliveryDate}
          manualDelayDays={activeDatePopoverData.record.manualDelayDays ?? 0}
          status={activeDatePopoverData.record.status}
          isLocked={activeDatePopoverData.isLocked}
          onUpdate={(patch) =>
            onUpdateFolderStudentRecord(
              activeDatePopoverData.student.id,
              activeDatePopoverData.folder.id,
              patch
            )
          }
          onOpenDetail={() =>
            onOpenFolderStudent(
              activeDatePopoverData.student.id,
              activeDatePopoverData.folder
            )
          }
          onClose={() => setActiveDatePopover(null)}
        />
      )}

      {/* Inline Cartellina Final Grade Popover */}
      {activeFolderGradePopoverData && (
        <FolderGradePopover
          anchorRect={activeFolderGradePopoverData.rect}
          studentName={`${activeFolderGradePopoverData.student.lastName} ${activeFolderGradePopoverData.student.firstName}`}
          folderTitle={activeFolderGradePopoverData.folder.title}
          currentGrade={activeFolderGradePopoverData.calc.finalGrade}
          suggestedGrade={activeFolderGradePopoverData.calc.suggestedFinalGrade}
          isManualOverride={Boolean(
            activeFolderGradePopoverData.calc.isManualOverride
          )}
          isLocked={activeFolderGradePopoverData.calc.isConfirmed}
          onSelectGrade={(grade) =>
            onUpdateFolderStudentRecord(
              activeFolderGradePopoverData.student.id,
              activeFolderGradePopoverData.folder.id,
              {
                manualFinalGrade: grade,
                manualGradeOverridden: grade !== null,
              }
            )
          }
          onOpenDetail={() =>
            onOpenFolderStudent(
              activeFolderGradePopoverData.student.id,
              activeFolderGradePopoverData.folder
            )
          }
          onClose={() => setActiveFolderGradePopover(null)}
        />
      )}
    </div>
  );
}

const FragmentSubHeaders = memo(function FragmentSubHeaders({
  stColW,
  gradeColW,
  topPx,
  endsGroup,
}: {
  stColW: number;
  gradeColW: number;
  topPx: number;
  endsGroup: boolean;
}) {
  return (
    <>
      <th
        scope="col"
        style={{ width: stColW, minWidth: stColW, maxWidth: stColW, top: topPx }}
        className="sticky z-20 h-[26px] border-r border-b border-slate-300 bg-slate-50 p-0 text-center text-[9px] font-semibold tracking-tight text-slate-600"
      >
        ST
      </th>
      <th
        scope="col"
        style={{
          width: gradeColW,
          minWidth: gradeColW,
          maxWidth: gradeColW,
          top: topPx,
        }}
        className={`sticky z-20 h-[26px] border-b border-slate-300 bg-sky-50/80 p-0 text-center text-[9px] font-semibold tracking-tight text-sky-900 ${
          endsGroup
            ? 'border-r-2 border-r-slate-500'
            : 'border-r-2 border-r-slate-400'
        }`}
      >
        VOTO
      </th>
    </>
  );
});

const FragmentFolderSubHeaders = memo(function FragmentFolderSubHeaders({
  dims,
  topPx,
}: {
  dims: FixedTableDims;
  topPx: number;
}) {
  return (
    <>
      <th
        scope="col"
        style={{
          width: dims.dateColW,
          minWidth: dims.dateColW,
          maxWidth: dims.dateColW,
          top: topPx,
        }}
        className="sticky z-20 h-[26px] border-r border-b border-l-2 border-blue-300 border-r-blue-200 bg-blue-50/70 p-0 text-center text-[9px] font-semibold text-blue-900"
      >
        Data
      </th>
      <th
        scope="col"
        style={{
          width: dims.delayColW,
          minWidth: dims.delayColW,
          maxWidth: dims.delayColW,
          top: topPx,
        }}
        title="Giorni di ritardo (0–10)"
        className="sticky z-20 h-[26px] border-r border-b border-blue-200 border-b-blue-300 bg-blue-50/70 p-0 text-center text-[9px] font-semibold text-blue-900"
      >
        Rit.
      </th>
      <th
        scope="col"
        style={{
          width: dims.avgColW,
          minWidth: dims.avgColW,
          maxWidth: dims.avgColW,
          top: topPx,
        }}
        title="Media aritmetica dei voti delle tavole (prima delle penalità)"
        className="sticky z-20 h-[26px] border-r border-b border-blue-200 border-b-blue-300 bg-blue-50/70 px-0.5 py-0 text-center text-[8.5px] font-semibold leading-[1.05] text-blue-900"
      >
        Media voti
      </th>
      <th
        scope="col"
        style={{
          width: dims.finalColW,
          minWidth: dims.finalColW,
          maxWidth: dims.finalColW,
          top: topPx,
        }}
        title="Voto finale effettivo dopo l'applicazione delle penalità"
        className="sticky z-20 h-[26px] border-r-2 border-b border-blue-300 bg-blue-100/90 px-0.5 py-0 text-center text-[8.5px] font-bold leading-[1.05] text-blue-950"
      >
        Voto finale
      </th>
    </>
  );
});

const FragmentPlateCells = memo(function FragmentPlateCells({
  studentId,
  plateId,
  stColW,
  gradeColW,
  endsGroup,
  statusCellBg,
  isStatusSelected,
  isGradeSelected,
  isRowHighlighted,
  isRowDimmed,
  cell,
  statusLabel,
  studentName,
  plateNumber,
  onClickStatus,
  onClickGrade,
  onFocusGrade,
  onBlurGrade,
  onFocusStatus,
}: {
  studentId: string;
  plateId: string;
  stColW: number;
  gradeColW: number;
  endsGroup: boolean;
  statusCellBg: string;
  isStatusSelected: boolean;
  isGradeSelected: boolean;
  isRowHighlighted: boolean;
  isRowDimmed: boolean;
  cell: PlateEvaluation;
  statusLabel: string;
  studentName: string;
  plateNumber: number;
  onClickStatus: (studentId: string, plateId: string, rect: DOMRect) => void;
  onClickGrade: (studentId: string, plateId: string, rect: DOMRect) => void;
  onFocusGrade: (studentId: string, plateId: string) => void;
  onBlurGrade: (relatedTarget: EventTarget | null) => void;
  onFocusStatus: () => void;
}) {
  const hasExNoPenalty = cell.wasNo && cell.status === 'SI';
  const rowHighlightShadow = isRowHighlighted
    ? 'shadow-[inset_0_2px_0_0_#2563eb,inset_0_-2px_0_0_#2563eb]'
    : '';
  const dimmedCellBg = isRowDimmed ? 'bg-slate-200/75' : '';

  return (
    <>
      {/* STATO subcell */}
      <td
        style={{ width: stColW, minWidth: stColW, maxWidth: stColW }}
        className={`h-[34px] border-r border-b border-slate-200 p-0 align-middle transition-colors duration-150 ${dimmedCellBg} ${rowHighlightShadow}`}
      >
        <button
          type="button"
          data-status-cell={`${studentId}::${plateId}`}
          onFocus={onFocusStatus}
          onClick={(e) =>
            onClickStatus(
              studentId,
              plateId,
              e.currentTarget.getBoundingClientRect()
            )
          }
          title={`${studentName} · Tav. ${plateNumber} Stato: ${statusLabel}${
            hasExNoPenalty
              ? ' * (consegnata dopo controllo: penalità ex-NO attiva)'
              : ''
          }`}
          className={`relative flex h-full w-full items-center justify-center p-0 font-mono text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${statusCellBg} ${
            isStatusSelected ? 'ring-2 ring-inset ring-blue-700' : ''
          }`}
        >
          <span>{cell.status ?? '—'}</span>
          {hasExNoPenalty && (
            <span
              aria-label="Penalità ex-NO attiva"
              className="pointer-events-none absolute top-0 right-0.5 font-mono text-[15px] font-black leading-none text-rose-600"
            >
              *
            </span>
          )}
        </button>
      </td>

      {/* VOTO subcell */}
      <td
        style={{ width: gradeColW, minWidth: gradeColW, maxWidth: gradeColW }}
        className={`h-[34px] border-b border-slate-200 p-0 align-middle transition-colors duration-150 ${
          endsGroup
            ? 'border-r-2 border-r-slate-500'
            : 'border-r-2 border-r-slate-400'
        } ${dimmedCellBg} ${rowHighlightShadow}`}
      >
        <button
          type="button"
          data-grade-cell={`${studentId}::${plateId}`}
          onFocus={() => onFocusGrade(studentId, plateId)}
          onBlur={(e) => onBlurGrade(e.relatedTarget)}
          onClick={(e) =>
            onClickGrade(
              studentId,
              plateId,
              e.currentTarget.getBoundingClientRect()
            )
          }
          style={
            cell.grade !== null ? getGradeColorStyle(cell.grade) : undefined
          }
          title={`${studentName} · Tav. ${plateNumber} Voto: ${formatGradeLabel(
            cell.grade
          )}${cell.grade !== null ? ' (Canc per rimuovere)' : ''}`}
          className={`flex h-full w-full items-center justify-center p-0 font-mono text-[13.5px] tabular-nums transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
            cell.grade !== null
              ? `font-bold hover:brightness-95 ${isRowDimmed ? 'opacity-70' : ''}`
              : isRowHighlighted
              ? 'bg-blue-50/60 font-normal text-slate-400 hover:bg-sky-100/60'
              : 'bg-sky-50/45 font-normal text-slate-300 hover:bg-sky-100/50'
          } ${isGradeSelected ? 'ring-2 ring-inset ring-blue-700' : ''}`}
        >
          <span>{formatGradeLabel(cell.grade)}</span>
        </button>
      </td>
    </>
  );
});

function DelayDaysCellSelect({
  value,
  disabled,
  studentName,
  folderTitle,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  studentName: string;
  folderTitle: string;
  onCommit: (days: number) => void;
}) {
  const safeVal = Math.min(10, Math.max(0, Math.floor(value || 0)));

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <span
        aria-hidden="true"
        className={`pointer-events-none font-mono text-[11px] tabular-nums ${
          safeVal > 0
            ? 'font-bold text-amber-800'
            : 'font-normal text-slate-400'
        }`}
      >
        {safeVal === 0 ? '0' : `${safeVal}g`}
      </span>
      <select
        disabled={disabled}
        value={safeVal}
        aria-label={`Giorni di ritardo per ${studentName} in ${folderTitle}`}
        title={
          safeVal === 0
            ? `${studentName} · ${folderTitle}: 0 giorni (consegna puntuale) — clicca per selezionare ritardo (0–10 giorni)`
            : `${studentName} · ${folderTitle}: ${safeVal} ${
                safeVal === 1 ? 'giorno' : 'giorni'
              } di ritardo — clicca per modificare (0–10)`
        }
        onChange={(e) => onCommit(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus:outline-none disabled:cursor-not-allowed"
      >
        <option value={0}>0 giorni (consegna puntuale)</option>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => (
          <option key={d} value={d}>
            {d === 1 ? '1 giorno di ritardo' : `${d} giorni di ritardo`}
          </option>
        ))}
      </select>
    </div>
  );
}

const FragmentFolderCells = memo(function FragmentFolderCells({
  studentId,
  folder,
  dims,
  actualDeliveryDate,
  status,
  manualDelayDays,
  initialAverage,
  totalPenalty,
  finalGrade,
  isManualOverride,
  isConfirmed,
  isDateSelected,
  isFolderGradeSelected,
  isRowHighlighted,
  isRowDimmed,
  studentName,
  folderTitle,
  onClickDate,
  onChangeDelayDays,
  onClickFinalGrade,
  onOpenDetail,
}: {
  studentId: string;
  folder: FolderDelivery;
  dims: FixedTableDims;
  actualDeliveryDate: string;
  status: FolderDeliveryStatus;
  manualDelayDays: number;
  initialAverage: number | null;
  totalPenalty: number;
  finalGrade: number | null;
  isManualOverride: boolean;
  isConfirmed: boolean;
  isDateSelected: boolean;
  isFolderGradeSelected: boolean;
  isRowHighlighted: boolean;
  isRowDimmed: boolean;
  studentName: string;
  folderTitle: string;
  onClickDate: (studentId: string, folderId: string, rect: DOMRect) => void;
  onChangeDelayDays: (studentId: string, folderId: string, days: number) => void;
  onClickFinalGrade: (studentId: string, folderId: string, rect: DOMRect) => void;
  onOpenDetail: (studentId: string, folder: FolderDelivery) => void;
}) {
  const dateColorClass =
    status === 'consegnata'
      ? 'text-emerald-800'
      : status === 'consegnata_ritardo'
      ? 'text-amber-800'
      : status === 'non_consegnata'
      ? 'text-rose-700'
      : 'text-slate-500';
  const rowHighlightShadow = isRowHighlighted
    ? 'shadow-[inset_0_2px_0_0_#2563eb,inset_0_-2px_0_0_#2563eb]'
    : '';
  const normalCellBg = isRowDimmed
    ? 'bg-slate-200/75'
    : isRowHighlighted
    ? 'bg-blue-50/55'
    : 'bg-white';

  return (
    <>
      {/* 1. Data effettiva (GG-mmm) */}
      <td
        style={{
          width: dims.dateColW,
          minWidth: dims.dateColW,
          maxWidth: dims.dateColW,
        }}
        className={`h-[34px] border-r border-b border-l-2 border-slate-200 border-l-blue-300 border-r-blue-100 p-0 align-middle transition-colors duration-150 ${normalCellBg} ${rowHighlightShadow}`}
      >
        <button
          type="button"
          onClick={(e) =>
            onClickDate(
              studentId,
              folder.id,
              e.currentTarget.getBoundingClientRect()
            )
          }
          title={`${studentName} · ${folderTitle}: clicca per modificare data effettiva, ritardo (0–10) e stato consegna`}
          className={`flex h-full w-full items-center justify-center p-0 font-mono text-[10.5px] tabular-nums hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${dateColorClass} ${
            isDateSelected ? 'bg-blue-50 ring-2 ring-inset ring-blue-700' : ''
          }`}
        >
          {actualDeliveryDate
            ? formatShortMonthDateIt(actualDeliveryDate)
            : status === 'non_consegnata'
            ? 'N.C.'
            : '—'}
        </button>
      </td>

      {/* 2. Giorni di ritardo (selettore 0-10) */}
      <td
        style={{
          width: dims.delayColW,
          minWidth: dims.delayColW,
          maxWidth: dims.delayColW,
        }}
        className={`h-[34px] border-r border-b border-slate-200 border-r-blue-100 p-0 align-middle transition-colors duration-150 hover:bg-blue-50/60 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-600 ${normalCellBg} ${rowHighlightShadow}`}
      >
        <DelayDaysCellSelect
          value={manualDelayDays}
          disabled={isConfirmed}
          studentName={studentName}
          folderTitle={folderTitle}
          onCommit={(days) => onChangeDelayDays(studentId, folder.id, days)}
        />
      </td>

      {/* 3. Media voti (prima delle penalità, con indicazione compatta penalità totali) */}
      <td
        style={{
          width: dims.avgColW,
          minWidth: dims.avgColW,
          maxWidth: dims.avgColW,
        }}
        className={`h-[34px] border-r border-b border-slate-200 border-r-blue-100 p-0 align-middle transition-colors duration-150 ${normalCellBg} ${rowHighlightShadow}`}
      >
        <button
          type="button"
          onClick={() => onOpenDetail(studentId, folder)}
          title={
            totalPenalty > 0
              ? `Media voti (prima delle penalità): ${
                  initialAverage !== null
                    ? formatDecimalIt(initialAverage, 2)
                    : '—'
                } · Penalità totali: -${formatDecimalIt(totalPenalty, 2)} pt (clicca per dettaglio)`
              : `Media voti: ${
                  initialAverage !== null
                    ? formatDecimalIt(initialAverage, 2)
                    : '—'
                } · Nessuna penalità (clicca per dettaglio)`
          }
          className="flex h-full w-full flex-col items-center justify-center p-0 font-mono leading-tight tabular-nums hover:bg-blue-50/60"
        >
          <span className="text-[11px] font-semibold text-slate-700">
            {initialAverage !== null ? formatDecimalIt(initialAverage, 2) : '—'}
          </span>
          {totalPenalty > 0 && (
            <span className="font-sans text-[9.5px] font-semibold leading-none tracking-tight tabular-nums text-rose-600">
              -{formatDecimalIt(totalPenalty, 2)}
            </span>
          )}
        </button>
      </td>

      {/* 4. Voto finale (dopo le penalità, aggiornato automaticamente) */}
      {(() => {
        const isFolderNotDelivered =
          status === 'da_consegnare' || status === 'non_consegnata';
        const finalGradeStyle = getGradeColorStyle(finalGrade);
        const tdClass = isFolderNotDelivered
          ? isRowDimmed
            ? 'bg-yellow-100/60'
            : isRowHighlighted
            ? 'bg-yellow-100'
            : 'bg-yellow-100/90'
          : isRowDimmed
          ? 'bg-slate-200/80'
          : isRowHighlighted
          ? 'bg-blue-100'
          : 'bg-blue-100/75';

        return (
          <td
            style={{
              width: dims.finalColW,
              minWidth: dims.finalColW,
              maxWidth: dims.finalColW,
            }}
            data-folder-not-delivered={isFolderNotDelivered ? 'true' : 'false'}
            className={`h-[34px] border-r-2 border-b border-slate-200 border-r-blue-300 p-0 align-middle transition-colors duration-150 ${tdClass} ${rowHighlightShadow}`}
          >
            <button
              type="button"
              onClick={(e) =>
                onClickFinalGrade(
                  studentId,
                  folder.id,
                  e.currentTarget.getBoundingClientRect()
                )
              }
              style={
                !isFolderNotDelivered && finalGradeStyle
                  ? finalGradeStyle
                  : undefined
              }
              title={
                isManualOverride
                  ? `${studentName} · ${folderTitle}: Voto finale (modifica manuale) — clicca per modificare o ripristinare calcolo automatico`
                  : isFolderNotDelivered
                  ? `${studentName} · ${folderTitle}: Cartellina non ancora consegnata — voto finale provvisorio dopo le penalità (clicca per modificare)`
                  : `${studentName} · ${folderTitle}: Voto finale calcolato automaticamente dopo le penalità — clicca per modificare`
              }
              className={`relative flex h-full w-full items-center justify-center gap-[1px] px-0.5 py-0 font-mono text-[17px] font-extrabold leading-none tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-700 ${
                isFolderNotDelivered
                  ? 'text-slate-900 hover:bg-yellow-200/70'
                  : finalGradeStyle
                  ? `hover:brightness-95 ${isRowDimmed ? 'opacity-75' : ''}`
                  : 'text-blue-950 hover:bg-blue-200/70'
              } ${isFolderGradeSelected ? 'ring-2 ring-inset ring-blue-700' : ''}`}
            >
              {isFolderNotDelivered && finalGradeStyle ? (
                <span
                  style={finalGradeStyle}
                  className="inline-flex items-center justify-center rounded-[3px] px-1.5 py-0.5 font-mono text-[15px] font-extrabold leading-none shadow-2xs"
                >
                  {formatGradeLabel(finalGrade)}
                </span>
              ) : (
                <span>{formatGradeLabel(finalGrade)}</span>
              )}
              {isConfirmed && (
                <Lock
                  className="h-2.5 w-2.5 shrink-0 opacity-85"
                  aria-label="Valutazione confermata"
                />
              )}
            </button>
          </td>
        );
      })()}
    </>
  );
});
