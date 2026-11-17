import {
  AlertCircle,
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileCheck2,
  Hammer,
  Minus,
  TrendingDown,
  TrendingUp,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ClassData, Student } from '../types/gradebook';
import {
  calculateFolderEvaluation,
  computeStudentTimelineStats,
  formatDateIt,
  formatDecimalIt,
  formatGradeLabel,
  formatPlateInterval,
  type StudentPlateOutcomeKind,
  type StudentPlateTimelineItem,
} from '../utils/calculations';

interface StudentStatsModalProps {
  open: boolean;
  classData: ClassData;
  studentId: string | null;
  students?: Student[];
  onSelectStudent?: (studentId: string) => void;
  onClose: () => void;
}

const OUTCOME_META: Record<
  StudentPlateOutcomeKind,
  {
    label: string;
    shortBadge: string;
    description: string;
    textClass: string;
    markerColor: string;
    markerBg: string;
    markerBorder: string;
    textFill: string;
  }
> = {
  graded: {
    label: 'Consegnata e valutata',
    shortBadge: 'Valutata',
    description: 'Voto definitivo registrato e incluso nella media.',
    textClass: 'text-emerald-800',
    markerColor: '#1d4ed8',
    markerBg: '#dbeafe',
    markerBorder: '#1d4ed8',
    textFill: '#1e3a8a',
  },
  not_delivered: {
    label: 'Non consegnata (NO)',
    shortBadge: 'NO',
    description:
      'Non consegnata al controllo (NO): nessun voto numerico attribuito.',
    textClass: 'text-rose-800',
    markerColor: '#e11d48',
    markerBg: '#ffe4e6',
    markerBorder: '#e11d48',
    textFill: '#9f1239',
  },
  missing_due: {
    label: 'Mancante alla scadenza',
    shortBadge: 'Manc.',
    description:
      'Data di consegna trascorsa senza consegna né valutazione registrata.',
    textClass: 'text-red-800',
    markerColor: '#dc2626',
    markerBg: '#fef2f2',
    markerBorder: '#dc2626',
    textFill: '#991b1b',
  },
  absent: {
    label: 'Assente alla consegna (ASS)',
    shortBadge: 'ASS',
    description:
      'Studente assente al controllo: nessuna penalità, tavola recuperabile.',
    textClass: 'text-amber-800',
    markerColor: '#d97706',
    markerBg: '#fef3c7',
    markerBorder: '#d97706',
    textFill: '#92400e',
  },
  wip: {
    label: 'In lavorazione (WIP)',
    shortBadge: 'WIP',
    description:
      'Tavola ancora da completare (WIP), non inclusa nella media.',
    textClass: 'text-orange-800',
    markerColor: '#ea580c',
    markerBg: '#ffedd5',
    markerBorder: '#ea580c',
    textFill: '#9a3412',
  },
  awaiting_grade: {
    label: 'Non ancora valutata',
    shortBadge: 'Da val.',
    description:
      'Tavola in attesa di valutazione (nessun voto ancora assegnato).',
    textClass: 'text-sky-800',
    markerColor: '#0284c7',
    markerBg: '#f0f9ff',
    markerBorder: '#7dd3fc',
    textFill: '#075985',
  },
  not_due: {
    label: 'Scadenza futura',
    shortBadge: 'Attesa',
    description: 'La scadenza prevista per questa tavola non è ancora arrivata.',
    textClass: 'text-slate-600',
    markerColor: '#64748b',
    markerBg: '#f8fafc',
    markerBorder: '#cbd5e1',
    textFill: '#475569',
  },
};

export function StudentStatsModal({
  open,
  classData,
  studentId,
  students,
  onSelectStudent,
  onClose,
}: StudentStatsModalProps) {
  const [selectedPlateId, setSelectedPlateId] = useState<string | null>(null);
  const [hoveredPlateId, setHoveredPlateId] = useState<string | null>(null);
  const [focusedFolderId, setFocusedFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const orderedStudents = useMemo(() => {
    if (students && students.length > 0) return students;
    return [...classData.students].sort((a, b) => a.order - b.order);
  }, [students, classData.students]);

  const studentIndex = useMemo(
    () => orderedStudents.findIndex((s) => s.id === studentId),
    [orderedStudents, studentId]
  );

  const student = useMemo(
    () =>
      studentIndex >= 0
        ? orderedStudents[studentIndex]
        : classData.students.find((s) => s.id === studentId) ?? null,
    [orderedStudents, studentIndex, classData.students, studentId]
  );

  const stats = useMemo(() => {
    if (!open || !student) return null;
    return computeStudentTimelineStats(classData, student.id);
  }, [open, classData, student]);

  const folderSummaries = useMemo(() => {
    if (!open || !student) return [];
    return classData.folders.map((folder) => {
      const calc = calculateFolderEvaluation(classData, student.id, folder);
      const totalPenalty =
        calc.penaltyNoTotal + calc.penaltyMissingTotal + calc.penaltyDelayTotal;
      return {
        folder,
        calc,
        totalPenalty,
      };
    });
  }, [open, classData, student]);

  useEffect(() => {
    if (!open || folderSummaries.length === 0) {
      setFocusedFolderId(null);
      return;
    }
    setFocusedFolderId((prev) => {
      if (prev && folderSummaries.some((f) => f.folder.id === prev)) {
        return prev;
      }
      return folderSummaries[folderSummaries.length - 1].folder.id;
    });
  }, [open, folderSummaries]);

  // Keep selected plate valid; default to latest graded plate, or latest timeline plate
  useEffect(() => {
    if (!open || !stats) {
      setSelectedPlateId(null);
      return;
    }
    setSelectedPlateId((prev) => {
      if (prev && stats.timeline.some((p) => p.plate.id === prev)) {
        return prev;
      }
      const lastGraded = stats.gradedItems[stats.gradedItems.length - 1];
      if (lastGraded) return lastGraded.plate.id;
      return stats.timeline[stats.timeline.length - 1]?.plate.id ?? null;
    });
  }, [open, studentId, stats]);

  if (!open || !student || !stats) return null;

  const fullName = `${student.lastName} ${student.firstName}`.trim();
  const selectedItem: StudentPlateTimelineItem | null =
    stats.timeline.find((p) => p.plate.id === selectedPlateId) ??
    stats.timeline[stats.timeline.length - 1] ??
    null;

  const focusedFolderSummary =
    folderSummaries.find((f) => f.folder.id === focusedFolderId) ??
    folderSummaries[folderSummaries.length - 1] ??
    null;

  const prevStudent =
    studentIndex > 0 ? orderedStudents[studentIndex - 1] : null;
  const nextStudent =
    studentIndex >= 0 && studentIndex < orderedStudents.length - 1
      ? orderedStudents[studentIndex + 1]
      : null;

  // Responsive full-fit SVG Geometry (no horizontal scrollbar on desktop)
  const SVG_WIDTH = 1040;
  const SVG_HEIGHT = 228;
  const PAD_LEFT = 36;
  const PAD_RIGHT = 26;
  const PAD_TOP = 18;
  const PLOT_H = 120; // Grade band 2..10
  const STATUS_BAND_Y = PAD_TOP + PLOT_H + 26;
  const X_AXIS_Y = STATUS_BAND_Y + 32;
  const plotW = SVG_WIDTH - PAD_LEFT - PAD_RIGHT;

  const totalCount = stats.timeline.length;
  const colSpacing = totalCount <= 1 ? plotW : plotW / (totalCount - 1);
  const badgeW = Math.min(40, Math.max(24, colSpacing - 4));
  const showPlateSubtitles = totalCount <= 14;
  const compactLabels = totalCount > 16;

  const yForGrade = (grade: number) => {
    const clamped = Math.min(10, Math.max(2, grade));
    const ratio = (clamped - 2) / 8;
    return PAD_TOP + PLOT_H * (1 - ratio);
  };

  const xForIndex = (idx: number) => {
    if (totalCount <= 1) {
      return PAD_LEFT + plotW / 2;
    }
    return PAD_LEFT + (idx / (totalCount - 1)) * plotW;
  };

  const timelineNodes = stats.timeline.map((item, idx) => ({
    ...item,
    idx,
    x: xForIndex(idx),
    y: item.plottedGrade !== null ? yForGrade(item.plottedGrade) : null,
  }));

  const gradeSegments: {
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    hasGap: boolean;
  }[] = [];

  const gradedNodes = timelineNodes.filter(
    (n): n is typeof n & { y: number; plottedGrade: number } =>
      n.y !== null && n.plottedGrade !== null
  );

  for (let i = 1; i < gradedNodes.length; i++) {
    const prev = gradedNodes[i - 1];
    const curr = gradedNodes[i];
    gradeSegments.push({
      key: `${prev.plate.id}-${curr.plate.id}`,
      x1: prev.x,
      y1: prev.y,
      x2: curr.x,
      y2: curr.y,
      hasGap: curr.idx - prev.idx > 1,
    });
  }

  const yTicks = [2, 4, 6, 8, 10];

  const trendBadge = (() => {
    switch (stats.trend) {
      case 'up':
        return {
          label: 'In miglioramento',
          icon: TrendingUp,
          cardClass: 'border-emerald-200 bg-emerald-50/75',
          textClass: 'text-emerald-800',
          iconClass: 'text-emerald-700',
        };
      case 'down':
        return {
          label: 'In peggioramento',
          icon: TrendingDown,
          cardClass: 'border-rose-200 bg-rose-50/75',
          textClass: 'text-rose-800',
          iconClass: 'text-rose-700',
        };
      case 'stable':
        return {
          label: 'Stabile',
          icon: Minus,
          cardClass: 'border-blue-200 bg-blue-50/75',
          textClass: 'text-blue-900',
          iconClass: 'text-blue-700',
        };
      default:
        return {
          label: 'N/D',
          icon: Minus,
          cardClass: 'border-slate-200 bg-slate-50/70',
          textClass: 'text-slate-600',
          iconClass: 'text-slate-400',
        };
    }
  })();
  const TrendIcon = trendBadge.icon;

  const statusBreakdownParts = [
    stats.counts.notDelivered > 0 ? `${stats.counts.notDelivered} NO` : '',
    stats.counts.missingDue > 0 ? `${stats.counts.missingDue} manc.` : '',
    stats.counts.absent > 0 ? `${stats.counts.absent} ASS` : '',
    stats.counts.wip > 0 ? `${stats.counts.wip} WIP` : '',
    stats.counts.awaitingGrade > 0 ? `${stats.counts.awaitingGrade} da val.` : '',
    stats.counts.notDue > 0 ? `${stats.counts.notDue} att.` : '',
  ].filter(Boolean);

  const selectedOutcomeMeta = selectedItem
    ? OUTCOME_META[selectedItem.kind]
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-2 backdrop-blur-[1px] sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-stats-title"
    >
      <div className="flex max-h-[95vh] w-full max-w-[1160px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        {/* Compact Single-Line Header with Direct Student Switcher */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <BarChart3 className="h-4 w-4 shrink-0 text-blue-700" />
            <h2
              id="student-stats-title"
              className="font-display truncate text-base font-bold text-slate-900"
            >
              {fullName}
            </h2>
            <span className="hidden truncate text-xs text-slate-500 sm:inline">
              · {classData.name} ({classData.schoolYear})
              {student.supportNeeds && student.supportNeeds.length > 0
                ? ` · ${student.supportNeeds.join('/')}`
                : ''}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onSelectStudent && orderedStudents.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!prevStudent}
                  onClick={() => prevStudent && onSelectStudent(prevStudent.id)}
                  title={
                    prevStudent
                      ? `Studente precedente: ${prevStudent.lastName} ${prevStudent.firstName}`
                      : 'Primo studente'
                  }
                  aria-label="Studente precedente"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-35"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <select
                  aria-label="Cambia studente"
                  value={student.id}
                  onChange={(e) => onSelectStudent(e.target.value)}
                  className="h-7 max-w-[175px] rounded border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-none"
                >
                  {orderedStudents.map((s, idx) => (
                    <option key={s.id} value={s.id}>
                      {idx + 1}. {s.lastName} {s.firstName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!nextStudent}
                  onClick={() => nextStudent && onSelectStudent(nextStudent.id)}
                  title={
                    nextStudent
                      ? `Studente successivo: ${nextStudent.lastName} ${nextStudent.firstName}`
                      : 'Ultimo studente'
                  }
                  aria-label="Studente successivo"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-35"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap"
              aria-label="Chiudi statistiche studente"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Chiudi</span>
            </button>
          </div>
        </header>

        {/* Single-Screen Main Body (zero scroll on desktop) */}
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-2.5 lg:overflow-hidden">
          {/* 5 Compact KPI Cards: includes both Media voti AND Voto finale post-penalità */}
          <section
            aria-label="Indicatori principali dello studente"
            className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
          >
            {/* 1. Media dei voti */}
            <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2">
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-slate-500">
                <span className="truncate">Media voti</span>
                <span className="font-mono text-[10px] text-slate-400">
                  tavole
                </span>
              </div>
              <div
                className={`mt-0.5 font-mono text-xl font-bold leading-tight tabular-nums ${
                  stats.average !== null && stats.average < 6
                    ? 'text-rose-700'
                    : 'text-slate-950'
                }`}
              >
                {stats.average !== null ? formatDecimalIt(stats.average, 2) : '—'}
              </div>
              <div className="mt-0.5 truncate text-[10.5px] text-slate-500">
                {stats.average !== null
                  ? `Scala: ${formatGradeLabel(stats.average)}`
                  : 'Nessun voto valido'}
              </div>
            </div>

            {/* 2. Voto finale dopo le penalità */}
            <div className="rounded-md border border-blue-200 bg-blue-50/70 px-3 py-2">
              <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-blue-900">
                <span className="truncate">Voto finale</span>
                {folderSummaries.length > 1 ? (
                  <select
                    aria-label="Seleziona cartellina per voto finale"
                    value={focusedFolderSummary?.folder.id ?? ''}
                    onChange={(e) => setFocusedFolderId(e.target.value)}
                    className="h-4 max-w-[92px] rounded border border-blue-200 bg-white px-1 text-[10px] font-medium text-blue-900 focus:outline-none"
                  >
                    {folderSummaries.map((fs) => (
                      <option key={fs.folder.id} value={fs.folder.id}>
                        {fs.folder.title}
                      </option>
                    ))}
                  </select>
                ) : focusedFolderSummary ? (
                  <span className="truncate text-[10px] font-medium text-blue-700">
                    {focusedFolderSummary.folder.title}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5 font-mono leading-tight tabular-nums">
                <span
                  className={`text-xl font-extrabold ${
                    focusedFolderSummary?.calc.finalGrade !== null &&
                    focusedFolderSummary?.calc.finalGrade !== undefined &&
                    focusedFolderSummary.calc.finalGrade < 6
                      ? 'text-rose-700'
                      : 'text-blue-950'
                  }`}
                >
                  {focusedFolderSummary?.calc.finalGrade !== null &&
                  focusedFolderSummary?.calc.finalGrade !== undefined
                    ? formatGradeLabel(focusedFolderSummary.calc.finalGrade)
                    : '—'}
                </span>
                {focusedFolderSummary?.calc.finalGrade !== null &&
                  focusedFolderSummary?.calc.finalGrade !== undefined && (
                    <span className="text-[11px] font-medium text-blue-800">
                      ({formatDecimalIt(focusedFolderSummary.calc.finalGrade, 2)})
                    </span>
                  )}
              </div>
              <div className="mt-0.5 truncate font-sans text-[10.5px] tabular-nums text-blue-800">
                {!focusedFolderSummary
                  ? 'Nessuna cartellina'
                  : focusedFolderSummary.totalPenalty > 0
                  ? `Penalità: -${formatDecimalIt(focusedFolderSummary.totalPenalty, 2)} pt`
                  : 'Dopo penalità (0,00)'}
              </div>
            </div>

            {/* 3. Tavole valutate */}
            <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2">
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-slate-500">
                <span className="truncate">Tavole valutate</span>
                <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              </div>
              <div className="mt-0.5 font-mono text-xl font-bold leading-tight tabular-nums text-slate-950">
                {stats.evaluatedCount}
                <span className="ml-1 text-xs font-normal text-slate-400">
                  / {stats.totalPlates}
                </span>
              </div>
              <div
                className="mt-0.5 truncate text-[10.5px] text-slate-500"
                title={statusBreakdownParts.join(' · ')}
              >
                {statusBreakdownParts.length > 0
                  ? statusBreakdownParts.join(' · ')
                  : 'Tutte valutate'}
              </div>
            </div>

            {/* 4. Voto massimo e minimo */}
            <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2">
              <div className="truncate text-[11px] font-medium text-slate-500">
                Voto max / min
              </div>
              {stats.maxGrade !== null && stats.minGrade !== null ? (
                <>
                  <div className="mt-0.5 flex items-baseline gap-1.5 font-mono text-xl font-bold leading-tight tabular-nums text-slate-950">
                    <span className="text-emerald-800">
                      {formatGradeLabel(stats.maxGrade)}
                    </span>
                    <span className="text-xs font-normal text-slate-400">/</span>
                    <span
                      className={
                        stats.minGrade < 6 ? 'text-rose-700' : 'text-slate-800'
                      }
                    >
                      {formatGradeLabel(stats.minGrade)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-slate-500">
                    Max {stats.maxPlates.join(', ')} · Min{' '}
                    {stats.minPlates.join(', ')}
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-0.5 font-mono text-xl font-bold leading-tight text-slate-400">
                    —
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-slate-500">
                    Nessun voto
                  </div>
                </>
              )}
            </div>

            {/* 5. Andamento generale */}
            <div className={`col-span-2 rounded-md border px-3 py-2 sm:col-span-1 ${trendBadge.cardClass}`}>
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-slate-600">
                <span className="truncate">Andamento</span>
                <TrendIcon className={`h-3.5 w-3.5 shrink-0 ${trendBadge.iconClass}`} />
              </div>
              <div
                className={`mt-0.5 truncate text-base font-bold leading-tight ${trendBadge.textClass}`}
              >
                {trendBadge.label}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-slate-600">
                {stats.trendDetail}
              </div>
            </div>
          </section>

          {/* Complete Chronological SVG Chart — Full-Fit without Horizontal Scroll */}
          <section className="flex min-h-0 flex-1 flex-col rounded-md border border-slate-200 bg-white px-3.5 py-2.5">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
              <h3 className="font-display text-xs font-bold text-slate-900 sm:text-[13px]">
                Andamento completo tavole ({stats.timeline.length})
              </h3>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-700" />
                  Valutata
                </span>
                <span className="font-mono font-semibold text-rose-800">
                  NO <span className="font-sans font-normal text-slate-500">non cons.</span>
                </span>
                <span className="font-mono font-semibold text-red-800">
                  Manc. <span className="font-sans font-normal text-slate-500">scaduta</span>
                </span>
                <span className="font-mono font-semibold text-amber-800">
                  ASS <span className="font-sans font-normal text-slate-500">assente</span>
                </span>
                <span className="font-mono font-semibold text-orange-800">
                  WIP <span className="font-sans font-normal text-slate-500">in corso</span>
                </span>
                <span className="font-mono font-semibold text-sky-800">
                  Da val.
                </span>
                <span className="font-mono font-semibold text-slate-600">
                  Attesa
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <span className="inline-block h-0.5 w-3 border-t border-dashed border-emerald-600" />
                  6
                </span>
              </div>
            </div>

            {stats.timeline.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                <BarChart3 className="h-6 w-6 text-slate-300" />
                <p className="mt-1.5 text-xs font-medium text-slate-600">
                  Nessuna tavola presente nella classe
                </p>
              </div>
            ) : (
              <div className="mt-1.5 flex min-h-0 flex-1 items-center">
                <svg
                  viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                  preserveAspectRatio="xMidYMid meet"
                  className="block h-[205px] w-full select-none sm:h-[222px]"
                  role="img"
                  aria-label={`Grafico percorso completo e voti di ${fullName}`}
                >
                  {/* Grade Y-axis gridlines */}
                  {yTicks.map((tick) => {
                    const y = yForGrade(tick);
                    const isSufficiency = tick === 6;
                    return (
                      <g key={tick}>
                        <line
                          x1={PAD_LEFT}
                          x2={SVG_WIDTH - PAD_RIGHT}
                          y1={y}
                          y2={y}
                          stroke={isSufficiency ? '#10b981' : '#e2e8f0'}
                          strokeWidth={isSufficiency ? 1.25 : 1}
                          strokeDasharray={isSufficiency ? '5 4' : undefined}
                        />
                        <text
                          x={PAD_LEFT - 8}
                          y={y + 3.5}
                          textAnchor="end"
                          className={`font-mono text-[10.5px] ${
                            isSufficiency
                              ? 'fill-emerald-700 font-semibold'
                              : 'fill-slate-500'
                          }`}
                        >
                          {tick}
                        </text>
                      </g>
                    );
                  })}

                  {/* Student Average Reference Line */}
                  {stats.average !== null && (
                    <line
                      x1={PAD_LEFT}
                      x2={SVG_WIDTH - PAD_RIGHT}
                      y1={yForGrade(stats.average)}
                      y2={yForGrade(stats.average)}
                      stroke="#94a3b8"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                    />
                  )}

                  {/* Non-graded status track */}
                  <rect
                    x={PAD_LEFT}
                    y={STATUS_BAND_Y - 13}
                    width={plotW}
                    height={26}
                    rx={4}
                    fill="#f8fafc"
                    stroke="#e2e8f0"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_LEFT - 7}
                    y={STATUS_BAND_Y + 3.5}
                    textAnchor="end"
                    className="font-mono text-[9px] font-semibold fill-slate-500"
                  >
                    Stato
                  </text>

                  {/* Grade trend segments */}
                  {gradeSegments.map((seg) => (
                    <line
                      key={seg.key}
                      x1={seg.x1}
                      y1={seg.y1}
                      x2={seg.x2}
                      y2={seg.y2}
                      stroke={seg.hasGap ? '#93c5fd' : '#1d4ed8'}
                      strokeWidth={seg.hasGap ? 1.6 : 2.25}
                      strokeDasharray={seg.hasGap ? '5 4' : undefined}
                      strokeLinecap="round"
                    />
                  ))}

                  {/* Chronological plate nodes */}
                  {timelineNodes.map((node) => {
                    const isSelected = selectedItem?.plate.id === node.plate.id;
                    const isHovered = hoveredPlateId === node.plate.id;
                    const shortTitle =
                      node.plate.title.length > 11
                        ? `${node.plate.title.slice(0, 10)}…`
                        : node.plate.title;
                    const meta = OUTCOME_META[node.kind];

                    return (
                      <g key={node.plate.id}>
                        {isSelected && (
                          <line
                            x1={node.x}
                            x2={node.x}
                            y1={PAD_TOP}
                            y2={STATUS_BAND_Y + 13}
                            stroke="#93c5fd"
                            strokeWidth={1.5}
                          />
                        )}

                        {/* X-axis T# (+ optional short title when space allows) */}
                        <text
                          x={node.x}
                          y={X_AXIS_Y}
                          textAnchor="middle"
                          className={`font-mono ${
                            compactLabels ? 'text-[9.5px]' : 'text-[10.5px]'
                          } ${
                            isSelected
                              ? 'fill-blue-900 font-bold'
                              : 'fill-slate-700 font-semibold'
                          }`}
                        >
                          T{node.plate.number}
                        </text>
                        {showPlateSubtitles && (
                          <text
                            x={node.x}
                            y={X_AXIS_Y + 12}
                            textAnchor="middle"
                            className="fill-slate-400 text-[9px]"
                          >
                            {shortTitle}
                          </text>
                        )}

                        {node.kind === 'graded' &&
                        node.y !== null &&
                        node.plottedGrade !== null ? (
                          <>
                            <line
                              x1={node.x}
                              x2={node.x}
                              y1={node.y + 5}
                              y2={STATUS_BAND_Y - 13}
                              stroke="#e2e8f0"
                              strokeWidth={1}
                              strokeDasharray="2 2"
                            />
                            <text
                              x={node.x}
                              y={node.y - 9}
                              textAnchor="middle"
                              className={`font-mono ${
                                compactLabels ? 'text-[10px]' : 'text-[11px]'
                              } font-bold ${
                                node.plottedGrade < 6
                                  ? 'fill-rose-700'
                                  : 'fill-slate-900'
                              }`}
                            >
                              {formatGradeLabel(node.plottedGrade)}
                              {node.isRecoveredExNo ? '*' : ''}
                            </text>
                            <circle
                              cx={node.x}
                              cy={STATUS_BAND_Y}
                              r={3}
                              fill="#10b981"
                              opacity={0.75}
                            />
                          </>
                        ) : (
                          <g>
                            <rect
                              x={node.x - badgeW / 2}
                              y={STATUS_BAND_Y - 9}
                              width={badgeW}
                              height={18}
                              rx={3.5}
                              fill={meta.markerBg}
                              stroke={
                                isSelected || isHovered
                                  ? '#1d4ed8'
                                  : meta.markerBorder
                              }
                              strokeWidth={isSelected ? 1.8 : 1.15}
                              strokeDasharray={
                                node.kind === 'not_due' ||
                                node.kind === 'awaiting_grade'
                                  ? '3 2'
                                  : undefined
                              }
                            />
                            <text
                              x={node.x}
                              y={STATUS_BAND_Y + 3}
                              textAnchor="middle"
                              fill={meta.textFill}
                              className={`font-mono font-bold ${
                                compactLabels ? 'text-[8px]' : 'text-[9px]'
                              }`}
                            >
                              {meta.shortBadge}
                            </text>
                          </g>
                        )}

                        {/* Interactive hitbox */}
                        <g
                          role="button"
                          tabIndex={0}
                          aria-label={`Tavola ${node.plate.number} ${node.plate.title}: ${
                            node.plottedGrade !== null
                              ? `voto ${formatGradeLabel(node.plottedGrade)}`
                              : meta.label
                          }`}
                          onClick={() => setSelectedPlateId(node.plate.id)}
                          onMouseEnter={() => setHoveredPlateId(node.plate.id)}
                          onMouseLeave={() => setHoveredPlateId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedPlateId(node.plate.id);
                            }
                          }}
                          className="cursor-pointer focus:outline-none"
                        >
                          <rect
                            x={node.x - Math.max(14, badgeW / 2)}
                            y={PAD_TOP - 6}
                            width={Math.max(28, badgeW)}
                            height={STATUS_BAND_Y + 20 - PAD_TOP}
                            fill="transparent"
                          />
                          {node.kind === 'graded' &&
                            node.y !== null &&
                            node.plottedGrade !== null && (
                              <>
                                {(isSelected || isHovered) && (
                                  <circle
                                    cx={node.x}
                                    cy={node.y}
                                    r={isSelected ? 8.5 : 7}
                                    fill="#dbeafe"
                                    stroke="#1d4ed8"
                                    strokeWidth={1.5}
                                  />
                                )}
                                <circle
                                  cx={node.x}
                                  cy={node.y}
                                  r={isSelected ? 5 : 4}
                                  fill={
                                    node.plottedGrade < 6
                                      ? '#e11d48'
                                      : '#1d4ed8'
                                  }
                                  stroke="#ffffff"
                                  strokeWidth={1.75}
                                />
                              </>
                            )}
                        </g>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </section>

          {/* Compact Bottom Strip: Selected Plate Detail + Folders Summary Table side-by-side */}
          {(selectedItem || folderSummaries.length > 0) && (
            <section className="grid shrink-0 grid-cols-1 gap-2.5 lg:grid-cols-12">
              {selectedItem && selectedOutcomeMeta && (
                <div
                  className={`flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 ${
                    folderSummaries.length > 0
                      ? 'lg:col-span-6'
                      : 'lg:col-span-12'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                      <span className="font-mono font-bold text-blue-900">
                        Tav. {selectedItem.plate.number}
                      </span>
                      <span className="font-semibold text-slate-900 truncate">
                        {selectedItem.plate.title}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span
                        className={`font-semibold ${selectedOutcomeMeta.textClass}`}
                      >
                        {selectedOutcomeMeta.label}
                        {selectedItem.isRecoveredExNo ? ' * (ex-NO)' : ''}
                        {selectedItem.wasAbsent && selectedItem.kind === 'graded'
                          ? ' (ex-ASS)'
                          : ''}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                      <span className="truncate">
                        {selectedOutcomeMeta.description}
                      </span>
                      {selectedItem.plate.dueDate && (
                        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-slate-500">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          Scad. {formatDateIt(selectedItem.plate.dueDate)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 rounded border border-blue-200 bg-white px-2.5 py-1.5">
                    {selectedItem.plottedGrade !== null ? (
                      <div className="text-right leading-none">
                        <span
                          className={`font-mono text-xl font-extrabold tabular-nums ${
                            selectedItem.plottedGrade < 6
                              ? 'text-rose-700'
                              : 'text-blue-950'
                          }`}
                        >
                          {formatGradeLabel(selectedItem.plottedGrade)}
                        </span>
                        <span className="ml-1 font-mono text-[11px] text-slate-500">
                          ({formatDecimalIt(selectedItem.plottedGrade, 2)})
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-800">
                        {selectedItem.kind === 'not_delivered' && (
                          <XCircle className="h-4 w-4 text-rose-600" />
                        )}
                        {selectedItem.kind === 'missing_due' && (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        )}
                        {selectedItem.kind === 'absent' && (
                          <UserX className="h-4 w-4 text-amber-600" />
                        )}
                        {selectedItem.kind === 'wip' && (
                          <Hammer className="h-4 w-4 text-orange-600" />
                        )}
                        {(selectedItem.kind === 'awaiting_grade' ||
                          selectedItem.kind === 'not_due') && (
                          <Clock className="h-4 w-4 text-slate-500" />
                        )}
                        <span>{selectedOutcomeMeta.shortBadge}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {folderSummaries.length > 0 && (
                <div
                  className={`overflow-hidden rounded-md border border-slate-200 bg-white ${
                    selectedItem ? 'lg:col-span-6' : 'lg:col-span-12'
                  }`}
                >
                  <div className="max-h-[112px] overflow-y-auto">
                    <table className="w-full border-collapse text-left text-[11px]">
                      <thead className="sticky top-0 bg-slate-50 text-[10px] font-semibold text-slate-600">
                        <tr className="border-b border-slate-200">
                          <th className="px-2.5 py-1">Cartellina</th>
                          <th className="px-2 py-1">Tavole</th>
                          <th className="px-2 py-1 text-right">Media</th>
                          <th className="px-2 py-1 text-right">Rit.</th>
                          <th className="px-2 py-1 text-right">Pen.</th>
                          <th className="px-2.5 py-1 text-right">Finale</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {folderSummaries.map(({ folder, calc, totalPenalty }) => {
                          const isFocused =
                            focusedFolderSummary?.folder.id === folder.id;
                          return (
                            <tr
                              key={folder.id}
                              onClick={() => setFocusedFolderId(folder.id)}
                              className={`cursor-pointer transition-colors ${
                                isFocused
                                  ? 'bg-blue-50/70'
                                  : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="max-w-[115px] truncate px-2.5 py-1 font-sans font-semibold text-slate-900">
                                {folder.title}
                              </td>
                              <td className="px-2 py-1 font-sans text-slate-500">
                                {formatPlateInterval(
                                  folder.plateIds,
                                  classData.plates
                                )}
                              </td>
                              <td className="px-2 py-1 text-right font-semibold text-slate-800">
                                {calc.initialAverage !== null
                                  ? formatDecimalIt(calc.initialAverage, 2)
                                  : '—'}
                              </td>
                              <td className="px-2 py-1 text-right text-slate-600">
                                {calc.rawDelayDays > 0
                                  ? `${calc.rawDelayDays}g`
                                  : '0g'}
                              </td>
                              <td className="px-2 py-1 text-right font-sans font-semibold tabular-nums text-rose-700">
                                {totalPenalty > 0
                                  ? `-${formatDecimalIt(totalPenalty, 2)}`
                                  : '0,00'}
                              </td>
                              <td className="px-2.5 py-1 text-right font-bold text-blue-950">
                                {calc.finalGrade !== null
                                  ? `${formatGradeLabel(calc.finalGrade)} (${formatDecimalIt(
                                      calc.finalGrade,
                                      2
                                    )})`
                                  : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
