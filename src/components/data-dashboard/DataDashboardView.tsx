import { ArrowLeft, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ClassData } from '../../types/gradebook';
import {
  computeSchoolDataSnapshot,
  YEAR_LEVEL_META,
  type SchoolDataFilter,
  type YearFilterValue,
} from '../../utils/schoolDataAnalytics';
import { ClassDetailPanel } from './ClassDetailPanel';
import { OverviewKpiStrip } from './OverviewKpiStrip';
import { SupportDistributionSection } from './SupportDistributionSection';
import { YearDistributionSection } from './YearDistributionSection';

interface DataDashboardViewProps {
  classes: ClassData[];
  onBackToGradebook: () => void;
  onOpenClassManager: () => void;
}

export function DataDashboardView({
  classes,
  onBackToGradebook,
  onOpenClassManager,
}: DataDashboardViewProps) {
  const [filter, setFilter] = useState<SchoolDataFilter>({
    yearLevel: 'all',
    selectedClassId: null,
  });

  // Compute live snapshot directly from TabScore's current classes (no parallel store)
  const snapshot = useMemo(
    () => computeSchoolDataSnapshot(classes, filter),
    [classes, filter]
  );

  // If the currently inspected class is deleted or no longer exists after sync/restore, clear selection cleanly
  useEffect(() => {
    if (
      filter.selectedClassId &&
      !classes.some((c) => c.id === filter.selectedClassId)
    ) {
      setFilter((prev) => ({ ...prev, selectedClassId: null }));
    }
  }, [classes, filter.selectedClassId]);

  // If the active year filter was 'unclassified' and unclassified classes were renamed/removed, reset to 'all'
  useEffect(() => {
    if (filter.yearLevel === 'unclassified' && !snapshot.hasUnclassifiedClasses) {
      setFilter((prev) => ({ ...prev, yearLevel: 'all' }));
    }
  }, [filter.yearLevel, snapshot.hasUnclassifiedClasses]);

  const handleYearFilterChange = (nextYear: YearFilterValue) => {
    setFilter((prev) => {
      // Keep selectedClassId only if it still belongs to the newly selected year filter
      const keepSelected =
        prev.selectedClassId &&
        (nextYear === 'all' ||
          snapshot.allClasses.some(
            (c) =>
              c.classId === prev.selectedClassId && c.yearLevel === nextYear
          ));
      return {
        ...prev,
        yearLevel: nextYear,
        selectedClassId: keepSelected ? prev.selectedClassId : null,
      };
    });
  };

  const handleSelectClass = (classId: string | null) => {
    setFilter((prev) => ({ ...prev, selectedClassId: classId }));
  };

  const handleResetFilters = () => {
    setFilter({ yearLevel: 'all', selectedClassId: null });
  };

  const hasActiveFilters =
    filter.yearLevel !== 'all' || filter.selectedClassId !== null;

  const activeScopeLabel =
    filter.yearLevel === 'all'
      ? 'Tutte le classi attive'
      : YEAR_LEVEL_META[filter.yearLevel].label;

  const yearFilterOptions: Array<{
    value: YearFilterValue;
    label: string;
    count: number;
  }> = [
    {
      value: 'all',
      label: 'Tutti gli anni',
      count: snapshot.globalOverview.totalClasses,
    },
    ...snapshot.yearDistribution.map((row) => ({
      value: row.yearLevel as YearFilterValue,
      label: row.shortLabel,
      count: row.classCount,
    })),
  ];

  const displayedOverview =
    filter.yearLevel === 'all'
      ? snapshot.globalOverview
      : snapshot.filteredOverview;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-3 py-4 sm:px-6 sm:py-6">
        {/* Section Header */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Dati
            </h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Cruscotto statistico complessivo della popolazione scolastica,
              aggiornato automaticamente dalle anagrafiche di tutte le classi.
            </p>
          </div>
          <button
            type="button"
            onClick={onBackToGradebook}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Torna al registro
          </button>
        </header>

        {classes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-16 text-center">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Nessun dato statistico disponibile
            </h2>
            <p className="mt-1.5 max-w-md text-sm text-slate-500">
              Crea una classe e aggiungi gli studenti in anagrafica per
              visualizzare automaticamente il riepilogo complessivo, la
              distribuzione per anno e i dati DSA, BES e H.
            </p>
            <button
              type="button"
              onClick={onOpenClassManager}
              className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              Crea prima classe
            </button>
          </div>
        ) : (
          <>
            {/* Filter & Consultation Bar */}
            <section
              aria-label="Filtri di consultazione"
              className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between"
            >
              {/* Year segmented filter */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-slate-500">
                  Anno:
                </span>
                <div
                  role="group"
                  aria-label="Filtra per anno scolastico"
                  className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1"
                >
                  {yearFilterOptions.map((opt) => {
                    const isActive = filter.yearLevel === opt.value;
                    return (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => handleYearFilterChange(opt.value)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                        {opt.value !== 'all' && opt.count > 0 && (
                          <span className="ml-1 font-mono text-[11px] text-slate-400 tabular-nums">
                            ({opt.count})
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Single-class detail selector & reset */}
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="data-dashboard-class-select"
                  className="text-xs font-medium text-slate-500 whitespace-nowrap"
                >
                  Dettaglio classe:
                </label>
                <select
                  id="data-dashboard-class-select"
                  value={filter.selectedClassId ?? ''}
                  onChange={(e) =>
                    handleSelectClass(e.target.value ? e.target.value : null)
                  }
                  className="h-9 min-w-[200px] rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="">Tutte le classi (panoramica)</option>
                  {snapshot.filteredClasses.map((cls) => (
                    <option key={cls.classId} value={cls.classId}>
                      {cls.className} — {cls.totalStudents} studenti
                    </option>
                  ))}
                </select>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Ripristina
                  </button>
                )}
              </div>
            </section>

            {/* Module 1: General Population Overview KPIs */}
            <OverviewKpiStrip
              overview={displayedOverview}
              scopeLabel={activeScopeLabel}
            />

            {/* Contextual Single-Class Detail Panel (inline inside "Dati") */}
            {snapshot.selectedClassDetail && (
              <ClassDetailPanel
                detail={snapshot.selectedClassDetail}
                onClose={() => handleSelectClass(null)}
              />
            )}

            {/* Module 2: Distribution by School Year */}
            <YearDistributionSection
              rows={snapshot.yearDistribution}
              totalStudents={snapshot.globalOverview.totalStudents}
              hasUnclassifiedClasses={snapshot.hasUnclassifiedClasses}
              activeYearFilter={filter.yearLevel}
              onSelectYearFilter={handleYearFilterChange}
            />

            {/* Module 3: DSA, BES & H Distribution by Class */}
            <SupportDistributionSection
              classes={snapshot.filteredClasses}
              totals={snapshot.filteredOverview}
              selectedClassId={filter.selectedClassId}
              onSelectClass={handleSelectClass}
            />
          </>
        )}
      </div>
    </div>
  );
}
