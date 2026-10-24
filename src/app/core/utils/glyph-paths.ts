import { SignGlyph } from '../models/sign.model';

export interface ColoredPath {
  d: string;
  /** null = encre par défaut (héritée du <svg>). */
  color: string | null;
}

/**
 * Chemins à afficher pour un glyphe : un par trait avec sa couleur, ou, pour l'ancien format,
 * un seul chemin avec la couleur globale éventuelle.
 */
export function glyphPaths(glyph: SignGlyph): ColoredPath[] {
  if (glyph.strokes?.length) return glyph.strokes.map((s) => ({ d: s.d, color: s.color ?? glyph.color ?? null }));
  return [{ d: glyph.svgPathData, color: glyph.color ?? null }];
}
