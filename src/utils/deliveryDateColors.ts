export interface DeliveryDateColor {
  /** Identificativo univoco della tonalità nella palette */
  id: string;
  /** Colore di sfondo pastello per la cella "Data" */
  bg: string;
  /** Colore di sfondo leggermente attenuato quando un'altra riga è evidenziata */
  dimmedBg: string;
  /** Colore testo ad alto contrasto (WCAG AA) */
  text: string;
}

/**
 * Palette ampia di 16 tonalità pastello tenui ma ben distinguibili tra loro,
 * distribuite sull'intero cerchio cromatico così che date diverse nella stessa
 * cartellina risultino immediatamente riconoscibili a colpo d'occhio.
 */
export const DELIVERY_DATE_PALETTE: readonly DeliveryDateColor[] = [
  { id: 'sky', bg: '#DCEEFF', dimmedBg: '#EBF4FE', text: '#0C4A6E' },
  { id: 'peach', bg: '#FFE3C7', dimmedBg: '#FFF1E3', text: '#7C2D12' },
  { id: 'lavender', bg: '#E9DDFF', dimmedBg: '#F4EEFF', text: '#4C1D95' },
  { id: 'mint', bg: '#D2F4E0', dimmedBg: '#E6F9EE', text: '#065F46' },
  { id: 'rose', bg: '#FFD8E6', dimmedBg: '#FFEBF2', text: '#831843' },
  { id: 'lemon', bg: '#FEF0B8', dimmedBg: '#FEF7DB', text: '#78350F' },
  { id: 'cyan', bg: '#CBEFF5', dimmedBg: '#E4F7FA', text: '#155E75' },
  { id: 'lilac', bg: '#F4D6FA', dimmedBg: '#F9EAFD', text: '#701A75' },
  { id: 'lime', bg: '#E2F5BE', dimmedBg: '#F0FADE', text: '#365314' },
  { id: 'coral', bg: '#FFD9CF', dimmedBg: '#FFECE7', text: '#7F1D1D' },
  { id: 'periwinkle', bg: '#D8E0FF', dimmedBg: '#EBEEFF', text: '#1E3A8A' },
  { id: 'apricot', bg: '#FFE9C2', dimmedBg: '#FFF4E0', text: '#78350F' },
  { id: 'seafoam', bg: '#CCF3EC', dimmedBg: '#E5F9F5', text: '#115E59' },
  { id: 'blush', bg: '#FCE0E2', dimmedBg: '#FDF0F1', text: '#881337' },
  { id: 'sand', bg: '#EFE3CA', dimmedBg: '#F7F1E4', text: '#5C3D1E' },
  { id: 'indigo', bg: '#DFE5FB', dimmedBg: '#EFF2FD', text: '#312E81' },
];

/**
 * Normalizza qualsiasi stringa data valida nel formato canonico `YYYY-MM-DD`,
 * ignorando eventuali orari, fusi orari o separatori diversi (`/` o `.`).
 * Restituisce `null` se la data è vuota o non valida.
 */
export function normalizeDeliveryDateKey(
  raw: string | null | undefined
): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let year: number;
  let month: number;
  let day: number;

  // 1. ISO date with optional time portion: YYYY-MM-DD or YYYY-MM-DDTHH:mm... or YYYY/MM/DD
  const isoMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(
    trimmed
  );
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    // 2. Italian date format: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (with optional time)
    const itMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/.exec(
      trimmed
    );
    if (!itMatch) return null;
    day = Number(itMatch[1]);
    month = Number(itMatch[2]);
    year = Number(itMatch[3]);
  }

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  // Validate real calendar date (e.g. reject Feb 30)
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(
    2,
    '0'
  )}-${String(day).padStart(2, '0')}`;
}

/**
 * Converte una chiave `YYYY-MM-DD` in numero di giorni interi dall'epoca UTC.
 * Garantisce che date consecutive (es. 18/11, 19/11, 20/11, 21/11...) ottengano
 * indici consecutivi e quindi colori sempre diversi tra loro.
 */
function dateKeyToEpochDays(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Genera una tonalità pastello deterministica aggiuntiva quando una singola
 * cartellina contiene più di 16 date distinte, evitando collisioni di colore.
 */
function buildOverflowPastelColor(overflowIndex: number): DeliveryDateColor {
  const hue = Math.round((27 + overflowIndex * 137.508) % 360);
  return {
    id: `pastel_${overflowIndex}`,
    bg: `hsl(${hue}, 68%, 89%)`,
    dimmedBg: `hsl(${hue}, 55%, 94%)`,
    text: `hsl(${hue}, 58%, 22%)`,
  };
}

/**
 * Costruisce una mappa deterministica e priva di collisioni `YYYY-MM-DD -> DeliveryDateColor`
 * a partire da tutte le date effettivamente presenti nella cartellina visualizzata.
 *
 * Proprietà garantite:
 * - Tutte le celle con la stessa data normalizzata ricevono esattamente lo stesso colore.
 * - Tutte le date distinte presenti nella cartellina ricevono colori differenti.
 * - La corrispondenza è deterministica: date uguali mantengono lo stesso colore
 *   dopo riapertura, aggiornamenti, ripristino backup e sincronizzazione Google Drive.
 */
export function buildFolderDeliveryDateColorMap(
  rawDates: Iterable<string | null | undefined>
): Map<string, DeliveryDateColor> {
  const uniqueDatesSet = new Set<string>();
  for (const raw of rawDates) {
    const key = normalizeDeliveryDateKey(raw);
    if (key) uniqueDatesSet.add(key);
  }

  const sortedDistinctDates = Array.from(uniqueDatesSet).sort();
  const colorMap = new Map<string, DeliveryDateColor>();
  const usedPaletteIndices = new Set<number>();
  const paletteSize = DELIVERY_DATE_PALETTE.length;
  let overflowCount = 0;

  for (const dateKey of sortedDistinctDates) {
    const epochDays = dateKeyToEpochDays(dateKey);
    const preferredIdx =
      ((epochDays % paletteSize) + paletteSize) % paletteSize;

    let assignedIdx = -1;
    if (!usedPaletteIndices.has(preferredIdx)) {
      assignedIdx = preferredIdx;
    } else if (usedPaletteIndices.size < paletteSize) {
      for (let step = 1; step < paletteSize; step++) {
        const candidate = (preferredIdx + step) % paletteSize;
        if (!usedPaletteIndices.has(candidate)) {
          assignedIdx = candidate;
          break;
        }
      }
    }

    if (assignedIdx !== -1) {
      usedPaletteIndices.add(assignedIdx);
      colorMap.set(dateKey, DELIVERY_DATE_PALETTE[assignedIdx]);
    } else {
      colorMap.set(dateKey, buildOverflowPastelColor(overflowCount));
      overflowCount += 1;
    }
  }

  return colorMap;
}

/**
 * Recupera il colore assegnato a una specifica data all'interno della mappa della cartellina.
 */
export function getDeliveryDateColor(
  rawDate: string | null | undefined,
  folderDateColorMap: Map<string, DeliveryDateColor>
): DeliveryDateColor | null {
  const key = normalizeDeliveryDateKey(rawDate);
  if (!key) return null;
  return folderDateColorMap.get(key) ?? null;
}
