import { SignGlyph, Stroke } from '../models/sign.model';
import { strokesToGlyphPath } from './freehand';
import { boundingBoxRatio, normalizeStrokes } from './gesture-geometry';

/** Tout ce qu'il faut pour enregistrer (Atelier) ou reconnaître (Carnet) un glyphe. */
export function extractGesture(strokes: Stroke[]): SignGlyph | null {
  const nonEmpty = strokes.filter((s) => s.length > 0);
  if (nonEmpty.length === 0) return null;
  return {
    normalizedGesturePoints: normalizeStrokes(nonEmpty),
    boundingBoxRatio: boundingBoxRatio(nonEmpty.flat()),
    strokeCount: nonEmpty.length,
    svgPathData: strokesToGlyphPath(nonEmpty),
  };
}
