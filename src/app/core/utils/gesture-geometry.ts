import { Point, Stroke, StrokePoint } from '../models/sign.model';

/**
 * Taille du nuage de points comparé par $Q. 48 plutôt que 32 : meilleure discrimination des dessins
 * à plusieurs traits (mesuré : 89 % → 93 % de bon premier choix), sans perte sur les formes simples.
 */
export const NORMALIZED_POINT_COUNT = 48;
/** Tailles acceptées : 32 pour les signes enregistrés avant le passage à 48. */
export const SUPPORTED_POINT_COUNTS: readonly number[] = [32, 48];

export interface BoundingBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/**
 * Pur (aucun accès DOM) : utilisable dans le thread principal comme dans le Web Worker.
 */
export function flattenStrokes(strokes: Stroke[]): StrokePoint[] {
  const out: StrokePoint[] = [];
  let strokeId = 0;
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    strokeId++;
    for (const p of stroke) out.push({ x: p.x, y: p.y, strokeId });
  }
  return out;
}

export function boundingBox(points: Point[]): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (points.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 };
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/** Au-delà de 3:1, une forme est "très allongée" : on ne distingue plus 4:1 de 8:1. */
export const MAX_BOUNDING_BOX_RATIO = 3;

/**
 * Ratio largeur/hauteur, borné à [1/3, 3] : une marge de 15 % de la plus grande dimension évite
 * 0 ou Infinity, et la borne évite qu'une ligne légèrement inclinée (ratio 3.5 au lieu de 7.7)
 * soit écartée par le pré-filtrage.
 */
export function boundingBoxRatio(points: Point[]): number {
  const { width, height } = boundingBox(points);
  const pad = Math.max(width, height) * 0.15 || 1;
  const ratio = (width + pad) / (height + pad);
  return Math.min(MAX_BOUNDING_BOX_RATIO, Math.max(1 / MAX_BOUNDING_BOX_RATIO, ratio));
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Longueur cumulée des traits, sans compter les sauts entre deux traits. */
export function pathLength(points: StrokePoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].strokeId === points[i - 1].strokeId) d += distance(points[i - 1], points[i]);
  }
  return d;
}

/** Ré-échantillonnage $P/$Q : n points équidistants le long des traits. */
export function resample(points: StrokePoint[], n: number): StrokePoint[] {
  if (points.length === 0) return [];
  const interval = pathLength(points) / (n - 1);
  // Tracé de longueur nulle (simple tap) : n copies du point.
  if (interval === 0) return Array.from({ length: n }, () => ({ ...points[0] }));

  const src = points.map((p) => ({ ...p }));
  const out: StrokePoint[] = [{ ...src[0] }];
  let acc = 0;
  for (let i = 1; i < src.length; i++) {
    if (src[i].strokeId !== src[i - 1].strokeId) continue;
    const d = distance(src[i - 1], src[i]);
    if (acc + d >= interval) {
      const t = (interval - acc) / d;
      const q: StrokePoint = {
        x: src[i - 1].x + t * (src[i].x - src[i - 1].x),
        y: src[i - 1].y + t * (src[i].y - src[i - 1].y),
        strokeId: src[i].strokeId,
      };
      out.push(q);
      src.splice(i, 0, q); // q devient le point précédent de la prochaine itération
      acc = 0;
    } else {
      acc += d;
    }
  }
  // Erreurs d'arrondi : on complète avec le dernier point.
  while (out.length < n) out.push({ ...src[src.length - 1] });
  return out.slice(0, n);
}

/**
 * Mise à l'échelle proportionnelle (max(largeur, hauteur)) : le tracé tient dans une boîte 1x1
 * sans déformer une ligne droite en diagonale.
 */
export function scale(points: StrokePoint[]): StrokePoint[] {
  const { minX, minY, width, height } = boundingBox(points);
  const size = Math.max(width, height) || 1;
  return points.map((p) => ({ x: (p.x - minX) / size, y: (p.y - minY) / size, strokeId: p.strokeId }));
}

export function translateToOrigin(points: StrokePoint[]): StrokePoint[] {
  if (points.length === 0) return [];
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  return points.map((p) => ({ x: p.x - cx, y: p.y - cy, strokeId: p.strokeId }));
}

/** Resample → Scale → TranslateToOrigin. Insensible à la taille et à la position du dessin. */
export function normalizeStrokes(strokes: Stroke[], n = NORMALIZED_POINT_COUNT): StrokePoint[] {
  return translateToOrigin(scale(resample(flattenStrokes(strokes), n)));
}
