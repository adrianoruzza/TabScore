import type { ClassData, StudentSupportTag } from '../types/gradebook';

export type RecognizedClassYear = 1 | 2 | 3 | 4 | 5;
export type ClassYearLevel = RecognizedClassYear | 'unclassified';
export type YearFilterValue = 'all' | ClassYearLevel;

export const RECOGNIZED_CLASS_YEARS: readonly RecognizedClassYear[] = [
  1, 2, 3, 4, 5,
];

export const SUPPORT_CATEGORIES: readonly StudentSupportTag[] = [
  'DSA',
  'BES',
  'H',
];

export interface YearLevelMeta {
  id: ClassYearLevel;
  label: string;
  shortLabel: string;
}

export const YEAR_LEVEL_META: Record<ClassYearLevel, YearLevelMeta> = {
  1: { id: 1, label: 'Classi prime', shortLabel: '1° anno' },
  2: { id: 2, label: 'Classi seconde', shortLabel: '2° anno' },
  3: { id: 3, label: 'Classi terze', shortLabel: '3° anno' },
  4: { id: 4, label: 'Classi quarte', shortLabel: '4° anno' },
  5: { id: 5, label: 'Classi quinte', shortLabel: '5° anno' },
  unclassified: {
    id: 'unclassified',
    label: 'Anno non riconosciuto',
    shortLabel: 'Non class.',
  },
};

export interface SupportCounts {
  dsa: number;
  bes: number;
  h: number;
  /** Number of unique students with at least one assigned category (DSA, BES or H). */
  studentsWithAnySupport: number;
  /** Number of unique students belonging to 2 or more categories simultaneously. */
  multiCategoryStudents: number;
}

export interface ClassDataSummary {
  classId: string;
  className: string;
  schoolYear: string;
  color: string | undefined;
  colorIndex: number;
  yearLevel: ClassYearLevel;
  yearLabel: string;
  yearShortLabel: string;
  totalStudents: number;
  support: SupportCounts;
  dsaPct: number;
  besPct: number;
  hPct: number;
}

export interface YearDistributionRow {
  yearLevel: ClassYearLevel;
  label: string;
  shortLabel: string;
  studentCount: number;
  studentPercentage: number;
  classCount: number;
  dsaCount: number;
  besCount: number;
  hCount: number;
  classIds: string[];
}

export interface SchoolPopulationOverview {
  totalStudents: number;
  totalClasses: number;
  dsaCount: number;
  besCount: number;
  hCount: number;
  studentsWithAnySupport: number;
  multiCategoryStudents: number;
}

export interface SelectedClassAnalytics {
  summary: ClassDataSummary;
  shareOfAllStudentsPct: number;
  shareOfYearStudentsPct: number;
  yearCohortClassCount: number;
  yearCohortStudentCount: number;
}

/**
 * Filter state for the "Dati" dashboard.
 * Structured as an extensible object so future filters (e.g. school year,
 * support category, grading period) can be added without breaking callers.
 */
export interface SchoolDataFilter {
  yearLevel: YearFilterValue;
  selectedClassId: string | null;
}

export interface SchoolDataSnapshot {
  /** Totals across all classes currently present in TabScore. */
  globalOverview: SchoolPopulationOverview;
  /** Totals across the classes matching the active year filter. */
  filteredOverview: SchoolPopulationOverview;
  /** Year breakdown computed across all classes (always reflects the full school population). */
  yearDistribution: YearDistributionRow[];
  /** Whether at least one class could not be reliably matched to years 1..5. */
  hasUnclassifiedClasses: boolean;
  /** List of all classes with computed statistics, preserving TabScore class order. */
  allClasses: ClassDataSummary[];
  /** Classes matching the active year filter, preserving TabScore class order. */
  filteredClasses: ClassDataSummary[];
  /** Selected class statistics when a single class is inspected inside "Dati". */
  selectedClassDetail: SelectedClassAnalytics | null;
}

const VALID_SUPPORT_SET = new Set<string>(SUPPORT_CATEGORIES);

const ORDINAL_WORD_TO_YEAR: Record<string, RecognizedClassYear> = {
  prima: 1,
  primo: 1,
  seconda: 2,
  secondo: 2,
  terza: 3,
  terzo: 3,
  quarta: 4,
  quarto: 4,
  quinta: 5,
  quinto: 5,
};

const ROMAN_TO_YEAR: Record<string, RecognizedClassYear> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
};

/**
 * Conservatively identifies the school year (1..5) from a class name.
 * Never guesses when the name does not clearly denote a year 1..5:
 * returns 'unclassified' in all ambiguous or non-standard cases.
 */
export function detectClassYearLevel(className: string): ClassYearLevel {
  const trimmed = className.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'unclassified';

  // Isolate the primary class identifier before decorative separators like "— Disegno Tecnico"
  const primaryPart = trimmed.split(/\s+[—–]\s+|\s+-\s+|\s*\(/)[0]?.trim() ?? trimmed;
  if (!primaryPart) return 'unclassified';

  // Strip optional leading Italian prefix ("Classe ", "Cl. ", "Sez. ")
  const cleaned = primaryPart
    .replace(/^(?:classe|cl\.?|sez\.?|sezione)\s+/i, '')
    .trim();
  if (!cleaned) return 'unclassified';

  // 1. Arabic digit 1..5 with explicit ordinal mark (e.g. "1ª", "2ª B", "3° C", "4^ A", "5°")
  const ordinalMatch = /^([1-5])\s*[ª°^](?=$|\s|[-_/.,]|[A-Za-z])/i.exec(cleaned);
  if (ordinalMatch) {
    return Number(ordinalMatch[1]) as RecognizedClassYear;
  }

  // 2. Arabic digit 1..5 followed by section letter or separator (e.g. "2B", "3 A", "1-C", "4_D", "2a", "3b")
  // Rejects multi-digit numbers (e.g. "12A", "2026") and words like "3D" or "2D"
  const digitSectionMatch =
    /^([1-5])(?:(?:\s*[-_/.\s]\s*|\s*)([A-Za-z]{1,2})(?=$|\s|[-_/.,])|(?=$))/.exec(
      cleaned
    );
  if (digitSectionMatch) {
    const digit = Number(digitSectionMatch[1]) as RecognizedClassYear;
    const section = (digitSectionMatch[2] ?? '').trim();
    // Guard against "2D" / "3D" graphic design course names when no separator is used
    if (
      section &&
      !/\s|[-_/.]/.test(cleaned.slice(1, cleaned.length - section.length + 1)) &&
      /^[dD]$/.test(section) &&
      /\b(?:disegno|grafica|cad|stampa|modellazione)\b/i.test(trimmed) &&
      cleaned.length === 2
    ) {
      // Wait: "3D" can legitimately be 3ª D (class 3, section D) in Italian schools!
      // Only treat as ambiguous if explicitly written like "Corso 3D" (already rejected because "Corso" isn't stripped).
      return digit;
    }
    if (section.length <= 2) {
      return digit;
    }
  }

  // 3. Explicit Italian ordinal words ("Prima A", "Seconda B", "Terza", "Quarta C", "Quinta")
  const wordMatch =
    /^(prima|primo|seconda|secondo|terza|terzo|quarta|quarto|quinta|quinto)(?=$|\s|[-_/.,])/i.exec(
      cleaned
    );
  if (wordMatch) {
    const mapped = ORDINAL_WORD_TO_YEAR[wordMatch[1].toLowerCase()];
    if (mapped) return mapped;
  }

  // 4. Uppercase Roman numerals I..V at start with ordinal mark or followed by a single section letter ("II B", "IVª A", "V C")
  const romanMatch =
    /^(IV|III|II|I|V)(?:[ª°^](?=$|\s|[-_/.,]|[A-Za-z])|\s+([A-Z])(?=$|\s|[-_/.,])|$)/.exec(
      cleaned
    );
  if (romanMatch) {
    const mapped = ROMAN_TO_YEAR[romanMatch[1]];
    if (mapped) return mapped;
  }

  return 'unclassified';
}

/**
 * Counts DSA, BES, and H assignments strictly from the students' stored anagrafica.
 * - Deduplicates repeated tags on the same student so no student is counted twice in the same category.
 * - Counts a student in every assigned category if they hold multiple tags (e.g. DSA + BES).
 * - Never mutates original student records.
 */
export function countClassSupportStats(cls: ClassData): SupportCounts {
  let dsa = 0;
  let bes = 0;
  let h = 0;
  let studentsWithAnySupport = 0;
  let multiCategoryStudents = 0;

  for (const student of cls.students) {
    const rawTags = Array.isArray(student.supportNeeds)
      ? student.supportNeeds
      : [];
    if (rawTags.length === 0) continue;

    const uniqueValid = new Set<StudentSupportTag>();
    for (const tag of rawTags) {
      if (typeof tag === 'string' && VALID_SUPPORT_SET.has(tag)) {
        uniqueValid.add(tag as StudentSupportTag);
      }
    }

    if (uniqueValid.size === 0) continue;

    if (uniqueValid.has('DSA')) dsa += 1;
    if (uniqueValid.has('BES')) bes += 1;
    if (uniqueValid.has('H')) h += 1;

    studentsWithAnySupport += 1;
    if (uniqueValid.size >= 2) {
      multiCategoryStudents += 1;
    }
  }

  return {
    dsa,
    bes,
    h,
    studentsWithAnySupport,
    multiCategoryStudents,
  };
}

function calcPercentage(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return (part / total) * 100;
}

function aggregateOverview(
  summaries: ClassDataSummary[]
): SchoolPopulationOverview {
  let totalStudents = 0;
  let dsaCount = 0;
  let besCount = 0;
  let hCount = 0;
  let studentsWithAnySupport = 0;
  let multiCategoryStudents = 0;

  for (const item of summaries) {
    totalStudents += item.totalStudents;
    dsaCount += item.support.dsa;
    besCount += item.support.bes;
    hCount += item.support.h;
    studentsWithAnySupport += item.support.studentsWithAnySupport;
    multiCategoryStudents += item.support.multiCategoryStudents;
  }

  return {
    totalStudents,
    totalClasses: summaries.length,
    dsaCount,
    besCount,
    hCount,
    studentsWithAnySupport,
    multiCategoryStudents,
  };
}

/**
 * Pure aggregation entry point for the "Dati" dashboard.
 * Derives all metrics directly from TabScore's live `classes` array.
 */
export function computeSchoolDataSnapshot(
  classes: ClassData[],
  filter: SchoolDataFilter = { yearLevel: 'all', selectedClassId: null }
): SchoolDataSnapshot {
  const allClasses: ClassDataSummary[] = classes.map((cls, index) => {
    const yearLevel = detectClassYearLevel(cls.name);
    const meta = YEAR_LEVEL_META[yearLevel];
    const totalStudents = cls.students.length;
    const support = countClassSupportStats(cls);

    return {
      classId: cls.id,
      className: cls.name,
      schoolYear: cls.schoolYear,
      color: cls.color,
      colorIndex: index,
      yearLevel,
      yearLabel: meta.label,
      yearShortLabel: meta.shortLabel,
      totalStudents,
      support,
      dsaPct: calcPercentage(support.dsa, totalStudents),
      besPct: calcPercentage(support.bes, totalStudents),
      hPct: calcPercentage(support.h, totalStudents),
    };
  });

  const globalOverview = aggregateOverview(allClasses);

  // Build distribution across years 1..5 plus 'unclassified' only if present
  const yearBuckets = new Map<ClassYearLevel, ClassDataSummary[]>();
  for (const year of RECOGNIZED_CLASS_YEARS) {
    yearBuckets.set(year, []);
  }
  const unclassifiedList: ClassDataSummary[] = [];

  for (const item of allClasses) {
    if (item.yearLevel === 'unclassified') {
      unclassifiedList.push(item);
    } else {
      yearBuckets.get(item.yearLevel)?.push(item);
    }
  }

  const hasUnclassifiedClasses = unclassifiedList.length > 0;
  const orderedLevels: ClassYearLevel[] = hasUnclassifiedClasses
    ? [...RECOGNIZED_CLASS_YEARS, 'unclassified']
    : [...RECOGNIZED_CLASS_YEARS];

  const yearDistribution: YearDistributionRow[] = orderedLevels.map((level) => {
    const bucket =
      level === 'unclassified'
        ? unclassifiedList
        : yearBuckets.get(level) ?? [];
    const meta = YEAR_LEVEL_META[level];
    const studentCount = bucket.reduce((sum, c) => sum + c.totalStudents, 0);
    const dsaCount = bucket.reduce((sum, c) => sum + c.support.dsa, 0);
    const besCount = bucket.reduce((sum, c) => sum + c.support.bes, 0);
    const hCount = bucket.reduce((sum, c) => sum + c.support.h, 0);

    return {
      yearLevel: level,
      label: meta.label,
      shortLabel: meta.shortLabel,
      studentCount,
      studentPercentage: calcPercentage(
        studentCount,
        globalOverview.totalStudents
      ),
      classCount: bucket.length,
      dsaCount,
      besCount,
      hCount,
      classIds: bucket.map((c) => c.classId),
    };
  });

  const filteredClasses =
    filter.yearLevel === 'all'
      ? allClasses
      : allClasses.filter((c) => c.yearLevel === filter.yearLevel);

  const filteredOverview = aggregateOverview(filteredClasses);

  let selectedClassDetail: SelectedClassAnalytics | null = null;
  if (filter.selectedClassId) {
    const found = allClasses.find((c) => c.classId === filter.selectedClassId);
    if (found) {
      const cohortRow = yearDistribution.find(
        (row) => row.yearLevel === found.yearLevel
      );
      const yearCohortStudentCount = cohortRow?.studentCount ?? found.totalStudents;
      const yearCohortClassCount = cohortRow?.classCount ?? 1;

      selectedClassDetail = {
        summary: found,
        shareOfAllStudentsPct: calcPercentage(
          found.totalStudents,
          globalOverview.totalStudents
        ),
        shareOfYearStudentsPct: calcPercentage(
          found.totalStudents,
          yearCohortStudentCount
        ),
        yearCohortClassCount,
        yearCohortStudentCount,
      };
    }
  }

  return {
    globalOverview,
    filteredOverview,
    yearDistribution,
    hasUnclassifiedClasses,
    allClasses,
    filteredClasses,
    selectedClassDetail,
  };
}

export function formatPercentIt(value: number, decimals = 1): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  const rounded = Number(value.toFixed(decimals));
  const formatted = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(decimals).replace('.', ',');
  return `${formatted}%`;
}
