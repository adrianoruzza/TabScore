import { X } from 'lucide-react';
import { getClassColorOption } from '../../utils/classColors';
import {
  formatPercentIt,
  type SelectedClassAnalytics,
} from '../../utils/schoolDataAnalytics';
import { SUPPORT_CATEGORY_META } from './DataSectionShell';

interface ClassDetailPanelProps {
  detail: SelectedClassAnalytics;
  onClose: () => void;
}

export function ClassDetailPanel({ detail, onClose }: ClassDetailPanelProps) {
  const { summary } = detail;
  const colorTheme = getClassColorOption(summary.color, summary.colorIndex);
  const { support, totalStudents } = summary;

  const categories = [
    {
      meta: SUPPORT_CATEGORY_META.DSA,
      count: support.dsa,
      pct: summary.dsaPct,
    },
    {
      meta: SUPPORT_CATEGORY_META.BES,
      count: support.bes,
      pct: summary.besPct,
    },
    {
      meta: SUPPORT_CATEGORY_META.H,
      count: support.h,
      pct: summary.hPct,
    },
  ];

  const maxCategoryCount = Math.max(
    1,
    totalStudents,
    support.dsa,
    support.bes,
    support.h
  );

  return (
    <section
      aria-labelledby="selected-class-detail-heading"
      className="rounded-lg border border-blue-200 bg-white"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              style={{ backgroundColor: colorTheme.accent }}
              className="h-3.5 w-3.5 shrink-0 rounded-sm"
            />
            <h2
              id="selected-class-detail-heading"
              className="font-display text-base font-semibold text-slate-900 truncate"
            >
              Dettaglio classe: {summary.className}
            </h2>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{summary.yearLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{summary.schoolYear}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {formatPercentIt(detail.shareOfAllStudentsPct)} degli studenti totali
            </span>
            {detail.yearCohortClassCount > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {formatPercentIt(detail.shareOfYearStudentsPct)} nel gruppo{' '}
                  {summary.yearLabel.toLowerCase()} ({detail.yearCohortClassCount}{' '}
                  classi)
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
        >
          <X className="h-3.5 w-3.5" />
          Chiudi dettaglio
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-12">
        {/* Compact class metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-7">
          <div className="border-r border-slate-100 pr-3 last:border-r-0">
            <div className="text-xs font-medium text-slate-500">
              Studenti classe
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {totalStudents}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {support.studentsWithAnySupport} con almeno una categoria
            </div>
          </div>

          {categories.map(({ meta, count, pct }) => (
            <div
              key={meta.id}
              className="border-r border-slate-100 pr-3 last:border-r-0"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: meta.barColor }}
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                />
                <span>{meta.label}</span>
              </div>
              <div
                className={`mt-1 font-display text-2xl font-bold tabular-nums ${meta.textClass}`}
              >
                {count}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                {formatPercentIt(pct)} della classe
              </div>
            </div>
          ))}
        </div>

        {/* Visual proportion bars for the selected class */}
        <div className="flex flex-col justify-center space-y-2.5 border-t border-slate-100 pt-4 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <div className="text-xs font-medium text-slate-600">
            Incidenza categorie sulla classe ({totalStudents}{' '}
            {totalStudents === 1 ? 'studente' : 'studenti'})
          </div>
          {categories.map(({ meta, count, pct }) => {
            const widthPct =
              totalStudents > 0 ? Math.min(100, (count / maxCategoryCount) * 100) : 0;
            return (
              <div key={meta.id} className="space-y-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-slate-700">
                    {meta.label}{' '}
                    <span className="font-normal text-slate-400">
                      — {meta.fullName}
                    </span>
                  </span>
                  <span className="shrink-0 pl-2 font-mono text-xs font-semibold text-slate-800 tabular-nums">
                    {count}{' '}
                    <span className="font-normal text-slate-500">
                      ({formatPercentIt(pct)})
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-sm bg-slate-100">
                  <div
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: meta.barColor,
                    }}
                    className="h-full rounded-sm transition-all duration-200"
                  />
                </div>
              </div>
            );
          })}
          {support.multiCategoryStudents > 0 && (
            <p className="pt-1 text-[11px] text-slate-500">
              {support.multiCategoryStudents}{' '}
              {support.multiCategoryStudents === 1
                ? 'studente appartiene'
                : 'studenti appartengono'}{' '}
              a più categorie ed è conteggiato in ciascuna categoria pertinente.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
