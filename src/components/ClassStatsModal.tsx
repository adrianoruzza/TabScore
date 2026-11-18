import { BarChart3, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ClassData, Student } from '../types/gradebook';
import {
  calculateFolderEvaluation,
  EMPTY_EVALUATION,
  EMPTY_FOLDER_RECORD,
  formatDateIt,
  formatDecimalIt,
  formatGradeLabel,
  sortPlates,
} from '../utils/calculations';
import { getGradeColorStyle } from '../utils/gradeColors';

interface ClassStatsModalProps {
  open: boolean;
  classData: ClassData;
  onOpenStudentStats?: (student: Student) => void;
  onClose: () => void;
}

type StatsTab = 'panoramica' | 'tavole' | 'studenti';

export function ClassStatsModal({
  open,
  classData,
  onOpenStudentStats,
  onClose,
}: ClassStatsModalProps) {
  const [activeTab, setActiveTab] = useState<StatsTab>('panoramica');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const stats = useMemo(() => {
    if (!open) return null;
    const sortedStudents = [...classData.students].sort(
      (a, b) => a.order - b.order
    );
    const orderedPlates = sortPlates(classData.plates);

    let siCount = 0;
    let exNoCount = 0;
    let noCount = 0;
    let assCount = 0;
    let wipCount = 0;

    const allGrades: number[] = [];
    let sufficientCount = 0;
    let insufficientCount = 0;

    for (const stu of sortedStudents) {
      const stuEvals = classData.evaluations[stu.id] ?? {};
      for (const p of orderedPlates) {
        const cell = stuEvals[p.id] ?? EMPTY_EVALUATION;
        if (cell.status === 'SI') {
          siCount += 1;
          if (cell.wasNo) exNoCount += 1;
        } else if (cell.status === 'NO') {
          noCount += 1;
        } else if (cell.status === 'ASS') {
          assCount += 1;
        } else if (cell.status === 'WIP') {
          wipCount += 1;
        }

        if (cell.grade !== null && !Number.isNaN(cell.grade)) {
          allGrades.push(cell.grade);
          if (cell.grade >= 6) sufficientCount += 1;
          else insufficientCount += 1;
        }
      }
    }

    const totalCells = sortedStudents.length * orderedPlates.length;
    const overallAvg =
      allGrades.length > 0
        ? allGrades.reduce((sum, g) => sum + g, 0) / allGrades.length
        : null;
    const minGrade = allGrades.length > 0 ? Math.min(...allGrades) : null;
    const maxGrade = allGrades.length > 0 ? Math.max(...allGrades) : null;

    const supportCounts = {
      DSA: sortedStudents.filter((s) => s.supportNeeds?.includes('DSA')).length,
      BES: sortedStudents.filter((s) => s.supportNeeds?.includes('BES')).length,
      H: sortedStudents.filter((s) => s.supportNeeds?.includes('H')).length,
      any: sortedStudents.filter(
        (s) => s.supportNeeds && s.supportNeeds.length > 0
      ).length,
    };

    const plateRows = orderedPlates.map((p) => {
      let si = 0;
      let exNo = 0;
      let no = 0;
      let ass = 0;
      let wip = 0;
      const grades: number[] = [];

      for (const stu of sortedStudents) {
        const cell = classData.evaluations[stu.id]?.[p.id] ?? EMPTY_EVALUATION;
        if (cell.status === 'SI') {
          si += 1;
          if (cell.wasNo) exNo += 1;
        } else if (cell.status === 'NO') no += 1;
        else if (cell.status === 'ASS') ass += 1;
        else if (cell.status === 'WIP') wip += 1;

        if (cell.grade !== null && !Number.isNaN(cell.grade)) {
          grades.push(cell.grade);
        }
      }

      const avg =
        grades.length > 0
          ? grades.reduce((sum, g) => sum + g, 0) / grades.length
          : null;

      return {
        plate: p,
        si,
        exNo,
        no,
        ass,
        wip,
        gradedCount: grades.length,
        avg,
      };
    });

    const folderRows = classData.folders.map((f) => {
      let consegnate = 0;
      let inRitardo = 0;
      let nonConsegnate = 0;
      let daConsegnare = 0;
      let confirmedCount = 0;
      const finalGrades: number[] = [];
      const initialAverages: number[] = [];

      for (const stu of sortedStudents) {
        const rec = classData.folderRecords[stu.id]?.[f.id] ?? EMPTY_FOLDER_RECORD;
        const calc = calculateFolderEvaluation(classData, stu.id, f);

        if (rec.status === 'consegnata') consegnate += 1;
        else if (rec.status === 'consegnata_ritardo') inRitardo += 1;
        else if (rec.status === 'non_consegnata') nonConsegnate += 1;
        else daConsegnare += 1;

        if (calc.isConfirmed) confirmedCount += 1;
        if (calc.finalGrade !== null) finalGrades.push(calc.finalGrade);
        if (calc.initialAverage !== null) initialAverages.push(calc.initialAverage);
      }

      return {
        folder: f,
        consegnate,
        inRitardo,
        nonConsegnate,
        daConsegnare,
        confirmedCount,
        finalAvg:
          finalGrades.length > 0
            ? finalGrades.reduce((s, g) => s + g, 0) / finalGrades.length
            : null,
        initialAvg:
          initialAverages.length > 0
            ? initialAverages.reduce((s, g) => s + g, 0) / initialAverages.length
            : null,
        finalCount: finalGrades.length,
      };
    });

    const lastFolder = classData.folders[classData.folders.length - 1] ?? null;

    const studentRows = sortedStudents.map((stu, idx) => {
      const stuEvals = classData.evaluations[stu.id] ?? {};
      let si = 0;
      let no = 0;
      let exNo = 0;
      let ass = 0;
      let wip = 0;
      const grades: number[] = [];

      for (const p of orderedPlates) {
        const cell = stuEvals[p.id] ?? EMPTY_EVALUATION;
        if (cell.status === 'SI') {
          si += 1;
          if (cell.wasNo) exNo += 1;
        } else if (cell.status === 'NO') no += 1;
        else if (cell.status === 'ASS') ass += 1;
        else if (cell.status === 'WIP') wip += 1;

        if (cell.grade !== null && !Number.isNaN(cell.grade)) {
          grades.push(cell.grade);
        }
      }

      const avg =
        grades.length > 0
          ? grades.reduce((s, g) => s + g, 0) / grades.length
          : null;

      const lastFolderGrade = lastFolder
        ? calculateFolderEvaluation(classData, stu.id, lastFolder).finalGrade
        : null;

      return {
        student: stu,
        index: idx + 1,
        si,
        no,
        exNo,
        ass,
        wip,
        gradedCount: grades.length,
        avg,
        lastFolderGrade,
      };
    });

    return {
      studentCount: sortedStudents.length,
      plateCount: orderedPlates.length,
      folderCount: classData.folders.length,
      totalCells,
      siCount,
      exNoCount,
      noCount,
      assCount,
      wipCount,
      gradedCount: allGrades.length,
      sufficientCount,
      insufficientCount,
      overallAvg,
      minGrade,
      maxGrade,
      supportCounts,
      plateRows,
      folderRows,
      studentRows,
      lastFolder,
    };
  }, [open, classData]);

  if (!open || !stats) return null;

  const pct = (part: number, total: number) =>
    total > 0 ? `${Math.round((part / total) * 100)}%` : '0%';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-[1px] sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="class-stats-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 shrink-0 text-blue-700" />
              <h2
                id="class-stats-title"
                className="font-display truncate text-base font-bold text-slate-900 sm:text-lg"
              >
                Statistiche della classe — {classData.name}
              </h2>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {classData.schoolYear} ·{' '}
              <span className="font-mono tabular-nums">
                {stats.studentCount} studenti · {stats.plateCount} tavole ·{' '}
                {stats.folderCount} cartelline
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi statistiche"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-5 py-2 sm:px-6">
          {(
            [
              { id: 'panoramica', label: 'Panoramica e Cartelline' },
              { id: 'tavole', label: `Per tavola (${stats.plateCount})` },
              { id: 'studenti', label: `Per studente (${stats.studentCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {activeTab === 'panoramica' && (
            <div className="space-y-6">
              {/* Primary KPI Strip */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    Media voti tavole
                  </div>
                  <div className="mt-1">
                    {stats.overallAvg !== null ? (
                      <span
                        style={getGradeColorStyle(stats.overallAvg, {
                          includeBorder: true,
                        })}
                        className="inline-flex rounded border px-2 py-0.5 font-mono text-2xl font-bold tabular-nums"
                      >
                        {formatDecimalIt(stats.overallAvg, 2)}
                      </span>
                    ) : (
                      <span className="font-mono text-2xl font-bold text-slate-400">
                        —
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                    {stats.gradedCount} voti inseriti
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    Sufficienze (≥ 6)
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-800">
                    {stats.gradedCount > 0
                      ? pct(stats.sufficientCount, stats.gradedCount)
                      : '—'}
                  </div>
                  <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                    {stats.sufficientCount} suff. / {stats.insufficientCount} insuff.
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    Intervallo voti
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
                    {stats.minGrade !== null && stats.maxGrade !== null
                      ? `${formatGradeLabel(stats.minGrade)} – ${formatGradeLabel(stats.maxGrade)}`
                      : '—'}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Minimo – Massimo
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    Profili DSA / BES / H
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
                    {stats.supportCounts.any}
                  </div>
                  <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                    DSA {stats.supportCounts.DSA} · BES {stats.supportCounts.BES} · H {stats.supportCounts.H}
                  </div>
                </div>
              </div>

              {/* Delivery Status Breakdown */}
              <section className="space-y-2.5 border-t border-slate-200 pt-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Distribuzione stati consegna tavole
                  </h3>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    Totale controlli possibili: {stats.totalCells}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2.5">
                    <div className="text-[11px] font-semibold text-emerald-900">
                      SI (Consegnate)
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-emerald-950">
                      {stats.siCount}{' '}
                      <span className="text-xs font-normal text-emerald-800">
                        ({pct(stats.siCount, stats.totalCells)})
                      </span>
                    </div>
                    <div className="font-mono text-[10.5px] tabular-nums text-emerald-800">
                      di cui {stats.exNoCount} ex-NO (*)
                    </div>
                  </div>

                  <div className="rounded-md border border-rose-200 bg-rose-50/70 px-3 py-2.5">
                    <div className="text-[11px] font-semibold text-rose-900">
                      NO (Mancanti)
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-rose-950">
                      {stats.noCount}{' '}
                      <span className="text-xs font-normal text-rose-800">
                        ({pct(stats.noCount, stats.totalCells)})
                      </span>
                    </div>
                    <div className="text-[10.5px] text-rose-800">
                      Con penalità
                    </div>
                  </div>

                  <div className="rounded-md border border-yellow-200 bg-yellow-50/80 px-3 py-2.5">
                    <div className="text-[11px] font-semibold text-yellow-900">
                      ASS (Assenti)
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-yellow-950">
                      {stats.assCount}{' '}
                      <span className="text-xs font-normal text-yellow-800">
                        ({pct(stats.assCount, stats.totalCells)})
                      </span>
                    </div>
                    <div className="text-[10.5px] text-yellow-800">
                      Recuperabili, no pen.
                    </div>
                  </div>

                  <div className="rounded-md border border-orange-200 bg-orange-50/70 px-3 py-2.5">
                    <div className="text-[11px] font-semibold text-orange-900">
                      WIP (In corso)
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-orange-950">
                      {stats.wipCount}{' '}
                      <span className="text-xs font-normal text-orange-800">
                        ({pct(stats.wipCount, stats.totalCells)})
                      </span>
                    </div>
                    <div className="text-[10.5px] text-orange-800">
                      Nessuna penalità
                    </div>
                  </div>
                </div>
              </section>

              {/* Folder Summary */}
              <section className="space-y-2.5 border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">
                  Riepilogo Cartelline
                </h3>
                {stats.folderRows.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Nessuna consegna di cartellina configurata per questa classe.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="bg-slate-50 text-[11px] font-semibold text-slate-700">
                        <tr className="border-b border-slate-200">
                          <th className="px-3 py-2">Cartellina</th>
                          <th className="px-3 py-2">Scadenza</th>
                          <th className="px-3 py-2 text-right">Consegnate</th>
                          <th className="px-3 py-2 text-right">In ritardo</th>
                          <th className="px-3 py-2 text-right">Non cons.</th>
                          <th className="px-3 py-2 text-right">Da cons.</th>
                          <th className="px-3 py-2 text-right">Media voti</th>
                          <th className="px-3 py-2 text-right">Voto finale medio</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white font-mono tabular-nums">
                        {stats.folderRows.map((row) => (
                          <tr key={row.folder.id}>
                            <td className="px-3 py-2 font-sans font-semibold text-slate-900">
                              {row.folder.title}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {row.folder.dueDate
                                ? formatDateIt(row.folder.dueDate)
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-right text-emerald-800">
                              {row.consegnate}
                            </td>
                            <td className="px-3 py-2 text-right text-amber-800">
                              {row.inRitardo}
                            </td>
                            <td className="px-3 py-2 text-right text-rose-700">
                              {row.nonConsegnate}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-500">
                              {row.daConsegnare}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700">
                              {row.initialAvg !== null ? (
                                <span
                                  style={getGradeColorStyle(row.initialAvg)}
                                  className="inline-flex rounded px-1.5 py-0.5 font-semibold"
                                >
                                  {formatDecimalIt(row.initialAvg, 2)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-blue-900">
                              {row.finalAvg !== null ? (
                                <span
                                  style={getGradeColorStyle(row.finalAvg)}
                                  className="inline-flex rounded px-1.5 py-0.5 font-bold"
                                >
                                  {formatDecimalIt(row.finalAvg, 2)} (
                                  {row.finalCount})
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'tavole' && (
            <div>
              {stats.plateRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Nessuna tavola presente nella classe.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] font-semibold text-slate-700">
                      <tr className="border-b border-slate-200">
                        <th className="px-3 py-2">Tav.</th>
                        <th className="px-3 py-2">Titolo</th>
                        <th className="px-3 py-2 text-right">SI (ex-NO)</th>
                        <th className="px-3 py-2 text-right">NO</th>
                        <th className="px-3 py-2 text-right">ASS</th>
                        <th className="px-3 py-2 text-right">WIP</th>
                        <th className="px-3 py-2 text-right">Voti</th>
                        <th className="px-3 py-2 text-right">Media</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white font-mono tabular-nums">
                      {stats.plateRows.map((row) => (
                        <tr key={row.plate.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-bold text-blue-900">
                            T{row.plate.number}
                          </td>
                          <td className="max-w-[260px] truncate px-3 py-2 font-sans font-medium text-slate-900">
                            {row.plate.title}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-800">
                            {row.si}
                            {row.exNo > 0 && (
                              <span className="ml-1 text-[10px] text-rose-600">
                                ({row.exNo}*)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-rose-700">
                            {row.no}
                          </td>
                          <td className="px-3 py-2 text-right text-amber-800">
                            {row.ass}
                          </td>
                          <td className="px-3 py-2 text-right text-orange-700">
                            {row.wip}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {row.gradedCount}/{stats.studentCount}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">
                            {row.avg !== null ? (
                              <span
                                style={getGradeColorStyle(row.avg)}
                                className="inline-flex rounded px-1.5 py-0.5 font-bold"
                              >
                                {formatDecimalIt(row.avg, 2)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'studenti' && (
            <div>
              {stats.studentRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Nessuno studente inserito nella classe.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] font-semibold text-slate-700">
                      <tr className="border-b border-slate-200">
                        <th className="px-3 py-2">N°</th>
                        <th className="px-3 py-2">Studente</th>
                        <th className="px-3 py-2 text-right">SI</th>
                        <th className="px-3 py-2 text-right">NO</th>
                        <th className="px-3 py-2 text-right">ASS</th>
                        <th className="px-3 py-2 text-right">WIP</th>
                        <th className="px-3 py-2 text-right">Voti</th>
                        <th className="px-3 py-2 text-right">Media voti</th>
                        {stats.lastFolder && (
                          <th className="px-3 py-2 text-right">
                            Voto finale ({stats.lastFolder.title})
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white font-mono tabular-nums">
                      {stats.studentRows.map((row) => {
                        const tags = row.student.supportNeeds;
                        return (
                          <tr
                            key={row.student.id}
                            onClick={
                              onOpenStudentStats
                                ? () => {
                                    onClose();
                                    onOpenStudentStats(row.student);
                                  }
                                : undefined
                            }
                            title={
                              onOpenStudentStats
                                ? `Apri statistiche individuali di ${row.student.lastName} ${row.student.firstName}`
                                : undefined
                            }
                            className={
                              onOpenStudentStats
                                ? 'cursor-pointer hover:bg-blue-50/60'
                                : 'hover:bg-slate-50'
                            }
                          >
                            <td className="px-3 py-2 text-slate-400">
                              {row.index}.
                              {tags && tags.length > 0 && (
                                <span
                                  className="ml-0.5 font-sans font-bold text-amber-600"
                                  title={tags.join(', ')}
                                >
                                  *
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-sans font-medium text-slate-900">
                              {row.student.lastName} {row.student.firstName}
                              {tags && tags.length > 0 && (
                                <span className="ml-2 font-mono text-[10px] text-amber-700">
                                  ({tags.join('/')})
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-emerald-800">
                              {row.si}
                            </td>
                            <td className="px-3 py-2 text-right text-rose-700">
                              {row.no}
                              {row.exNo > 0 && (
                                <span className="ml-0.5 text-[10px]">
                                  (+{row.exNo}*)
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-amber-800">
                              {row.ass}
                            </td>
                            <td className="px-3 py-2 text-right text-orange-700">
                              {row.wip}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {row.gradedCount}/{stats.plateCount}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900">
                              {row.avg !== null ? (
                                <span
                                  style={getGradeColorStyle(row.avg)}
                                  className="inline-flex rounded px-1.5 py-0.5 font-bold"
                                >
                                  {formatDecimalIt(row.avg, 2)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            {stats.lastFolder && (
                              <td className="px-3 py-2 text-right font-bold text-blue-900">
                                {row.lastFolderGrade !== null ? (
                                  <span
                                    style={getGradeColorStyle(
                                      row.lastFolderGrade
                                    )}
                                    className="inline-flex rounded px-1.5 py-0.5 font-bold"
                                  >
                                    {formatGradeLabel(row.lastFolderGrade)}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 sm:px-6">
          <span className="text-[11px] text-slate-500">
            Dati calcolati in tempo reale senza modificare il registro.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
