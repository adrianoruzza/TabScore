export type PlateStatus = 'ASS' | 'SI' | 'NO' | 'WIP';

export type RoundingMode = 'none' | 'quarter' | 'half' | 'integer';

export type FolderDeliveryStatus =
  | 'da_consegnare'
  | 'consegnata'
  | 'consegnata_ritardo'
  | 'non_consegnata';

export interface ClassSettings {
  penaltyNo: number;
  penaltyMissing: number;
  penaltyLatePerDay: number;
  toleranceDays: number;
  defaultPlatesPerFolder: number;
  roundingMode: RoundingMode;
}

export type StudentSupportTag = 'DSA' | 'BES' | 'H';

export interface StudentTransferPlateSnapshot {
  plateId: string;
  plateNumber: number;
  plateTitle: string;
  status: PlateStatus | null;
  grade: number | null;
  wasNo: boolean;
}

export interface StudentTransferFolderSnapshot {
  folderId: string;
  folderTitle: string;
  status: FolderDeliveryStatus;
  actualDeliveryDate: string;
  manualDelayDays: number;
  finalGrade: number | null;
  isConfirmed: boolean;
}

export interface StudentTransferRecord {
  id: string;
  fromClassId: string;
  fromClassName: string;
  toClassId: string;
  toClassName: string;
  movedAt: string;
  plates: StudentTransferPlateSnapshot[];
  folders: StudentTransferFolderSnapshot[];
}

export interface ArchivedStudentHistory {
  studentId: string;
  lastName: string;
  firstName: string;
  supportNeeds?: StudentSupportTag[];
  exemptFromPenalties?: boolean;
  movedAt: string;
  toClassId: string;
  toClassName: string;
  evaluations: Record<string, PlateEvaluation>;
  folderRecords: Record<string, FolderStudentRecord>;
}

export interface Student {
  id: string;
  lastName: string;
  firstName: string;
  order: number;
  supportNeeds?: StudentSupportTag[];
  exemptFromPenalties?: boolean;
  transferHistory?: StudentTransferRecord[];
}

export interface Plate {
  id: string;
  number: number;
  order?: number;
  title: string;
  assignedDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  notes: string;
  imageDataUrl?: string;
  imageName?: string;
}

export interface PlateEvaluation {
  status: PlateStatus | null;
  grade: number | null;
  wasNo: boolean;
}

export interface FolderDelivery {
  id: string;
  title: string;
  dueDate: string; // YYYY-MM-DD
  plateIds: string[];
  notes: string;
}

export interface FolderPlateBreakdownItem {
  plateId: string;
  plateNumber: number;
  plateTitle: string;
  status: PlateStatus | null;
  grade: number | null;
  wasNo: boolean;
  countsAsNo: boolean;
  countsAsMissing: boolean;
  isExtraMissing: boolean;
}

export interface FolderCalculationBreakdown {
  initialAverage: number | null;
  gradedCount: number;
  totalPlatesCount: number;
  noCount: number;
  penaltyNoTotal: number;
  missingCount: number;
  penaltyMissingTotal: number;
  rawDelayDays: number;
  chargeableDelayDays: number;
  penaltyDelayTotal: number;
  rawFinalGrade: number | null;
  clampedGrade: number | null;
  suggestedFinalGrade: number | null;
  finalGrade: number | null;
  plateItems: FolderPlateBreakdownItem[];
  settingsUsed: ClassSettings;
  isConfirmed: boolean;
  confirmedAt: string | null;
  isManualOverride?: boolean;
  isPenaltyExempt?: boolean;
}

export interface FolderStudentRecord {
  actualDeliveryDate: string; // YYYY-MM-DD or ''
  manualDelayDays?: number;
  manualFinalGrade?: number | null;
  manualGradeOverridden?: boolean;
  status: FolderDeliveryStatus;
  notes: string;
  extraMissingPlateIds: string[];
  confirmedSnapshot: FolderCalculationBreakdown | null;
}

export interface ClassData {
  id: string;
  name: string;
  schoolYear: string;
  order?: number;
  color?: string;
  subject?: string;
  createdAt: string;
  updatedAt: string;
  settings: ClassSettings;
  students: Student[];
  plates: Plate[];
  /** evaluations[studentId][plateId] */
  evaluations: Record<string, Record<string, PlateEvaluation>>;
  folders: FolderDelivery[];
  /** folderRecords[studentId][folderId] */
  folderRecords: Record<string, Record<string, FolderStudentRecord>>;
  /** Preserved evaluations/folder records for students transferred to another class */
  archivedStudentHistories?: ArchivedStudentHistory[];
}

export type AuditCategory =
  | 'classe'
  | 'studente'
  | 'tavola'
  | 'valutazione'
  | 'cartellina'
  | 'impostazioni'
  | 'archivio';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  classId: string | null;
  className: string;
  category: AuditCategory;
  action: string;
  details: string;
}

export interface GradebookStoreState {
  version: number;
  activeClassId: string | null;
  classes: ClassData[];
  auditLog: AuditLogEntry[];
}

export interface SingleClassArchive {
  archiveType: 'single_class';
  version: number;
  exportedAt: string;
  classData: ClassData;
  classAuditLog: AuditLogEntry[];
}

export interface FullBackupArchive {
  archiveType: 'full_backup';
  version: number;
  exportedAt: string;
  classes: ClassData[];
  auditLog: AuditLogEntry[];
}
