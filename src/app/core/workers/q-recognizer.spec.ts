import { describe, expect, it } from 'vitest';
import { NORMALIZED_POINT_COUNT, boundingBoxRatio, normalizeStrokes } from '../utils/gesture-geometry';
import { Stroke } from '../models/sign.model';
import * as Q from './q-recognizer';
import { SHAPES, seededRandom, variant } from '../../../testing/shapes';

const names = Object.keys(SHAPES);
const templates = names.map((id) =>
  Q.toTemplate({
    id,
    strokeCount: SHAPES[id].length,
    boundingBoxRatio: boundingBoxRatio(SHAPES[id].flat()),
    normalizedGesturePoints: normalizeStrokes(SHAPES[id]),
  }),
);
const candidateOf = (strokes: Stroke[]) => ({
  strokeCount: strokes.length,
  boundingBoxRatio: boundingBoxRatio(strokes.flat()),
  normalize: (n: number) => normalizeStrokes(strokes, n),
});
const templateOf = (id: string, strokes: Stroke[], n = NORMALIZED_POINT_COUNT) =>
  Q.toTemplate({
    id,
    strokeCount: strokes.length,
    boundingBoxRatio: boundingBoxRatio(strokes.flat()),
    normalizedGesturePoints: normalizeStrokes(strokes, n),
  });

describe('$Q recognize', () => {
  it("donne le même top 3 avec l'abandon anticipé qu'en force brute", () => {
    const rand = seededRandom(7);
    for (const name of names) {
      for (let k = 0; k < 5; k++) {
        const cand = candidateOf(variant(SHAPES[name], rand));
        const fast = Q.recognize(cand, templates);
        const points = cand.normalize(NORMALIZED_POINT_COUNT);
        const cloud = Q.toCloud(points);
        const structure = Q.strokeStructure(points);
        const brute = templates
          .filter((t) => Q.isCompatible(t, cand))
          .map((t) => ({
            signId: t.id,
            score:
              Q.distanceToScore(Q.greedyCloudMatch(cloud, t.cloud), NORMALIZED_POINT_COUNT) *
              Q.structureFactor(structure, t.structure),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        expect(fast.map((m) => m.signId)).toEqual(brute.map((m) => m.signId));
        fast.forEach((m, i) => expect(m.score).toBeCloseTo(brute[i].score, 12));
      }
    }
  });

  it('renvoie une liste vide sans candidat compatible', () => {
    expect(Q.recognize({ strokeCount: 0, boundingBoxRatio: 1, normalize: () => [] }, templates)).toEqual([]);
    const fourStrokes = candidateOf([...SHAPES['croix'], ...SHAPES['plus']]);
    expect(Q.recognize(fourStrokes, templates)).toEqual([]); // aucun modèle à 3+ traits
  });

  /**
   * Garde-fou de calibration (voir ZERO_CONFIDENCE_RMS) : 14 glyphes redessinés 20 fois.
   * Le remplacement automatique (> 0.8) ne doit jamais se tromper.
   */
  it('reconnaît les glyphes redessinés sans remplacement automatique erroné', () => {
    const rand = seededRandom(42);
    let top1 = 0;
    let top3 = 0;
    let autoWrong = 0;
    let total = 0;
    for (const name of names) {
      for (let k = 0; k < 20; k++) {
        const matches = Q.recognize(candidateOf(variant(SHAPES[name], rand)), templates);
        total++;
        if (matches[0]?.signId === name) top1++;
        if (matches.some((m) => m.signId === name)) top3++;
        if (matches[0] && matches[0].score > 0.8 && matches[0].signId !== name) autoWrong++;
      }
    }
    expect(autoWrong).toBe(0);
    expect(top1 / total).toBeGreaterThan(0.95);
    expect(top3 / total).toBeGreaterThan(0.99);
  });

  it("n'écarte pas une ligne légèrement inclinée au pré-filtrage (ratio borné)", () => {
    const rand = seededRandom(3);
    for (const name of ['ligneH', 'exclamation']) {
      const t = templates.find((x) => x.id === name)!;
      for (let k = 0; k < 20; k++) expect(Q.isCompatible(t, candidateOf(variant(SHAPES[name], rand)))).toBe(true);
    }
  });
});

/** Dessin composé de plusieurs formes côte à côte (ex. « ? → 8 »). */
const composite = (names: string[]): Stroke[] =>
  names.flatMap((name, i) => SHAPES[name].map((st) => st.map((p) => ({ x: p.x * 0.8 + i * 110, y: p.y * 0.8 }))));

describe('dessins complexes (plusieurs traits)', () => {
  const drawings: Record<string, string[]> = {
    a: ['exclamation', 'fleche', 'cercle'],
    b: ['croix', 'u'],
    c: ['plus', 'triangle', 'coche'],
    d: ['fleche', 'croix'],
    e: ['spirale', 'plus', 'ligneH'],
  };
  const complexTemplates = Object.entries(drawings).map(([id, names]) => templateOf(id, composite(names)));

  it('ne remplace jamais automatiquement par un dessin sans rapport, et reconnaît le bon', () => {
    const rand = seededRandom(21);
    let top1 = 0;
    let total = 0;
    for (const [id, names] of Object.entries(drawings)) {
      for (let k = 0; k < 10; k++) {
        const matches = Q.recognize(candidateOf(variant(composite(names), rand)), complexTemplates);
        total++;
        if (matches[0]?.signId === id) top1++;
        for (const m of matches) if (m.signId !== id) expect(m.score).toBeLessThanOrEqual(0.8);
      }
    }
    expect(top1 / total).toBeGreaterThanOrEqual(0.9);
  });

  it('pénalise une disposition de traits différente, pas un simple tremblement', () => {
    const rand = seededRandom(4);
    const st = (strokes: Stroke[]) => Q.strokeStructure(normalizeStrokes(strokes));
    const ref = st(composite(drawings['a']));
    expect(Q.structureFactor(st(variant(composite(drawings['a']), rand)), ref)).toBeGreaterThan(0.9);
    expect(Q.structureFactor(st(composite(['cercle', 'fleche', 'exclamation'])), ref)).toBeLessThan(0.7);
  });
});

describe('compatibilité des anciens signes (32 points)', () => {
  it('reconnaît un modèle à 32 points au milieu de modèles à 48 points', () => {
    const mixed = names.map((id) => templateOf(id, SHAPES[id], id === 'triangle' ? 32 : NORMALIZED_POINT_COUNT));
    const rand = seededRandom(13);
    const hits = Array.from({ length: 10 }, () => Q.recognize(candidateOf(variant(SHAPES['triangle'], rand)), mixed)[0]);
    expect(hits.filter((m) => m?.signId === 'triangle').length).toBeGreaterThanOrEqual(9);
  });
});
