/** Couleurs d'affichage d'un glyphe (la saisie et la reconnaissance restent en noir). */
export const GLYPH_COLORS: readonly { value: string | null; label: string; swatch: string }[] = [
  { value: null, label: 'Noir', swatch: '#1d1d1f' },
  { value: '#c62828', label: 'Rouge', swatch: '#c62828' },
  { value: '#ef6c00', label: 'Orange', swatch: '#ef6c00' },
  { value: '#e0a100', label: 'Jaune', swatch: '#e0a100' },
  { value: '#2e7d32', label: 'Vert', swatch: '#2e7d32' },
  { value: '#1565c0', label: 'Bleu', swatch: '#1565c0' },
  { value: '#6a1b9a', label: 'Violet', swatch: '#6a1b9a' },
  { value: '#6d4c41', label: 'Marron', swatch: '#6d4c41' },
];

export const GLYPH_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
