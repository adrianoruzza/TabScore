import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { Plate } from '../types/gradebook';
import {
  decodeTextBuffer,
  extractTextFromLegacyDoc,
  getExcelColLetter,
} from './studentImport';

export interface ParsedPlateCandidate {
  tempId: string;
  title: string;
  detectedNumber?: number;
  rawSource: string;
}

export interface PlateExcelColumnConfig {
  orientation: 'rows' | 'columns';
  titleCol: number;
  numberCol: number; // -1 means none / auto from title text
  hasHeader: boolean;
}

export interface PlateExcelSheetData {
  name: string;
  rows: string[][];
  maxCols: number;
  columnLabels: string[];
  detectedConfig: PlateExcelColumnConfig;
}

export type ParsedPlateImportDocument =
  | {
      ok: true;
      kind: 'excel';
      fileName: string;
      sheets: PlateExcelSheetData[];
      initialSheetIndex: number;
    }
  | {
      ok: true;
      kind: 'word' | 'txt';
      fileName: string;
      candidates: ParsedPlateCandidate[];
      unrecognizedLines: string[];
    }
  | {
      ok: false;
      error: string;
    };

export interface PreviewPlateRow extends ParsedPlateCandidate {
  isDuplicateInFile: boolean;
  isDuplicateInClass: boolean;
  selected: boolean;
  assignedNumber: number | null;
}

let plateTempSeq = 1;
export function nextPlateTempId(): string {
  plateTempSeq += 1;
  return `plt_imp_${Date.now().toString(36)}_${plateTempSeq}`;
}

export function normalizePlateTitleValue(value: string): string {
  return value
    .replace(/[\u00A0\u200B\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildPlateTitleDedupeKey(title: string): string {
  return normalizePlateTitleValue(title).toLowerCase();
}

const PLATE_HEADER_EXACT = new Set([
  'titolo',
  'titoli',
  'titolo tavola',
  'titolo della tavola',
  'titolo elaborato',
  'tavola',
  'tavole',
  'elenco tavole',
  'elenco delle tavole',
  'lista tavole',
  'programma tavole',
  'piano tavole',
  'descrizione',
  'argomento',
  'argomenti',
  'oggetto',
  'elaborato',
  'elaborati',
  'disegno',
  'disegni',
  'n',
  'n.',
  'n°',
  'nr',
  'nr.',
  'num',
  'num.',
  'numero',
  'numero tavola',
  'codice',
  'data',
  'data assegnazione',
  'data consegna',
  'scadenza',
  'note',
  'annotazioni',
  'osservazioni',
  'classe',
  'anno',
  'anno scolastico',
  'materia',
  'disciplina',
  'docente',
  'professore',
  'studente',
  'studenti',
  'alunno',
  'alunni',
  'cognome',
  'nome',
  'nominativo',
  'voto',
  'voti',
  'media',
  'media voti',
  'voto finale',
  'valutazione',
  'stato',
  'consegna',
  'ritardo',
  'penalita',
  'penalità',
  'cartellina',
  'assenza',
  'assenze',
  'si',
  'no',
  'ass',
  'wip',
  'n.c.',
]);

const NON_PLATE_COLUMN_HEADERS = [
  'voto',
  'media',
  'valutaz',
  'stato',
  'consegna',
  'scadenza',
  'data',
  'ritardo',
  'penalit',
  'cartellin',
  'cognom',
  'nome',
  'student',
  'alunn',
  'nominativ',
  'assenz',
  'email',
  'e-mail',
  'note',
  'annotaz',
];

const TITLE_COLUMN_HEADERS = [
  'titol',
  'descrizion',
  'argoment',
  'oggett',
  'elaborat',
  'disegn',
  'tavol',
  'esercizio',
  'tema',
];

const NUMBER_COLUMN_HEADERS = [
  'n°',
  'n.',
  'nr',
  'num',
  'numero',
  'cod',
  'id',
  'prog',
  'tav',
];

export function isLikelyPlateHeaderOrNoise(text: string): boolean {
  const clean = normalizePlateTitleValue(text).toLowerCase();
  if (!clean) return true;
  if (/^\d+(?:[.,]\d+)?$/.test(clean)) return true;
  if (/^[^\p{L}]+$/u.test(clean)) return true;
  if (clean.includes('@') && /\S+@\S+/.test(clean)) return true;
  // Dates like 12/10/2026 or 2026-10-12 or 12-nov
  if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(clean)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return true;
  if (/^\d{1,2}\s*[-/]\s*(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\.?$/i.test(clean)) {
    return true;
  }
  // Grade labels like 7+, 6½, 8-, 7,50
  if (/^(?:10|[2-9])(?:[+-]|½|[.,]\d{1,2})?$/.test(clean)) return true;
  // Bare plate code without title (e.g. "T1", "Tav. 3", "Tavola 12")
  if (/^(?:t|tav\.?|tavola)\s*0*\d{1,3}$/i.test(clean)) return true;

  const stripped = clean
    .replace(/[:;.,/()\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (PLATE_HEADER_EXACT.has(stripped)) return true;
  if (
    /^(?:elenco|lista|programma|piano|riepilogo|tabella)\s+(?:delle\s+)?tavole(?:\s+.*)?$/.test(
      stripped
    ) &&
    stripped.split(' ').length <= 5
  ) {
    return true;
  }
  if (/^(?:classe|a\.s\.|anno\s+scolastico)\s*[:.]?\s*\S+/i.test(clean) && clean.length <= 28) {
    return true;
  }
  return false;
}

/**
 * Extracts a standalone positive plate number from a number cell (e.g., "3", "03", "T3", "Tav. 03", "3)").
 */
export function parseStandalonePlateNumber(raw: string): number | undefined {
  const clean = normalizePlateTitleValue(raw);
  if (!clean) return undefined;
  const match =
    /^(?:(?:tavola|tav\.?|t|n°|n\.|nr\.?|num\.?|#)\s*)?0*(\d{1,3})\s*[.)°:-]?$/i.exec(
      clean
    );
  if (!match) return undefined;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n >= 1 && n <= 999 ? n : undefined;
}

/**
 * Parses a raw plate string, stripping leading bullets and progressive plate numbering
 * ("Tav. 1 - Proiezioni", "T02: Assonometria", "3. Sezioni", "4) Prospettiva", "- Retta")
 * while keeping numbers that are part of the actual title ("Assonometria 3D", "Scala 1:50").
 */
export function parseRawPlateEntry(
  rawText: string,
  explicitNumber?: number
): { title: string; detectedNumber?: number } | null {
  let working = normalizePlateTitleValue(rawText);
  if (!working) return null;

  // Strip leading checkboxes and bullet markers
  working = working.replace(/^(?:\[\s*[xX ]?\s*\]\s*)/, '');
  working = working.replace(/^[•●▪▫◦‣∙\-–—*►▸➤]+\s+/, '');
  working = normalizePlateTitleValue(working);
  if (!working) return null;

  let detectedNumber = explicitNumber;

  // 1. Explicit plate prefix: "Tav. 1 - ...", "Tavola 02: ...", "T03 – ...", "T4 ..."
  const explicitPrefix =
    /^(?:tavola|tav\.?|t)\s*0*(\d{1,3})(?:\s*(?:[-–—:.)|/°]+|\s+))\s*(.+)$/i.exec(
      working
    );
  if (explicitPrefix) {
    const parsedNum = Number.parseInt(explicitPrefix[1], 10);
    const rest = normalizePlateTitleValue(explicitPrefix[2]);
    if (rest && !isLikelyPlateHeaderOrNoise(rest)) {
      if (detectedNumber === undefined && parsedNum >= 1 && parsedNum <= 999) {
        detectedNumber = parsedNum;
      }
      return { title: rest, detectedNumber };
    }
  }

  // 2. Generic progressive numbering: "1. Titolo", "02) Titolo", "3 - Titolo", "N° 4: Titolo", "4) - Titolo"
  const genericNumPrefix =
    /^(?:(?:n°|n\.|nr\.?|#)\s*)?0*(\d{1,3})\s*(?:[.)°:\-–—/|]+)\s*(.+)$/i.exec(
      working
    );
  if (genericNumPrefix) {
    const parsedNum = Number.parseInt(genericNumPrefix[1], 10);
    const rest = normalizePlateTitleValue(genericNumPrefix[2]).replace(
      /^[-–—:]+\s*/,
      ''
    );
    if (rest && !isLikelyPlateHeaderOrNoise(rest)) {
      if (detectedNumber === undefined && parsedNum >= 1 && parsedNum <= 999) {
        detectedNumber = parsedNum;
      }
      return { title: rest, detectedNumber };
    }
  }

  // 3. Space-separated leading small progressive index before a capitalized/alphabetic title: "01 Proiezioni ortogonali"
  const spaceNumPrefix = /^0*(\d{1,2})\s+([\p{L}].+)$/u.exec(working);
  if (spaceNumPrefix) {
    const parsedNum = Number.parseInt(spaceNumPrefix[1], 10);
    const rest = normalizePlateTitleValue(spaceNumPrefix[2]);
    // Avoid stripping things like "3D modellazione" or "2 punti di fuga" unless it's clearly a list index
    if (
      rest &&
      !/^(?:d\b|punti\b|proiezioni\b|viste\b|sezioni\b|metodi\b|parti\b)/i.test(rest) &&
      !isLikelyPlateHeaderOrNoise(rest)
    ) {
      if (detectedNumber === undefined && parsedNum >= 1 && parsedNum <= 99) {
        detectedNumber = parsedNum;
      }
      return { title: rest, detectedNumber };
    }
  }

  if (isLikelyPlateHeaderOrNoise(working)) {
    return null;
  }

  return { title: working, detectedNumber };
}

function isHeaderTextForPlates(cell: string): boolean {
  const lower = normalizePlateTitleValue(cell).toLowerCase();
  if (!lower) return false;
  if (PLATE_HEADER_EXACT.has(lower.replace(/[:;.,/()\-–—]/g, ' ').replace(/\s+/g, ' ').trim())) {
    return true;
  }
  return (
    TITLE_COLUMN_HEADERS.some((k) => lower.includes(k)) ||
    NUMBER_COLUMN_HEADERS.some((k) => lower === k || lower.startsWith(`${k} `)) ||
    NON_PLATE_COLUMN_HEADERS.some((k) => lower.includes(k))
  );
}

function scoreTitleColumnValues(values: string[]): number {
  if (values.length === 0) return -100;
  let validTitleCount = 0;
  let totalLen = 0;
  let numericOrNoise = 0;
  for (const val of values) {
    if (parseStandalonePlateNumber(val) !== undefined || isLikelyPlateHeaderOrNoise(val)) {
      numericOrNoise += 1;
      continue;
    }
    const parsed = parseRawPlateEntry(val);
    if (parsed && parsed.title.length >= 2) {
      validTitleCount += 1;
      totalLen += Math.min(parsed.title.length, 60);
    } else {
      numericOrNoise += 1;
    }
  }
  const ratio = validTitleCount / values.length;
  const avgLen = validTitleCount > 0 ? totalLen / validTitleCount : 0;
  return validTitleCount * 10 + ratio * 25 + Math.min(avgLen, 35) * 0.4 - numericOrNoise * 3;
}

function scoreNumberColumnValues(values: string[]): number {
  if (values.length === 0) return -100;
  let numCount = 0;
  for (const val of values) {
    if (parseStandalonePlateNumber(val) !== undefined) {
      numCount += 1;
    }
  }
  const ratio = numCount / values.length;
  return ratio >= 0.65 && numCount >= 1 ? ratio * 50 + numCount : -100;
}

function detectPlateExcelSheetConfig(
  rows: string[][],
  maxCols: number
): PlateExcelColumnConfig {
  const nonEmptyRows = rows.filter((r) =>
    r.some((cell) => normalizePlateTitleValue(cell) !== '')
  );
  if (nonEmptyRows.length === 0) {
    return { orientation: 'rows', titleCol: 0, numberCol: -1, hasHeader: false };
  }

  // Check if the sheet is a single horizontal row (or 2 rows: numbers + titles) of plate titles
  if (nonEmptyRows.length <= 2 && maxCols >= 3) {
    const row0Titles = nonEmptyRows[0]
      .map((c) => parseRawPlateEntry(c))
      .filter(Boolean).length;
    const row1Titles =
      nonEmptyRows[1]
        ?.map((c) => parseRawPlateEntry(c))
        .filter(Boolean).length ?? 0;
    const row0HasHeaders = nonEmptyRows[0].filter((c) => isHeaderTextForPlates(c)).length;
    if (
      (row0Titles >= 2 && row0HasHeaders < 2) ||
      (nonEmptyRows.length === 2 && row1Titles >= 2 && row0Titles < 2)
    ) {
      return {
        orientation: 'columns',
        titleCol: 0,
        numberCol: -1,
        hasHeader: false,
      };
    }
  }

  const firstRow = nonEmptyRows[0] ?? [];
  let headerTitleCol = -1;
  let headerNumberCol = -1;
  let headerHits = 0;

  firstRow.forEach((cell, cIdx) => {
    const lower = normalizePlateTitleValue(cell).toLowerCase();
    if (!lower) return;
    const isNonPlate = NON_PLATE_COLUMN_HEADERS.some((k) => lower.includes(k));
    if (isHeaderTextForPlates(lower)) {
      headerHits += 1;
    }
    if (
      !isNonPlate &&
      headerTitleCol === -1 &&
      TITLE_COLUMN_HEADERS.some((k) => lower.includes(k)) &&
      !/^(?:n\.?|n°|nr\.?|num(?:ero)?)\s*tavol/i.test(lower)
    ) {
      headerTitleCol = cIdx;
    } else if (
      headerNumberCol === -1 &&
      (NUMBER_COLUMN_HEADERS.some((k) => lower === k || lower.startsWith(`${k} `)) ||
        /^(?:n\.?|n°|nr\.?|num(?:ero)?)\s*tavol/i.test(lower))
    ) {
      headerNumberCol = cIdx;
    }
  });

  const hasHeader =
    headerTitleCol >= 0 ||
    headerNumberCol >= 0 ||
    (headerHits >= 2 && nonEmptyRows.length >= 2) ||
    (nonEmptyRows.length >= 2 &&
      firstRow.filter((c) => normalizePlateTitleValue(c) !== '').length === 1 &&
      isHeaderTextForPlates(firstRow.find((c) => normalizePlateTitleValue(c) !== '') ?? ''));

  const dataSample = nonEmptyRows.slice(hasHeader ? 1 : 0, 25);

  // Validate headerTitleCol doesn't actually contain pure numbers (e.g. header "Tavola" with values "1, 2, 3")
  if (headerTitleCol >= 0 && dataSample.length > 0) {
    const vals = dataSample
      .map((r) => normalizePlateTitleValue(r[headerTitleCol] ?? ''))
      .filter(Boolean);
    if (scoreNumberColumnValues(vals) > 0 && scoreTitleColumnValues(vals) < 10) {
      if (headerNumberCol === -1) headerNumberCol = headerTitleCol;
      headerTitleCol = -1;
    }
  }

  let bestTitleCol = headerTitleCol;
  if (bestTitleCol === -1) {
    let bestScore = -Infinity;
    for (let c = 0; c < maxCols; c++) {
      if (c === headerNumberCol) continue;
      const headerCell = hasHeader ? normalizePlateTitleValue(firstRow[c] ?? '').toLowerCase() : '';
      if (headerCell && NON_PLATE_COLUMN_HEADERS.some((k) => headerCell.includes(k))) {
        continue;
      }
      const vals = dataSample
        .map((r) => normalizePlateTitleValue(r[c] ?? ''))
        .filter(Boolean);
      const score = scoreTitleColumnValues(vals);
      if (score > bestScore) {
        bestScore = score;
        bestTitleCol = c;
      }
    }
    if (bestTitleCol === -1) bestTitleCol = 0;
  }

  let bestNumberCol = headerNumberCol;
  if (bestNumberCol === -1 && maxCols >= 2) {
    let bestNumScore = 0;
    for (let c = 0; c < maxCols; c++) {
      if (c === bestTitleCol) continue;
      const headerCell = hasHeader ? normalizePlateTitleValue(firstRow[c] ?? '').toLowerCase() : '';
      if (headerCell && NON_PLATE_COLUMN_HEADERS.some((k) => headerCell.includes(k))) {
        continue;
      }
      const vals = dataSample
        .map((r) => normalizePlateTitleValue(r[c] ?? ''))
        .filter(Boolean);
      const score = scoreNumberColumnValues(vals);
      if (score > bestNumScore) {
        bestNumScore = score;
        bestNumberCol = c;
      }
    }
  }

  return {
    orientation: 'rows',
    titleCol: Math.max(0, bestTitleCol),
    numberCol: bestNumberCol === bestTitleCol ? -1 : bestNumberCol,
    hasHeader,
  };
}

export function extractPlateCandidatesFromExcelSheet(
  sheet: PlateExcelSheetData,
  config: PlateExcelColumnConfig
): { candidates: ParsedPlateCandidate[]; unrecognizedCount: number } {
  const candidates: ParsedPlateCandidate[] = [];
  let unrecognizedCount = 0;

  if (config.orientation === 'columns') {
    const nonEmptyRows = sheet.rows.filter((r) =>
      r.some((c) => normalizePlateTitleValue(c) !== '')
    );
    if (nonEmptyRows.length === 0) return { candidates, unrecognizedCount };

    // If 2 rows and first row is mostly numbers, pair row 0 numbers with row 1 titles
    let numberRow: string[] | null = null;
    let titleRow: string[] = nonEmptyRows[0];
    if (nonEmptyRows.length >= 2) {
      const r0Nums = nonEmptyRows[0].filter(
        (c) => parseStandalonePlateNumber(c) !== undefined
      ).length;
      const r1Titles = nonEmptyRows[1].filter(
        (c) => parseRawPlateEntry(c) !== null
      ).length;
      if (r0Nums >= 2 && r1Titles >= 2) {
        numberRow = nonEmptyRows[0];
        titleRow = nonEmptyRows[1];
      }
    }

    for (let c = 0; c < titleRow.length; c++) {
      const rawCell = normalizePlateTitleValue(titleRow[c] ?? '');
      if (!rawCell) continue;
      const explicitNum = numberRow
        ? parseStandalonePlateNumber(numberRow[c] ?? '')
        : undefined;
      const parsed = parseRawPlateEntry(rawCell, explicitNum);
      if (parsed) {
        candidates.push({
          tempId: nextPlateTempId(),
          title: parsed.title,
          ...(parsed.detectedNumber !== undefined
            ? { detectedNumber: parsed.detectedNumber }
            : {}),
          rawSource: rawCell,
        });
      } else {
        unrecognizedCount += 1;
      }
    }
    return { candidates, unrecognizedCount };
  }

  let skippedHeader = false;
  for (const row of sheet.rows) {
    const nonEmpty = row.some((c) => normalizePlateTitleValue(c) !== '');
    if (!nonEmpty) continue;

    if (config.hasHeader && !skippedHeader) {
      skippedHeader = true;
      continue;
    }

    const rawTitle = normalizePlateTitleValue(row[config.titleCol] ?? '');
    if (!rawTitle) continue;

    const rawNum =
      config.numberCol >= 0
        ? normalizePlateTitleValue(row[config.numberCol] ?? '')
        : '';
    const explicitNum = rawNum ? parseStandalonePlateNumber(rawNum) : undefined;
    const parsed = parseRawPlateEntry(rawTitle, explicitNum);

    if (parsed) {
      candidates.push({
        tempId: nextPlateTempId(),
        title: parsed.title,
        ...(parsed.detectedNumber !== undefined
          ? { detectedNumber: parsed.detectedNumber }
          : {}),
        rawSource: rawNum ? `${rawNum} | ${rawTitle}` : rawTitle,
      });
    } else if (!isHeaderTextForPlates(rawTitle)) {
      unrecognizedCount += 1;
    }
  }

  return { candidates, unrecognizedCount };
}

function extractCandidatesFromTableMatrix(
  matrix: string[][]
): { candidates: ParsedPlateCandidate[]; unrecognizedLines: string[] } {
  const maxCols = Math.max(1, ...matrix.map((r) => r.length));
  const sheetData: PlateExcelSheetData = {
    name: 'Tabella',
    rows: matrix,
    maxCols,
    columnLabels: [],
    detectedConfig: detectPlateExcelSheetConfig(matrix, maxCols),
  };
  const { candidates } = extractPlateCandidatesFromExcelSheet(
    sheetData,
    sheetData.detectedConfig
  );
  return { candidates, unrecognizedLines: [] };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  );
}

/**
 * Extracts plate titles from mammoth-generated HTML while preserving original document order
 * across paragraphs, bulleted/numbered lists, and Word tables.
 * Uses DOMParser in the browser and falls back cleanly in Node test environments.
 */
export function parseDocxHtmlPlates(html: string): {
  candidates: ParsedPlateCandidate[];
  unrecognizedLines: string[];
} {
  const candidates: ParsedPlateCandidate[] = [];
  const unrecognizedLines: string[] = [];

  const pushTextLine = (line: string) => {
    const trimmed = normalizePlateTitleValue(line);
    if (!trimmed) return;
    const parsed = parseRawPlateEntry(trimmed);
    if (parsed) {
      candidates.push({
        tempId: nextPlateTempId(),
        title: parsed.title,
        ...(parsed.detectedNumber !== undefined
          ? { detectedNumber: parsed.detectedNumber }
          : {}),
        rawSource: trimmed,
      });
    } else if (!/^\d+$/.test(trimmed)) {
      unrecognizedLines.push(trimmed);
    }
  };

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'table') {
          const rows = Array.from(child.querySelectorAll('tr')).map((tr) =>
            Array.from(tr.querySelectorAll('th, td')).map((cell) =>
              normalizePlateTitleValue(cell.textContent ?? '')
            )
          );
          const { candidates: tableCands } = extractCandidatesFromTableMatrix(rows);
          candidates.push(...tableCands);
        } else if (tag === 'ul' || tag === 'ol') {
          const items = Array.from(child.querySelectorAll(':scope > li'));
          items.forEach((li, liIdx) => {
            const clone = li.cloneNode(true) as HTMLElement;
            // Remove nested lists before reading direct item text
            clone.querySelectorAll('ul, ol').forEach((n) => n.remove());
            clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
            const lines = (clone.textContent ?? '').split(/\n/);
            for (const line of lines) {
              const trimmed = normalizePlateTitleValue(line);
              if (!trimmed) continue;
              const explicit = tag === 'ol' ? liIdx + 1 : undefined;
              const parsed = parseRawPlateEntry(trimmed, explicit);
              if (parsed) {
                candidates.push({
                  tempId: nextPlateTempId(),
                  title: parsed.title,
                  ...(parsed.detectedNumber !== undefined
                    ? { detectedNumber: parsed.detectedNumber }
                    : {}),
                  rawSource: trimmed,
                });
              } else if (!/^\d+$/.test(trimmed)) {
                unrecognizedLines.push(trimmed);
              }
            }
            // Also process nested lists if present
            const nestedLists = Array.from(li.querySelectorAll(':scope > ul, :scope > ol'));
            for (const nested of nestedLists) {
              walk(nested);
            }
          });
        } else if (
          tag === 'p' ||
          tag === 'h1' ||
          tag === 'h2' ||
          tag === 'h3' ||
          tag === 'h4'
        ) {
          const clone = child.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
          const lines = (clone.textContent ?? '').split(/\n/);
          for (const line of lines) {
            pushTextLine(line);
          }
        } else {
          walk(child);
        }
      }
    };

    walk(doc.body);
    return { candidates, unrecognizedLines };
  }

  // Fallback parser for non-DOM environments (e.g. Node unit tests)
  const blockRegex =
    /<(table|ol|ul|p|h[1-4])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[2];
    if (tag === 'table') {
      const matrix: string[][] = [];
      const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch: RegExpExecArray | null;
      while ((trMatch = trRegex.exec(inner)) !== null) {
        const row: string[] = [];
        const cellRegex = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
          row.push(normalizePlateTitleValue(stripHtmlTags(cellMatch[1])));
        }
        if (row.length > 0) matrix.push(row);
      }
      const { candidates: tableCands } = extractCandidatesFromTableMatrix(matrix);
      candidates.push(...tableCands);
    } else if (tag === 'ol' || tag === 'ul') {
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      let liIdx = 0;
      while ((liMatch = liRegex.exec(inner)) !== null) {
        liIdx += 1;
        const lines = stripHtmlTags(liMatch[1]).split(/\n/);
        for (const line of lines) {
          const trimmed = normalizePlateTitleValue(line);
          if (!trimmed) continue;
          const parsed = parseRawPlateEntry(
            trimmed,
            tag === 'ol' ? liIdx : undefined
          );
          if (parsed) {
            candidates.push({
              tempId: nextPlateTempId(),
              title: parsed.title,
              ...(parsed.detectedNumber !== undefined
                ? { detectedNumber: parsed.detectedNumber }
                : {}),
              rawSource: trimmed,
            });
          } else if (!/^\d+$/.test(trimmed)) {
            unrecognizedLines.push(trimmed);
          }
        }
      }
    } else {
      const lines = stripHtmlTags(inner).split(/\n/);
      for (const line of lines) {
        pushTextLine(line);
      }
    }
  }

  return { candidates, unrecognizedLines };
}

/**
 * Parses plain text (.txt) or legacy .doc extracted lines into plate candidates.
 * Supports newline lists, numbered/bulleted lists, tabular lines (tab/semicolon/pipe),
 * and multi-item delimited single lines.
 */
export function parseTextPlates(text: string): {
  candidates: ParsedPlateCandidate[];
  unrecognizedLines: string[];
} {
  const rawLines = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .split(/\r\n|\r|\n/);

  const nonEmptyLines = rawLines
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Check if the document is consistently tabular (tab, semicolon, or pipe columns across multiple rows)
  for (const sep of ['\t', ';', '|'] as const) {
    const splitLines = nonEmptyLines.map((l) =>
      l.split(sep).map((c) => normalizePlateTitleValue(c))
    );
    const multiColRows = splitLines.filter((cols) => cols.length >= 2);
    if (
      multiColRows.length >= 2 &&
      multiColRows.length >= nonEmptyLines.length * 0.6
    ) {
      // Distinguish "tabular columns (e.g. N° ; Titolo ; Data)" vs "single-line list of titles (Titolo 1; Titolo 2; Titolo 3)"
      const firstRowHasHeader = splitLines[0].some((c) =>
        isHeaderTextForPlates(c)
      );
      const firstColIsNumeric =
        multiColRows.filter(
          (cols) => parseStandalonePlateNumber(cols[0] ?? '') !== undefined
        ).length >=
        multiColRows.length * 0.6;
      const hasDateOrGradeColumn =
        multiColRows[0].length >= 2 &&
        multiColRows.some((cols) =>
          cols.slice(1).some((c) => isLikelyPlateHeaderOrNoise(c))
        );

      if (firstRowHasHeader || firstColIsNumeric || hasDateOrGradeColumn) {
        return extractCandidatesFromTableMatrix(splitLines);
      }
    }
  }

  const candidates: ParsedPlateCandidate[] = [];
  const unrecognizedLines: string[] = [];

  for (const line of nonEmptyLines) {
    // Handle single-line delimited lists like "Proiezioni ortogonali; Assonometria; Prospettiva"
    const sepMatch = line.includes(';')
      ? ';'
      : line.includes('|')
      ? '|'
      : line.includes('\t')
      ? '\t'
      : null;

    if (sepMatch) {
      const parts = line
        .split(sepMatch)
        .map((p) => normalizePlateTitleValue(p))
        .filter(Boolean);

      // Pair like "T1 | Proiezioni ortogonali" or "1 ; Proiezioni ortogonali"
      if (parts.length >= 2 && parseStandalonePlateNumber(parts[0]) !== undefined) {
        const num = parseStandalonePlateNumber(parts[0]);
        const titlePart = parts.slice(1).find((p) => !isLikelyPlateHeaderOrNoise(p));
        if (titlePart) {
          const parsed = parseRawPlateEntry(titlePart, num);
          if (parsed) {
            candidates.push({
              tempId: nextPlateTempId(),
              title: parsed.title,
              ...(parsed.detectedNumber !== undefined
                ? { detectedNumber: parsed.detectedNumber }
                : {}),
              rawSource: line,
            });
            continue;
          }
        }
      }

      // Multiple independent plate titles on the same line
      if (parts.length >= 2) {
        const validParts = parts
          .map((p) => parseRawPlateEntry(p))
          .filter((p): p is { title: string; detectedNumber?: number } => p !== null);
        if (validParts.length >= 2) {
          for (const vp of validParts) {
            candidates.push({
              tempId: nextPlateTempId(),
              title: vp.title,
              ...(vp.detectedNumber !== undefined
                ? { detectedNumber: vp.detectedNumber }
                : {}),
              rawSource: line,
            });
          }
          continue;
        }
      }
    }

    const parsed = parseRawPlateEntry(line);
    if (parsed) {
      candidates.push({
        tempId: nextPlateTempId(),
        title: parsed.title,
        ...(parsed.detectedNumber !== undefined
          ? { detectedNumber: parsed.detectedNumber }
          : {}),
        rawSource: line,
      });
    } else if (!/^\d+$/.test(line)) {
      unrecognizedLines.push(line);
    }
  }

  return { candidates, unrecognizedLines };
}

export async function parsePlateImportFile(
  file: File
): Promise<ParsedPlateImportDocument> {
  const fileName = file.name;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (file.size === 0) {
    return { ok: false, error: 'Il file selezionato è vuoto.' };
  }

  try {
    if (ext === 'xlsx' || ext === 'xls') {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        return {
          ok: false,
          error: 'Il file Excel non contiene alcun foglio di lavoro leggibile.',
        };
      }

      const sheets: PlateExcelSheetData[] = workbook.SheetNames.map((sheetName) => {
        const ws = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          raw: false,
          defval: '',
        });
        const rows = rawRows.map((r) =>
          Array.isArray(r) ? r.map((cell) => String(cell ?? '').trim()) : []
        );
        const maxCols = Math.max(
          1,
          ...rows.slice(0, 60).map((r) => r.length)
        );
        const firstNonEmptyRow =
          rows.find((r) => r.some((c) => normalizePlateTitleValue(c) !== '')) ?? [];
        const columnLabels = Array.from({ length: maxCols }, (_, i) => {
          const sample = firstNonEmptyRow[i]
            ? ` — "${firstNonEmptyRow[i].slice(0, 22)}"`
            : '';
          return `Colonna ${getExcelColLetter(i)}${sample}`;
        });
        return {
          name: sheetName,
          rows,
          maxCols,
          columnLabels,
          detectedConfig: detectPlateExcelSheetConfig(rows, maxCols),
        };
      });

      const hasAnyContent = sheets.some((s) =>
        s.rows.some((r) => r.some((c) => normalizePlateTitleValue(c) !== ''))
      );
      if (!hasAnyContent) {
        return {
          ok: false,
          error: 'Il file Excel selezionato non contiene dati.',
        };
      }

      // Prefer the first sheet that yields valid plate candidates
      let initialSheetIndex = sheets.findIndex((s) => {
        const { candidates } = extractPlateCandidatesFromExcelSheet(
          s,
          s.detectedConfig
        );
        return candidates.length > 0;
      });
      if (initialSheetIndex === -1) {
        initialSheetIndex = Math.max(
          0,
          sheets.findIndex((s) =>
            s.rows.some((r) => r.some((c) => normalizePlateTitleValue(c) !== ''))
          )
        );
      }

      return {
        ok: true,
        kind: 'excel',
        fileName,
        sheets,
        initialSheetIndex,
      };
    }

    if (ext === 'docx') {
      const buffer = await file.arrayBuffer();
      const nodeBufferCtor =
        typeof window === 'undefined'
          ? (
              globalThis as {
                Buffer?: { from(input: ArrayBuffer): unknown };
              }
            ).Buffer
          : undefined;
      const mammothInput = nodeBufferCtor
        ? ({ buffer: nodeBufferCtor.from(buffer) } as unknown as {
            arrayBuffer: ArrayBuffer;
          })
        : { arrayBuffer: buffer };
      const result = await mammoth.convertToHtml(mammothInput);
      const { candidates, unrecognizedLines } = parseDocxHtmlPlates(
        result.value || ''
      );
      if (candidates.length === 0) {
        return {
          ok: false,
          error:
            'Nessun titolo di tavola valido individuato nel documento Word (.docx).',
        };
      }
      return {
        ok: true,
        kind: 'word',
        fileName,
        candidates,
        unrecognizedLines,
      };
    }

    if (ext === 'doc') {
      const buffer = await file.arrayBuffer();
      const rawText = extractTextFromLegacyDoc(buffer);
      const { candidates, unrecognizedLines } = parseTextPlates(rawText);
      if (candidates.length === 0) {
        return {
          ok: false,
          error:
            'Nessun titolo di tavola valido individuato nel file Word (.doc). Se il file usa un formato obsoleto o protetto, salvalo in .docx o .txt.',
        };
      }
      return {
        ok: true,
        kind: 'word',
        fileName,
        candidates,
        unrecognizedLines,
      };
    }

    if (ext === 'txt') {
      const buffer = await file.arrayBuffer();
      const text = decodeTextBuffer(buffer);
      if (!text.trim()) {
        return { ok: false, error: 'Il file di testo (.txt) è vuoto.' };
      }
      const { candidates, unrecognizedLines } = parseTextPlates(text);
      if (candidates.length === 0) {
        return {
          ok: false,
          error:
            'Nessun titolo di tavola valido riconosciuto nel file di testo (.txt).',
        };
      }
      return {
        ok: true,
        kind: 'txt',
        fileName,
        candidates,
        unrecognizedLines,
      };
    }

    return {
      ok: false,
      error:
        'Formato file non supportato. Seleziona un file Excel (.xlsx, .xls), Word (.docx, .doc) o Testo (.txt).',
    };
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Errore durante la lettura locale del file. Verifica che il documento non sia danneggiato o protetto.';
    return { ok: false, error: message };
  }
}

/**
 * Computes preview rows with duplicate flagging and live TabScore progressive `TXX` numbering.
 * Preserves the exact order of `candidates` (no alphabetical sorting).
 */
export function buildPlatePreviewRows(
  candidates: ParsedPlateCandidate[],
  existingPlates: Plate[],
  mode: 'append' | 'replace',
  previousSelection?: Map<string, boolean>
): PreviewPlateRow[] {
  const existingKeys = new Set(
    mode === 'append'
      ? existingPlates.map((p) => buildPlateTitleDedupeKey(p.title))
      : []
  );
  const seenInFile = new Set<string>();

  const usedNumbers = new Set<number>(
    mode === 'append' ? existingPlates.map((p) => p.number) : []
  );
  let nextSequential =
    mode === 'append' && existingPlates.length > 0
      ? Math.max(...existingPlates.map((p) => p.number)) + 1
      : 1;

  const allocNextFreeNumber = (preferred?: number): number => {
    if (
      preferred !== undefined &&
      Number.isInteger(preferred) &&
      preferred >= 1 &&
      !usedNumbers.has(preferred)
    ) {
      usedNumbers.add(preferred);
      if (preferred >= nextSequential) {
        nextSequential = preferred + 1;
      }
      return preferred;
    }
    while (usedNumbers.has(nextSequential)) {
      nextSequential += 1;
    }
    const assigned = nextSequential;
    usedNumbers.add(assigned);
    nextSequential += 1;
    return assigned;
  };

  return candidates.map((cand) => {
    const cleanTitle = normalizePlateTitleValue(cand.title);
    const key = buildPlateTitleDedupeKey(cleanTitle);
    const hasTitle = cleanTitle !== '';
    const isDuplicateInClass = hasTitle && existingKeys.has(key);
    const isDuplicateInFile = hasTitle && !isDuplicateInClass && seenInFile.has(key);
    if (hasTitle) seenInFile.add(key);

    const prevChecked = previousSelection?.get(cand.tempId);
    const selected =
      !hasTitle || isDuplicateInClass || isDuplicateInFile
        ? false
        : prevChecked !== undefined
        ? prevChecked
        : true;

    const assignedNumber = selected
      ? allocNextFreeNumber(cand.detectedNumber)
      : null;

    return {
      ...cand,
      isDuplicateInFile,
      isDuplicateInClass,
      selected,
      assignedNumber,
    };
  });
}
