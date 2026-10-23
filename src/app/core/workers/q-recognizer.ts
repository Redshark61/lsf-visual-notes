/**
 * $Q Super-Quick Recognizer (Vatavu, Anthony & Wobbrock, 2018), adapté au format du projet.
 *
 * Module pur (aucun accès DOM ni IndexedDB) : exécuté dans gesture-recognizer.worker.ts,
 * testable isolément. Les nuages en entrée sont déjà normalisés par normalizeStrokes()
 * (boîte 1x1 proportionnelle centrée sur le centroïde, donc coordonnées dans [-1, 1]).
 */
import { StrokePoint } from '../models/sign.model';

const MAX_INT_COORD = 1024;
const LUT_SIZE = 64;
const LUT_SCALE = MAX_INT_COORD / LUT_SIZE;

/**
 * Distance RMS (en unités de la boîte 1x1) à partir de laquelle la confiance tombe à 0.
 * Calibrée sur 14 glyphes redessinés 40 fois (échelle, position, rotation ±10°, bruit 3 %) :
 * top-1 97.5 %, top-3 100 %, 74 % des tracés au-dessus de 0.8 sans aucune erreur.
 * À 0.35, des remplacements automatiques erronés apparaissent.
 */
export const ZERO_CONFIDENCE_RMS = 0.3;

/** Pré-filtrage : le nombre de traits peut différer de 1, le ratio L/H d'un facteur 1.4 (±40 %). */
export const STROKE_COUNT_TOLERANCE = 1;
export const MAX_RATIO_FACTOR = 1.4;

interface QPoint {
  x: number;
  y: number;
  intX: number;
  intY: number;
}

export interface QCloud {
  points: QPoint[];
  lut: Uint8Array; // LUT_SIZE * LUT_SIZE indices du point le plus proche
}

export interface QTemplate {
  id: string;
  strokeCount: number;
  boundingBoxRatio: number;
  cloud: QCloud;
}

export interface QCandidate {
  normalizedPoints: StrokePoint[];
  strokeCount: number;
  boundingBoxRatio: number;
}

export interface QMatch {
  signId: string;
  /** Confiance de 0 à 1. */
  score: number;
}

/** Prépare un nuage (coordonnées entières + LUT). À faire une seule fois par signe du dictionnaire. */
export function toCloud(points: StrokePoint[]): QCloud {
  const qPoints = points.map((p) => ({
    x: p.x,
    y: p.y,
    intX: Math.round(((clamp(p.x) + 1) / 2) * (MAX_INT_COORD - 1)),
    intY: Math.round(((clamp(p.y) + 1) / 2) * (MAX_INT_COORD - 1)),
  }));
  return { points: qPoints, lut: computeLut(qPoints) };
}

export function toTemplate(sign: {
  id: string;
  strokeCount: number;
  boundingBoxRatio: number;
  normalizedGesturePoints: StrokePoint[];
}): QTemplate {
  return {
    id: sign.id,
    strokeCount: sign.strokeCount,
    boundingBoxRatio: sign.boundingBoxRatio,
    cloud: toCloud(sign.normalizedGesturePoints),
  };
}

export function isCompatible(t: QTemplate, c: QCandidate): boolean {
  if (Math.abs(t.strokeCount - c.strokeCount) > STROKE_COUNT_TOLERANCE) return false;
  const factor = Math.max(t.boundingBoxRatio, c.boundingBoxRatio) / Math.min(t.boundingBoxRatio, c.boundingBoxRatio);
  return factor <= MAX_RATIO_FACTOR;
}

/** Top `limit` des signes compatibles, triés par confiance décroissante. */
export function recognize(candidate: QCandidate, templates: QTemplate[], limit = 3): QMatch[] {
  const n = candidate.normalizedPoints.length;
  if (n === 0) return [];
  const cloud = toCloud(candidate.normalizedPoints);
  const best: { id: string; distance: number }[] = [];

  for (const t of templates) {
    if (t.cloud.points.length !== n || !isCompatible(t, candidate)) continue;
    // Early abandoning : inutile de finir le calcul s'il ne peut pas entrer dans le top.
    const threshold = best.length < limit ? Infinity : best[best.length - 1].distance;
    const distance = greedyCloudMatch(cloud, t.cloud, threshold);
    if (distance >= threshold) continue;
    best.push({ id: t.id, distance });
    best.sort((a, b) => a.distance - b.distance);
    if (best.length > limit) best.pop();
  }

  return best.map((b) => ({ signId: b.id, score: distanceToScore(b.distance, n) }));
}

/** Distance pondérée $Q → confiance 0..1 (indépendante du nombre de points). */
export function distanceToScore(distance: number, n: number): number {
  const weightSum = (n * (n + 1)) / 2;
  const rms = Math.sqrt(distance / weightSum);
  return Math.max(0, Math.min(1, 1 - rms / ZERO_CONFIDENCE_RMS));
}

export function greedyCloudMatch(a: QCloud, b: QCloud, minSoFar = Infinity): number {
  const n = a.points.length;
  const step = Math.max(1, Math.floor(Math.sqrt(n)));
  const lb1 = computeLowerBound(a.points, b.points, step, b.lut);
  const lb2 = computeLowerBound(b.points, a.points, step, a.lut);
  for (let i = 0, indexLB = 0; i < n; i += step, indexLB++) {
    if (lb1[indexLB] < minSoFar) minSoFar = Math.min(minSoFar, cloudDistance(a.points, b.points, i, minSoFar));
    if (lb2[indexLB] < minSoFar) minSoFar = Math.min(minSoFar, cloudDistance(b.points, a.points, i, minSoFar));
  }
  return minSoFar;
}

function cloudDistance(pts1: QPoint[], pts2: QPoint[], start: number, minSoFar: number): number {
  const n = pts1.length;
  const unmatched = Array.from({ length: n }, (_, k) => k);
  let i = start;
  let weight = n;
  let sum = 0;
  do {
    let u = -1;
    let b = Infinity;
    for (let j = 0; j < unmatched.length; j++) {
      const d = sqrDistance(pts1[i], pts2[unmatched[j]]);
      if (d < b) {
        b = d;
        u = j;
      }
    }
    unmatched.splice(u, 1);
    sum += weight * b;
    if (sum >= minSoFar) return sum;
    weight--;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

function computeLowerBound(pts1: QPoint[], pts2: QPoint[], step: number, lut: Uint8Array): number[] {
  const n = pts1.length;
  const lb = new Array<number>(Math.floor(n / step) + 1).fill(0);
  const sat = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = Math.round(pts1[i].intX / LUT_SCALE);
    const y = Math.round(pts1[i].intY / LUT_SCALE);
    const d = sqrDistance(pts1[i], pts2[lut[lutIndex(x, y)]]);
    sat[i] = i === 0 ? d : sat[i - 1] + d;
    lb[0] += (n - i) * d;
  }
  for (let i = step, indexLB = 1; i < n; i += step, indexLB++) {
    lb[indexLB] = lb[0] + i * sat[n - 1] - n * sat[i - 1];
  }
  return lb;
}

function computeLut(points: QPoint[]): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE * LUT_SIZE);
  for (let x = 0; x < LUT_SIZE; x++) {
    for (let y = 0; y < LUT_SIZE; y++) {
      let u = 0;
      let b = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dx = points[i].intX / LUT_SCALE - x;
        const dy = points[i].intY / LUT_SCALE - y;
        const d = dx * dx + dy * dy;
        if (d < b) {
          b = d;
          u = i;
        }
      }
      lut[lutIndex(x, y)] = u;
    }
  }
  return lut;
}

// Math.round(1023 / 16) = 64 : on borne pour rester dans la LUT.
const lutIndex = (x: number, y: number) => Math.min(x, LUT_SIZE - 1) * LUT_SIZE + Math.min(y, LUT_SIZE - 1);
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const sqrDistance = (a: QPoint, b: QPoint) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
