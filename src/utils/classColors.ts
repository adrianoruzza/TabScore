export interface ClassColorOption {
  id: string;
  label: string;
  accent: string;
  softBg: string;
  border: string;
  text: string;
}

export const CLASS_COLOR_PALETTE: ClassColorOption[] = [
  {
    id: 'blue',
    label: 'Blu cobalto',
    accent: '#1d4ed8',
    softBg: '#eff6ff',
    border: '#bfdbfe',
    text: '#1e3a8a',
  },
  {
    id: 'emerald',
    label: 'Verde salvia',
    accent: '#047857',
    softBg: '#ecfdf5',
    border: '#a7f3d0',
    text: '#064e3b',
  },
  {
    id: 'amber',
    label: 'Ocra caldo',
    accent: '#b45309',
    softBg: '#fffbeb',
    border: '#fde68a',
    text: '#78350f',
  },
  {
    id: 'indigo',
    label: 'Indaco',
    accent: '#4338ca',
    softBg: '#eef2ff',
    border: '#c7d2fe',
    text: '#312e81',
  },
  {
    id: 'rose',
    label: 'Bordeaux',
    accent: '#be123c',
    softBg: '#fff1f2',
    border: '#fecdd3',
    text: '#881337',
  },
  {
    id: 'teal',
    label: 'Ottanio',
    accent: '#0f766e',
    softBg: '#f0fdfa',
    border: '#99f6e4',
    text: '#134e4a',
  },
  {
    id: 'purple',
    label: 'Prugna',
    accent: '#7e22ce',
    softBg: '#faf5ff',
    border: '#e9d5ff',
    text: '#581c87',
  },
  {
    id: 'slate',
    label: 'Ardesia',
    accent: '#334155',
    softBg: '#f1f5f9',
    border: '#cbd5e1',
    text: '#0f172a',
  },
];

export function getClassColorOption(
  colorId?: string,
  fallbackIndex = 0
): ClassColorOption {
  if (colorId) {
    const found = CLASS_COLOR_PALETTE.find(
      (c) => c.id === colorId || c.accent.toLowerCase() === colorId.toLowerCase()
    );
    if (found) return found;
  }
  const idx =
    ((fallbackIndex % CLASS_COLOR_PALETTE.length) + CLASS_COLOR_PALETTE.length) %
    CLASS_COLOR_PALETTE.length;
  return CLASS_COLOR_PALETTE[idx];
}

export function pickNextDistinctClassColorId(
  existingColors: (string | undefined)[]
): string {
  const used = new Set(existingColors.filter(Boolean) as string[]);
  const unused = CLASS_COLOR_PALETTE.find((c) => !used.has(c.id));
  if (unused) return unused.id;
  return CLASS_COLOR_PALETTE[existingColors.length % CLASS_COLOR_PALETTE.length].id;
}
