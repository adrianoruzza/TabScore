import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { Student } from '../types/gradebook';

export type ImportNameOrder = 'last_first' | 'first_last';

export interface ParsedStudentCandidate {
  tempId: string;
  lastName: string;
  firstName: string;
  rawSource: string;
}

export interface ExcelColumnConfig {
  mode: 'two_columns' | 'single_column';
  lastNameCol: number;
  firstNameCol: number;
  fullNameCol: number;
  hasHeader: boolean;
  nameOrder: ImportNameOrder;
}

export interface ExcelSheetData {
  name: string;
  rows: string[][];
  maxCols: number;
  columnLabels: string[];
  detectedConfig: ExcelColumnConfig;
}

export type ParsedImportDocument =
  | {
      ok: true;
      kind: 'excel';
      fileName: string;
      sheets: ExcelSheetData[];
      initialSheetIndex: number;
    }
  | {
      ok: true;
      kind: 'word' | 'txt';
      fileName: string;
      rawEntries: Array<{
        text?: string;
        pair?: { lastName: string; firstName: string };
        rawSource: string;
      }>;
      unrecognizedLines: string[];
      defaultOrder: ImportNameOrder;
    }
  | {
      ok: false;
      error: string;
    };

export interface PreviewStudentRow extends ParsedStudentCandidate {
  isDuplicateInFile: boolean;
  isDuplicateInClass: boolean;
  selected: boolean;
}

const COMPOUND_SURNAME_PARTICLES = new Set([
  'da',
  'dal',
  'dalla',
  'dalle',
  'dalli',
  'dallo',
  'de',
  'degli',
  'dei',
  'del',
  'dell',
  'della',
  'delle',
  'delli',
  'dello',
  'di',
  'do',
  'don',
  'dos',
  'du',
  'la',
  'le',
  'li',
  'lo',
  'mac',
  'mc',
  'san',
  'santa',
  'santo',
  'van',
  'von',
]);

const HEADER_KEYWORDS = [
  'cognome',
  'nome',
  'nominativo',
  'studente',
  'studenti',
  'alunno',
  'alunni',
  'allievo',
  'allievi',
  'elenco',
  'classe',
  'numero',
  'n°',
  'nr',
  'matricola',
  'email',
  'e-mail',
  'last name',
  'first name',
  'surname',
  'student',
];

let tempSeq = 1;
function nextTempId(): string {
  tempSeq += 1;
  return `imp_${Date.now().toString(36)}_${tempSeq}`;
}

export function normalizeNameValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildStudentDedupeKey(lastName: string, firstName: string): string {
  const ln = normalizeNameValue(lastName).toLowerCase();
  const fn = normalizeNameValue(firstName).toLowerCase();
  return `${ln}::${fn}`;
}

export function cleanLeadingListMarkers(line: string): string {
  let cleaned = line.replace(/[\u00A0\u200B\uFEFF]/g, ' ').trim();
  // Remove numbering like "1.", "1)", "01 -", "12:", bullets "-", "•", "*"
  cleaned = cleaned.replace(/^(?:\[\s*[xX ]?\s*\]\s*)/, '');
  cleaned = cleaned.replace(/^(?:\d{1,3}\s*[.)°:\-–]\s+)/, '');
  cleaned = cleaned.replace(/^[•●▪▫◦‣∙\-–—*]+\s+/, '');
  return normalizeNameValue(cleaned);
}

export function isLikelyNoiseOrHeader(text: string): boolean {
  const clean = normalizeNameValue(text).toLowerCase();
  if (!clean) return true;
  if (/^\d+$/.test(clean)) return true;
  if (/^[^\p{L}]+$/u.test(clean)) return true;
  if (clean.includes('@')) return true;
  if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(clean)) return true;

  const stripped = clean.replace(/[:;.,/()\-]/g, ' ').trim();
  if (HEADER_KEYWORDS.includes(stripped)) return true;
  if (
    /^(n\.?|num\.?|numero|cognome\s+e\s+nome|nome\s+e\s+cognome|elenco\s+studenti|elenco\s+alunni|lista\s+studenti)$/.test(
      stripped
    )
  ) {
    return true;
  }
  return false;
}

function isHeaderPair(colA: string, colB: string): boolean {
  const a = normalizeNameValue(colA).toLowerCase();
  const b = normalizeNameValue(colB).toLowerCase();
  const aIsHeader =
    HEADER_KEYWORDS.some((k) => a === k || a.includes('cognom') || a.includes('last name') || a === 'nome' || a === 'first name');
  const bIsHeader =
    HEADER_KEYWORDS.some((k) => b === k || b.includes('cognom') || b.includes('nome') || b.includes('first name') || b.includes('last name'));
  return aIsHeader && bIsHeader;
}

export function splitSingleFullName(
  rawText: string,
  order: ImportNameOrder
): { lastName: string; firstName: string } | null {
  const cleaned = cleanLeadingListMarkers(rawText);
  if (!cleaned || isLikelyNoiseOrHeader(cleaned)) return null;

  // Comma format "Cognome, Nome" explicitly marks surname before comma
  if (cleaned.includes(',')) {
    const commaParts = cleaned
      .split(',')
      .map((p) => normalizeNameValue(p))
      .filter(Boolean);
    if (commaParts.length === 2) {
      return order === 'last_first'
        ? { lastName: commaParts[0], firstName: commaParts[1] }
        : { lastName: commaParts[1], firstName: commaParts[0] };
    }
  }

  // Common delimiters inside a single line (tab, semicolon, pipe)
  for (const sep of ['\t', ';', '|']) {
    if (cleaned.includes(sep)) {
      const parts = cleaned
        .split(sep)
        .map((p) => normalizeNameValue(p))
        .filter((p) => p && !/^\d+$/.test(p));
      if (parts.length >= 2) {
        return order === 'last_first'
          ? { lastName: parts[0], firstName: parts.slice(1).join(' ') }
          : { lastName: parts.slice(1).join(' '), firstName: parts[0] };
      }
    }
  }

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) {
    return { lastName: tokens[0], firstName: '' };
  }
  if (tokens.length === 2) {
    return order === 'last_first'
      ? { lastName: tokens[0], firstName: tokens[1] }
      : { lastName: tokens[1], firstName: tokens[0] };
  }

  // 3+ tokens: handle Italian compound surname particles ("De Luca Maria Chiara", "Mario De Luca")
  if (order === 'last_first') {
    let splitIdx = 1;
    if (COMPOUND_SURNAME_PARTICLES.has(tokens[0].toLowerCase())) {
      splitIdx = Math.min(2, tokens.length - 1);
      if (
        splitIdx < tokens.length - 1 &&
        COMPOUND_SURNAME_PARTICLES.has(tokens[1].toLowerCase())
      ) {
        splitIdx = Math.min(3, tokens.length - 1);
      }
    }
    return {
      lastName: tokens.slice(0, splitIdx).join(' '),
      firstName: tokens.slice(splitIdx).join(' '),
    };
  } else {
    let splitIdx = tokens.length - 1;
    if (
      tokens.length >= 3 &&
      COMPOUND_SURNAME_PARTICLES.has(tokens[tokens.length - 2].toLowerCase())
    ) {
      splitIdx = tokens.length - 2;
    }
    return {
      firstName: tokens.slice(0, splitIdx).join(' '),
      lastName: tokens.slice(splitIdx).join(' '),
    };
  }
}

function getExcelColLetter(idx: number): string {
  let n = idx;
  let label = '';
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

function detectExcelSheetConfig(rows: string[][], maxCols: number): ExcelColumnConfig {
  const nonEmptyRows = rows.filter((r) =>
    r.some((cell) => normalizeNameValue(cell) !== '')
  );
  const firstRow = nonEmptyRows[0] ?? [];

  let headerLastIdx = -1;
  let headerFirstIdx = -1;
  let headerFullIdx = -1;
  let foundExplicitHeader = false;

  firstRow.forEach((cell, cIdx) => {
    const lower = normalizeNameValue(cell).toLowerCase();
    if (!lower) return;
    if (
      lower === 'cognome' ||
      lower === 'cognomi' ||
      lower === 'last name' ||
      lower === 'lastname' ||
      lower === 'surname'
    ) {
      headerLastIdx = cIdx;
      foundExplicitHeader = true;
    } else if (
      lower === 'nome' ||
      lower === 'nomi' ||
      lower === 'first name' ||
      lower === 'firstname'
    ) {
      headerFirstIdx = cIdx;
      foundExplicitHeader = true;
    } else if (
      lower.includes('nominativ') ||
      lower.includes('studente') ||
      lower.includes('alunno') ||
      lower.includes('cognome e nome') ||
      lower.includes('nome e cognome')
    ) {
      headerFullIdx = cIdx;
      foundExplicitHeader = true;
    }
  });

  if (headerLastIdx >= 0 && headerFirstIdx >= 0) {
    return {
      mode: 'two_columns',
      lastNameCol: headerLastIdx,
      firstNameCol: headerFirstIdx,
      fullNameCol: headerLastIdx,
      hasHeader: true,
      nameOrder: 'last_first',
    };
  }

  if (headerFullIdx >= 0) {
    const headerVal = normalizeNameValue(firstRow[headerFullIdx] ?? '').toLowerCase();
    return {
      mode: 'single_column',
      lastNameCol: headerFullIdx,
      firstNameCol: Math.min(maxCols - 1, headerFullIdx + 1),
      fullNameCol: headerFullIdx,
      hasHeader: true,
      nameOrder: headerVal.includes('nome e cognome') ? 'first_last' : 'last_first',
    };
  }

  // Heuristic when no header keywords: find text columns (ignore numeric index columns & email columns)
  const sampleRows = nonEmptyRows.slice(foundExplicitHeader ? 1 : 0, 12);
  const textCols: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    const values = sampleRows
      .map((r) => normalizeNameValue(r[c] ?? ''))
      .filter(Boolean);
    if (values.length === 0) continue;
    const alphaCount = values.filter(
      (v) => /\p{L}/u.test(v) && !/^\d+$/.test(v) && !v.includes('@')
    ).length;
    if (alphaCount / values.length >= 0.6) {
      textCols.push(c);
    }
  }

  if (textCols.length >= 2) {
    return {
      mode: 'two_columns',
      lastNameCol: textCols[0],
      firstNameCol: textCols[1],
      fullNameCol: textCols[0],
      hasHeader: foundExplicitHeader,
      nameOrder: 'last_first',
    };
  }

  const singleCol = textCols[0] ?? 0;
  return {
    mode: 'single_column',
    lastNameCol: singleCol,
    firstNameCol: Math.min(Math.max(0, maxCols - 1), singleCol + 1),
    fullNameCol: singleCol,
    hasHeader: foundExplicitHeader,
    nameOrder: 'last_first',
  };
}

export function extractCandidatesFromExcelSheet(
  sheet: ExcelSheetData,
  config: ExcelColumnConfig
): { candidates: ParsedStudentCandidate[]; unrecognizedCount: number } {
  const candidates: ParsedStudentCandidate[] = [];
  let unrecognizedCount = 0;

  let skippedHeader = false;
  for (const row of sheet.rows) {
    const nonEmpty = row.some((c) => normalizeNameValue(c) !== '');
    if (!nonEmpty) continue;

    if (config.hasHeader && !skippedHeader) {
      skippedHeader = true;
      continue;
    }

    if (config.mode === 'two_columns') {
      const rawLast = normalizeNameValue(row[config.lastNameCol] ?? '');
      const rawFirst = normalizeNameValue(row[config.firstNameCol] ?? '');
      if (!rawLast && !rawFirst) continue;
      if (isHeaderPair(rawLast, rawFirst)) continue;

      if (!rawLast || !rawFirst) {
        const fallback = splitSingleFullName(rawLast || rawFirst, config.nameOrder);
        if (fallback && fallback.lastName) {
          candidates.push({
            tempId: nextTempId(),
            lastName: fallback.lastName,
            firstName: fallback.firstName,
            rawSource: `${rawLast} ${rawFirst}`.trim(),
          });
        } else {
          unrecognizedCount += 1;
        }
        continue;
      }

      if (isLikelyNoiseOrHeader(rawLast) && isLikelyNoiseOrHeader(rawFirst)) {
        unrecognizedCount += 1;
        continue;
      }

      candidates.push({
        tempId: nextTempId(),
        lastName: cleanLeadingListMarkers(rawLast),
        firstName: cleanLeadingListMarkers(rawFirst),
        rawSource: `${rawLast} | ${rawFirst}`,
      });
    } else {
      const cellText = normalizeNameValue(row[config.fullNameCol] ?? '');
      if (!cellText) continue;
      const split = splitSingleFullName(cellText, config.nameOrder);
      if (split && split.lastName) {
        candidates.push({
          tempId: nextTempId(),
          lastName: split.lastName,
          firstName: split.firstName,
          rawSource: cellText,
        });
      } else if (!isLikelyNoiseOrHeader(cellText)) {
        unrecognizedCount += 1;
      }
    }
  }

  return { candidates, unrecognizedCount };
}

function decodeTextBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function parseTxtLines(
  text: string
): {
  entries: Array<{ text: string; rawSource: string }>;
  unrecognizedLines: string[];
} {
  const rawLines = text.split(/\r\n|\r|\n/);
  const entries: Array<{ text: string; rawSource: string }> = [];
  const unrecognizedLines: string[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // If a single line packs multiple students separated by ';' or '|' (2+ separators, or both sides contain spaces)
    const semiParts = trimmed.split(';').map((s) => s.trim()).filter(Boolean);
    if (
      semiParts.length >= 2 &&
      (semiParts.length >= 3 || semiParts.every((p) => /\s+/.test(cleanLeadingListMarkers(p))))
    ) {
      semiParts.forEach((p) => entries.push({ text: p, rawSource: trimmed }));
      continue;
    }

    const pipeParts = trimmed.split('|').map((s) => s.trim()).filter(Boolean);
    if (
      pipeParts.length >= 2 &&
      (pipeParts.length >= 3 || pipeParts.every((p) => /\s+/.test(cleanLeadingListMarkers(p))))
    ) {
      pipeParts.forEach((p) => entries.push({ text: p, rawSource: trimmed }));
      continue;
    }

    // Multiple full names separated by commas on one line (e.g. "Rossi Mario, Bianchi Luca")
    const commaParts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    if (
      commaParts.length >= 2 &&
      commaParts.every((p) => cleanLeadingListMarkers(p).split(/\s+/).length >= 2)
    ) {
      commaParts.forEach((p) => entries.push({ text: p, rawSource: trimmed }));
      continue;
    }

    if (isLikelyNoiseOrHeader(cleanLeadingListMarkers(trimmed))) {
      if (!/^\d+$/.test(trimmed)) {
        unrecognizedLines.push(trimmed);
      }
      continue;
    }

    entries.push({ text: trimmed, rawSource: trimmed });
  }

  return { entries, unrecognizedLines };
}

/**
 * Local binary Word (.doc OLE2) text extraction using XLSX.CFB + Word FIB/PieceTable fallback.
 */
function extractTextFromLegacyDoc(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const cfbLib =
    XLSX.CFB ??
    (XLSX as unknown as { default?: { CFB?: typeof XLSX.CFB } }).default?.CFB;
  if (!cfbLib) {
    throw new Error('Modulo di lettura OLE2 (.doc) non disponibile.');
  }
  const cfb = cfbLib.read(bytes, { type: 'array' });
  const wordEntry = cfbLib.find(cfb, '/WordDocument');
  if (!wordEntry || !wordEntry.content) {
    throw new Error('Struttura Word (.doc) non valida o file protetto.');
  }

  const wordBytes = new Uint8Array(wordEntry.content as Uint8Array);
  const view = new DataView(
    wordBytes.buffer,
    wordBytes.byteOffset,
    wordBytes.byteLength
  );

  // Check encrypted flag in FIB (offset 0x0A, bit 8: fEncrypted)
  if (wordBytes.byteLength >= 32) {
    const flags = view.getUint16(0x0a, true);
    if (flags & 0x0100) {
      throw new Error('Il documento Word (.doc) è protetto da password e non può essere letto.');
    }
  }

  // Try Piece Table (CLX) via 1Table / 0Table for exact Unicode & CP1252 fidelity
  const flags = wordBytes.byteLength >= 12 ? view.getUint16(0x0a, true) : 0;
  const tableStreamName = flags & 0x0200 ? '/1Table' : '/0Table';
  const tableEntry = cfbLib.find(cfb, tableStreamName);

  if (tableEntry?.content && wordBytes.byteLength > 0x1aa) {
    const fcClx = view.getUint32(0x1a2, true);
    const lcbClx = view.getUint32(0x1a6, true);
    const tableBytes = new Uint8Array(tableEntry.content as Uint8Array);

    if (lcbClx > 0 && fcClx + lcbClx <= tableBytes.byteLength) {
      let pos = fcClx;
      const clxEnd = fcClx + lcbClx;
      // Skip Prc blocks (clxt === 1) to reach Pcdt (clxt === 2)
      while (pos < clxEnd && tableBytes[pos] === 1) {
        if (pos + 3 > clxEnd) break;
        const cbGrpprl =
          tableBytes[pos + 1] | (tableBytes[pos + 2] << 8);
        pos += 3 + cbGrpprl;
      }
      if (pos + 5 <= clxEnd && tableBytes[pos] === 2) {
        const tv = new DataView(
          tableBytes.buffer,
          tableBytes.byteOffset,
          tableBytes.byteLength
        );
        const lcbPcdt = tv.getUint32(pos + 1, true);
        const plcStart = pos + 5;
        const plcEnd = Math.min(clxEnd, plcStart + lcbPcdt);
        // PlcPcd has (n+1) 4-byte CPs followed by n 8-byte PCDs => 4 + 12*n = lcbPcdt
        const nPieces = Math.floor((plcEnd - plcStart - 4) / 12);
        if (nPieces > 0) {
          const cpCount = nPieces + 1;
          const pieces: string[] = [];
          const utf16Decoder = new TextDecoder('utf-16le');
          const winDecoder = new TextDecoder('windows-1252');

          for (let i = 0; i < nPieces; i++) {
            const cpStart = tv.getUint32(plcStart + i * 4, true);
            const cpEnd = tv.getUint32(plcStart + (i + 1) * 4, true);
            const charCount = cpEnd - cpStart;
            if (charCount <= 0) continue;

            const pcdOffset = plcStart + cpCount * 4 + i * 8;
            if (pcdOffset + 8 > plcEnd) break;
            const fcRaw = tv.getUint32(pcdOffset + 2, true);
            const isCompressed = (fcRaw & 0x40000000) !== 0;
            const fc = isCompressed ? (fcRaw & 0x3fffffff) >> 1 : fcRaw & 0x3fffffff;
            const byteLen = isCompressed ? charCount : charCount * 2;
            if (fc + byteLen > wordBytes.byteLength) continue;

            const slice = wordBytes.subarray(fc, fc + byteLen);
            pieces.push(
              isCompressed ? winDecoder.decode(slice) : utf16Decoder.decode(slice)
            );
          }

          if (pieces.length > 0) {
            return pieces
              .join('')
              .replace(/\x07/g, '\t')
              .replace(/\r/g, '\n');
          }
        }
      }
    }
  }

  // Fallback to FIB fcMin..fcMac span if piece table is absent
  if (wordBytes.byteLength >= 32) {
    const fcMin = view.getUint32(0x18, true);
    const fcMac = view.getUint32(0x1c, true);
    if (fcMac > fcMin && fcMac <= wordBytes.byteLength) {
      const slice = wordBytes.subarray(fcMin, fcMac);
      // Detect UTF-16LE vs 8-bit Windows-1252 by zero-byte ratio
      let zeroCount = 0;
      for (let i = 1; i < Math.min(slice.length, 200); i += 2) {
        if (slice[i] === 0) zeroCount += 1;
      }
      const isUtf16 = zeroCount > Math.min(slice.length, 200) / 6;
      const decoded = new TextDecoder(
        isUtf16 ? 'utf-16le' : 'windows-1252'
      ).decode(slice);
      return decoded.replace(/\x07/g, '\t').replace(/\r/g, '\n');
    }
  }

  throw new Error('Impossibile estrarre testo leggibile dal file .doc.');
}

function parseDocxHtmlEntries(html: string): {
  rawEntries: Array<{
    text?: string;
    pair?: { lastName: string; firstName: string };
    rawSource: string;
  }>;
  unrecognizedLines: string[];
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const rawEntries: Array<{
    text?: string;
    pair?: { lastName: string; firstName: string };
    rawSource: string;
  }> = [];
  const unrecognizedLines: string[] = [];

  // 1. Extract structured rows from Word tables
  const tables = Array.from(doc.querySelectorAll('table'));
  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll('th, td'))
        .map((c) => normalizeNameValue(c.textContent ?? ''))
        .filter((val) => val !== '' && !/^\d{1,3}[.)]?$/.test(val));

      if (cells.length === 0) continue;
      if (cells.length >= 2) {
        // Filter out non-name columns (emails, dates)
        const nameCells = cells.filter(
          (c) =>
            /\p{L}/u.test(c) &&
            !c.includes('@') &&
            !/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(c)
        );
        if (nameCells.length >= 2) {
          if (isHeaderPair(nameCells[0], nameCells[1])) continue;
          rawEntries.push({
            pair: {
              lastName: cleanLeadingListMarkers(nameCells[0]),
              firstName: cleanLeadingListMarkers(nameCells[1]),
            },
            rawSource: nameCells.slice(0, 2).join(' | '),
          });
          continue;
        }
      }
      const singleCell = cells[0];
      if (!isLikelyNoiseOrHeader(singleCell)) {
        rawEntries.push({ text: singleCell, rawSource: singleCell });
      }
    }
  }

  // 2. Extract list items & paragraphs outside tables
  const textBlocks = Array.from(doc.querySelectorAll('li, p, h1, h2, h3, h4'));
  for (const el of textBlocks) {
    if (el.closest('table')) continue;
    // Handle <br> splits cleanly
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    const lines = (clone.textContent ?? '').split(/\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isLikelyNoiseOrHeader(cleanLeadingListMarkers(trimmed))) {
        unrecognizedLines.push(trimmed);
      } else {
        rawEntries.push({ text: trimmed, rawSource: trimmed });
      }
    }
  }

  return { rawEntries, unrecognizedLines };
}

export async function parseStudentImportFile(
  file: File
): Promise<ParsedImportDocument> {
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

      const sheets: ExcelSheetData[] = workbook.SheetNames.map((sheetName) => {
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
          ...rows.slice(0, 50).map((r) => r.length)
        );
        const columnLabels = Array.from({ length: maxCols }, (_, i) => {
          const sample = rows[0]?.[i] ? ` — "${rows[0][i].slice(0, 20)}"` : '';
          return `Colonna ${getExcelColLetter(i)}${sample}`;
        });
        return {
          name: sheetName,
          rows,
          maxCols,
          columnLabels,
          detectedConfig: detectExcelSheetConfig(rows, maxCols),
        };
      });

      const hasAnyContent = sheets.some((s) =>
        s.rows.some((r) => r.some((c) => normalizeNameValue(c) !== ''))
      );
      if (!hasAnyContent) {
        return {
          ok: false,
          error: 'Il file Excel selezionato non contiene dati.',
        };
      }

      const initialSheetIndex = Math.max(
        0,
        sheets.findIndex((s) =>
          s.rows.some((r) => r.some((c) => normalizeNameValue(c) !== ''))
        )
      );

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
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
      const { rawEntries, unrecognizedLines } = parseDocxHtmlEntries(
        result.value || ''
      );
      if (rawEntries.length === 0) {
        return {
          ok: false,
          error:
            'Nessun nominativo valido individuato nel documento Word (.docx).',
        };
      }
      return {
        ok: true,
        kind: 'word',
        fileName,
        rawEntries,
        unrecognizedLines,
        defaultOrder: 'last_first',
      };
    }

    if (ext === 'doc') {
      const buffer = await file.arrayBuffer();
      const rawText = extractTextFromLegacyDoc(buffer);
      const lines = rawText.split(/\r\n|\r|\n/);
      const rawEntries: Array<{
        text?: string;
        pair?: { lastName: string; firstName: string };
        rawSource: string;
      }> = [];
      const unrecognizedLines: string[] = [];

      for (const line of lines) {
        const cleanedLine = line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
        if (!cleanedLine) continue;
        // Word .doc table rows separated by \t (converted from \x07)
        if (cleanedLine.includes('\t')) {
          const cols = cleanedLine
            .split('\t')
            .map((c) => normalizeNameValue(c))
            .filter((c) => c !== '' && !/^\d{1,3}[.)]?$/.test(c));
          const nameCols = cols.filter(
            (c) => /\p{L}/u.test(c) && !c.includes('@')
          );
          if (nameCols.length >= 2) {
            if (isHeaderPair(nameCols[0], nameCols[1])) continue;
            rawEntries.push({
              pair: {
                lastName: cleanLeadingListMarkers(nameCols[0]),
                firstName: cleanLeadingListMarkers(nameCols[1]),
              },
              rawSource: nameCols.slice(0, 2).join(' | '),
            });
            continue;
          }
          if (nameCols.length === 1 && !isLikelyNoiseOrHeader(nameCols[0])) {
            rawEntries.push({ text: nameCols[0], rawSource: nameCols[0] });
          }
          continue;
        }

        if (isLikelyNoiseOrHeader(cleanLeadingListMarkers(cleanedLine))) {
          unrecognizedLines.push(cleanedLine);
        } else {
          rawEntries.push({ text: cleanedLine, rawSource: cleanedLine });
        }
      }

      if (rawEntries.length === 0) {
        return {
          ok: false,
          error:
            'Nessun nominativo valido individuato nel file Word (.doc). Se il file usa un formato obsoleto o protetto, salvalo in .docx o .txt.',
        };
      }

      return {
        ok: true,
        kind: 'word',
        fileName,
        rawEntries,
        unrecognizedLines,
        defaultOrder: 'last_first',
      };
    }

    if (ext === 'txt') {
      const buffer = await file.arrayBuffer();
      const text = decodeTextBuffer(buffer);
      if (!text.trim()) {
        return { ok: false, error: 'Il file di testo (.txt) è vuoto.' };
      }
      const { entries, unrecognizedLines } = parseTxtLines(text);
      if (entries.length === 0) {
        return {
          ok: false,
          error:
            'Nessun nominativo valido riconosciuto nel file di testo (.txt).',
        };
      }
      return {
        ok: true,
        kind: 'txt',
        fileName,
        rawEntries: entries,
        unrecognizedLines,
        defaultOrder: 'last_first',
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
        : 'Errore durante la lettura locale del file.';
    return { ok: false, error: message };
  }
}

export function materializeLinearEntries(
  rawEntries: Array<{
    text?: string;
    pair?: { lastName: string; firstName: string };
    rawSource: string;
  }>,
  order: ImportNameOrder
): ParsedStudentCandidate[] {
  const out: ParsedStudentCandidate[] = [];
  for (const entry of rawEntries) {
    if (entry.pair) {
      out.push({
        tempId: nextTempId(),
        lastName:
          order === 'last_first' ? entry.pair.lastName : entry.pair.firstName,
        firstName:
          order === 'last_first' ? entry.pair.firstName : entry.pair.lastName,
        rawSource: entry.rawSource,
      });
    } else if (entry.text) {
      const split = splitSingleFullName(entry.text, order);
      if (split && split.lastName) {
        out.push({
          tempId: nextTempId(),
          lastName: split.lastName,
          firstName: split.firstName,
          rawSource: entry.rawSource,
        });
      }
    }
  }
  return out;
}

export function buildPreviewWithDuplicates(
  candidates: ParsedStudentCandidate[],
  existingStudents: Student[],
  previousSelection?: Map<string, boolean>
): PreviewStudentRow[] {
  const existingKeys = new Set(
    existingStudents.map((s) => buildStudentDedupeKey(s.lastName, s.firstName))
  );
  const seenInFile = new Set<string>();

  return candidates.map((cand) => {
    const key = buildStudentDedupeKey(cand.lastName, cand.firstName);
    const hasName = normalizeNameValue(cand.lastName) !== '';
    const isDuplicateInClass = hasName && existingKeys.has(key);
    const isDuplicateInFile = hasName && !isDuplicateInClass && seenInFile.has(key);
    if (hasName) seenInFile.add(key);

    const prevChecked = previousSelection?.get(cand.tempId);
    const defaultSelected =
      hasName && !isDuplicateInClass && !isDuplicateInFile;

    return {
      ...cand,
      isDuplicateInFile,
      isDuplicateInClass,
      selected:
        isDuplicateInClass || isDuplicateInFile
          ? false
          : prevChecked !== undefined
          ? prevChecked
          : defaultSelected,
    };
  });
}

export function sortStudentsAlphabeticallyIt<
  T extends { lastName: string; firstName: string }
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const cmpLast = a.lastName.localeCompare(b.lastName, 'it', {
      sensitivity: 'base',
    });
    if (cmpLast !== 0) return cmpLast;
    return a.firstName.localeCompare(b.firstName, 'it', {
      sensitivity: 'base',
    });
  });
}
