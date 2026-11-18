import {
  BarChart3,
  FileText,
  FolderPlus,
  Image as ImageIcon,
  Lock,
  UserPlus,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  ClassData,
  FolderDelivery,
  PlateEvaluation,
  PlateStatus,
  Student,
} from '../types/gradebook';
import {
  calculateFolderEvaluation,
  EMPTY_EVALUATION,
  EMPTY_FOLDER_RECORD,
  FOLDER_STATUS_META,
  formatDecimalIt,
  formatGradeLabel,
  formatShortMonthDateIt,
  sortPlates,
  STATUS_META,
} from '../utils/calculations';
import { getGradeColorStyle } from '../utils/gradeColors';
import { isPdfDataUrl } from '../utils/pdfViewer';
import { PlateImageViewerModal } from './PlateImageViewerModal';
import { RapidGradePicker } from './RapidGradePicker';

interface MobilePlateViewProps {
  classData: ClassData;
  onAddStudent: () => void;
  onAddFolder: () => void;
  onOpenStats: () => void;
  onOpenStudentStats?: (student: Student) => void;
  onOpenFolderStats?: (folder: FolderDelivery) => void;
  onUpdateCell: (
    studentId: string,
    plateId: string,
    patch: Partial<PlateEvaluation> & { explicitWasNo?: boolean }
  ) => void;
  onOpenFolderStudent: (studentId: string, folder: FolderDelivery) => void;
}

const STATUS_CODES: PlateStatus[] = ['SI', 'NO', 'ASS', 'WIP'];
const HOLD_DELAY_MS = 180;
const HOLD_MOVE_CANCEL_PX = 8;

export function MobilePlateView({
  classData,
  onAddStudent,
  onAddFolder,
  onOpenStats,
  onOpenStudentStats,
  onOpenFolderStats,
  onUpdateCell,
  onOpenFolderStudent,
}: MobilePlateViewProps) {
  const orderedPlates = useMemo(
    () => sortPlates(classData.plates),
    [classData.plates]
  );

  const [selectedColumnKey, setSelectedColumnKey] = useState<string>(() =>
    orderedPlates[0]
      ? `plate:${orderedPlates[0].id}`
      : classData.folders[0]
      ? `folder:${classData.folders[0].id}`
      : ''
  );

  const [mobileGradeTarget, setMobileGradeTarget] = useState<{
    studentId: string;
    studentName: string;
    plateId: string;
    currentGrade: number | null;
  } | null>(null);

  const [highlightedStudentId, setHighlightedStudentId] = useState<
    string | null
  >(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdStateRef = useRef<{
    studentId: string;
    pointerId: number;
    startX: number;
    startY: number;
    activated: boolean;
  } | null>(null);

  useEffect(() => {
    setHighlightedStudentId(null);
    setViewerOpen(false);
  }, [classData.id]);

  useEffect(() => {
    const cancelPendingTimer = (pointerId?: number) => {
      const cur = holdStateRef.current;
      if (!cur) return;
      if (pointerId !== undefined && cur.pointerId !== pointerId) return;
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      holdStateRef.current = null;
    };

    const handleMove = (e: PointerEvent) => {
      const cur = holdStateRef.current;
      if (!cur || cur.pointerId !== e.pointerId || cur.activated) return;
      if (
        Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) >
        HOLD_MOVE_CANCEL_PX
      ) {
        cancelPendingTimer(e.pointerId);
      }
    };

    const handleUp = (e: PointerEvent) => cancelPendingTimer(e.pointerId);
    const handleCancel = (e: PointerEvent) => cancelPendingTimer(e.pointerId);
    const handleBlur = () => cancelPendingTimer();

    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('blur', handleBlur);
    return () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
      }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const handleHoldStart = (
    e: ReactPointerEvent<HTMLElement>,
    studentId: string
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
    }
    const pointerId = e.pointerId;
    holdStateRef.current = {
      studentId,
      pointerId,
      startX: e.clientX,
      startY: e.clientY,
      activated: false,
    };
    holdTimerRef.current = window.setTimeout(() => {
      if (holdStateRef.current?.pointerId === pointerId) {
        holdStateRef.current.activated = true;
        setHighlightedStudentId(studentId);
      }
    }, HOLD_DELAY_MS);
  };

  const students = useMemo(
    () => [...classData.students].sort((a, b) => a.order - b.order),
    [classData.students]
  );

  const highlightedStudent = useMemo(
    () => classData.students.find((s) => s.id === highlightedStudentId) ?? null,
    [classData.students, highlightedStudentId]
  );

  const activePlate = selectedColumnKey.startsWith('plate:')
    ? orderedPlates.find((p) => `plate:${p.id}` === selectedColumnKey) ?? null
    : null;

  const activeFolder = selectedColumnKey.startsWith('folder:')
    ? classData.folders.find((f) => `folder:${f.id}` === selectedColumnKey) ??
      null
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white">
      {/* Header: Dominant Class Name + Stats + Column selector */}
      <div className="border-b border-slate-200 bg-slate-100 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="font-display truncate text-lg font-extrabold tracking-tight text-slate-950">
            {classData.name}
          </div>
          <button
            type="button"
            onClick={onOpenStats}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-800 whitespace-nowrap"
          >
            <BarChart3 className="h-3.5 w-3.5 text-blue-700" />
            Statistiche
          </button>
        </div>

        <label className="block text-[11px] font-semibold text-slate-600">
          Tavola o Cartellina attiva
        </label>
        <select
          value={selectedColumnKey}
          onChange={(e) => setSelectedColumnKey(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900"
        >
          {orderedPlates.map((p) => (
            <option key={p.id} value={`plate:${p.id}`}>
              Tav. {p.number} — {p.title}
            </option>
          ))}
          {classData.folders.map((f) => (
            <option key={f.id} value={`folder:${f.id}`}>
              Cartellina — {f.title}
            </option>
          ))}
        </select>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {activePlate?.imageDataUrl && (
            <button
              type="button"
              onClick={() => setViewerOpen(true)}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border border-blue-300 bg-white px-2.5 text-xs font-semibold text-blue-800 hover:bg-blue-50 whitespace-nowrap"
            >
              {isPdfDataUrl(activePlate.imageDataUrl) ? (
                <>
                  <FileText className="h-3.5 w-3.5 text-rose-600" />
                  Visualizza PDF tavola
                </>
              ) : (
                <>
                  <ImageIcon className="h-3.5 w-3.5 text-blue-700" />
                  Visualizza immagine tavola
                </>
              )}
            </button>
          )}
          {activeFolder && onOpenFolderStats && (
            <button
              type="button"
              onClick={() => onOpenFolderStats(activeFolder)}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border border-blue-300 bg-white px-2.5 text-xs font-semibold text-blue-900 hover:bg-blue-50 whitespace-nowrap"
            >
              <BarChart3 className="h-3.5 w-3.5 text-blue-700" />
              Statistiche classe — {activeFolder.title}
            </button>
          )}
          <button
            type="button"
            onClick={onAddStudent}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 whitespace-nowrap"
          >
            <UserPlus className="h-3.5 w-3.5 text-slate-600" />
            Aggiungi studente
          </button>
          <button
            type="button"
            onClick={onAddFolder}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-blue-300 bg-blue-50 px-2.5 text-xs font-medium text-blue-800 whitespace-nowrap"
          >
            <FolderPlus className="h-3.5 w-3.5 text-blue-700" />
            Crea cartellina
          </button>
        </div>
      </div>

      {highlightedStudent && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-blue-200 bg-blue-50 px-3 py-1.5 text-xs">
          <span className="truncate font-medium text-blue-950">
            Evidenziato:{' '}
            <strong>
              {highlightedStudent.lastName} {highlightedStudent.firstName}
            </strong>
          </span>
          <button
            type="button"
            onClick={() => setHighlightedStudentId(null)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded border border-blue-300 bg-white px-2.5 text-xs font-semibold text-blue-900"
          >
            <X className="h-3.5 w-3.5" />
            Esci dall’evidenziazione
          </button>
        </div>
      )}

      {/* Student rows */}
      <div className="flex-1 divide-y divide-slate-200 overflow-y-auto">
        {students.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Nessuno studente da visualizzare.
          </div>
        ) : activePlate ? (
          students.map((stu, idx) => {
            const cell =
              classData.evaluations[stu.id]?.[activePlate.id] ??
              EMPTY_EVALUATION;
            const fullName = `${stu.lastName} ${stu.firstName}`.trim();
            const hasSupportNeeds = Boolean(
              stu.supportNeeds && stu.supportNeeds.length > 0
            );
            const hasHighlight = highlightedStudentId !== null;
            const isHighlighted = highlightedStudentId === stu.id;
            const isDimmed = hasHighlight && !isHighlighted;

            return (
              <div
                key={stu.id}
                className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 transition-colors ${
                  isHighlighted
                    ? 'bg-blue-50 ring-2 ring-inset ring-blue-600'
                    : isDimmed
                    ? 'bg-slate-100 opacity-45'
                    : 'bg-white'
                }`}
              >
                <div
                  onPointerDown={(e) => handleHoldStart(e, stu.id)}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    userSelect: 'none',
                  }}
                  className="min-w-0 flex-1 select-none py-1"
                >
                  <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                      <span className="mr-1.5 font-mono text-xs text-slate-400">
                        {idx + 1}.
                        {hasSupportNeeds && (
                          <span className="ml-0.5 font-sans font-bold text-amber-600">
                            *
                          </span>
                        )}
                      </span>
                      {fullName}
                    </div>
                    {onOpenStudentStats && (
                      <button
                        type="button"
                        data-no-row-highlight="true"
                        onClick={() => onOpenStudentStats(stu)}
                        title="Statistiche"
                        aria-label={`Statistiche di ${fullName}`}
                        className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-blue-700"
                      >
                        <BarChart3 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {STATUS_CODES.map((code) => {
                    const active = cell.status === code;
                    const showExNoAsterisk =
                      code === 'SI' && active && cell.wasNo;
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() =>
                          onUpdateCell(stu.id, activePlate.id, {
                            status: active ? null : code,
                          })
                        }
                        className={`relative h-8 rounded border px-2 font-mono text-[11px] font-semibold ${
                          showExNoAsterisk
                            ? 'border-lime-500 bg-lime-200/85 text-lime-950 hover:bg-lime-300/75 ring-1 ring-slate-900/30'
                            : active
                            ? `${STATUS_META[code].buttonClass} ring-1 ring-slate-900/30`
                            : 'border-slate-200 bg-white text-slate-500'
                        }`}
                      >
                        <span>{code}</span>
                        {showExNoAsterisk && (
                          <span
                            aria-label="Penalità ex-NO attiva"
                            className="pointer-events-none absolute -top-0.5 right-0.5 font-mono text-sm font-black leading-none text-rose-600"
                          >
                            *
                          </span>
                        )}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    aria-label={`Voto per ${fullName}`}
                    onClick={() =>
                      setMobileGradeTarget({
                        studentId: stu.id,
                        studentName: fullName,
                        plateId: activePlate.id,
                        currentGrade: cell.grade,
                      })
                    }
                    style={
                      cell.grade !== null
                        ? getGradeColorStyle(cell.grade, { includeBorder: true })
                        : undefined
                    }
                    className={`h-8 min-w-[48px] rounded border px-2 font-mono text-sm font-bold tabular-nums ${
                      cell.grade !== null
                        ? 'hover:brightness-95'
                        : 'border-sky-200 bg-sky-50 text-slate-400'
                    }`}
                  >
                    <span>{formatGradeLabel(cell.grade)}</span>
                  </button>
                </div>
              </div>
            );
          })
        ) : activeFolder ? (
          students.map((stu, idx) => {
            const rec =
              classData.folderRecords[stu.id]?.[activeFolder.id] ??
              EMPTY_FOLDER_RECORD;
            const calc = calculateFolderEvaluation(
              classData,
              stu.id,
              activeFolder
            );
            const hasSupportNeeds = Boolean(
              stu.supportNeeds && stu.supportNeeds.length > 0
            );
            const isFolderNotDelivered =
              rec.status === 'da_consegnare' || rec.status === 'non_consegnata';
            const finalStyle = getGradeColorStyle(calc.finalGrade, {
              includeBorder: true,
            });
            return (
              <button
                key={stu.id}
                type="button"
                onClick={() => onOpenFolderStudent(stu.id, activeFolder)}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-blue-50/40"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">
                    <span className="mr-1.5 font-mono text-xs text-slate-400">
                      {idx + 1}.
                      {hasSupportNeeds && (
                        <span className="ml-0.5 font-sans font-bold text-amber-600">
                          *
                        </span>
                      )}
                    </span>
                    {stu.lastName} {stu.firstName}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {FOLDER_STATUS_META[rec.status].label} ·{' '}
                    {rec.actualDeliveryDate
                      ? formatShortMonthDateIt(rec.actualDeliveryDate)
                      : 'Data n.i.'}{' '}
                    · Rit. {calc.rawDelayDays}g · Media voti{' '}
                    <strong className="font-mono text-slate-700">
                      {calc.initialAverage !== null
                        ? formatDecimalIt(calc.initialAverage, 2)
                        : '—'}
                    </strong>
                    {calc.penaltyNoTotal +
                      calc.penaltyMissingTotal +
                      calc.penaltyDelayTotal >
                      0 && (
                      <span className="ml-1 font-sans font-semibold tabular-nums text-rose-700">
                        (-
                        {formatDecimalIt(
                          calc.penaltyNoTotal +
                            calc.penaltyMissingTotal +
                            calc.penaltyDelayTotal,
                          2
                        )}
                        )
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className={`flex flex-col items-end shrink-0 rounded px-2 py-1 ${
                    isFolderNotDelivered ? 'border border-yellow-300 bg-yellow-100/90' : ''
                  }`}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-700">
                    Voto finale
                  </span>
                  <div className="mt-0.5 flex items-center gap-1 font-mono text-lg font-extrabold leading-none">
                    <span
                      style={finalStyle}
                      className={
                        finalStyle
                          ? 'rounded border px-1.5 py-0.5 text-base font-extrabold leading-none'
                          : 'text-blue-950'
                      }
                    >
                      {formatGradeLabel(calc.finalGrade)}
                    </span>
                    {calc.isConfirmed && <Lock className="h-3.5 w-3.5 text-blue-700" />}
                  </div>
                </div>
              </button>
            );
          })
        ) : (
          <div className="p-8 text-center text-sm text-slate-500">
            Nessuna tavola o cartellina disponibile.
          </div>
        )}
      </div>

      {/* Mobile RapidGradePicker Sheet */}
      {mobileGradeTarget && activePlate && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Assegna voto a ${mobileGradeTarget.studentName}`}
        >
          <div className="w-full max-w-xs rounded-lg border border-slate-300 bg-white p-3.5 shadow-2xl">
            <div className="mb-2.5 flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">
                  {mobileGradeTarget.studentName}
                </div>
                <div className="truncate text-[11px] text-slate-500">
                  Tav. {activePlate.number} — {activePlate.title}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileGradeTarget(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <RapidGradePicker
              currentGrade={mobileGradeTarget.currentGrade}
              onSelect={(grade) => {
                onUpdateCell(
                  mobileGradeTarget.studentId,
                  mobileGradeTarget.plateId,
                  { grade }
                );
                setMobileGradeTarget(null);
              }}
              onCancel={() => setMobileGradeTarget(null)}
            />
          </div>
        </div>
      )}

      <PlateImageViewerModal
        plate={viewerOpen ? activePlate : null}
        onClose={() => setViewerOpen(false)}
      />
    </div>
  );
}
