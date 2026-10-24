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
 * Calibrée sur 14 glyphes redessinés (échelle, position, rotation ±10°, bruit 3 %) : top-1 ≈ 97 %,
 * ~75 % des tracés au-dessus de 0.8 sans aucune erreur (32 et 48 points). À 0.35, des remplacements
 * automatiques erronés apparaissent. Garde-fous : q-recognizer.spec.ts.
 */
export const ZERO_CONFIDENCE_RMS = 0.3;

/**
 * Pénalité de structure (disposition des traits), car $Q ignore l'organisation en traits :
 * deux dessins complexes (5-6 traits) remplissent la boîte et se « ressemblent » toujours un peu.
 * Distance de structure mesurée : même dessin redessiné ≤ 0.105 (p98), dessins sans rapport ≥ 0.119 (p2).
 * Aucune pénalité jusqu'à STRUCTURE_TOLERANCE (tremblement normal), puis jusqu'à -60 % du score.
 */
export const STRUCTURE_TOLERANCE = 0.08;
export const STRUCTURE_RANGE = 0.15;
export const STRUCTURE_MAX_PENALTY = 0.6;
/** Pénalité d'un trait sans équivalent dans l'autre dessin (par unité de longueur relative). */
const UNMATCHED_STROKE_COST = 0.5;

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

/** Un trait résumé : centre (repère normalisé) et part de la longueur totale. */
export interface StrokeShape {
  x: number;
  y: number;
  weight: number;
}

export interface QTemplate {
  id: string;
  strokeCount: number;
  boundingBoxRatio: number;
  cloud: QCloud;
  structure: StrokeShape[];
}

export interface QCandidate {
  strokeCount: number;
  boundingBoxRatio: number;
  /**
   * Nuage normalisé à n points. Les modèles peuvent avoir des tailles différentes
   * (32 pour les anciens signes, 48 aujourd'hui) : le candidat est normalisé à la demande.
   */
  normalize: (n: number) => StrokePoint[];
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
    structure: strokeStructure(sign.normalizedGesturePoints),
  };
}

/** Résumé des traits d'un nuage normalisé (points équidistants : part de points = part de longueur). */
export function strokeStructure(points: StrokePoint[]): StrokeShape[] {
  const byStroke = new Map<number, { x: number; y: number; count: number }>();
  for (const p of points) {
    const acc = byStroke.get(p.strokeId) ?? { x: 0, y: 0, count: 0 };
    acc.x += p.x;
    acc.y += p.y;
    acc.count++;
    byStroke.set(p.strokeId, acc);
  }
  return [...byStroke.values()].map((a) => ({ x: a.x / a.count, y: a.y / a.count, weight: a.count / points.length }));
}

/** Écart de disposition des traits : appariement glouton (traits les plus longs d'abord). */
export function structureDistance(a: StrokeShape[], b: StrokeShape[]): number {
  const free = [...b];
  let sum = 0;
  for (const s of [...a].sort((p, q) => q.weight - p.weight)) {
    let best = -1;
    let bestD = Infinity;
    free.forEach((t, i) => {
      const d = Math.hypot(s.x - t.x, s.y - t.y) + Math.abs(s.weight - t.weight);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) {
      sum += s.weight * UNMATCHED_STROKE_COST;
      continue;
    }
    sum += ((s.weight + free[best].weight) / 2) * bestD;
    free.splice(best, 1);
  }
  return sum + free.reduce((t, s) => t + s.weight * UNMATCHED_STROKE_COST, 0);
}

/** Facteur multiplicatif du score (1 = disposition identique, au minimum 1 - STRUCTURE_MAX_PENALTY). */
export function structureFactor(a: StrokeShape[], b: StrokeShape[]): number {
  const excess = Math.max(0, structureDistance(a, b) - STRUCTURE_TOLERANCE);
  return 1 - Math.min(1, excess / STRUCTURE_RANGE) * STRUCTURE_MAX_PENALTY;
}

export function isCompatible(t: QTemplate, c: QCandidate): boolean {
  if (Math.abs(t.strokeCount - c.strokeCount) > STROKE_COUNT_TOLERANCE) return false;
  const factor = Math.max(t.boundingBoxRatio, c.boundingBoxRatio) / Math.min(t.boundingBoxRatio, c.boundingBoxRatio);
  return factor <= MAX_RATIO_FACTOR;
}

/** Top `limit` des signes compatibles, triés par confiance décroissante. */
export function recognize(candidate: QCandidate, templates: QTemplate[], limit = 3): QMatch[] {
  const prepared = new Map<number, { cloud: QCloud; structure: StrokeShape[] } | null>();
  const prepare = (n: number) => {
    if (!prepared.has(n)) {
      const points = candidate.normalize(n);
      prepared.set(n, points.length === n ? { cloud: toCloud(points), structure: strokeStructure(points) } : null);
    }
    return prepared.get(n)!;
  };
  const best: QMatch[] = [];

  for (const t of templates) {
    if (!isCompatible(t, candidate)) continue;
    const n = t.cloud.points.length;
    const c = prepare(n);
    if (!c) continue;
    // Early abandoning : le facteur de structure étant ≤ 1, un score $Q déjà sous le top est perdu.
    const floor = best.length < limit ? 0 : best[best.length - 1].score;
    const maxDistance = floor > 0 ? scoreToDistance(floor, n) : Infinity;
    const distance = greedyCloudMatch(c.cloud, t.cloud, maxDistance);
    if (distance >= maxDistance) continue;
    const score = distanceToScore(distance, n) * structureFactor(c.structure, t.structure);
    if (best.length >= limit && score <= floor) continue;
    best.push({ signId: t.id, score });
    best.sort((a, b) => b.score - a.score);
    if (best.length > limit) best.pop();
  }
  return best;
}

/** Distance pondérée $Q → confiance 0..1 (indépendante du nombre de points). */
export function distanceToScore(distance: number, n: number): number {
  const weightSum = (n * (n + 1)) / 2;
  const rms = Math.sqrt(distance / weightSum);
  return Math.max(0, Math.min(1, 1 - rms / ZERO_CONFIDENCE_RMS));
}

/** Inverse de distanceToScore : distance $Q correspondant à un score donné. */
export function scoreToDistance(score: number, n: number): number {
  const weightSum = (n * (n + 1)) / 2;
  return weightSum * (ZERO_CONFIDENCE_RMS * (1 - score)) ** 2;
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
