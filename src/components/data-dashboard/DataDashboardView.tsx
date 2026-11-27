import { ArrowLeft, Filter, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClassData } from '../../types/gradebook';
import {
  flushUiSessionNow,
  loadUiSession,
  updateUiSession,
} from '../../utils/uiSessionState';
import {
  computeSchoolDataSnapshot,
  YEAR_LEVEL_META,
  type ClassYearLevel,
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

function serializeYearFilterValue(value: YearFilterValue): string {
  return String(value);
}

function parseYearFilterValue(raw: string): YearFilterValue {
  if (raw === 'all') return 'all';
  if (raw === 'unclassified') return 'unclassified';
  const parsed = Number(raw);
  if (
    parsed === 1 ||
    parsed === 2 ||
    parsed === 3 ||
    parsed === 4 ||
    parsed === 5
  ) {
    return parsed as ClassYearLevel;
  }
  return 'all';
}

export function DataDashboardView({
  classes,
  onBackToGradebook,
  onOpenClassManager,
}: DataDashboardViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isRestoringScrollRef = useRef(false);

  const [filter, setFilter] = useState<SchoolDataFilter>(() => {
    const session = loadUiSession();
    return {
      yearLevel: session.dataFilter.yearLevel,
      selectedClassId: session.dataFilter.selectedClassId,
    };
  });

  useEffect(() => {
    updateUiSession(
      (prev) =>
        prev.dataFilter.yearLevel === filter.yearLevel &&
        prev.dataFilter.selectedClassId === filter.selectedClassId
          ? prev
          : {
              ...prev,
              dataFilter: {
                yearLevel: filter.yearLevel,
                selectedClassId: filter.selectedClassId,
              },
            },
      { immediate: true }
    );
  }, [filter.yearLevel, filter.selectedClassId]);

  // Restore & persist dashboard vertical scroll position
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const targetTop = loadUiSession().dataScrollTop;
    isRestoringScrollRef.current = true;
    let raf1 = 0;
    let raf2 = 0;
    let releaseTimer: number | null = null;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.min(targetTop, maxTop);
        releaseTimer = window.setTimeout(() => {
          isRestoringScrollRef.current = false;
        }, 60);
      });
    });

    const handleScroll = () => {
      if (isRestoringScrollRef.current) return;
      const top = Math.max(0, Math.round(el.scrollTop));
      updateUiSession(
        (prev) =>
          prev.dataScrollTop === top ? prev : { ...prev, dataScrollTop: top },
        { immediate: false, debounceMs: 160 }
      );
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (releaseTimer !== null) window.clearTimeout(releaseTimer);
      isRestoringScrollRef.current = false;
      el.removeEventListener('scroll', handleScroll);
      flushUiSessionNow();
    };
  }, []);

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
      : `Filtro: ${YEAR_LEVEL_META[filter.yearLevel].label}`;

  const yearSelectOptions: Array<{
    value: YearFilterValue;
    label: string;
    shortLabel: string;
    classCount: number;
    studentCount: number;
  }> = [
    {
      value: 'all',
      label: `Tutti gli anni scolastici (${snapshot.globalOverview.totalClasses} ${
        snapshot.globalOverview.totalClasses === 1 ? 'classe' : 'classi'
      })`,
      shortLabel: 'Tutti',
      classCount: snapshot.globalOverview.totalClasses,
      studentCount: snapshot.globalOverview.totalStudents,
    },
    ...snapshot.yearDistribution.map((row) => ({
      value: row.yearLevel as YearFilterValue,
      label: `${row.label} (${row.classCount} ${
        row.classCount === 1 ? 'classe' : 'classi'
      } · ${row.studentCount} ${
        row.studentCount === 1 ? 'studente' : 'studenti'
      })`,
      shortLabel: row.shortLabel,
      classCount: row.classCount,
      studentCount: row.studentCount,
    })),
  ];

  const displayedOverview =
    filter.yearLevel === 'all'
      ? snapshot.globalOverview
      : snapshot.filteredOverview;

  return (
    <div
      ref={scrollContainerRef}
      data-zoom-scroll-container="true"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50 touch-pan-x touch-pan-y"
    >
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
              className="space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 sm:px-5"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                {/* Primary School Year Filter Selector */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <label
                    htmlFor="data-dashboard-year-select"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap"
                  >
                    <Filter className="h-3.5 w-3.5 text-blue-700" />
                    Anno scolastico:
                  </label>
                  <select
                    id="data-dashboard-year-select"
                    value={serializeYearFilterValue(filter.yearLevel)}
                    onChange={(e) =>
                      handleYearFilterChange(
                        parseYearFilterValue(e.target.value)
                      )
                    }
                    className={`h-9 min-w-[230px] rounded-md border px-2.5 text-xs font-medium focus:border-blue-600 focus:outline-none ${
                      filter.yearLevel !== 'all'
                        ? 'border-blue-400 bg-blue-50/60 text-blue-950 font-semibold'
                        : 'border-slate-300 bg-white text-slate-900'
                    }`}
                  >
                    {yearSelectOptions.map((opt) => (
                      <option
                        key={serializeYearFilterValue(opt.value)}
                        value={serializeYearFilterValue(opt.value)}
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Single-class detail selector & reset */}
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="data-dashboard-class-select"
                    className="text-xs font-medium text-slate-600 whitespace-nowrap"
                  >
                    Dettaglio classe:
                  </label>
                  <select
                    id="data-dashboard-class-select"
                    value={filter.selectedClassId ?? ''}
                    onChange={(e) =>
                      handleSelectClass(e.target.value ? e.target.value : null)
                    }
                    disabled={snapshot.filteredClasses.length === 0}
                    className="h-9 min-w-[200px] rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">
                      {snapshot.filteredClasses.length === 0
                        ? 'Nessuna classe nel filtro'
                        : 'Tutte le classi visualizzate'}
                    </option>
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
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Ripristina
                    </button>
                  )}
                </div>
              </div>

              {/* Quick year switcher synchronized with the dropdown selector */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                <div
                  role="group"
                  aria-label="Selezione rapida anno scolastico"
                  className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1"
                >
                  {yearSelectOptions.map((opt) => {
                    const isActive = filter.yearLevel === opt.value;
                    return (
                      <button
                        key={`quick-${serializeYearFilterValue(opt.value)}`}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => handleYearFilterChange(opt.value)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-white text-blue-800 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.shortLabel}
                        {opt.value !== 'all' && opt.classCount > 0 && (
                          <span className="ml-1 font-mono text-[11px] text-slate-400 tabular-nums">
                            ({opt.classCount})
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {filter.yearLevel !== 'all' && (
                  <div className="text-xs text-slate-600 tabular-nums">
                    Visualizzazione filtrata:{' '}
                    <span className="font-semibold text-blue-800">
                      {YEAR_LEVEL_META[filter.yearLevel].label}
                    </span>{' '}
                    · {snapshot.filteredOverview.totalStudents} di{' '}
                    {snapshot.globalOverview.totalStudents} studenti (
                    {snapshot.filteredOverview.totalClasses} di{' '}
                    {snapshot.globalOverview.totalClasses} classi)
                  </div>
                )}
              </div>
            </section>

            {/* Module 1: General Population Overview KPIs (dynamically updated by year filter) */}
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

            {/* Module 2: Distribution by School Year (dynamically switches to filtered year's classes) */}
            <YearDistributionSection
              rows={snapshot.yearDistribution}
              filteredClasses={snapshot.filteredClasses}
              filteredTotalStudents={snapshot.filteredOverview.totalStudents}
              globalTotalStudents={snapshot.globalOverview.totalStudents}
              hasUnclassifiedClasses={snapshot.hasUnclassifiedClasses}
              activeYearFilter={filter.yearLevel}
              selectedClassId={filter.selectedClassId}
              onSelectYearFilter={handleYearFilterChange}
              onSelectClass={handleSelectClass}
            />

            {/* Module 3: DSA, BES & H Distribution by Class (table + totals + comparative chart all filtered) */}
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
