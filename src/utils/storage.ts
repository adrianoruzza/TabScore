import * as XLSX from 'xlsx';
import type {
  AuditLogEntry,
  ClassData,
  ClassSettings,
  FullBackupArchive,
  GradebookStoreState,
  PlateEvaluation,
  SingleClassArchive,
} from '../types/gradebook';
import { getClassColorOption } from './classColors';
import {
  calculateFolderEvaluation,
  EMPTY_EVALUATION,
  EMPTY_FOLDER_RECORD,
  FOLDER_STATUS_META,
  formatDateIt,
  formatDecimalIt,
  formatGradeLabel,
  formatPlateInterval,
  ROUNDING_MODE_LABELS,
  sortPlates,
} from './calculations';

export const STORAGE_KEY = 'dt_registro_tavole_v1';
export const STORE_VERSION = 1;

export const DEFAULT_CLASS_SETTINGS: ClassSettings = {
  penaltyNo: 0.2,
  penaltyMissing: 0.5,
  penaltyLatePerDay: 0.1,
  toleranceDays: 0,
  defaultPlatesPerFolder: 10,
  roundingMode: 'quarter',
};

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createInitialSeedState(): GradebookStoreState {
  const now = new Date().toISOString();
  const classId = 'cls_2b_dt';

  const students = [
    { id: 'stu_1', lastName: 'Bianchi', firstName: 'Lorenzo', order: 0 },
    { id: 'stu_2', lastName: 'Conti', firstName: 'Matilde', order: 1 },
    { id: 'stu_3', lastName: 'Ferrari', firstName: 'Davide', order: 2 },
    { id: 'stu_4', lastName: 'Gallo', firstName: 'Chiara', order: 3 },
    { id: 'stu_5', lastName: 'Moretti', firstName: 'Tommaso', order: 4 },
    { id: 'stu_6', lastName: 'Ricci', firstName: 'Sofia', order: 5 },
  ];

  const plates = [
    {
      id: 'plt_1',
      number: 1,
      title: 'Squadratura e linee di costruzione',
      assignedDate: '2026-09-18',
      dueDate: '2026-09-25',
      notes: 'Uso corretto delle matite 2H e HB.',
    },
    {
      id: 'plt_2',
      number: 2,
      title: 'Costruzioni geometriche: poligoni regolari',
      assignedDate: '2026-09-25',
      dueDate: '2026-10-02',
      notes: 'Pentagono ed esagono inscritti.',
    },
    {
      id: 'plt_3',
      number: 3,
      title: 'Proiezioni ortogonali: prisma a base esagonale',
      assignedDate: '2026-10-02',
      dueDate: '2026-10-16',
      notes: 'Verificare tratteggio spigoli nascosti.',
    },
    {
      id: 'plt_4',
      number: 4,
      title: 'Proiezioni ortogonali: gruppo di solidi',
      assignedDate: '2026-10-16',
      dueDate: '2026-10-30',
      notes: 'Composizione cilindro e piramide.',
    },
    {
      id: 'plt_5',
      number: 5,
      title: 'Assonometria isometrica di un solido composto',
      assignedDate: '2026-10-30',
      dueDate: '2026-11-10',
      notes: 'Quotatura essenziale secondo norma UNI.',
    },
  ];

  const evaluations: Record<string, Record<string, PlateEvaluation>> = {
    stu_1: {
      plt_1: { status: 'SI', grade: 7.5, wasNo: false },
      plt_2: { status: 'SI', grade: 8, wasNo: false },
      plt_3: { status: 'SI', grade: 7.25, wasNo: false },
      plt_4: { status: 'SI', grade: 7.75, wasNo: false },
      plt_5: { status: 'SI', grade: 8.25, wasNo: false },
    },
    stu_2: {
      plt_1: { status: 'SI', grade: 8.5, wasNo: false },
      plt_2: { status: 'SI', grade: 8.75, wasNo: false },
      plt_3: { status: 'SI', grade: 7.5, wasNo: true }, // inizialmente NO, poi consegnata
      plt_4: { status: 'SI', grade: 8, wasNo: false },
      plt_5: { status: 'SI', grade: 8.5, wasNo: false },
    },
    stu_3: {
      plt_1: { status: 'SI', grade: 6.25, wasNo: false },
      plt_2: { status: 'NO', grade: null, wasNo: true },
      plt_3: { status: 'SI', grade: 6.5, wasNo: false },
      plt_4: { status: 'WIP', grade: 6, wasNo: false },
      plt_5: { status: 'ASS', grade: null, wasNo: false },
    },
    stu_4: {
      plt_1: { status: 'SI', grade: 9, wasNo: false },
      plt_2: { status: 'SI', grade: 9.25, wasNo: false },
      plt_3: { status: 'SI', grade: 8.75, wasNo: false },
      plt_4: { status: 'SI', grade: 9.5, wasNo: false },
      plt_5: { status: 'SI', grade: 9, wasNo: false },
    },
    stu_5: {
      plt_1: { status: 'SI', grade: 6, wasNo: false },
      plt_2: { status: 'SI', grade: 6.5, wasNo: false },
      plt_3: { status: 'NO', grade: null, wasNo: true },
      plt_4: { status: 'SI', grade: 6.75, wasNo: false },
      plt_5: { status: 'WIP', grade: null, wasNo: false },
    },
    stu_6: {
      plt_1: { status: 'ASS', grade: 7, wasNo: false },
      plt_2: { status: 'SI', grade: 7.25, wasNo: false },
      plt_3: { status: 'SI', grade: 7.5, wasNo: false },
      plt_4: { status: 'SI', grade: 7.75, wasNo: false },
      plt_5: { status: 'SI', grade: 8, wasNo: false },
    },
  };

  const folderId = 'fld_1';
  const folders = [
    {
      id: folderId,
      title: 'Cartellina 1',
      dueDate: '2026-11-12',
      plateIds: ['plt_1', 'plt_2', 'plt_3', 'plt_4', 'plt_5'],
      notes: 'Prima raccolta valutativa del trimestre.',
    },
  ];

  const folderRecords: ClassData['folderRecords'] = {
    stu_1: {
      [folderId]: {
        actualDeliveryDate: '2026-11-12',
        manualDelayDays: 0,
        manualFinalGrade: null,
        status: 'consegnata',
        notes: 'Cartellina ordinata e completa.',
        extraMissingPlateIds: [],
        confirmedSnapshot: null,
      },
    },
    stu_2: {
      [folderId]: {
        actualDeliveryDate: '2026-11-12',
        manualDelayDays: 0,
        manualFinalGrade: null,
        status: 'consegnata',
        notes: 'Tavola 3 recuperata prima della consegna finale.',
        extraMissingPlateIds: [],
        confirmedSnapshot: null,
      },
    },
    stu_3: {
      [folderId]: {
        actualDeliveryDate: '2026-11-14',
        manualDelayDays: 2,
        manualFinalGrade: null,
        status: 'consegnata_ritardo',
        notes: 'Consegnata con 2 giorni di ritardo; manca tavola 2.',
        extraMissingPlateIds: [],
        confirmedSnapshot: null,
      },
    },
    stu_4: {
      [folderId]: {
        actualDeliveryDate: '2026-11-11',
        manualDelayDays: 0,
        manualFinalGrade: null,
        status: 'consegnata',
        notes: '',
        extraMissingPlateIds: [],
        confirmedSnapshot: null,
      },
    },
    stu_5: {
      [folderId]: {
        actualDeliveryDate: '',
        manualDelayDays: 0,
        manualFinalGrade: null,
        status: 'da_consegnare',
        notes: '',
        extraMissingPlateIds: [],
        confirmedSnapshot: null,
      },
    },
    stu_6: {
      [folderId]: {
        actualDeliveryDate: '2026-11-12',
        manualDelayDays: 0,
        manualFinalGrade: null,
        status: 'consegnata',
        notes: '',
        extraMissingPlateIds: [],
        confirmedSnapshot: null,
      },
    },
  };

  const sampleClass: ClassData = {
    id: classId,
    name: '2ª B — Disegno Tecnico',
    schoolYear: '2026/2027',
    color: 'blue',
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_CLASS_SETTINGS, defaultPlatesPerFolder: 5 },
    students,
    plates,
    evaluations,
    folders,
    folderRecords,
  };

  return {
    version: STORE_VERSION,
    activeClassId: classId,
    classes: [sampleClass],
    auditLog: [
      {
        id: createId('log'),
        timestamp: now,
        classId,
        className: sampleClass.name,
        category: 'classe',
        action: 'Inizializzazione registro',
        details: 'Creata classe iniziale di esempio con 6 studenti, 5 tavole e Cartellina 1.',
      },
    ],
  };
}

export function normalizeClassData(cls: ClassData, fallbackIndex = 0): ClassData {
  return {
    ...cls,
    color: getClassColorOption(cls.color, fallbackIndex).id,
    settings: {
      penaltyNo: cls.settings?.penaltyNo ?? DEFAULT_CLASS_SETTINGS.penaltyNo,
      penaltyMissing:
        cls.settings?.penaltyMissing ?? DEFAULT_CLASS_SETTINGS.penaltyMissing,
      penaltyLatePerDay:
        cls.settings?.penaltyLatePerDay ??
        DEFAULT_CLASS_SETTINGS.penaltyLatePerDay,
      toleranceDays:
        cls.settings?.toleranceDays ?? DEFAULT_CLASS_SETTINGS.toleranceDays,
      defaultPlatesPerFolder:
        cls.settings?.defaultPlatesPerFolder ??
        DEFAULT_CLASS_SETTINGS.defaultPlatesPerFolder,
      roundingMode:
        cls.settings?.roundingMode ?? DEFAULT_CLASS_SETTINGS.roundingMode,
    },
  };
}

export function loadStoreState(): GradebookStoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = createInitialSeedState();
      saveStoreState(seed);
      return seed;
    }
    const parsed = JSON.parse(raw) as GradebookStoreState;
    if (!parsed || !Array.isArray(parsed.classes)) {
      throw new Error('Struttura archivio non valida');
    }
    const normalizedClasses = parsed.classes.map((cls, idx) =>
      normalizeClassData(cls, idx)
    );
    return {
      version: parsed.version ?? STORE_VERSION,
      activeClassId:
        parsed.activeClassId && normalizedClasses.some((c) => c.id === parsed.activeClassId)
          ? parsed.activeClassId
          : normalizedClasses[0]?.id ?? null,
      classes: normalizedClasses,
      auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog : [],
    };
  } catch {
    const seed = createInitialSeedState();
    saveStoreState(seed);
    return seed;
  }
}

export function saveStoreState(state: GradebookStoreState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('Errore salvataggio locale:', err);
    return false;
  }
}

export function triggerJsonDownload(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportSingleClassJson(
  classData: ClassData,
  auditLog: AuditLogEntry[]
): void {
  const archive: SingleClassArchive = {
    archiveType: 'single_class',
    version: STORE_VERSION,
    exportedAt: new Date().toISOString(),
    classData,
    classAuditLog: auditLog.filter((l) => l.classId === classData.id),
  };
  const safeName = classData.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_|_$/g, '');
  const datePart = new Date().toISOString().slice(0, 10);
  triggerJsonDownload(`registro_${safeName || 'classe'}_${datePart}.json`, archive);
}

export function createFullBackupArchive(
  state: GradebookStoreState,
  now: Date = new Date()
): FullBackupArchive {
  return {
    archiveType: 'full_backup',
    version: STORE_VERSION,
    exportedAt: now.toISOString(),
    classes: state.classes,
    auditLog: state.auditLog,
  };
}

export function buildTimestampedBackupFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `backup_completo_tabscore_${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}.json`;
}

export function exportFullBackupJson(state: GradebookStoreState): void {
  const now = new Date();
  const backup = createFullBackupArchive(state, now);
  triggerJsonDownload(buildTimestampedBackupFileName(now), backup);
}

export function validateImportedArchive(
  rawJson: unknown
):
  | { ok: true; kind: 'single_class'; archive: SingleClassArchive }
  | { ok: true; kind: 'full_backup'; archive: FullBackupArchive }
  | { ok: false; error: string } {
  if (!rawJson || typeof rawJson !== 'object') {
    return { ok: false, error: 'Il file selezionato non contiene un oggetto JSON valido.' };
  }
  const obj = rawJson as Record<string, unknown>;

  if (obj.archiveType === 'single_class' && obj.classData && typeof obj.classData === 'object') {
    const cls = obj.classData as ClassData;
    if (!cls.id || !cls.name || !Array.isArray(cls.students) || !Array.isArray(cls.plates)) {
      return { ok: false, error: 'Archivio classe incompleto: mancano studenti o tavole.' };
    }
    return { ok: true, kind: 'single_class', archive: obj as unknown as SingleClassArchive };
  }

  if (obj.archiveType === 'full_backup' && Array.isArray(obj.classes)) {
    const validClasses = (obj.classes as ClassData[]).every(
      (c) => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.students)
    );
    if (!validClasses) {
      return { ok: false, error: 'Il backup completo contiene una o più classi non valide.' };
    }
    return { ok: true, kind: 'full_backup', archive: obj as unknown as FullBackupArchive };
  }

  return {
    ok: false,
    error: 'Formato archivio non riconosciuto. Selezionare un file esportato da TabScore.',
  };
}

export function exportClassToExcel(classData: ClassData): void {
  const wb = XLSX.utils.book_new();
  const sortedStudents = [...classData.students].sort((a, b) => a.order - b.order);
  const sortedPlates = sortPlates(classData.plates);

  // Sheet 1: Registro Valutazioni
  const headerRow1: string[] = ['N°', 'Cognome', 'Nome'];
  sortedPlates.forEach((p) => {
    headerRow1.push(`T${p.number} (${p.title}) - Stato`);
    headerRow1.push(`T${p.number} (${p.title}) - Voto`);
  });
  classData.folders.forEach((f) => {
    headerRow1.push(`${f.title} - Stato`);
    headerRow1.push(`${f.title} - Data Consegna`);
    headerRow1.push(`${f.title} - Voto Finale`);
  });

  const rowsSheet1: (string | number)[][] = [headerRow1];

  sortedStudents.forEach((stu, idx) => {
    const row: (string | number)[] = [idx + 1, stu.lastName, stu.firstName];
    const stuEvals = classData.evaluations[stu.id] ?? {};

    sortedPlates.forEach((p) => {
      const cell = stuEvals[p.id] ?? EMPTY_EVALUATION;
      const statusStr = cell.status
        ? cell.wasNo && cell.status === 'SI'
          ? 'SI (ex-NO)'
          : cell.status
        : '';
      row.push(statusStr);
      row.push(cell.grade !== null ? cell.grade : '');
    });

    classData.folders.forEach((f) => {
      const rec = classData.folderRecords[stu.id]?.[f.id] ?? EMPTY_FOLDER_RECORD;
      const calc = calculateFolderEvaluation(classData, stu.id, f);
      row.push(FOLDER_STATUS_META[rec.status].label);
      row.push(rec.actualDeliveryDate ? formatDateIt(rec.actualDeliveryDate) : '');
      row.push(calc.finalGrade !== null ? calc.finalGrade : '');
    });

    rowsSheet1.push(row);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(rowsSheet1);
  XLSX.utils.book_append_sheet(wb, ws1, 'Registro Valutazioni');

  // Sheet 2: Dettaglio Calcolo Cartelline
  const headerRow2 = [
    'Cartellina',
    'Intervallo Tavole',
    'Scadenza Prevista',
    'Studente',
    'Stato Consegna',
    'Data Effettiva',
    'Valutazione Confermata',
    'Voti Considerati',
    'Media Iniziale',
    'N° NO',
    'Penalità NO',
    'N° Mancanti',
    'Penalità Mancanti',
    'Giorni Ritardo (Manuali)',
    'Penalità Ritardo',
    'Voto Grezzo',
    'Voto Indicativo Calcolato',
    'Voto Finale Assegnato',
    'Voto Scala',
    'Annotazioni',
  ];

  const rowsSheet2: (string | number)[][] = [headerRow2];
  classData.folders.forEach((f) => {
    const interval = formatPlateInterval(f.plateIds, classData.plates);
    sortedStudents.forEach((stu) => {
      const rec = classData.folderRecords[stu.id]?.[f.id] ?? EMPTY_FOLDER_RECORD;
      const calc = calculateFolderEvaluation(classData, stu.id, f);
      rowsSheet2.push([
        f.title,
        interval,
        f.dueDate ? formatDateIt(f.dueDate) : '',
        `${stu.lastName} ${stu.firstName}`,
        FOLDER_STATUS_META[rec.status].label,
        rec.actualDeliveryDate ? formatDateIt(rec.actualDeliveryDate) : '',
        calc.isConfirmed ? 'Sì (bloccata)' : 'No (dinamica)',
        calc.gradedCount,
        calc.initialAverage !== null ? Number(calc.initialAverage.toFixed(2)) : '',
        calc.noCount,
        calc.penaltyNoTotal,
        calc.missingCount,
        calc.penaltyMissingTotal,
        calc.chargeableDelayDays,
        calc.penaltyDelayTotal,
        calc.rawFinalGrade !== null ? Number(calc.rawFinalGrade.toFixed(2)) : '',
        calc.suggestedFinalGrade !== null ? calc.suggestedFinalGrade : '',
        calc.finalGrade !== null ? calc.finalGrade : '',
        calc.finalGrade !== null ? formatGradeLabel(calc.finalGrade) : '',
        rec.notes || '',
      ]);
    });
  });

  const ws2 = XLSX.utils.aoa_to_sheet(rowsSheet2);
  XLSX.utils.book_append_sheet(wb, ws2, 'Dettaglio Cartelline');

  // Sheet 3: Elenco Tavole e Impostazioni
  const rowsSheet3: (string | number)[][] = [
    ['Classe', classData.name],
    ['Anno Scolastico', classData.schoolYear],
    [],
    ['PARAMETRI DI VALUTAZIONE CLASSE'],
    ['Penalità per ogni NO', formatDecimalIt(classData.settings.penaltyNo)],
    ['Penalità per tavola mancante', formatDecimalIt(classData.settings.penaltyMissing)],
    ['Penalità ritardo giornaliera', formatDecimalIt(classData.settings.penaltyLatePerDay)],
    ['Giorni di tolleranza', classData.settings.toleranceDays],
    ['Tavole indicative per cartellina', classData.settings.defaultPlatesPerFolder],
    ['Arrotondamento voto indicativo', ROUNDING_MODE_LABELS[classData.settings.roundingMode]],
    [],
    ['ELENCO TAVOLE'],
    ['N° Tavola', 'Titolo', 'Data Assegnazione', 'Data Controllo Prevista', 'Annotazioni'],
  ];

  sortedPlates.forEach((p) => {
    rowsSheet3.push([
      p.number,
      p.title,
      p.assignedDate ? formatDateIt(p.assignedDate) : '',
      p.dueDate ? formatDateIt(p.dueDate) : '',
      p.notes || '',
    ]);
  });

  const ws3 = XLSX.utils.aoa_to_sheet(rowsSheet3);
  XLSX.utils.book_append_sheet(wb, ws3, 'Tavole e Impostazioni');

  const safeName = classData.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_|_$/g, '');
  const datePart = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `registro_${safeName || 'classe'}_${datePart}.xlsx`);
}
