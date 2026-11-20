import { getClassColorOption } from '../../utils/classColors';
import {
  formatPercentIt,
  YEAR_LEVEL_META,
  type ClassDataSummary,
  type ClassYearLevel,
  type YearDistributionRow,
  type YearFilterValue,
} from '../../utils/schoolDataAnalytics';
import { DataSectionShell } from './DataSectionShell';

interface YearDistributionSectionProps {
  rows: YearDistributionRow[];
  filteredClasses: ClassDataSummary[];
  filteredTotalStudents: number;
  globalTotalStudents: number;
  hasUnclassifiedClasses: boolean;
  activeYearFilter: YearFilterValue;
  selectedClassId: string | null;
  onSelectYearFilter: (year: YearFilterValue) => void;
  onSelectClass: (classId: string | null) => void;
}

export function YearDistributionSection({
  rows,
  filteredClasses,
  filteredTotalStudents,
  globalTotalStudents,
  hasUnclassifiedClasses,
  activeYearFilter,
  selectedClassId,
  onSelectYearFilter,
  onSelectClass,
}: YearDistributionSectionProps) {
  const isFilteredByYear = activeYearFilter !== 'all';
  const activeYearMeta = isFilteredByYear
    ? YEAR_LEVEL_META[activeYearFilter]
    : null;

  const maxYearStudents = Math.max(1, ...rows.map((r) => r.studentCount));
  const maxClassStudents = Math.max(
    1,
    ...filteredClasses.map((c) => c.totalStudents)
  );

  const shareOfSchoolPct =
    globalTotalStudents > 0
      ? (filteredTotalStudents / globalTotalStudents) * 100
      : 0;

  const handleToggleYear = (yearLevel: ClassYearLevel) => {
    if (activeYearFilter === yearLevel) {
      onSelectYearFilter('all');
    } else {
      onSelectYearFilter(yearLevel);
    }
  };

  return (
    <DataSectionShell
      id="year-distribution"
      title={
        isFilteredByYear && activeYearMeta
          ? `Distribuzione degli studenti — ${activeYearMeta.label}`
          : 'Distribuzione degli studenti per anno scolastico'
      }
      subtitle={
        isFilteredByYear && activeYearMeta
          ? `Dettaglio delle classi appartenenti a "${activeYearMeta.label}" (${formatPercentIt(
              shareOfSchoolPct
            )} sul totale di ${globalTotalStudents} studenti). Fai clic su una classe per aprirne il dettaglio.`
          : 'Ripartizione automatica ricavata dal nome delle classi. Seleziona un anno dal filtro o fai clic su una fascia per filtrare tutti i dati.'
      }
      headerRight={
        isFilteredByYear ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
              Totale filtrato: {filteredTotalStudents}{' '}
              {filteredTotalStudents === 1 ? 'studente' : 'studenti'}
            </span>
            <button
              type="button"
              onClick={() => onSelectYearFilter('all')}
              className="text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline underline-offset-4 whitespace-nowrap"
            >
              Mostra tutti gli anni
            </button>
          </div>
        ) : (
          <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
            Totale: {globalTotalStudents}{' '}
            {globalTotalStudents === 1 ? 'studente' : 'studenti'}
          </span>
        )
      }
    >
      {isFilteredByYear ? (
        filteredClasses.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            Nessuna classe presente per{' '}
            <span className="font-medium text-slate-700">
              {activeYearMeta?.label}
            </span>
            .
          </div>
        ) : (
          <div
            className="space-y-3"
            role="list"
            aria-label={`Distribuzione studenti in ${activeYearMeta?.label}`}
          >
            {filteredClasses.map((cls) => {
              const isSelected = selectedClassId === cls.classId;
              const colorTheme = getClassColorOption(cls.color, cls.colorIndex);
              const barWidthPct =
                cls.totalStudents > 0
                  ? Math.max(2, (cls.totalStudents / maxClassStudents) * 100)
                  : 0;

              return (
                <button
                  key={cls.classId}
                  type="button"
                  role="listitem"
                  aria-pressed={isSelected}
                  onClick={() =>
                    onSelectClass(isSelected ? null : cls.classId)
                  }
                  className={`group block w-full rounded-md border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    isSelected
                      ? 'border-blue-300 bg-blue-50/50'
                      : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
                    <div className="flex items-baseline justify-between gap-2 sm:col-span-4 sm:block">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          aria-hidden="true"
                          style={{ backgroundColor: colorTheme.accent }}
                          className="h-3 w-3 shrink-0 rounded-[2px]"
                        />
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {cls.className}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums sm:mt-0.5 sm:pl-5">
                        {cls.schoolYear}
                      </div>
                    </div>

                    <div className="sm:col-span-5">
                      <div
                        className="h-3.5 w-full overflow-hidden rounded-sm bg-slate-100"
                        aria-hidden="true"
                      >
                        {barWidthPct > 0 && (
                          <div
                            style={{ width: `${barWidthPct}%` }}
                            className={`h-full rounded-sm transition-all duration-200 ${
                              isSelected
                                ? 'bg-blue-700'
                                : 'bg-blue-600/85 group-hover:bg-blue-700'
                            }`}
                          />
                        )}
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between gap-2 sm:col-span-3 sm:justify-end sm:text-right">
                      <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                        {cls.totalStudents}{' '}
                        <span className="font-sans text-xs font-normal text-slate-500">
                          {cls.totalStudents === 1 ? 'studente' : 'studenti'}
                        </span>
                      </span>
                      <span className="min-w-[48px] font-mono text-xs font-medium text-slate-600 tabular-nums">
                        {formatPercentIt(cls.shareOfFilteredStudentsPct)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <>
          <div
            className="space-y-3"
            role="list"
            aria-label="Distribuzione per anno"
          >
            {rows.map((row) => {
              const isUnclassified = row.yearLevel === 'unclassified';
              const barWidthPct =
                row.studentCount > 0
                  ? Math.max(2, (row.studentCount / maxYearStudents) * 100)
                  : 0;

              const classCountText =
                row.classCount === 0
                  ? '0 classi'
                  : row.classCount === 1
                  ? '1 classe'
                  : `${row.classCount} classi`;

              return (
                <button
                  key={String(row.yearLevel)}
                  type="button"
                  role="listitem"
                  onClick={() => handleToggleYear(row.yearLevel)}
                  className="group block w-full rounded-md border border-slate-200/80 bg-white px-3.5 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
                    {/* Year label & class count */}
                    <div className="flex items-baseline justify-between gap-2 sm:col-span-4 sm:block">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-semibold ${
                            isUnclassified ? 'text-slate-700' : 'text-slate-900'
                          }`}
                        >
                          {row.label}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums sm:mt-0.5">
                        {classCountText}
                      </div>
                    </div>

                    {/* Horizontal bar */}
                    <div className="sm:col-span-5">
                      <div
                        className="h-3.5 w-full overflow-hidden rounded-sm bg-slate-100"
                        aria-hidden="true"
                      >
                        {barWidthPct > 0 && (
                          <div
                            style={{ width: `${barWidthPct}%` }}
                            className={`h-full rounded-sm transition-all duration-200 ${
                              isUnclassified
                                ? 'bg-slate-500 group-hover:bg-slate-600'
                                : 'bg-blue-600/85 group-hover:bg-blue-700'
                            }`}
                          />
                        )}
                      </div>
                    </div>

                    {/* Numeric readout: count + percentage */}
                    <div className="flex items-baseline justify-between gap-2 sm:col-span-3 sm:justify-end sm:text-right">
                      <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                        {row.studentCount}{' '}
                        <span className="font-sans text-xs font-normal text-slate-500">
                          {row.studentCount === 1 ? 'studente' : 'studenti'}
                        </span>
                      </span>
                      <span className="min-w-[48px] font-mono text-xs font-medium text-slate-600 tabular-nums">
                        {formatPercentIt(row.studentPercentage)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {hasUnclassifiedClasses && (
            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Le classi il cui nome non indica chiaramente un anno tra 1° e 5°
              (es. 1ª A, 2B, Terza C) vengono raggruppate in{' '}
              <span className="font-medium text-slate-700">
                Anno non riconosciuto
              </span>{' '}
              senza assegnazioni arbitrarie.
            </p>
          )}
        </>
      )}
    </DataSectionShell>
  );
}
