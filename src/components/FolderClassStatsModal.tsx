import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BarChart3,
  CheckCircle2,
  FolderCheck,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ClassData, FolderDelivery } from '../types/gradebook';
import {
  computeFolderClassStats,
  formatDateIt,
  formatDecimalIt,
  formatGradeLabel,
  formatPlateInterval,
  type FolderPlateStatsItem,
} from '../utils/calculations';

interface FolderClassStatsModalProps {
  open: boolean;
  classData: ClassData;
  folder: FolderDelivery | null;
  onClose: () => void;
}

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${Math.round(value)}%`;
}

function formatTiedPlatesHeading(plates: FolderPlateStatsItem[]): string {
  return plates.map((p) => `T${p.plate.number}`).join(', ');
}

function formatTiedPlatesTitles(plates: FolderPlateStatsItem[]): string {
  if (plates.length === 1) return plates[0].plate.title;
  return `${plates.length} tavole a pari merito: ${plates
    .map((p) => `T${p.plate.number} (${p.plate.title})`)
    .join(' · ')}`;
}

export function FolderClassStatsModal({
  open,
  classData,
  folder,
  onClose,
}: FolderClassStatsModalProps) {
  const [selectedPlateId, setSelectedPlateId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const stats = useMemo(() => {
    if (!folder) return null;
    return computeFolderClassStats(classData, folder);
  }, [classData, folder]);

  useEffect(() => {
    if (!open || !stats) {
      setSelectedPlateId(null);
      return;
    }
    setSelectedPlateId((prev) =>
      prev && stats.plateStats.some((p) => p.plate.id === prev)
        ? prev
        : stats.plateStats[0]?.plate.id ?? null
    );
  }, [open, folder?.id, stats]);

  if (!open || !folder || !stats) return null;

  const mostDeliveredIds = new Set(
    stats.mostDelivered?.plates.map((p) => p.plate.id) ?? []
  );
  const leastDeliveredIds = new Set(
    stats.leastDelivered?.plates.map((p) => p.plate.id) ?? []
  );
  const mostSkippedIds = new Set(
    stats.mostSkipped && stats.mostSkipped.count > 0
      ? stats.mostSkipped.plates.map((p) => p.plate.id)
      : []
  );
  const leastSkippedIds = new Set(
    stats.leastSkipped?.plates.map((p) => p.plate.id) ?? []
  );
  const highestAvgIds = new Set(
    stats.highestAvg?.plates.map((p) => p.plate.id) ?? []
  );
  const lowestAvgIds = new Set(
    stats.lowestAvg?.plates.map((p) => p.plate.id) ?? []
  );

  // Grouped Vertical Bar Chart SVG dimensions
  const plateCount = stats.plateStats.length;
  const maxBarValue = Math.max(
    1,
    stats.totalStudents,
    ...stats.plateStats.flatMap((p) => [
      p.deliveredCount,
      p.missedCount,
      p.wipCount,
    ])
  );
  const SVG_H = 235;
  const PAD_LEFT = 36;
  const PAD_RIGHT = 20;
  const PAD_TOP = 22;
  const PAD_BOTTOM = 44;
  const PLOT_H = SVG_H - PAD_TOP - PAD_BOTTOM;

  const groupWidth = plateCount <= 5 ? 88 : 74;
  const svgW = Math.max(
    560,
    PAD_LEFT + PAD_RIGHT + Math.max(1, plateCount) * groupWidth
  );
  const plotW = svgW - PAD_LEFT - PAD_RIGHT;
  const slotW = plateCount > 0 ? plotW / plateCount : plotW;

  const yTickStep = maxBarValue <= 6 ? 1 : maxBarValue <= 15 ? 3 : 5;
  const yTicks: number[] = [];
  for (let v = 0; v <= maxBarValue; v += yTickStep) {
    yTicks.push(v);
  }
  if (yTicks[yTicks.length - 1] !== maxBarValue) {
    yTicks.push(maxBarValue);
  }

  const barY = (val: number) => PAD_TOP + PLOT_H * (1 - val / maxBarValue);
  const barH = (val: number) => (val / maxBarValue) * PLOT_H;

  const selectedPlateStat =
    stats.plateStats.find((p) => p.plate.id === selectedPlateId) ??
    stats.plateStats[0] ??
    null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-3 backdrop-blur-[1px] sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-class-stats-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Torna al registro</span>
              <span className="sm:hidden">Indietro</span>
            </button>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <FolderCheck className="h-4 w-4 shrink-0 text-blue-700" />
                <h2
                  id="folder-class-stats-title"
                  className="font-display truncate text-base font-bold text-slate-900 sm:text-lg"
                >
                  Statistiche classe — {folder.title}
                </h2>
                <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-900">
                  {formatPlateInterval(folder.plateIds, classData.plates)}
                </span>
              </div>
              <p className="truncate text-xs text-slate-500">
                {classData.name} · {stats.totalStudents} studenti in classe
                {folder.dueDate
                  ? ` · Scadenza cartellina: ${formatDateIt(folder.dueDate)}`
                  : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi statistiche cartellina"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {/* Primary Overall KPI Row (Total Delivered vs Missed, % Rates, Avg, WIP/ASS) */}
          <section
            aria-label="Riepilogo complessivo della cartellina"
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-emerald-900">
                <span>Consegne effettuate</span>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-2 font-mono text-2xl font-bold tabular-nums text-emerald-950">
                <span>{stats.totalDelivered}</span>
                <span className="text-xs font-semibold text-emerald-800">
                  ({formatPct(stats.overallDeliveryPct)})
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-emerald-800">
                su {stats.totalExpected} consegne previste (esclusi ASS)
              </div>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-rose-900">
                <span>Mancate consegne (NO)</span>
                <AlertTriangle className="h-3.5 w-3.5 text-rose-700" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-2 font-mono text-2xl font-bold tabular-nums text-rose-950">
                <span>{stats.totalMissed}</span>
                <span className="text-xs font-semibold text-rose-800">
                  ({formatPct(stats.overallMissedPct)})
                </span>
              </div>
              <div className="mt-1 text-[11px] text-rose-800">
                Escluse WIP e tavole non scadute
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-700">
                <span>Media voti cartellina</span>
                <Award className="h-3.5 w-3.5 text-blue-700" />
              </div>
              <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-slate-950">
                {stats.overallGradeAvg !== null
                  ? formatDecimalIt(stats.overallGradeAvg, 2)
                  : '—'}
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-500">
                {stats.totalGradedCells > 0
                  ? `${stats.totalGradedCells} valutazioni valide`
                  : 'Nessun voto valido'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-700">
                <span>In lavorazione & Assenti</span>
                <Users className="h-3.5 w-3.5 text-slate-500" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-3 font-mono text-2xl font-bold tabular-nums text-slate-950">
                <span className="text-orange-700">{stats.totalWip}</span>
                <span className="text-xs font-medium text-slate-500">WIP</span>
                <span className="text-amber-700">{stats.totalAbsent}</span>
                <span className="text-xs font-medium text-slate-500">ASS</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                WIP distinti dai NO · ASS esclusi
              </div>
            </div>
          </section>

          {/* Rankings Cards (Most/Least Delivered, Most/Least Skipped, Highest/Lowest Average — with ties) */}
          {stats.plateStats.length > 0 && (
            <section
              aria-label="Classifiche delle tavole nella cartellina"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {/* Più / Meno Consegnata */}
              <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Consegne per tavola
                </div>
                <div className="mt-2.5 space-y-2.5">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-emerald-900">
                        Tavola più consegnata
                      </span>
                      {stats.mostDelivered && (
                        <span className="font-mono text-xs font-bold text-emerald-800">
                          {stats.mostDelivered.count} cons.
                        </span>
                      )}
                    </div>
                    {stats.mostDelivered ? (
                      <div className="mt-1">
                        <div className="font-mono text-sm font-bold text-emerald-950">
                          {formatTiedPlatesHeading(stats.mostDelivered.plates)}
                          {stats.mostDelivered.plates.length > 1 && (
                            <span className="ml-1.5 font-sans text-[10px] font-semibold text-emerald-800">
                              (pari merito)
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-emerald-800" title={formatTiedPlatesTitles(stats.mostDelivered.plates)}>
                          {formatTiedPlatesTitles(stats.mostDelivered.plates)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500">
                        In attesa di scadenza
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Tavola meno consegnata
                      </span>
                      {stats.leastDelivered && (
                        <span className="font-mono text-xs font-bold text-slate-700">
                          {stats.leastDelivered.count} cons.
                        </span>
                      )}
                    </div>
                    {stats.leastDelivered ? (
                      <div className="mt-1">
                        <div className="font-mono text-sm font-bold text-slate-900">
                          {formatTiedPlatesHeading(stats.leastDelivered.plates)}
                          {stats.leastDelivered.plates.length > 1 && (
                            <span className="ml-1.5 font-sans text-[10px] font-semibold text-slate-600">
                              (pari merito)
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-slate-600" title={formatTiedPlatesTitles(stats.leastDelivered.plates)}>
                          {formatTiedPlatesTitles(stats.leastDelivered.plates)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500">
                        In attesa di scadenza
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Più / Meno Saltata */}
              <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Mancate consegne (NO)
                </div>
                <div className="mt-2.5 space-y-2.5">
                  <div className="rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-rose-900">
                        Tavola più saltata
                      </span>
                      {stats.mostSkipped && (
                        <span className="font-mono text-xs font-bold text-rose-800">
                          {stats.mostSkipped.count} NO
                        </span>
                      )}
                    </div>
                    {!stats.mostSkipped ? (
                      <div className="mt-1 text-xs text-slate-500">
                        Nessuna tavola ancora scaduta
                      </div>
                    ) : stats.mostSkipped.count === 0 ? (
                      <div className="mt-1 text-xs font-medium text-emerald-800">
                        Nessuna mancata consegna registrata (0 NO)
                      </div>
                    ) : (
                      <div className="mt-1">
                        <div className="font-mono text-sm font-bold text-rose-950">
                          {formatTiedPlatesHeading(stats.mostSkipped.plates)}
                          {stats.mostSkipped.plates.length > 1 && (
                            <span className="ml-1.5 font-sans text-[10px] font-semibold text-rose-800">
                              (pari merito)
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-rose-800" title={formatTiedPlatesTitles(stats.mostSkipped.plates)}>
                          {formatTiedPlatesTitles(stats.mostSkipped.plates)}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Tavola meno saltata
                      </span>
                      {stats.leastSkipped && (
                        <span className="font-mono text-xs font-bold text-slate-700">
                          {stats.leastSkipped.count} NO
                        </span>
                      )}
                    </div>
                    {stats.leastSkipped ? (
                      <div className="mt-1">
                        <div className="font-mono text-sm font-bold text-slate-900">
                          {formatTiedPlatesHeading(stats.leastSkipped.plates)}
                          {stats.leastSkipped.plates.length > 1 && (
                            <span className="ml-1.5 font-sans text-[10px] font-semibold text-slate-600">
                              (pari merito)
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-slate-600" title={formatTiedPlatesTitles(stats.leastSkipped.plates)}>
                          {formatTiedPlatesTitles(stats.leastSkipped.plates)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500">
                        Nessuna tavola ancora scaduta
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Media Voti Più Alta / Più Bassa */}
              <div className="rounded-lg border border-slate-200 bg-white p-3.5 sm:col-span-2 lg:col-span-1">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Estremi media voti
                </div>
                <div className="mt-2.5 space-y-2.5">
                  <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-900">
                        <TrendingUp className="h-3.5 w-3.5 text-blue-700" />
                        Media più alta
                      </span>
                      {stats.highestAvg && (
                        <span className="font-mono text-xs font-bold text-blue-900">
                          {formatDecimalIt(stats.highestAvg.avg, 2)} (
                          {formatGradeLabel(stats.highestAvg.avg)})
                        </span>
                      )}
                    </div>
                    {stats.highestAvg ? (
                      <div className="mt-1">
                        <div className="font-mono text-sm font-bold text-blue-950">
                          {formatTiedPlatesHeading(stats.highestAvg.plates)}
                          {stats.highestAvg.plates.length > 1 && (
                            <span className="ml-1.5 font-sans text-[10px] font-semibold text-blue-800">
                              (pari merito)
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-blue-800" title={formatTiedPlatesTitles(stats.highestAvg.plates)}>
                          {formatTiedPlatesTitles(stats.highestAvg.plates)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500">
                        Nessun voto assegnato
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                        <TrendingDown className="h-3.5 w-3.5 text-slate-500" />
                        Media più bassa
                      </span>
                      {stats.lowestAvg && (
                        <span className="font-mono text-xs font-bold text-slate-800">
                          {formatDecimalIt(stats.lowestAvg.avg, 2)} (
                          {formatGradeLabel(stats.lowestAvg.avg)})
                        </span>
                      )}
                    </div>
                    {stats.lowestAvg ? (
                      <div className="mt-1">
                        <div className="font-mono text-sm font-bold text-slate-900">
                          {formatTiedPlatesHeading(stats.lowestAvg.plates)}
                          {stats.lowestAvg.plates.length > 1 && (
                            <span className="ml-1.5 font-sans text-[10px] font-semibold text-slate-600">
                              (pari merito)
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-slate-600" title={formatTiedPlatesTitles(stats.lowestAvg.plates)}>
                          {formatTiedPlatesTitles(stats.lowestAvg.plates)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500">
                        Nessun voto assegnato
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Bar Chart: Deliveries vs Missed vs WIP per Plate */}
          <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  <BarChart3 className="h-4 w-4 text-blue-700" />
                  Confronto consegne e mancate consegne per tavola
                </h3>
                <p className="text-xs text-slate-500">
                  Numero di elaborati consegnati (SI), mancate consegne (NO) e tavole in lavorazione (WIP) al netto degli assenti (ASS). Clicca su una colonna per i dettagli.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-xs bg-emerald-600" />
                  Consegnate (SI)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-xs bg-rose-600" />
                  Mancate (NO)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-xs bg-orange-500" />
                  Da terminare (WIP)
                </span>
              </div>
            </div>

            {stats.plateStats.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                Nessuna tavola associata a questa cartellina. Configura la cartellina per includere le tavole desiderate.
              </div>
            ) : (
              <>
                <div className="mt-3 overflow-x-auto pb-1">
                  <svg
                    viewBox={`0 0 ${svgW} ${SVG_H}`}
                    style={{ minWidth: `${svgW}px` }}
                    className="h-[235px] w-full select-none"
                    role="img"
                    aria-label={`Grafico a barre consegne ${folder.title}`}
                  >
                    {/* Horizontal gridlines */}
                    {yTicks.map((tick) => {
                      const y = barY(tick);
                      return (
                        <g key={tick}>
                          <line
                            x1={PAD_LEFT}
                            x2={svgW - PAD_RIGHT}
                            y1={y}
                            y2={y}
                            stroke="#e2e8f0"
                            strokeWidth={1}
                          />
                          <text
                            x={PAD_LEFT - 8}
                            y={y + 4}
                            textAnchor="end"
                            className="font-mono text-[10.5px] fill-slate-500"
                          >
                            {tick}
                          </text>
                        </g>
                      );
                    })}

                    {/* Grouped Bars per Plate */}
                    {stats.plateStats.map((item, idx) => {
                      const centerX = PAD_LEFT + (idx + 0.5) * slotW;
                      const isSelected =
                        selectedPlateStat?.plate.id === item.plate.id;
                      const bw = Math.min(18, Math.max(10, (slotW - 22) / 3));
                      const gap = 3;
                      const totalBarsW = bw * 3 + gap * 2;
                      const x0 = centerX - totalBarsW / 2;

                      const delH = barH(item.deliveredCount);
                      const missH = barH(item.missedCount);
                      const wipH = barH(item.wipCount);

                      return (
                        <g
                          key={item.plate.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedPlateId(item.plate.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedPlateId(item.plate.id);
                            }
                          }}
                          aria-label={`Tavola ${item.plate.number}: ${item.deliveredCount} consegnate, ${item.missedCount} mancate, ${item.wipCount} in lavorazione`}
                          className="cursor-pointer focus:outline-none"
                        >
                          {isSelected && (
                            <rect
                              x={centerX - slotW / 2 + 4}
                              y={PAD_TOP - 8}
                              width={slotW - 8}
                              height={PLOT_H + 12}
                              rx={5}
                              fill="#eff6ff"
                              stroke="#93c5fd"
                              strokeWidth={1}
                            />
                          )}

                          {/* Delivered bar (SI) */}
                          <rect
                            x={x0}
                            y={barY(item.deliveredCount)}
                            width={bw}
                            height={Math.max(item.deliveredCount > 0 ? 3 : 0, delH)}
                            rx={2}
                            fill="#059669"
                          />
                          {item.deliveredCount > 0 && (
                            <text
                              x={x0 + bw / 2}
                              y={barY(item.deliveredCount) - 5}
                              textAnchor="middle"
                              className="font-mono text-[10px] font-bold fill-emerald-900"
                            >
                              {item.deliveredCount}
                            </text>
                          )}

                          {/* Missed bar (NO) */}
                          <rect
                            x={x0 + bw + gap}
                            y={barY(item.missedCount)}
                            width={bw}
                            height={Math.max(item.missedCount > 0 ? 3 : 0, missH)}
                            rx={2}
                            fill="#e11d48"
                          />
                          {item.missedCount > 0 && (
                            <text
                              x={x0 + bw + gap + bw / 2}
                              y={barY(item.missedCount) - 5}
                              textAnchor="middle"
                              className="font-mono text-[10px] font-bold fill-rose-800"
                            >
                              {item.missedCount}
                            </text>
                          )}

                          {/* WIP bar (da terminare) */}
                          <rect
                            x={x0 + (bw + gap) * 2}
                            y={barY(item.wipCount)}
                            width={bw}
                            height={Math.max(item.wipCount > 0 ? 3 : 0, wipH)}
                            rx={2}
                            fill="#f97316"
                          />
                          {item.wipCount > 0 && (
                            <text
                              x={x0 + (bw + gap) * 2 + bw / 2}
                              y={barY(item.wipCount) - 5}
                              textAnchor="middle"
                              className="font-mono text-[10px] font-bold fill-orange-800"
                            >
                              {item.wipCount}
                            </text>
                          )}

                          {/* X-axis label */}
                          <text
                            x={centerX}
                            y={PAD_TOP + PLOT_H + 17}
                            textAnchor="middle"
                            className={`font-mono text-[11px] ${
                              isSelected
                                ? 'fill-blue-900 font-bold'
                                : 'fill-slate-700 font-semibold'
                            }`}
                          >
                            T{item.plate.number}
                          </text>
                          <text
                            x={centerX}
                            y={PAD_TOP + PLOT_H + 31}
                            textAnchor="middle"
                            className="font-mono text-[9.5px] fill-slate-500"
                          >
                            {item.isNotYetDue
                              ? 'non scad.'
                              : item.gradeAverage !== null
                              ? `Ø ${formatDecimalIt(item.gradeAverage, 1)}`
                              : '—'}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {selectedPlateStat && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50/50 px-3.5 py-2 text-xs text-slate-700">
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-blue-950">
                        Tav. {selectedPlateStat.plate.number}
                      </span>{' '}
                      —{' '}
                      <strong className="font-semibold text-slate-900">
                        {selectedPlateStat.plate.title}
                      </strong>
                      {selectedPlateStat.isNotYetDue && (
                        <span className="ml-2 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          Scadenza non ancora arrivata ({formatDateIt(selectedPlateStat.effectiveDueDate)})
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums">
                      <span className="text-emerald-800">
                        Consegnate: {selectedPlateStat.deliveredCount}/
                        {selectedPlateStat.expectedCount} (
                        {formatPct(selectedPlateStat.deliveryPct)})
                      </span>
                      <span className="text-rose-700">
                        Mancate: {selectedPlateStat.missedCount} (
                        {formatPct(selectedPlateStat.missedPct)})
                      </span>
                      <span className="text-orange-700">
                        WIP: {selectedPlateStat.wipCount}
                      </span>
                      <span className="text-amber-800">
                        ASS esclusi: {selectedPlateStat.absentCount}
                      </span>
                      <span className="font-bold text-slate-900">
                        Media:{' '}
                        {selectedPlateStat.gradeAverage !== null
                          ? formatDecimalIt(selectedPlateStat.gradeAverage, 2)
                          : '—'}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Summary Table */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Tabella riepilogativa per tavola
              </h3>
              <span className="text-[11px] text-slate-500">
                Tenuti = Studenti della classe ({stats.totalStudents}) − Assenti (ASS). I voti mancanti, NO e WIP sono esclusi dalla media.
              </span>
            </div>

            {stats.plateStats.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold text-slate-700">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2">Tav.</th>
                      <th className="px-3 py-2">Titolo e primati</th>
                      <th className="px-3 py-2 text-right">Tenuti</th>
                      <th className="px-3 py-2 text-right">ASS</th>
                      <th className="px-3 py-2 text-right">Consegnate</th>
                      <th className="px-3 py-2 text-right">% Consegna</th>
                      <th className="px-3 py-2 text-right">Mancate (NO)</th>
                      <th className="px-3 py-2 text-right">% Mancate</th>
                      <th className="px-3 py-2 text-right">WIP</th>
                      <th className="px-3 py-2 text-right">Media voti</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white font-mono tabular-nums">
                    {stats.plateStats.map((row) => {
                      const tags: { label: string; cls: string }[] = [];
                      if (row.isNotYetDue) {
                        tags.push({
                          label: 'Non ancora scaduta',
                          cls: 'border-slate-300 bg-slate-100 text-slate-700',
                        });
                      }
                      if (mostDeliveredIds.has(row.plate.id)) {
                        tags.push({
                          label: 'Più consegnata',
                          cls: 'border-emerald-200 bg-emerald-50 text-emerald-800',
                        });
                      }
                      if (
                        leastDeliveredIds.has(row.plate.id) &&
                        !mostDeliveredIds.has(row.plate.id)
                      ) {
                        tags.push({
                          label: 'Meno consegnata',
                          cls: 'border-amber-200 bg-amber-50 text-amber-800',
                        });
                      }
                      if (mostSkippedIds.has(row.plate.id)) {
                        tags.push({
                          label: 'Più saltata',
                          cls: 'border-rose-200 bg-rose-50 text-rose-800',
                        });
                      }
                      if (
                        leastSkippedIds.has(row.plate.id) &&
                        !mostSkippedIds.has(row.plate.id) &&
                        (stats.mostSkipped?.count ?? 0) > 0
                      ) {
                        tags.push({
                          label: 'Meno saltata',
                          cls: 'border-teal-200 bg-teal-50 text-teal-800',
                        });
                      }
                      if (highestAvgIds.has(row.plate.id)) {
                        tags.push({
                          label: 'Media più alta',
                          cls: 'border-blue-200 bg-blue-50 text-blue-800',
                        });
                      }
                      if (
                        lowestAvgIds.has(row.plate.id) &&
                        !highestAvgIds.has(row.plate.id)
                      ) {
                        tags.push({
                          label: 'Media più bassa',
                          cls: 'border-slate-300 bg-slate-100 text-slate-700',
                        });
                      }

                      return (
                        <tr
                          key={row.plate.id}
                          onClick={() => setSelectedPlateId(row.plate.id)}
                          className={`cursor-pointer transition-colors ${
                            selectedPlateStat?.plate.id === row.plate.id
                              ? 'bg-blue-50/45'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-3 py-2 font-bold text-blue-900">
                            T{row.plate.number}
                          </td>
                          <td className="px-3 py-2 font-sans">
                            <div className="font-medium text-slate-900">
                              {row.plate.title}
                            </div>
                            {tags.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {tags.map((t) => (
                                  <span
                                    key={t.label}
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${t.cls}`}
                                  >
                                    {t.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {row.expectedCount}
                          </td>
                          <td className="px-3 py-2 text-right text-amber-800">
                            {row.absentCount}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-800">
                            {row.deliveredCount}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-900">
                            {formatPct(row.deliveryPct)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-rose-700">
                            {row.missedCount}
                          </td>
                          <td className="px-3 py-2 text-right text-rose-800">
                            {row.isNotYetDue ? '0%*' : formatPct(row.missedPct)}
                          </td>
                          <td className="px-3 py-2 text-right text-orange-700">
                            {row.wipCount}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">
                            {row.gradeAverage !== null ? (
                              <span>
                                {formatDecimalIt(row.gradeAverage, 2)}{' '}
                                <span className="text-[10px] font-normal text-slate-500">
                                  ({row.gradedCount})
                                </span>
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 sm:px-6">
          <span className="text-[11px] text-slate-500">
            * Le tavole la cui scadenza non è ancora arrivata non vengono conteggiate come mancate consegne.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Torna al registro
          </button>
        </footer>
      </div>
    </div>
  );
}
