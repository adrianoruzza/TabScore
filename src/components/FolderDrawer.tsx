import { CheckCircle2, Lock, Unlock, X } from 'lucide-react';
import { useEffect } from 'react';
import type {
  ClassData,
  FolderDelivery,
  FolderDeliveryStatus,
  PlateEvaluation,
} from '../types/gradebook';
import {
  calculateFolderEvaluation,
  EMPTY_FOLDER_RECORD,
  formatDecimalIt,
  formatGradeLabel,
  formatPlateInterval,
  formatShortMonthDateIt,
  ROUNDING_MODE_LABELS,
  STATUS_META,
} from '../utils/calculations';

interface FolderDrawerProps {
  open: boolean;
  classData: ClassData;
  studentId: string;
  folder: FolderDelivery;
  onClose: () => void;
  onUpdateRecord: (patch: {
    actualDeliveryDate?: string;
    status?: FolderDeliveryStatus;
    notes?: string;
    extraMissingPlateIds?: string[];
    manualDelayDays?: number;
    manualFinalGrade?: number | null;
    manualGradeOverridden?: boolean;
  }) => void;
  onUpdatePlateCell: (
    plateId: string,
    patch: Partial<PlateEvaluation> & { explicitWasNo?: boolean }
  ) => void;
  onConfirm: () => void;
  onReopen: () => void;
}

export function FolderDrawer({
  open,
  classData,
  studentId,
  folder,
  onClose,
  onUpdateRecord,
  onUpdatePlateCell,
  onConfirm,
  onReopen,
}: FolderDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const student = classData.students.find((s) => s.id === studentId);
  if (!student) return null;

  const record =
    classData.folderRecords[studentId]?.[folder.id] ?? EMPTY_FOLDER_RECORD;
  const breakdown = calculateFolderEvaluation(classData, studentId, folder);
  const isLocked = breakdown.isConfirmed;
  const settings = breakdown.settingsUsed;

  const supportTags =
    student.supportNeeds && student.supportNeeds.length > 0
      ? student.supportNeeds
      : null;

  const assCount = breakdown.plateItems.filter((i) => i.status === 'ASS').length;
  const wipCount = breakdown.plateItems.filter((i) => i.status === 'WIP').length;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Dettaglio ${folder.title} per ${student.lastName} ${student.firstName}`}
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl">
        {/* Header: Student Name (+ H/DSA/BES if present) + Folder Context */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-display text-lg font-bold text-slate-950">
                {student.lastName} {student.firstName}
              </h2>
              {supportTags && (
                <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-xs font-bold text-amber-900">
                  {supportTags.join(' · ')}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              <span className="font-semibold text-blue-900">{folder.title}</span>
              <span aria-hidden="true">·</span>
              <span>{formatPlateInterval(folder.plateIds, classData.plates)}</span>
              {folder.dueDate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Scad. {formatShortMonthDateIt(folder.dueDate)}</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Chiudi pannello"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {isLocked && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-900">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 shrink-0 text-blue-700" />
                <div>
                  <div className="text-xs font-semibold">
                    Valutazione confermata e bloccata
                  </div>
                  <div className="text-[11px] text-blue-700">
                    Protetta da modifiche future alle impostazioni di valutazione.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onReopen}
                className="inline-flex items-center gap-1.5 rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
              >
                <Unlock className="h-3.5 w-3.5" />
                Riapri
              </button>
            </div>
          )}

          {/* Top Summary Cards: Media voti & Voto finale */}
          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3">
              <div className="text-xs font-semibold text-slate-600">
                Media voti
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900">
                  {breakdown.initialAverage !== null
                    ? formatDecimalIt(breakdown.initialAverage, 2)
                    : '—'}
                </span>
                {breakdown.initialAverage !== null && (
                  <span className="font-mono text-xs text-slate-500">
                    ({formatGradeLabel(breakdown.initialAverage)})
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {breakdown.gradedCount}/{breakdown.totalPlatesCount} tavole valutate
              </div>
            </div>

            <div className="rounded-lg border-2 border-blue-200 bg-blue-50/75 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-blue-900">
                  Voto finale
                </span>
                {breakdown.isManualOverride && (
                  <span className="text-[11px] font-medium text-amber-800">
                    Manuale
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-3xl font-extrabold tabular-nums text-blue-950">
                  {breakdown.finalGrade !== null
                    ? formatGradeLabel(breakdown.finalGrade)
                    : '—'}
                </span>
                {breakdown.finalGrade !== null && (
                  <span className="font-mono text-xs font-medium tabular-nums text-slate-600">
                    ({formatDecimalIt(breakdown.finalGrade, 2)})
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-600">
                Dopo applicazione penalità
              </div>
            </div>
          </section>

          {/* Calcolo automatico di media e penalità (subito sotto il voto) */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-slate-900">
                Calcolo automatico media e penalità
              </h3>
              <span className="text-[11px] text-slate-500">Scala 2–10</span>
            </div>

            <div className="divide-y divide-slate-200/80 rounded-md border border-slate-200 bg-slate-50/50">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-slate-800">
                    Media voti (prima delle penalità)
                  </span>
                  <span className="ml-2 text-xs text-slate-500">
                    {breakdown.gradedCount}/{breakdown.totalPlatesCount} tavole
                  </span>
                </div>
                <span className="font-mono text-[15px] font-bold tabular-nums text-slate-900">
                  {breakdown.initialAverage !== null
                    ? formatDecimalIt(breakdown.initialAverage, 2)
                    : '—'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-slate-800">
                    Penalità stato NO
                  </span>
                  <span className="ml-2 font-mono text-xs text-slate-500">
                    {breakdown.noCount} × {formatDecimalIt(settings.penaltyNo, 2)}
                  </span>
                </div>
                <span className="font-sans text-[15px] font-semibold tabular-nums text-rose-700">
                  {breakdown.penaltyNoTotal > 0
                    ? `-${formatDecimalIt(breakdown.penaltyNoTotal, 2)}`
                    : '0,00'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-slate-800">
                    Penalità tavole mancanti
                  </span>
                  <span className="ml-2 font-mono text-xs text-slate-500">
                    {breakdown.missingCount} × {formatDecimalIt(settings.penaltyMissing, 2)}
                  </span>
                </div>
                <span className="font-sans text-[15px] font-semibold tabular-nums text-rose-700">
                  {breakdown.penaltyMissingTotal > 0
                    ? `-${formatDecimalIt(breakdown.penaltyMissingTotal, 2)}`
                    : '0,00'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-slate-800">
                    Penalità ritardo cartellina
                  </span>
                  <span className="ml-2 font-mono text-xs text-slate-500">
                    {settings.toleranceDays > 0 && breakdown.rawDelayDays > 0
                      ? `(${breakdown.rawDelayDays}g − ${settings.toleranceDays}g) = ${breakdown.chargeableDelayDays}g × ${formatDecimalIt(settings.penaltyLatePerDay, 2)}`
                      : `${breakdown.chargeableDelayDays}g × ${formatDecimalIt(settings.penaltyLatePerDay, 2)}`}
                  </span>
                </div>
                <span className="font-sans text-[15px] font-semibold tabular-nums text-rose-700">
                  {breakdown.penaltyDelayTotal > 0
                    ? `-${formatDecimalIt(breakdown.penaltyDelayTotal, 2)}`
                    : '0,00'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 bg-blue-50/70 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-blue-950">
                    Voto finale (dopo le penalità)
                  </div>
                  <div className="text-xs text-slate-600">
                    {breakdown.rawFinalGrade !== null
                      ? `Grezzo ${formatDecimalIt(breakdown.rawFinalGrade, 2)} · ${ROUNDING_MODE_LABELS[settings.roundingMode]}`
                      : 'Nessun voto assegnato nel periodo'}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-mono text-xl font-extrabold tabular-nums text-blue-950">
                    {breakdown.suggestedFinalGrade !== null
                      ? formatGradeLabel(breakdown.suggestedFinalGrade)
                      : '—'}
                  </span>
                  {breakdown.suggestedFinalGrade !== null && (
                    <span className="ml-1.5 font-mono text-xs font-semibold tabular-nums text-slate-600">
                      ({formatDecimalIt(breakdown.suggestedFinalGrade, 2)})
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Dati di consegna cartellina: esclusivamente Annotazioni consegna */}
          <section className="space-y-2 border-t border-slate-200 pt-3.5">
            <h3 className="text-[13px] font-semibold text-slate-900">
              Dati di consegna cartellina
            </h3>
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Annotazioni consegna
              </label>
              <textarea
                rows={2}
                disabled={isLocked}
                value={record.notes}
                onChange={(e) => onUpdateRecord({ notes: e.target.value })}
                placeholder="Note su ordine della cartellina, tavole mancanti o giustificazioni..."
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
              />
            </div>
          </section>

          {/* Verifica tavole incluse */}
          <section className="space-y-2 border-t border-slate-200 pt-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-slate-900">
                Tavole incluse ({breakdown.plateItems.length})
              </h3>
              {(assCount > 0 || wipCount > 0) && (
                <span className="text-xs text-slate-500">
                  Escluse da penalità:{' '}
                  <strong className="font-mono text-slate-700">
                    {[
                      assCount > 0 ? `${assCount} ASS` : '',
                      wipCount > 0 ? `${wipCount} WIP` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </strong>
                </span>
              )}
            </div>

            <div className="divide-y divide-slate-200 rounded-md border border-slate-200">
              {breakdown.plateItems.length === 0 ? (
                <div className="px-4 py-5 text-center text-xs text-slate-500">
                  Nessuna tavola assegnata a questa cartellina.
                </div>
              ) : (
                breakdown.plateItems.map((item) => (
                  <div
                    key={item.plateId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-600">
                          T{item.plateNumber}
                        </span>
                        <span className="truncate text-[13px] font-medium text-slate-900">
                          {item.plateTitle}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>
                          Stato:{' '}
                          <strong className="font-mono text-slate-700">
                            {item.status ?? '—'}
                          </strong>
                          {item.wasNo && item.status !== 'NO' && ' (ex-NO)'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Voto:{' '}
                          <strong className="font-mono tabular-nums text-slate-700">
                            {formatGradeLabel(item.grade)}
                          </strong>
                        </span>
                        {item.countsAsNo && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-rose-700">Penalità NO</span>
                          </>
                        )}
                        {item.countsAsMissing && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-rose-700">Mancante</span>
                          </>
                        )}
                      </div>
                    </div>

                    {!isLocked && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.status === 'NO' && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdatePlateCell(item.plateId, {
                                status: 'SI',
                                explicitWasNo: true,
                              })
                            }
                            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                          >
                            Consegnata in cartellina
                          </button>
                        )}
                        {item.status === 'ASS' && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdatePlateCell(item.plateId, {
                                status: 'SI',
                                explicitWasNo: false,
                              })
                            }
                            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                          >
                            Recupero (SI)
                          </button>
                        )}
                        {item.status === 'WIP' && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdatePlateCell(item.plateId, {
                                status: 'SI',
                                explicitWasNo: false,
                              })
                            }
                            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                          >
                            Segna SI
                          </button>
                        )}
                        {item.status && (
                          <span
                            className={`rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                              STATUS_META[item.status].badgeClass
                            }`}
                          >
                            {item.status}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          {!isLocked ? (
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex min-h-9 items-center gap-2 rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              <CheckCircle2 className="h-4 w-4" />
              Conferma e blocca valutazione
            </button>
          ) : (
            <span className="text-xs text-slate-500">
              Confermata il{' '}
              {breakdown.confirmedAt
                ? new Date(breakdown.confirmedAt).toLocaleDateString('it-IT')
                : ''}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
