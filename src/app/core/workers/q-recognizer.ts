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
/**
 * Un nombre de traits différent (cercle tracé en deux fois, trait de plus) rend la comparaison de
 * disposition des traits sans objet : on ne l'applique pas, et on multiplie à la place le score par ce
 * facteur pour chaque trait d'écart.
 * Mesuré : avec la pénalité de disposition appliquée dans ce cas, les redessins coupés en deux
 * tombaient à ~0,35 (7 % des redessins sans aucune suggestion). Sans aucune pénalité, 28 % des
 * gribouillis hors dictionnaire étaient remplacés ; à 0,75 : 15 %, pour 0,2 point de rappel perdu.
 */
export const STROKE_COUNT_MISMATCH_FACTOR = 0.75;

/**
 * Pré-filtrage, volontairement large : un tracé « un peu différent » (un trait de plus ou de moins,
 * proportions un peu autres) ne doit pas être écarté avant d'être comparé. C'est le score qui tranche.
 * (Mesuré : traits ±2 et ratio ×2 font passer le bon signe dans le top 3 de 97-98 % à 100 %.)
 */
export const STROKE_COUNT_TOLERANCE = 2;
export const MAX_RATIO_FACTOR = 2.0;

/**
 * Tolérances de forme, mesurées sur des dessins refaits avec des proportions déformées, une rotation
 * jusqu'à 15°, un tremblement constant en pixels et un tracé parfois coupé en deux :
 * - lissage léger des traits (atténue le tremblement, surtout sur un petit dessin) ;
 * - comparaison aussi avec les proportions « étirées » (les deux dimensions ramenées à 1) ;
 * - comparaison aussi après une petite rotation du tracé (± ROTATION_DEGREES).
 * Bon premier choix : 88-91 % → 97 % sur des redessins un peu différents.
 */
export const SMOOTH_PASSES = 1;
export const ROTATION_DEGREES = 10;
/** Les variantes (étirement, rotations) ne sont essayées que sur les meilleurs signes de la première passe. */
export const VARIANT_POOL_SIZE = 8;
/** Une forme dont le petit côté fait moins de 20 % du grand (ligne) n'est jamais étirée. */
const MIN_STRETCH_ASPECT = 0.2;

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
  /** Même nuage, proportions étirées (null pour une forme quasi linéaire). */
  stretchCloud: QCloud | null;
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
  // Le lissage s'applique au moment de la comparaison (aux signes enregistrés comme au tracé) : les
  // points stockés ne changent pas, les anciens signes en profitent aussi.
  const points = smoothPoints(sign.normalizedGesturePoints);
  const stretched = stretchPoints(points);
  return {
    id: sign.id,
    strokeCount: sign.strokeCount,
    boundingBoxRatio: sign.boundingBoxRatio,
    cloud: toCloud(points),
    stretchCloud: stretched ? toCloud(stretched) : null,
    structure: strokeStructure(points),
  };
}

/** Lissage léger de chaque trait (moyenne 1-2-1, extrémités fixes) : atténue le tremblement de la main. */
export function smoothPoints(points: StrokePoint[], passes = SMOOTH_PASSES): StrokePoint[] {
  let current = points;
  for (let pass = 0; pass < passes; pass++) {
    const source = current;
    current = source.map((p, i) => {
      const a = source[i - 1];
      const b = source[i + 1];
      if (!a || !b || a.strokeId !== p.strokeId || b.strokeId !== p.strokeId) return p;
      return { ...p, x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
    });
  }
  return current;
}

/**
 * Nuage « étiré » : largeur et hauteur ramenées chacune à 1, centré. Deux dessins du même signe aux
 * proportions un peu différentes (plus large, plus haut) deviennent alors superposables.
 * null pour une forme quasi linéaire (l'étirer l'agrandirait en bruit).
 */
export function stretchPoints(points: StrokePoint[]): StrokePoint[] | null {
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (Math.min(width, height) / Math.max(width, height, 1e-9) < MIN_STRETCH_ASPECT) return null;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return points.map((p) => ({ ...p, x: (p.x - cx) / width, y: (p.y - cy) / height }));
}

/** Rotation autour de l'origine (le nuage normalisé y est centré). */
export function rotatePoints(points: StrokePoint[], degrees: number): StrokePoint[] {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return points.map((p) => ({ ...p, x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
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

/** Facteur de disposition des traits, ou pénalité fixe par trait d'écart si le nombre de traits diffère. */
function layoutFactor(candidateStrokes: number, structure: StrokeShape[], t: QTemplate): number {
  const diff = Math.abs(candidateStrokes - t.strokeCount);
  return diff === 0 ? structureFactor(structure, t.structure) : STROKE_COUNT_MISMATCH_FACTOR ** diff;
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

/** Nuages du tracé à reconnaître, pour une taille de nuage donnée (variantes calculées à la demande). */
interface PreparedCandidate {
  points: StrokePoint[];
  cloud: QCloud;
  structure: StrokeShape[];
  stretch?: QCloud | null;
  rotated?: QCloud[];
}

/**
 * Top `limit` des signes compatibles, triés par confiance décroissante.
 *
 * Deux passes : tous les signes sont d'abord comparés simplement (avec abandon anticipé) ; seuls les
 * `pool` meilleurs sont ensuite comparés avec les variantes tolérantes (proportions étirées, petites
 * rotations), dont on garde le meilleur score. La pénalité de structure s'applique au résultat.
 */
export function recognize(
  candidate: QCandidate,
  templates: QTemplate[],
  limit = 3,
  pool = VARIANT_POOL_SIZE,
): QMatch[] {
  const prepared = new Map<number, PreparedCandidate | null>();
  const prepare = (n: number) => {
    if (!prepared.has(n)) {
      const points = smoothPoints(candidate.normalize(n));
      prepared.set(
        n,
        points.length === n ? { points, cloud: toCloud(points), structure: strokeStructure(points) } : null,
      );
    }
    return prepared.get(n)!;
  };

  // Passe 1 : comparaison simple de tous les signes compatibles.
  const first: { t: QTemplate; c: PreparedCandidate; score: number; factor: number }[] = [];
  for (const t of templates) {
    if (!isCompatible(t, candidate)) continue;
    const n = t.cloud.points.length;
    const c = prepare(n);
    if (!c) continue;
    // Abandon anticipé : un score $Q déjà sous le dernier du groupe est perdu (le facteur de structure ≤ 1 ne l'améliore pas).
    const floor = first.length < pool ? 0 : first[first.length - 1].score;
    const maxDistance = floor > 0 ? scoreToDistance(floor, n) : Infinity;
    const distance = greedyCloudMatch(c.cloud, t.cloud, maxDistance);
    if (distance >= maxDistance) continue;
    const factor = layoutFactor(candidate.strokeCount, c.structure, t);
    const score = distanceToScore(distance, n) * factor;
    if (first.length >= pool && score <= floor) continue;
    first.push({ t, c, score, factor });
    first.sort((a, b) => b.score - a.score);
    if (first.length > pool) first.pop();
  }

  // Passe 2 : variantes tolérantes sur les meilleurs.
  const results: QMatch[] = first.map(({ t, c, score, factor }) => {
    const n = t.cloud.points.length;
    let best = score / (factor || 1);
    if (t.stretchCloud) {
      if (c.stretch === undefined) {
        const stretched = stretchPoints(c.points);
        c.stretch = stretched ? toCloud(stretched) : null;
      }
      if (c.stretch) best = Math.max(best, distanceToScore(greedyCloudMatch(c.stretch, t.stretchCloud), n));
    }
    c.rotated ??= [-ROTATION_DEGREES, ROTATION_DEGREES].map((deg) => toCloud(rotatePoints(c.points, deg)));
    for (const rotated of c.rotated) best = Math.max(best, distanceToScore(greedyCloudMatch(rotated, t.cloud), n));
    return { signId: t.id, score: best * factor };
  });
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
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
