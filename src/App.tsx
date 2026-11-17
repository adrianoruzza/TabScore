import {
  Plus,
  Settings,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArchiveModal } from './components/ArchiveModal';
import { AuditLogDrawer } from './components/AuditLogDrawer';
import { ClassManagerModal } from './components/ClassManagerModal';
import { ClassSettingsModal } from './components/ClassSettingsModal';
import { ClassStatsModal } from './components/ClassStatsModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { FolderClassStatsModal } from './components/FolderClassStatsModal';
import { FolderConfigModal } from './components/FolderConfigModal';
import { FolderDrawer } from './components/FolderDrawer';
import { GradeTable } from './components/GradeTable';
import { MobilePlateView } from './components/MobilePlateView';
import { PlateModal } from './components/PlateModal';
import { PWABanners, PWAInstallButton } from './components/PWAControls';
import { StudentModal } from './components/StudentModal';
import { StudentStatsModal } from './components/StudentStatsModal';
import { useGradebookStore } from './hooks/useGradebookStore';
import { usePWAStatus } from './hooks/usePWAStatus';
import type {
  ClassData,
  FolderDelivery,
  Plate,
  Student,
  StudentSupportTag,
} from './types/gradebook';
import { OFFICIAL_TABSCORE_ICON } from './utils/appAssets';
import { getClassColorOption } from './utils/classColors';

type ConfirmTarget =
  | { kind: 'class'; cls: ClassData }
  | { kind: 'student'; student: Student }
  | {
      kind: 'move_student';
      student: Student;
      sourceClass: ClassData;
      targetClass: ClassData;
      draftData: {
        lastName: string;
        firstName: string;
        supportNeeds: StudentSupportTag[];
      };
    }
  | { kind: 'plate'; plate: Plate }
  | { kind: 'folder'; folder: FolderDelivery };

export default function App() {
  const store = useGradebookStore();
  const { activeClass, state } = store;

  const [mobileMode, setMobileMode] = useState<'table' | 'cards'>('table');

  // Modals & Drawers
  const [classManagerOpen, setClassManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [studentStatsId, setStudentStatsId] = useState<string | null>(null);
  const [folderStatsId, setFolderStatsId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  useEffect(() => {
    setStudentStatsId(null);
    setFolderStatsId(null);
  }, [activeClass?.id]);

  const [studentModal, setStudentModal] = useState<{
    open: boolean;
    student: Student | null;
  }>({ open: false, student: null });

  const [plateModal, setPlateModal] = useState<{
    open: boolean;
    plate: Plate | null;
  }>({ open: false, plate: null });

  const [folderConfigModal, setFolderConfigModal] = useState<{
    open: boolean;
    folder: FolderDelivery | null;
  }>({ open: false, folder: null });

  const [activeFolderCell, setActiveFolderCell] = useState<{
    studentId: string;
    folderId: string;
  } | null>(null);

  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  const dataFingerprint = useMemo(
    () =>
      `${state.activeClassId ?? ''}|${state.classes
        .map((c) => `${c.id}:${c.updatedAt}`)
        .join(',')}|${state.auditLog[0]?.id ?? ''}`,
    [state]
  );

  const isEditingBusy = Boolean(
    studentModal.open ||
      plateModal.open ||
      folderConfigModal.open ||
      settingsOpen ||
      classManagerOpen ||
      activeFolderCell ||
      confirmTarget
  );

  const pwa = usePWAStatus(dataFingerprint, isEditingBusy);

  const activeClassId = activeClass?.id ?? null;
  const activeClassColor = useMemo(
    () => (activeClass ? getClassColorOption(activeClass.color) : null),
    [activeClass]
  );

  const sortedStudents = useMemo(
    () =>
      activeClass
        ? [...activeClass.students].sort((a, b) => a.order - b.order)
        : [],
    [activeClass]
  );

  const nextPlateNumber = activeClass
    ? activeClass.plates.reduce((max, p) => Math.max(max, p.number), 0) + 1
    : 1;

  const activeFolderObj =
    activeClass && activeFolderCell
      ? activeClass.folders.find((f) => f.id === activeFolderCell.folderId) ?? null
      : null;

  const folderStatsObj =
    activeClass && folderStatsId
      ? activeClass.folders.find((f) => f.id === folderStatsId) ?? null
      : null;

  const handleEditStudent = useCallback(
    (student: Student) => setStudentModal({ open: true, student }),
    []
  );
  const handleOpenStudentStats = useCallback(
    (student: Student) => setStudentStatsId(student.id),
    []
  );
  const handleDeleteStudent = useCallback(
    (student: Student) => setConfirmTarget({ kind: 'student', student }),
    []
  );
  const handleReorderStudent = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (activeClassId) store.reorderStudent(activeClassId, fromIdx, toIdx);
    },
    [activeClassId, store.reorderStudent]
  );
  const handleAddStudent = useCallback(
    () => setStudentModal({ open: true, student: null }),
    []
  );
  const handleEditPlate = useCallback(
    (plate: Plate) => setPlateModal({ open: true, plate }),
    []
  );
  const handleUpdatePlateTitle = useCallback(
    (plateId: string, newTitle: string) => {
      if (activeClassId) store.updatePlateTitle(activeClassId, plateId, newTitle);
    },
    [activeClassId, store.updatePlateTitle]
  );
  const handleUpdatePlateImage = useCallback(
    (plateId: string, image: { dataUrl: string; fileName: string } | null) =>
      activeClassId
        ? store.updatePlateImage(activeClassId, plateId, image)
        : false,
    [activeClassId, store.updatePlateImage]
  );
  const handleReorderPlate = useCallback(
    (plateId: string, direction: 'left' | 'right') => {
      if (activeClassId) store.reorderPlate(activeClassId, plateId, direction);
    },
    [activeClassId, store.reorderPlate]
  );
  const handleAddPlate = useCallback(
    () => setPlateModal({ open: true, plate: null }),
    []
  );
  const handleEditFolder = useCallback(
    (folder: FolderDelivery) => setFolderConfigModal({ open: true, folder }),
    []
  );
  const handleAddFolder = useCallback(
    () => setFolderConfigModal({ open: true, folder: null }),
    []
  );
  const handleOpenStats = useCallback(() => setStatsOpen(true), []);
  const handleOpenFolderStats = useCallback(
    (folder: FolderDelivery) => setFolderStatsId(folder.id),
    []
  );
  const handleUpdateCell = useCallback(
    (
      studentId: string,
      plateId: string,
      patch: Parameters<typeof store.setCellEvaluation>[3]
    ) => {
      if (activeClassId) {
        store.setCellEvaluation(activeClassId, studentId, plateId, patch);
      }
    },
    [activeClassId, store.setCellEvaluation]
  );
  const handleUpdateFolderStudentRecord = useCallback(
    (
      studentId: string,
      folderId: string,
      patch: Parameters<typeof store.updateFolderStudentRecord>[3]
    ) => {
      if (activeClassId) {
        store.updateFolderStudentRecord(
          activeClassId,
          studentId,
          folderId,
          patch
        );
      }
    },
    [activeClassId, store.updateFolderStudentRecord]
  );
  const handleOpenFolderStudent = useCallback(
    (studentId: string, folder: FolderDelivery) =>
      setActiveFolderCell({ studentId, folderId: folder.id }),
    []
  );

  const handleConfirmAction = () => {
    if (!confirmTarget) return;
    if (confirmTarget.kind === 'class') {
      store.deleteClass(confirmTarget.cls.id);
    } else if (confirmTarget.kind === 'move_student') {
      store.moveStudentToClass(
        confirmTarget.sourceClass.id,
        confirmTarget.student.id,
        confirmTarget.targetClass.id,
        confirmTarget.draftData
      );
      setStudentModal({ open: false, student: null });
    } else if (activeClass) {
      if (confirmTarget.kind === 'student') {
        store.deleteStudent(activeClass.id, confirmTarget.student.id);
      } else if (confirmTarget.kind === 'plate') {
        store.deletePlate(activeClass.id, confirmTarget.plate.id);
        setPlateModal({ open: false, plate: null });
      } else if (confirmTarget.kind === 'folder') {
        store.deleteFolder(activeClass.id, confirmTarget.folder.id);
        setFolderConfigModal({ open: false, folder: null });
        if (activeFolderCell?.folderId === confirmTarget.folder.id) {
          setActiveFolderCell(null);
        }
      }
    }
    setConfirmTarget(null);
  };

  const confirmCopy: {
    title: string;
    description: string;
    confirmLabel: string;
    destructive: boolean;
  } = (() => {
    if (!confirmTarget) {
      return {
        title: '',
        description: '',
        confirmLabel: 'Elimina',
        destructive: true,
      };
    }
    switch (confirmTarget.kind) {
      case 'class':
        return {
          title: `Eliminare la classe "${confirmTarget.cls.name}"?`,
          description: `Verranno eliminati definitivamente ${confirmTarget.cls.students.length} studenti, ${confirmTarget.cls.plates.length} tavole e tutte le relative valutazioni.`,
          confirmLabel: 'Elimina',
          destructive: true,
        };
      case 'student':
        return {
          title: `Eliminare lo studente "${confirmTarget.student.lastName} ${confirmTarget.student.firstName}"?`,
          description:
            'Tutte le valutazioni delle tavole e delle cartelline associate a questo studente verranno rimosse.',
          confirmLabel: 'Elimina',
          destructive: true,
        };
      case 'move_student': {
        const studentName =
          `${confirmTarget.draftData.lastName} ${confirmTarget.draftData.firstName}`.trim();
        return {
          title: `Spostare "${studentName}" in "${confirmTarget.targetClass.name}"?`,
          description: `Lo studente verrà trasferito da "${confirmTarget.sourceClass.name}" a "${confirmTarget.targetClass.name}". Dati anagrafici, indicazioni (DSA/BES/H) e storico delle valutazioni nella classe di provenienza resteranno conservati senza alcuna perdita.`,
          confirmLabel: 'Conferma spostamento',
          destructive: false,
        };
      }
      case 'plate':
        return {
          title: `Eliminare la Tavola ${confirmTarget.plate.number}?`,
          description: `La tavola "${confirmTarget.plate.title}" e tutti i voti/stati registrati dagli studenti per questa tavola saranno rimossi.`,
          confirmLabel: 'Elimina',
          destructive: true,
        };
      case 'folder':
        return {
          title: `Eliminare "${confirmTarget.folder.title}"?`,
          description:
            'Verranno rimossi i dati di consegna della cartellina per tutta la classe. Le singole tavole resteranno invariate.',
          confirmLabel: 'Elimina',
          destructive: true,
        };
    }
  })();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900">
      {/* Top Bar: Brand + Class Switcher & Management Nav */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2 sm:px-5">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <img
            src={OFFICIAL_TABSCORE_ICON}
            alt=""
            aria-hidden="true"
            className="h-8 w-auto shrink-0 object-contain"
          />
          <span className="font-display text-base font-bold tracking-tight text-slate-900">
            TabScore
          </span>
        </div>

        <div className="hidden md:flex min-w-0 items-center gap-4 lg:gap-6">
          <div className="flex items-center gap-2 shrink-0">
            {activeClassColor && (
              <span
                aria-hidden="true"
                style={{ backgroundColor: activeClassColor.accent }}
                className="h-3.5 w-3.5 shrink-0 rounded-sm"
                title={`Colore classe: ${activeClassColor.label}`}
              />
            )}
            <label htmlFor="class-selector" className="sr-only">
              Seleziona classe
            </label>
            <select
              id="class-selector"
              value={activeClass?.id ?? ''}
              onChange={(e) => store.setActiveClass(e.target.value)}
              disabled={state.classes.length === 0}
              style={
                activeClassColor
                  ? {
                      borderColor: activeClassColor.border,
                      backgroundColor: activeClassColor.softBg,
                      color: activeClassColor.text,
                    }
                  : undefined
              }
              className="h-8 max-w-[210px] rounded-md border border-slate-300 bg-slate-50/70 px-2.5 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
            >
              {state.classes.length === 0 ? (
                <option value="">Nessuna classe</option>
              ) : (
                state.classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <nav
            aria-label="Strumenti principali"
            className="flex items-center gap-4 lg:gap-5 text-sm font-medium text-slate-600"
          >
            <button
              type="button"
              onClick={() => setClassManagerOpen(true)}
              className="hover:text-slate-900 hover:underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Gestione classi
            </button>
            <button
              type="button"
              disabled={!activeClass}
              onClick={() => setSettingsOpen(true)}
              className="hover:text-slate-900 hover:underline underline-offset-4 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              Impostazioni valutazione
            </button>
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="hover:text-slate-900 hover:underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Archivio e backup
            </button>
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="hover:text-slate-900 hover:underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Cronologia
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />
          {!activeClass && (
            <button
              type="button"
              onClick={() => setClassManagerOpen(true)}
              className="inline-flex min-h-9 items-center gap-2 rounded-md bg-blue-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              Nuova classe
            </button>
          )}
        </div>
      </header>

      {/* Compact Mobile Bar (hidden on md+ desktop/tablet) */}
      <section className="shrink-0 space-y-2 border-b border-slate-200 bg-white/70 px-3 py-2 md:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {activeClassColor && (
              <span
                aria-hidden="true"
                style={{ backgroundColor: activeClassColor.accent }}
                className="h-3.5 w-3.5 shrink-0 rounded-sm"
              />
            )}
            <label htmlFor="class-selector-mobile" className="sr-only">
              Seleziona classe
            </label>
            <select
              id="class-selector-mobile"
              value={activeClass?.id ?? ''}
              onChange={(e) => store.setActiveClass(e.target.value)}
              disabled={state.classes.length === 0}
              style={
                activeClassColor
                  ? {
                      borderColor: activeClassColor.border,
                      backgroundColor: activeClassColor.softBg,
                      color: activeClassColor.text,
                    }
                  : undefined
              }
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              {state.classes.length === 0 ? (
                <option value="">Nessuna classe</option>
              ) : (
                state.classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {activeClass && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Impostazioni valutazione"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Settings className="h-3.5 w-3.5" />
              Impostazioni valutazione
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setClassManagerOpen(true)}
              className="hover:text-slate-900 underline-offset-4 hover:underline"
            >
              Gestione classi
            </button>
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="hover:text-slate-900 underline-offset-4 hover:underline"
            >
              Archivio e backup
            </button>
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="hover:text-slate-900 underline-offset-4 hover:underline"
            >
              Cronologia
            </button>
          </div>

          {activeClass && (
            <div className="flex items-center rounded border border-slate-300 bg-white p-0.5 sm:hidden">
              <button
                type="button"
                onClick={() => setMobileMode('table')}
                className={`rounded px-2 py-1 text-[11px] font-medium ${
                  mobileMode === 'table'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600'
                }`}
              >
                Tabella
              </button>
              <button
                type="button"
                onClick={() => setMobileMode('cards')}
                className={`rounded px-2 py-1 text-[11px] font-medium ${
                  mobileMode === 'cards'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600'
                }`}
              >
                Scheda tavola
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Main Content: Spreadsheet Table */}
      <main className="flex min-h-0 flex-1 flex-col px-3 pt-2.5 pb-3 sm:px-5 sm:pt-3 sm:pb-4">
        {!activeClass ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-16 text-center">
            <img
              src={OFFICIAL_TABSCORE_ICON}
              alt="TabScore"
              className="mb-4 h-16 w-auto object-contain"
            />
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Nessuna classe presente nel registro
            </h2>
            <p className="mt-1.5 max-w-md text-sm text-slate-500">
              Crea una nuova classe o importa un archivio precedentemente salvato per iniziare.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setClassManagerOpen(true)}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
              >
                <Plus className="h-4 w-4" />
                Crea prima classe
              </button>
              <button
                type="button"
                onClick={() => setArchiveOpen(true)}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Importa archivio
              </button>
            </div>
          </div>
        ) : (
          <>
            {mobileMode === 'cards' && (
              <div className="flex min-h-0 flex-1 flex-col sm:hidden">
                <MobilePlateView
                  classData={activeClass}
                  onAddStudent={() =>
                    setStudentModal({ open: true, student: null })
                  }
                  onAddFolder={() =>
                    setFolderConfigModal({ open: true, folder: null })
                  }
                  onOpenStats={() => setStatsOpen(true)}
                  onOpenStudentStats={(student) => setStudentStatsId(student.id)}
                  onOpenFolderStats={(folder) => setFolderStatsId(folder.id)}
                  onUpdateCell={(studentId, plateId, patch) =>
                    store.setCellEvaluation(
                      activeClass.id,
                      studentId,
                      plateId,
                      patch
                    )
                  }
                  onOpenFolderStudent={(studentId, folder) =>
                    setActiveFolderCell({ studentId, folderId: folder.id })
                  }
                />
              </div>
            )}
            <div
              className={
                mobileMode === 'cards'
                  ? 'hidden min-h-0 flex-1 flex-col sm:flex'
                  : 'flex min-h-0 flex-1 flex-col'
              }
            >
              <GradeTable
                classData={activeClass}
                onEditStudent={handleEditStudent}
                onOpenStudentStats={handleOpenStudentStats}
                onDeleteStudent={handleDeleteStudent}
                onReorderStudent={handleReorderStudent}
                onAddStudent={handleAddStudent}
                onEditPlate={handleEditPlate}
                onUpdatePlateTitle={handleUpdatePlateTitle}
                onUpdatePlateImage={handleUpdatePlateImage}
                onReorderPlate={handleReorderPlate}
                onAddPlate={handleAddPlate}
                onEditFolder={handleEditFolder}
                onAddFolder={handleAddFolder}
                onOpenStats={handleOpenStats}
                onOpenFolderStats={handleOpenFolderStats}
                onUpdateCell={handleUpdateCell}
                onUpdateFolderStudentRecord={handleUpdateFolderStudentRecord}
                onOpenFolderStudent={handleOpenFolderStudent}
              />
            </div>
          </>
        )}
      </main>

      {/* Modals & Drawers */}
      <ClassManagerModal
        open={classManagerOpen}
        classes={state.classes}
        activeClassId={activeClass?.id ?? null}
        onSelectClass={store.setActiveClass}
        onCreateClass={store.createClass}
        onUpdateClass={store.updateClass}
        onDeleteClass={(cls) => setConfirmTarget({ kind: 'class', cls })}
        onImportStudents={store.importStudents}
        onClose={() => setClassManagerOpen(false)}
      />

      {activeClass && (
        <>
          <StudentModal
            open={studentModal.open}
            student={studentModal.student}
            classes={state.classes.map((c) => ({ id: c.id, name: c.name }))}
            currentClassId={activeClass.id}
            suppressEscape={Boolean(confirmTarget)}
            onSave={(data) => {
              if (studentModal.student) {
                store.updateStudent(
                  activeClass.id,
                  studentModal.student.id,
                  data
                );
              } else {
                store.addStudent(activeClass.id, data);
              }
            }}
            onRequestMoveToClass={(targetClassId, draftData) => {
              if (!studentModal.student) return;
              const targetClass = state.classes.find(
                (c) => c.id === targetClassId
              );
              if (!targetClass) return;
              setConfirmTarget({
                kind: 'move_student',
                student: studentModal.student,
                sourceClass: activeClass,
                targetClass,
                draftData,
              });
            }}
            onClose={() => setStudentModal({ open: false, student: null })}
          />

          <PlateModal
            open={plateModal.open}
            plate={plateModal.plate}
            nextNumber={nextPlateNumber}
            onSave={(data) => {
              if (plateModal.plate) {
                store.updatePlate(activeClass.id, plateModal.plate.id, data);
              } else {
                store.addPlate(activeClass.id, data);
              }
            }}
            onDelete={(plate) => setConfirmTarget({ kind: 'plate', plate })}
            onClose={() => setPlateModal({ open: false, plate: null })}
          />

          <FolderConfigModal
            open={folderConfigModal.open}
            classData={activeClass}
            folder={folderConfigModal.folder}
            onSave={(data) => {
              if (folderConfigModal.folder) {
                store.updateFolder(
                  activeClass.id,
                  folderConfigModal.folder.id,
                  data
                );
              } else {
                store.addFolder(activeClass.id, data);
              }
            }}
            onDelete={(folder) => setConfirmTarget({ kind: 'folder', folder })}
            onConfirmAll={(folderId) =>
              store.confirmAllStudentsInFolder(activeClass.id, folderId)
            }
            onReopenAll={(folderId) =>
              store.reopenAllStudentsInFolder(activeClass.id, folderId)
            }
            onClose={() =>
              setFolderConfigModal({ open: false, folder: null })
            }
          />

          <ClassSettingsModal
            open={settingsOpen}
            classData={activeClass}
            onSave={(settings) =>
              store.updateClassSettings(activeClass.id, settings)
            }
            onClose={() => setSettingsOpen(false)}
          />

          <ClassStatsModal
            open={statsOpen}
            classData={activeClass}
            onOpenStudentStats={handleOpenStudentStats}
            onClose={() => setStatsOpen(false)}
          />

          <StudentStatsModal
            open={Boolean(studentStatsId)}
            classData={activeClass}
            studentId={studentStatsId}
            students={sortedStudents}
            onSelectStudent={(id) => setStudentStatsId(id)}
            onClose={() => setStudentStatsId(null)}
          />

          <FolderClassStatsModal
            open={Boolean(folderStatsObj)}
            classData={activeClass}
            folder={folderStatsObj}
            onClose={() => setFolderStatsId(null)}
          />

          {activeFolderCell && activeFolderObj && (
            <FolderDrawer
              open={true}
              classData={activeClass}
              studentId={activeFolderCell.studentId}
              folder={activeFolderObj}
              onClose={() => setActiveFolderCell(null)}
              onUpdateRecord={(patch) =>
                store.updateFolderStudentRecord(
                  activeClass.id,
                  activeFolderCell.studentId,
                  activeFolderObj.id,
                  patch
                )
              }
              onUpdatePlateCell={(plateId, patch) =>
                store.setCellEvaluation(
                  activeClass.id,
                  activeFolderCell.studentId,
                  plateId,
                  patch
                )
              }
              onConfirm={() =>
                store.confirmStudentFolder(
                  activeClass.id,
                  activeFolderCell.studentId,
                  activeFolderObj.id
                )
              }
              onReopen={() =>
                store.reopenStudentFolder(
                  activeClass.id,
                  activeFolderCell.studentId,
                  activeFolderObj.id
                )
              }
            />
          )}
        </>
      )}

      <ArchiveModal
        open={archiveOpen}
        storeState={state}
        activeClass={activeClass}
        onImportSingleClass={store.importSingleClass}
        onImportFullBackup={store.importFullBackup}
        onLogExport={(action, details) =>
          store.recordAuditAction(
            activeClass?.id ?? null,
            activeClass?.name ?? 'Archivio completo',
            'archivio',
            action,
            details
          )
        }
        onClose={() => setArchiveOpen(false)}
      />

      <AuditLogDrawer
        open={auditOpen}
        entries={state.auditLog}
        activeClassId={activeClass?.id ?? null}
        onClose={() => setAuditOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        destructive={confirmCopy.destructive}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmTarget(null)}
      />

      <PWABanners
        isOnline={pwa.isOnline}
        needRefresh={pwa.needRefresh}
        pendingOfflineChanges={pwa.pendingOfflineChanges}
        reconciledNotice={pwa.reconciledNotice}
        isEditingBusy={isEditingBusy}
        isUpdating={pwa.isUpdating}
        onApplyUpdate={() => void pwa.applyUpdate()}
        onDismissUpdate={pwa.dismissUpdatePrompt}
      />
    </div>
  );
}
