import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { Stroke } from '../models/sign.model';
import { boundingBox } from './gesture-geometry';

export const PEN_OPTIONS: StrokeOptions = {
  size: 8,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
};

/** Côté du viewBox ("0 0 100 100") dans lequel est stocké le tracé d'un signe. */
export const GLYPH_VIEWBOX = 100;

const avg = (a: number, b: number) => (a + b) / 2;

/** Polygone de perfect-freehand → chemin SVG en courbes quadratiques. */
export function outlineToSvgPath(outline: number[][]): string {
  const len = outline.length;
  if (len < 4) return '';
  const r = (n: number) => +n.toFixed(2);
  let a = outline[0];
  let b = outline[1];
  const c = outline[2];
  let d = `M${r(a[0])},${r(a[1])} Q${r(b[0])},${r(b[1])} ${r(avg(b[0], c[0]))},${r(avg(b[1], c[1]))} T`;
  for (let i = 2; i < len - 1; i++) {
    a = outline[i];
    b = outline[i + 1];
    d += `${r(avg(a[0], b[0]))},${r(avg(a[1], b[1]))} `;
  }
  return d + 'Z';
}

export function strokeToSvgPath(stroke: Stroke, options: StrokeOptions = PEN_OPTIONS): string {
  // Souris / doigt : pas de pression réelle, perfect-freehand la simule à partir de la vitesse.
  const simulatePressure = stroke.every((p) => p.pressure === undefined);
  const input = stroke.map((p) => [p.x, p.y, p.pressure ?? 0.5]);
  return outlineToSvgPath(getStroke(input, { ...options, simulatePressure }));
}

/**
 * Tracé de rendu stocké dans UserSign.svgPathData : centré et mis à l'échelle (proportionnellement)
 * dans un viewBox fixe GLYPH_VIEWBOX x GLYPH_VIEWBOX, quelle que soit la taille du dessin d'origine.
 */
/**
 * Épaisseur du trait dans le glyphe : celle du canevas réduite dans la même proportion que le dessin
 * (un grand dessin détaillé reste fin), bornée pour rester lisible en petit (56 px dans les notes).
 */
const MIN_GLYPH_PEN = 2.5;
const MAX_GLYPH_PEN = 6;

export function strokesToGlyphPath(strokes: Stroke[], margin = 10): string {
  return strokesToGlyphPaths(strokes, margin).join(' ');
}

/** Comme strokesToGlyphPath, mais un chemin par trait non vide (dans le même repère). */
export function strokesToGlyphPaths(strokes: Stroke[], margin = 10): string[] {
  const all = strokes.flat();
  if (all.length === 0) return [];
  const { minX, minY, width, height } = boundingBox(all);
  const inner = GLYPH_VIEWBOX - 2 * margin;
  const k = inner / (Math.max(width, height) || 1);
  const offX = margin + (inner - width * k) / 2;
  const offY = margin + (inner - height * k) / 2;
  const penSize = Math.min(MAX_GLYPH_PEN, Math.max(MIN_GLYPH_PEN, (PEN_OPTIONS.size ?? 8) * k));
  return strokes
    .filter((s) => s.length > 0)
    .map((s) =>
      strokeToSvgPath(
        s.map((p) => ({ ...p, x: offX + (p.x - minX) * k, y: offY + (p.y - minY) * k })),
        { ...PEN_OPTIONS, size: penSize },
      ),
    );
}
