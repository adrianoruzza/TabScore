import { getClassColorOption } from '../../utils/classColors';
import {
  formatPercentIt,
  type ClassDataSummary,
  type SchoolPopulationOverview,
} from '../../utils/schoolDataAnalytics';
import { DataSectionShell, SUPPORT_CATEGORY_META } from './DataSectionShell';

interface SupportDistributionSectionProps {
  classes: ClassDataSummary[];
  totals: SchoolPopulationOverview;
  selectedClassId: string | null;
  onSelectClass: (classId: string | null) => void;
}

const CHART_CATEGORIES = [
  SUPPORT_CATEGORY_META.DSA,
  SUPPORT_CATEGORY_META.BES,
  SUPPORT_CATEGORY_META.H,
] as const;

export function SupportDistributionSection({
  classes,
  totals,
  selectedClassId,
  onSelectClass,
}: SupportDistributionSectionProps) {
  const maxBarValue = Math.max(
    1,
    ...classes.map((c) => Math.max(c.support.dsa, c.support.bes, c.support.h))
  );

  // Build clean integer Y-axis ticks (up to 4 intervals)
  const yTickStep = Math.max(1, Math.ceil(maxBarValue / 4));
  const yAxisMax = yTickStep * 4;
  const yTicks = [yAxisMax, yTickStep * 3, yTickStep * 2, yTickStep, 0];

  const handleToggleClass = (classId: string) => {
    onSelectClass(selectedClassId === classId ? null : classId);
  };

  return (
    <DataSectionShell
      id="support-distribution"
      title="Distribuzione studenti DSA, BES e H per classe"
      subtitle="Conteggio ricavato esclusivamente dalle categorie assegnate nell'anagrafica. Fai clic su una classe per aprirne il dettaglio."
      headerRight={
        <div
          className="flex flex-wrap items-center gap-4 text-xs text-slate-600"
          aria-label="Legenda categorie"
        >
          {CHART_CATEGORIES.map((cat) => (
            <span key={cat.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                style={{ backgroundColor: cat.barColor }}
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              />
              <span className="font-medium text-slate-700">{cat.label}</span>
            </span>
          ))}
        </div>
      }
    >
      {classes.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">
          Nessuna classe corrisponde al filtro selezionato.
        </div>
      ) : (
        <div className="space-y-8">
          {/* 1. Structured summary table */}
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[460px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th scope="col" className="px-4 py-2.5">
                    Classe
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right">
                    Totale studenti
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right">
                    <span className={SUPPORT_CATEGORY_META.DSA.textClass}>
                      DSA
                    </span>
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right">
                    <span className={SUPPORT_CATEGORY_META.BES.textClass}>
                      BES
                    </span>
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right">
                    <span className={SUPPORT_CATEGORY_META.H.textClass}>H</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {classes.map((cls) => {
                  const isSelected = selectedClassId === cls.classId;
                  const colorTheme = getClassColorOption(
                    cls.color,
                    cls.colorIndex
                  );
                  return (
                    <tr
                      key={cls.classId}
                      onClick={() => handleToggleClass(cls.classId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleClass(cls.classId);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-pressed={isSelected}
                      className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                        isSelected
                          ? 'bg-blue-50/70'
                          : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            style={{ backgroundColor: colorTheme.accent }}
                            className="h-3 w-3 shrink-0 rounded-[2px]"
                          />
                          <div className="min-w-0">
                            <span className="font-medium text-slate-900">
                              {cls.className}
                            </span>
                            <span className="ml-2 text-xs text-slate-400">
                              {cls.yearShortLabel}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {cls.totalStudents}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        <span
                          className={
                            cls.support.dsa > 0
                              ? `font-semibold ${SUPPORT_CATEGORY_META.DSA.textClass}`
                              : 'text-slate-400'
                          }
                        >
                          {cls.support.dsa}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        <span
                          className={
                            cls.support.bes > 0
                              ? `font-semibold ${SUPPORT_CATEGORY_META.BES.textClass}`
                              : 'text-slate-400'
                          }
                        >
                          {cls.support.bes}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        <span
                          className={
                            cls.support.h > 0
                              ? `font-semibold ${SUPPORT_CATEGORY_META.H.textClass}`
                              : 'text-slate-400'
                          }
                        >
                          {cls.support.h}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
                  <td className="px-4 py-3 text-xs font-semibold text-slate-700">
                    Totale generale ({classes.length}{' '}
                    {classes.length === 1 ? 'classe' : 'classi'})
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {totals.totalStudents}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono tabular-nums ${SUPPORT_CATEGORY_META.DSA.textClass}`}
                  >
                    {totals.dsaCount}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono tabular-nums ${SUPPORT_CATEGORY_META.BES.textClass}`}
                  >
                    {totals.besCount}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono tabular-nums ${SUPPORT_CATEGORY_META.H.textClass}`}
                  >
                    {totals.hCount}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Counting transparency note */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <p>
              Gli studenti appartenenti a più categorie vengono conteggiati in
              ciascuna categoria pertinente; la somma DSA + BES + H può quindi
              superare il numero di studenti coinvolti.
            </p>
            <div className="shrink-0 font-mono text-[11px] text-slate-600 tabular-nums">
              Studenti con almeno una categoria: {totals.studentsWithAnySupport}
              {totals.totalStudents > 0
                ? ` (${formatPercentIt(
                    (totals.studentsWithAnySupport / totals.totalStudents) * 100
                  )})`
                : ''}
              {totals.multiCategoryStudents > 0 &&
                ` · Multi-categoria: ${totals.multiCategoryStudents}`}
            </div>
          </div>

          {/* 2. Comparative grouped bar chart across classes */}
          <div className="border-t border-slate-200 pt-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Confronto grafico per classe (DSA, BES, H)
              </h3>
              <span className="text-xs text-slate-500">
                Valori espressi in numero di studenti per categoria
              </span>
            </div>

            {totals.dsaCount === 0 &&
            totals.besCount === 0 &&
            totals.hCount === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-xs text-slate-500">
                Nessuno studente con categoria DSA, BES o H registrata nelle
                classi visualizzate. Il grafico comparativo si popolerà
                automaticamente all&apos;inserimento delle categorie in
                anagrafica.
              </div>
            ) : (
              <div className="overflow-x-auto pb-2">
                <div
                  className="flex items-stretch gap-3"
                  style={{
                    minWidth: `${Math.max(420, classes.length * 104 + 48)}px`,
                  }}
                >
                  {/* Y-axis scale aligned strictly with the 176px (h-44) bar area */}
                  <div
                    aria-hidden="true"
                    className="flex h-44 w-8 shrink-0 flex-col justify-between text-right font-mono text-[11px] text-slate-400 tabular-nums"
                  >
                    {yTicks.map((tick) => (
                      <span key={tick} className="leading-none">
                        {tick}
                      </span>
                    ))}
                  </div>

                  {/* Plot area (bars + gridlines) + X-axis labels row */}
                  <div className="flex-1">
                    <div className="relative h-44">
                      {/* Horizontal gridlines spanning exact bar area height */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 flex flex-col justify-between"
                      >
                        {yTicks.map((tick) => (
                          <div
                            key={tick}
                            className={`w-full border-t ${
                              tick === 0
                                ? 'border-slate-300'
                                : 'border-slate-100'
                            }`}
                          />
                        ))}
                      </div>

                      {/* Class column groups */}
                      <div className="relative flex h-full items-end justify-around gap-3 pt-4">
                        {classes.map((cls) => {
                          const isSelected = selectedClassId === cls.classId;
                          const values = [
                            {
                              meta: SUPPORT_CATEGORY_META.DSA,
                              count: cls.support.dsa,
                            },
                            {
                              meta: SUPPORT_CATEGORY_META.BES,
                              count: cls.support.bes,
                            },
                            {
                              meta: SUPPORT_CATEGORY_META.H,
                              count: cls.support.h,
                            },
                          ];

                          return (
                            <button
                              key={cls.classId}
                              type="button"
                              onClick={() => handleToggleClass(cls.classId)}
                              title={`${cls.className}: DSA ${cls.support.dsa}, BES ${cls.support.bes}, H ${cls.support.h} (totale ${cls.totalStudents} studenti)`}
                              className={`group flex h-full min-w-[76px] max-w-[136px] flex-1 items-end justify-center gap-1.5 rounded-t-md px-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                                isSelected
                                  ? 'bg-blue-50/70'
                                  : 'hover:bg-slate-50/80'
                              }`}
                            >
                              {values.map(({ meta, count }) => {
                                const heightPct =
                                  count > 0
                                    ? Math.max(6, (count / yAxisMax) * 100)
                                    : 0;
                                return (
                                  <div
                                    key={meta.id}
                                    className="flex h-full w-5 flex-col items-center justify-end sm:w-6"
                                  >
                                    {count > 0 && (
                                      <span className="mb-1 font-mono text-[10px] font-semibold text-slate-700 tabular-nums leading-none">
                                        {count}
                                      </span>
                                    )}
                                    <div
                                      style={{
                                        height: `${heightPct}%`,
                                        backgroundColor:
                                          count > 0
                                            ? meta.barColor
                                            : '#e2e8f0',
                                        minHeight: count > 0 ? '4px' : '2px',
                                      }}
                                      className="w-full rounded-t-[3px] transition-all duration-200"
                                    />
                                  </div>
                                );
                              })}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Aligned X-axis class labels directly below each group */}
                    <div className="mt-2 flex items-start justify-around gap-3">
                      {classes.map((cls) => {
                        const isSelected = selectedClassId === cls.classId;
                        return (
                          <button
                            key={`label-${cls.classId}`}
                            type="button"
                            onClick={() => handleToggleClass(cls.classId)}
                            title={cls.className}
                            className={`min-w-[76px] max-w-[136px] flex-1 truncate px-1 text-center text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                              isSelected
                                ? 'font-semibold text-blue-800'
                                : 'font-medium text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {cls.className}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </DataSectionShell>
  );
}
