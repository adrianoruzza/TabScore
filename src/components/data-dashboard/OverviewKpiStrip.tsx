import type { SchoolPopulationOverview } from '../../utils/schoolDataAnalytics';
import { formatPercentIt } from '../../utils/schoolDataAnalytics';
import { SUPPORT_CATEGORY_META } from './DataSectionShell';

interface OverviewKpiStripProps {
  overview: SchoolPopulationOverview;
  scopeLabel: string;
}

export function OverviewKpiStrip({
  overview,
  scopeLabel,
}: OverviewKpiStripProps) {
  const { totalStudents, totalClasses, dsaCount, besCount, hCount } = overview;

  const dsaPct =
    totalStudents > 0 ? formatPercentIt((dsaCount / totalStudents) * 100) : '0%';
  const besPct =
    totalStudents > 0 ? formatPercentIt((besCount / totalStudents) * 100) : '0%';
  const hPct =
    totalStudents > 0 ? formatPercentIt((hCount / totalStudents) * 100) : '0%';

  const avgStudentsPerClass =
    totalClasses > 0
      ? (totalStudents / totalClasses).toFixed(1).replace('.', ',')
      : '0';

  const items = [
    {
      id: 'total-students',
      label: 'Totale studenti',
      value: totalStudents,
      detail:
        totalClasses > 0
          ? `Media ${avgStudentsPerClass} per classe`
          : 'Nessuna classe attiva',
      accentColor: null as string | null,
      valueClass: 'text-slate-900',
    },
    {
      id: 'total-classes',
      label: 'Totale classi',
      value: totalClasses,
      detail: scopeLabel,
      accentColor: null as string | null,
      valueClass: 'text-slate-900',
    },
    {
      id: 'dsa-students',
      label: 'Studenti DSA',
      value: dsaCount,
      detail: `${dsaPct} sul totale studenti`,
      accentColor: SUPPORT_CATEGORY_META.DSA.barColor,
      valueClass: SUPPORT_CATEGORY_META.DSA.textClass,
    },
    {
      id: 'bes-students',
      label: 'Studenti BES',
      value: besCount,
      detail: `${besPct} sul totale studenti`,
      accentColor: SUPPORT_CATEGORY_META.BES.barColor,
      valueClass: SUPPORT_CATEGORY_META.BES.textClass,
    },
    {
      id: 'h-students',
      label: 'Studenti H',
      value: hCount,
      detail: `${hPct} sul totale studenti`,
      accentColor: SUPPORT_CATEGORY_META.H.barColor,
      valueClass: SUPPORT_CATEGORY_META.H.textClass,
    },
  ];

  return (
    <section aria-label="Riepilogo generale degli studenti">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white px-4 py-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                {item.label}
              </span>
              {item.accentColor && (
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: item.accentColor }}
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                />
              )}
            </div>
            <div
              className={`mt-2 font-display text-3xl font-bold tracking-tight tabular-nums ${item.valueClass}`}
            >
              {item.value}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500 tabular-nums">
              {item.detail}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
