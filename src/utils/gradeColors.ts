import type { CSSProperties } from 'react';

/**
 * Configurazione centralizzata della scala cromatica dei voti numerici (da 2 a 10):
 * gradazione continua da OCRA (voti bassi) a BLU SCURO (voti alti).
 *
 * NOTA: Gli stop attuali costituiscono una scala provvisoria pulita e leggibile.
 * Quando verrà fornita l'immagine di riferimento con i colori esatti, è sufficiente
 * aggiornare l'array `GRADE_COLOR_STOPS` (o aggiungerne i punti intermedi) senza
 * modificare alcun componente UI.
 */
export interface GradeColorStop {
  grade: number;
  /** Colore esadecimale di sfondo (#RRGGBB) */
  bg: string;
  /** Opzionale: colore testo esplicito; se omesso viene calcolato automaticamente per contrasto WCAG */
  text?: string;
}

export const GRADE_COLOR_RANGE = {
  min: 2,
  max: 10,
} as const;

export const GRADE_COLOR_STOPS: readonly GradeColorStop[] = [
  { grade: 2, bg: '#9C6615' },   // Ocra intenso
  { grade: 4, bg: '#946B1E' },   // Ocra dorato caldo
  { grade: 5.5, bg: '#7E7638' }, // Ocra-oliva di transizione
  { grade: 6, bg: '#557175' },   // Punto di soglia neutro-azzurrato
  { grade: 7.5, bg: '#37628D' }, // Azzurro acciaio medio
  { grade: 9, bg: '#22467D' },   // Blu profondo
  { grade: 10, bg: '#142B5E' },  // Blu scuro
];

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function parseHexRgb(hex: string): RgbColor {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) {
    return { r: 226, g: 232, b: 240 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clampByte(r), clampByte(g), clampByte(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function mixRgb(a: RgbColor, b: RgbColor, t: number): RgbColor {
  const ratio = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  };
}

function relativeLuminance({ r, g, b }: RgbColor): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(lumA: number, lumB: number): number {
  const bright = Math.max(lumA, lumB);
  const dark = Math.min(lumA, lumB);
  return (bright + 0.05) / (dark + 0.05);
}

const DARK_TEXT_HEX = '#0F172A';
const LIGHT_TEXT_HEX = '#FFFFFF';
const DARK_TEXT_LUM = relativeLuminance(parseHexRgb(DARK_TEXT_HEX));
const LIGHT_TEXT_LUM = relativeLuminance(parseHexRgb(LIGHT_TEXT_HEX));

export interface GradeColorResult {
  backgroundColor: string;
  borderColor: string;
  color: string;
  isDarkBackground: boolean;
}

/**
 * Restituisce i colori calcolati per un voto numerico (inclusi decimali e frazioni .25/.50/.75).
 * Restituisce `null` per valori vuoti (`null`/`undefined`/`NaN`), così le celle vuote
 * e gli stati testuali non ricevono colorazioni improprie.
 */
export function getGradeColorTokens(
  grade: number | null | undefined,
  stops: readonly GradeColorStop[] = GRADE_COLOR_STOPS
): GradeColorResult | null {
  if (grade === null || grade === undefined || !Number.isFinite(grade)) {
    return null;
  }

  const ordered = [...stops].sort((a, b) => a.grade - b.grade);
  if (ordered.length === 0) return null;

  const clamped = Math.max(
    GRADE_COLOR_RANGE.min,
    Math.min(GRADE_COLOR_RANGE.max, grade)
  );

  let rgb: RgbColor;
  let explicitText: string | undefined;

  if (clamped <= ordered[0].grade) {
    rgb = parseHexRgb(ordered[0].bg);
    explicitText = ordered[0].text;
  } else if (clamped >= ordered[ordered.length - 1].grade) {
    const last = ordered[ordered.length - 1];
    rgb = parseHexRgb(last.bg);
    explicitText = last.text;
  } else {
    let lower = ordered[0];
    let upper = ordered[ordered.length - 1];
    for (let i = 0; i < ordered.length - 1; i++) {
      if (clamped >= ordered[i].grade && clamped <= ordered[i + 1].grade) {
        lower = ordered[i];
        upper = ordered[i + 1];
        break;
      }
    }
    const span = upper.grade - lower.grade;
    const t = span > 0 ? (clamped - lower.grade) / span : 0;
    rgb = mixRgb(parseHexRgb(lower.bg), parseHexRgb(upper.bg), t);
    if (t === 0) explicitText = lower.text;
    if (t === 1) explicitText = upper.text;
  }

  const bgLuminance = relativeLuminance(rgb);
  const darkContrast = contrastRatio(bgLuminance, DARK_TEXT_LUM);
  const lightContrast = contrastRatio(bgLuminance, LIGHT_TEXT_LUM);
  const useLightText = lightContrast >= darkContrast;

  const borderRgb = mixRgb(rgb, { r: 15, g: 23, b: 42 }, 0.22);

  return {
    backgroundColor: rgbToHex(rgb),
    borderColor: rgbToHex(borderRgb),
    color: explicitText ?? (useLightText ? LIGHT_TEXT_HEX : DARK_TEXT_HEX),
    isDarkBackground: useLightText,
  };
}

/**
 * Comodo helper per applicare direttamente sfondo e testo ad alta leggibilità sui badge/celle voto.
 */
export function getGradeColorStyle(
  grade: number | null | undefined,
  options?: { includeBorder?: boolean; stops?: readonly GradeColorStop[] }
): CSSProperties | undefined {
  const tokens = getGradeColorTokens(grade, options?.stops);
  if (!tokens) return undefined;
  return options?.includeBorder
    ? {
        backgroundColor: tokens.backgroundColor,
        borderColor: tokens.borderColor,
        color: tokens.color,
      }
    : {
        backgroundColor: tokens.backgroundColor,
        color: tokens.color,
      };
}
