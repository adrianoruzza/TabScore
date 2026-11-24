import type {
  ClassData,
  ClassSettings,
  FolderCalculationBreakdown,
  FolderDelivery,
  FolderDeliveryStatus,
  FolderPlateBreakdownItem,
  FolderStudentRecord,
  Plate,
  PlateEvaluation,
  PlateStatus,
  RoundingMode,
} from '../types/gradebook';

/**
 * Formats numbers using Italian decimal comma formatting.
 */

export function formatDecimalIt(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace('.', ',');
}

export function formatGradeLabel(grade: number | null | undefined): string {
  if (grade === null || grade === undefined || Number.isNaN(grade)) {
    return '—';
  }
  const clamped = Math.min(10, Math.max(2, grade));
  const roundedQuarter = Math.round(clamped * 4) / 4;
  if (Math.abs(clamped - roundedQuarter) < 0.001) {
    const intPart = Math.floor(roundedQuarter);
    const frac = roundedQuarter - intPart;
    if (frac === 0) return `${intPart}`;
    if (frac === 0.25) return `${intPart}+`;
    if (frac === 0.5) return `${intPart}½`;
    if (frac === 0.75) return `${intPart + 1}-`;
  }
  return formatDecimalIt(clamped, 2);
}

export function clampGrade(value: number): number {
  return Math.min(10, Math.max(2, value));
}

export function roundGrade(value: number, mode: RoundingMode): number {
  const clamped = clampGrade(value);
  let rounded: number;
  switch (mode) {
    case 'quarter':
      rounded = Math.round(clamped * 4) / 4;
      break;
    case 'half':
      rounded = Math.round(clamped * 2) / 2;
      break;
    case 'integer':
      rounded = Math.round(clamped);
      break;
    case 'none':
    default:
      rounded = Math.round(clamped * 100) / 100;
      break;
  }
  return clampGrade(rounded);
}

export function parseUtcDateMs(dateStr: string): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function hasValidDeliveryDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}



const IT_MONTHS_SHORT = [
  'gen',
  'feb',
  'mar',
  'apr',
  'mag',
  'giu',
  'lug',
  'ago',
  'set',
  'ott',
  'nov',
  'dic',
];

export function formatDateIt(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function formatShortMonthDateIt(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '—';
  const [, m, d] = dateStr.split('-');
  const monthIdx = Number(m) - 1;
  const monthLabel = IT_MONTHS_SHORT[monthIdx] ?? m;
  return `${d}-${monthLabel}`;
}

export function formatPlateInterval(plateIds: string[], plates: Plate[]): string {
  const idSet = new Set(plateIds);
  const selectedNums = plates
    .filter((p) => idSet.has(p.id))
    .map((p) => p.number)
    .sort((a, b) => a - b);

  if (selectedNums.length === 0) return 'Nessuna tavola';

  const ranges: string[] = [];
  let start = selectedNums[0];
  let prev = selectedNums[0];

  for (let i = 1; i < selectedNums.length; i++) {
    const curr = selectedNums[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = curr;
      prev = curr;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);

  return selectedNums.length === 1
    ? `Tavola ${ranges[0]}`
    : `Tavole ${ranges.join(', ')}`;
}

export function sortPlates(plates: Plate[]): Plate[] {
  return [...plates].sort((a, b) => {
    const oa = a.order ?? a.number;
    const ob = b.order ?? b.number;
    if (oa !== ob) return oa - ob;
    return a.number - b.number;
  });
}

export const EMPTY_EVALUATION: PlateEvaluation = {
  status: null,
  grade: null,
  wasNo: false,
};

export const EMPTY_FOLDER_RECORD: FolderStudentRecord = {
  actualDeliveryDate: '',
  manualDelayDays: 0,
  manualFinalGrade: null,
  manualGradeOverridden: false,
  status: 'da_consegnare',
  notes: '',
  extraMissingPlateIds: [],
  confirmedSnapshot: null,
};

export function calculateFolderEvaluation(
  classData: ClassData,
  studentId: string,
  folder: FolderDelivery
): FolderCalculationBreakdown {
  const record =
    classData.folderRecords[studentId]?.[folder.id] ?? EMPTY_FOLDER_RECORD;

  // If evaluation is confirmed and locked, return the frozen snapshot untouched
  if (record.confirmedSnapshot) {
    return record.confirmedSnapshot;
  }

  return computeLiveFolderEvaluation(classData, studentId, folder, classData.settings);
}

export function computeLiveFolderEvaluation(
  classData: ClassData,
  studentId: string,
  folder: FolderDelivery,
  settings: ClassSettings
): FolderCalculationBreakdown {
  const record =
    classData.folderRecords[studentId]?.[folder.id] ?? EMPTY_FOLDER_RECORD;
  const studentEvals = classData.evaluations[studentId] ?? {};

  // Deduplicate plate IDs to guarantee zero penalty duplication
  const uniquePlateIds = Array.from(new Set(folder.plateIds));
  const plateMap = new Map(classData.plates.map((p) => [p.id, p]));

  const includedPlates = uniquePlateIds
    .map((id) => plateMap.get(id))
    .filter((p): p is Plate => Boolean(p))
    .sort((a, b) => a.number - b.number);

  let gradeSum = 0;
  let gradedCount = 0;
  let noCount = 0;
  let missingCount = 0;

  const plateItems: FolderPlateBreakdownItem[] = includedPlates.map((plate) => {
    const evalCell = studentEvals[plate.id] ?? EMPTY_EVALUATION;
    const status = evalCell.status;
    const grade = evalCell.grade;
    const wasNo = Boolean(evalCell.wasNo);

    if (grade !== null && !Number.isNaN(grade)) {
      gradeSum += grade;
      gradedCount += 1;
    }

    // Strict state rules:
    // - ASS (assente) & WIP (in lavorazione): NEVER count as NO and NEVER count as missing.
    // - Current NO: counts as NO penalty AND as missing at final delivery.
    // - Previously NO, subsequently delivered (status === 'SI' && wasNo): counts ONLY as NO penalty, NOT missing.
    const countsAsNo = status === 'NO' || (status === 'SI' && wasNo);
    const countsAsMissing = status === 'NO';

    if (countsAsNo) noCount += 1;
    if (countsAsMissing) missingCount += 1;

    return {
      plateId: plate.id,
      plateNumber: plate.number,
      plateTitle: plate.title,
      status,
      grade,
      wasNo,
      countsAsNo,
      countsAsMissing,
      isExtraMissing: false,
    };
  });

  const student = classData.students.find((s) => s.id === studentId);
  const isPenaltyExempt = Boolean(
    student?.exemptFromPenalties &&
      student.supportNeeds &&
      student.supportNeeds.length > 0
  );

  const initialAverage = gradedCount > 0 ? gradeSum / gradedCount : null;

  // Manual delay days entered by teacher (0-10), minus optional tolerance days from class settings
  const rawDelayDays = Math.max(0, Math.floor(record.manualDelayDays ?? 0));
  const safeTolerance = Math.max(0, Math.floor(settings.toleranceDays || 0));
  const chargeableDelayDays = Math.max(0, rawDelayDays - safeTolerance);

  const penaltyNoTotal = isPenaltyExempt ? 0 : round2(noCount * settings.penaltyNo);
  const penaltyMissingTotal = isPenaltyExempt
    ? 0
    : round2(missingCount * settings.penaltyMissing);
  const penaltyDelayTotal = isPenaltyExempt
    ? 0
    : round2(chargeableDelayDays * settings.penaltyLatePerDay);

  let rawFinalGrade: number | null = null;
  let clampedGrade: number | null = null;
  let suggestedFinalGrade: number | null = null;

  if (initialAverage !== null) {
    rawFinalGrade =
      initialAverage - penaltyNoTotal - penaltyMissingTotal - penaltyDelayTotal;
    clampedGrade = clampGrade(rawFinalGrade);
    suggestedFinalGrade = roundGrade(clampedGrade, settings.roundingMode);
  }

  // Final grade updates automatically from post-penalty calculation unless explicitly overridden manually
  const hasManualOverride =
    Boolean(record.manualGradeOverridden) &&
    record.manualFinalGrade !== undefined &&
    record.manualFinalGrade !== null;

  const finalGrade = hasManualOverride
    ? clampGrade(record.manualFinalGrade as number)
    : suggestedFinalGrade;

  return {
    initialAverage,
    gradedCount,
    totalPlatesCount: includedPlates.length,
    noCount,
    penaltyNoTotal,
    missingCount,
    penaltyMissingTotal,
    rawDelayDays,
    chargeableDelayDays,
    penaltyDelayTotal,
    rawFinalGrade,
    clampedGrade,
    suggestedFinalGrade,
    finalGrade,
    plateItems,
    settingsUsed: { ...settings },
    isConfirmed: false,
    confirmedAt: null,
    isManualOverride: hasManualOverride,
    isPenaltyExempt,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const STATUS_META: Record<
  PlateStatus,
  { code: PlateStatus; label: string; shortLabel: string; badgeClass: string; buttonClass: string }
> = {
  SI: {
    code: 'SI',
    label: 'Tavola consegnata e valutabile',
    shortLabel: 'Consegnata',
    badgeClass: 'bg-emerald-100/90 text-emerald-900 border-emerald-200',
    buttonClass: 'bg-emerald-100 text-emerald-900 border-emerald-400 hover:bg-emerald-200/70',
  },
  NO: {
    code: 'NO',
    label: 'Tavola non consegnata al controllo (comporta penalità)',
    shortLabel: 'Non consegnata',
    badgeClass: 'bg-rose-100/90 text-rose-900 border-rose-200',
    buttonClass: 'bg-rose-100 text-rose-900 border-rose-400 hover:bg-rose-200/70',
  },
  WIP: {
    code: 'WIP',
    label: 'Tavola in lavorazione (nessuna penalità automatica)',
    shortLabel: 'In lavorazione',
    badgeClass: 'bg-orange-100/90 text-orange-900 border-orange-200',
    buttonClass: 'bg-orange-100 text-orange-900 border-orange-400 hover:bg-orange-200/70',
  },
  ASS: {
    code: 'ASS',
    label: 'Studente assente al controllo (nessuna penalità, recuperabile)',
    shortLabel: 'Assente',
    badgeClass: 'bg-yellow-100/95 text-yellow-900 border-yellow-300',
    buttonClass: 'bg-yellow-100 text-yellow-900 border-yellow-400 hover:bg-yellow-200/70',
  },
};

export const FOLDER_STATUS_META: Record<
  FolderDeliveryStatus,
  { value: FolderDeliveryStatus; label: string; colorClass: string }
> = {
  da_consegnare: {
    value: 'da_consegnare',
    label: 'Da consegnare',
    colorClass: 'text-slate-600 bg-slate-100 border-slate-300',
  },
  consegnata: {
    value: 'consegnata',
    label: 'Consegnata',
    colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-300',
  },
  consegnata_ritardo: {
    value: 'consegnata_ritardo',
    label: 'In ritardo',
    colorClass: 'text-amber-800 bg-amber-50 border-amber-300',
  },
  non_consegnata: {
    value: 'non_consegnata',
    label: 'Non consegnata',
    colorClass: 'text-rose-700 bg-rose-50 border-rose-300',
  },
};

export const ROUNDING_MODE_LABELS: Record<RoundingMode, string> = {
  none: 'Nessuno (2 decimali esatti)',
  quarter: 'Al quarto di voto (0,25 — es. 6+, 6½, 7-)',
  half: 'Al mezzo voto (0,50 — es. 6, 6½, 7)',
  integer: 'Al voto intero (1,00 — es. 6, 7)',
};

export function getLocalTodayDateStr(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type StudentPlateOutcomeKind =
  | 'graded'
  | 'not_delivered'
  | 'missing_due'
  | 'absent'
  | 'wip'
  | 'awaiting_grade'
  | 'not_due';

export interface StudentPlateTimelineItem {
  plate: Plate;
  evaluation: PlateEvaluation;
  kind: StudentPlateOutcomeKind;
  plottedGrade: number | null;
  isRecoveredExNo: boolean;
  wasAbsent: boolean;
  isDueArrived: boolean;
}

export interface StudentTimelineStats {
  totalPlates: number;
  timeline: StudentPlateTimelineItem[];
  gradedItems: StudentPlateTimelineItem[];
  evaluatedCount: number;
  average: number | null;
  maxGrade: number | null;
  minGrade: number | null;
  maxPlates: string[];
  minPlates: string[];
  counts: {
    graded: number;
    notDelivered: number;
    missingDue: number;
    absent: number;
    wip: number;
    awaitingGrade: number;
    notDue: number;
  };
  trend: 'up' | 'down' | 'stable' | 'insufficient';
  trendDelta: number | null;
  trendDetail: string;
}

export function classifyStudentPlateOutcome(
  plate: Plate,
  cell: PlateEvaluation,
  todayStr: string = getLocalTodayDateStr()
): Omit<StudentPlateTimelineItem, 'plate' | 'evaluation'> {
  const hasValidGrade = cell.grade !== null && !Number.isNaN(cell.grade);
  const dueMs = parseUtcDateMs(plate.dueDate);
  const isNotYetDue = dueMs !== null && plate.dueDate > todayStr;
  const isDueArrived = dueMs !== null && plate.dueDate <= todayStr;

  if (cell.status === 'NO') {
    return {
      kind: 'not_delivered',
      plottedGrade: null,
      isRecoveredExNo: false,
      wasAbsent: false,
      isDueArrived,
    };
  }

  if (cell.status === 'WIP') {
    return {
      kind: 'wip',
      plottedGrade: null,
      isRecoveredExNo: false,
      wasAbsent: false,
      isDueArrived,
    };
  }

  if (cell.status === 'ASS') {
    if (hasValidGrade) {
      return {
        kind: 'graded',
        plottedGrade: cell.grade,
        isRecoveredExNo: false,
        wasAbsent: true,
        isDueArrived,
      };
    }
    return {
      kind: 'absent',
      plottedGrade: null,
      isRecoveredExNo: false,
      wasAbsent: true,
      isDueArrived,
    };
  }

  if (cell.status === 'SI' || (cell.status === null && hasValidGrade)) {
    if (hasValidGrade) {
      return {
        kind: 'graded',
        plottedGrade: cell.grade,
        isRecoveredExNo: Boolean(cell.wasNo && cell.status === 'SI'),
        wasAbsent: false,
        isDueArrived,
      };
    }
    return {
      kind: 'awaiting_grade',
      plottedGrade: null,
      isRecoveredExNo: false,
      wasAbsent: false,
      isDueArrived,
    };
  }

  // status === null && !hasValidGrade
  if (isNotYetDue) {
    return {
      kind: 'not_due',
      plottedGrade: null,
      isRecoveredExNo: false,
      wasAbsent: false,
      isDueArrived: false,
    };
  }

  if (isDueArrived) {
    return {
      kind: 'missing_due',
      plottedGrade: null,
      isRecoveredExNo: false,
      wasAbsent: false,
      isDueArrived: true,
    };
  }

  return {
    kind: 'awaiting_grade',
    plottedGrade: null,
    isRecoveredExNo: false,
    wasAbsent: false,
    isDueArrived: false,
  };
}

export function computeStudentTimelineStats(
  classData: ClassData,
  studentId: string,
  todayStr: string = getLocalTodayDateStr()
): StudentTimelineStats {
  const orderedPlates = sortPlates(classData.plates);
  const stuEvals = classData.evaluations[studentId] ?? {};

  const counts = {
    graded: 0,
    notDelivered: 0,
    missingDue: 0,
    absent: 0,
    wip: 0,
    awaitingGrade: 0,
    notDue: 0,
  };

  const timeline: StudentPlateTimelineItem[] = orderedPlates.map((plate) => {
    const cell = stuEvals[plate.id] ?? EMPTY_EVALUATION;
    const classified = classifyStudentPlateOutcome(plate, cell, todayStr);

    switch (classified.kind) {
      case 'graded':
        counts.graded += 1;
        break;
      case 'not_delivered':
        counts.notDelivered += 1;
        break;
      case 'missing_due':
        counts.missingDue += 1;
        break;
      case 'absent':
        counts.absent += 1;
        break;
      case 'wip':
        counts.wip += 1;
        break;
      case 'awaiting_grade':
        counts.awaitingGrade += 1;
        break;
      case 'not_due':
        counts.notDue += 1;
        break;
    }

    return {
      plate,
      evaluation: cell,
      ...classified,
    };
  });

  const gradedItems = timeline.filter(
    (item): item is StudentPlateTimelineItem & { plottedGrade: number } =>
      item.kind === 'graded' && item.plottedGrade !== null
  );
  const evaluatedCount = gradedItems.length;
  const grades = gradedItems.map((i) => i.plottedGrade);

  const average =
    evaluatedCount > 0
      ? grades.reduce((sum, g) => sum + g, 0) / evaluatedCount
      : null;
  const maxGrade = evaluatedCount > 0 ? Math.max(...grades) : null;
  const minGrade = evaluatedCount > 0 ? Math.min(...grades) : null;

  const maxPlates =
    maxGrade !== null
      ? gradedItems
          .filter((i) => i.plottedGrade === maxGrade)
          .map((i) => `T${i.plate.number}`)
      : [];
  const minPlates =
    minGrade !== null
      ? gradedItems
          .filter((i) => i.plottedGrade === minGrade)
          .map((i) => `T${i.plate.number}`)
      : [];

  let trend: StudentTimelineStats['trend'] = 'insufficient';
  let trendDelta: number | null = null;
  let trendDetail = 'Servono almeno 2 tavole valutate';

  if (evaluatedCount >= 2) {
    const recentWindow =
      evaluatedCount >= 6 ? 3 : evaluatedCount >= 4 ? 2 : 1;
    const recentSlice = grades.slice(-recentWindow);
    const earlierSlice = grades.slice(0, evaluatedCount - recentWindow);

    const recentAvg =
      recentSlice.reduce((s, g) => s + g, 0) / recentSlice.length;
    const earlierAvg =
      earlierSlice.reduce((s, g) => s + g, 0) / earlierSlice.length;

    const delta = recentAvg - earlierAvg;
    trendDelta = delta;

    if (delta >= 0.3) {
      trend = 'up';
      trendDetail = `+${formatDecimalIt(delta, 2)} pt rispetto alle precedenti`;
    } else if (delta <= -0.3) {
      trend = 'down';
      trendDetail = `${formatDecimalIt(delta, 2)} pt rispetto alle precedenti`;
    } else {
      trend = 'stable';
      const sign = delta > 0 ? '+' : '';
      trendDetail = `Variazione ${sign}${formatDecimalIt(delta, 2)} pt`;
    }
  }

  return {
    totalPlates: orderedPlates.length,
    timeline,
    gradedItems,
    evaluatedCount,
    average,
    maxGrade,
    minGrade,
    maxPlates,
    minPlates,
    counts,
    trend,
    trendDelta,
    trendDetail,
  };
}

export interface FolderPlateStatsItem {
  plate: Plate;
  effectiveDueDate: string;
  isNotYetDue: boolean;
  totalStudents: number;
  absentCount: number;
  expectedCount: number;
  deliveredCount: number;
  exNoDeliveredCount: number;
  missedCount: number;
  wipCount: number;
  unrecordedCount: number;
  deliveryPct: number | null;
  missedPct: number | null;
  gradedCount: number;
  gradeAverage: number | null;
}

export interface FolderClassStatsSummary {
  folder: FolderDelivery;
  totalStudents: number;
  plateStats: FolderPlateStatsItem[];
  totalDelivered: number;
  totalMissed: number;
  totalWip: number;
  totalAbsent: number;
  totalExpected: number;
  totalExpectedDue: number;
  overallDeliveryPct: number | null;
  overallMissedPct: number | null;
  overallGradeAvg: number | null;
  totalGradedCells: number;
  mostDelivered: { count: number; plates: FolderPlateStatsItem[] } | null;
  leastDelivered: { count: number; plates: FolderPlateStatsItem[] } | null;
  mostSkipped: { count: number; plates: FolderPlateStatsItem[] } | null;
  leastSkipped: { count: number; plates: FolderPlateStatsItem[] } | null;
  highestAvg: { avg: number; plates: FolderPlateStatsItem[] } | null;
  lowestAvg: { avg: number; plates: FolderPlateStatsItem[] } | null;
  folderSubmissionSummary: {
    consegnata: number;
    consegnata_ritardo: number;
    non_consegnata: number;
    da_consegnare: number;
  };
}

export function computeFolderClassStats(
  classData: ClassData,
  folder: FolderDelivery,
  todayStr: string = getLocalTodayDateStr()
): FolderClassStatsSummary {
  const folderPlateSet = new Set(folder.plateIds);
  const orderedIncludedPlates = sortPlates(classData.plates).filter((p) =>
    folderPlateSet.has(p.id)
  );
  const students = classData.students;
  const totalStudents = students.length;

  let totalDelivered = 0;
  let totalMissed = 0;
  let totalWip = 0;
  let totalAbsent = 0;
  let totalExpected = 0;
  let totalExpectedDue = 0;
  const allValidGrades: number[] = [];

  const plateStats: FolderPlateStatsItem[] = orderedIncludedPlates.map(
    (plate) => {
      const effectiveDueDate = plate.dueDate || folder.dueDate || '';
      const dueMs = parseUtcDateMs(effectiveDueDate);
      const isNotYetDue = dueMs !== null && effectiveDueDate > todayStr;

      let absentCount = 0;
      let deliveredCount = 0;
      let exNoDeliveredCount = 0;
      let missedCount = 0;
      let wipCount = 0;
      let unrecordedCount = 0;
      const grades: number[] = [];

      for (const stu of students) {
        const cell =
          classData.evaluations[stu.id]?.[plate.id] ?? EMPTY_EVALUATION;
        const hasValidGrade =
          cell.grade !== null && !Number.isNaN(cell.grade);

        // Voto valido per la media della tavola (esclude NO, WIP e voti mancanti)
        if (
          hasValidGrade &&
          cell.status !== 'NO' &&
          cell.status !== 'WIP'
        ) {
          grades.push(cell.grade as number);
          allValidGrades.push(cell.grade as number);
        }

        // Studente assente al controllo/consegna: escluso dai conteggi dei tenuti a consegnare
        if (cell.status === 'ASS') {
          absentCount += 1;
          continue;
        }

        if (cell.status === 'SI' || (cell.status === null && hasValidGrade)) {
          deliveredCount += 1;
          if (cell.wasNo && cell.status === 'SI') {
            exNoDeliveredCount += 1;
          }
          continue;
        }

        if (cell.status === 'WIP') {
          // Distinto dalle mancate consegne: tavola ancora da terminare
          wipCount += 1;
          continue;
        }

        // Tavola la cui scadenza non è ancora arrivata: non conteggiata come mancata consegna
        if (isNotYetDue) {
          unrecordedCount += 1;
          continue;
        }

        if (cell.status === 'NO') {
          missedCount += 1;
        } else {
          unrecordedCount += 1;
        }
      }

      const expectedCount = Math.max(0, totalStudents - absentCount);
      const deliveryPct =
        expectedCount > 0 ? (deliveredCount / expectedCount) * 100 : null;
      const missedPct =
        expectedCount > 0
          ? isNotYetDue
            ? 0
            : (missedCount / expectedCount) * 100
          : null;
      const gradeAverage =
        grades.length > 0
          ? grades.reduce((sum, g) => sum + g, 0) / grades.length
          : null;

      totalAbsent += absentCount;
      totalExpected += expectedCount;
      if (!isNotYetDue) {
        totalExpectedDue += expectedCount;
      }
      totalDelivered += deliveredCount;
      totalMissed += missedCount;
      totalWip += wipCount;

      return {
        plate,
        effectiveDueDate,
        isNotYetDue,
        totalStudents,
        absentCount,
        expectedCount,
        deliveredCount,
        exNoDeliveredCount,
        missedCount,
        wipCount,
        unrecordedCount,
        deliveryPct,
        missedPct,
        gradedCount: grades.length,
        gradeAverage,
      };
    }
  );

  // Per classifiche consegne/saltate usiamo prioritariamente le tavole già scadute (o tutte se tutte future ma con consegne)
  const dueOrDeliveredPlates = plateStats.filter(
    (p) => !p.isNotYetDue || p.deliveredCount > 0
  );
  const duePlates = plateStats.filter((p) => !p.isNotYetDue);

  let mostDelivered: FolderClassStatsSummary['mostDelivered'] = null;
  let leastDelivered: FolderClassStatsSummary['leastDelivered'] = null;
  if (dueOrDeliveredPlates.length > 0) {
    const maxDel = Math.max(
      ...dueOrDeliveredPlates.map((p) => p.deliveredCount)
    );
    const minDel = Math.min(
      ...dueOrDeliveredPlates.map((p) => p.deliveredCount)
    );
    mostDelivered = {
      count: maxDel,
      plates: dueOrDeliveredPlates.filter((p) => p.deliveredCount === maxDel),
    };
    leastDelivered = {
      count: minDel,
      plates: dueOrDeliveredPlates.filter((p) => p.deliveredCount === minDel),
    };
  }

  let mostSkipped: FolderClassStatsSummary['mostSkipped'] = null;
  let leastSkipped: FolderClassStatsSummary['leastSkipped'] = null;
  if (duePlates.length > 0) {
    const maxSkip = Math.max(...duePlates.map((p) => p.missedCount));
    const minSkip = Math.min(...duePlates.map((p) => p.missedCount));
    mostSkipped = {
      count: maxSkip,
      plates: duePlates.filter((p) => p.missedCount === maxSkip),
    };
    leastSkipped = {
      count: minSkip,
      plates: duePlates.filter((p) => p.missedCount === minSkip),
    };
  }

  const platesWithAvg = plateStats.filter(
    (p): p is FolderPlateStatsItem & { gradeAverage: number } =>
      p.gradeAverage !== null
  );
  let highestAvg: FolderClassStatsSummary['highestAvg'] = null;
  let lowestAvg: FolderClassStatsSummary['lowestAvg'] = null;
  if (platesWithAvg.length > 0) {
    const maxAvg = Math.max(...platesWithAvg.map((p) => p.gradeAverage));
    const minAvg = Math.min(...platesWithAvg.map((p) => p.gradeAverage));
    highestAvg = {
      avg: maxAvg,
      plates: platesWithAvg.filter(
        (p) => Math.abs(p.gradeAverage - maxAvg) < 0.0001
      ),
    };
    lowestAvg = {
      avg: minAvg,
      plates: platesWithAvg.filter(
        (p) => Math.abs(p.gradeAverage - minAvg) < 0.0001
      ),
    };
  }

  const folderSubmissionSummary = {
    consegnata: 0,
    consegnata_ritardo: 0,
    non_consegnata: 0,
    da_consegnare: 0,
  };
  for (const stu of students) {
    const rec =
      classData.folderRecords[stu.id]?.[folder.id] ?? EMPTY_FOLDER_RECORD;
    folderSubmissionSummary[rec.status] += 1;
  }

  return {
    folder,
    totalStudents,
    plateStats,
    totalDelivered,
    totalMissed,
    totalWip,
    totalAbsent,
    totalExpected,
    totalExpectedDue,
    overallDeliveryPct:
      totalExpected > 0 ? (totalDelivered / totalExpected) * 100 : null,
    overallMissedPct:
      totalExpectedDue > 0 ? (totalMissed / totalExpectedDue) * 100 : null,
    overallGradeAvg:
      allValidGrades.length > 0
        ? allValidGrades.reduce((sum, g) => sum + g, 0) / allValidGrades.length
        : null,
    totalGradedCells: allValidGrades.length,
    mostDelivered,
    leastDelivered,
    mostSkipped,
    leastSkipped,
    highestAvg,
    lowestAvg,
    folderSubmissionSummary,
  };
}

export interface FolderDeliveryCounts {
  delivered: number;
  missing: number;
  total: number;
}

/**
 * Counts how many students in the current class have delivered the given folder
 * (`consegnata` or `consegnata_ritardo`) vs. how many have not yet delivered it
 * (`da_consegnare` or `non_consegnata`, including students without a record).
 * Derived exclusively from existing `students` and `folderRecords` state.
 */
export function computeFolderDeliveryCounts(
  classData: Pick<ClassData, 'students' | 'folderRecords'>,
  folderId: string
): FolderDeliveryCounts {
  let delivered = 0;
  let missing = 0;
  for (const stu of classData.students) {
    const rec =
      classData.folderRecords[stu.id]?.[folderId] ?? EMPTY_FOLDER_RECORD;
    if (rec.status === 'consegnata' || rec.status === 'consegnata_ritardo') {
      delivered += 1;
    } else {
      missing += 1;
    }
  }
  return {
    delivered,
    missing,
    total: classData.students.length,
  };
}
