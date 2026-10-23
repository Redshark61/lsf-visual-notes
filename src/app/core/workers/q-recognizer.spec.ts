import { describe, expect, it } from 'vitest';
import { boundingBoxRatio, normalizeStrokes } from '../utils/gesture-geometry';
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
const candidateOf = (strokes: (typeof SHAPES)[string]) => ({
  normalizedPoints: normalizeStrokes(strokes),
  strokeCount: strokes.length,
  boundingBoxRatio: boundingBoxRatio(strokes.flat()),
});

describe('$Q recognize', () => {
  it("donne le même top 3 avec l'abandon anticipé qu'en force brute", () => {
    const rand = seededRandom(7);
    for (const name of names) {
      for (let k = 0; k < 5; k++) {
        const cand = candidateOf(variant(SHAPES[name], rand));
        const fast = Q.recognize(cand, templates);
        const cloud = Q.toCloud(cand.normalizedPoints);
        const brute = templates
          .filter((t) => Q.isCompatible(t, cand))
          .map((t) => ({ signId: t.id, score: Q.distanceToScore(Q.greedyCloudMatch(cloud, t.cloud), 32) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        expect(fast.map((m) => m.signId)).toEqual(brute.map((m) => m.signId));
        fast.forEach((m, i) => expect(m.score).toBeCloseTo(brute[i].score, 12));
      }
    }
  });

  it('renvoie une liste vide sans candidat compatible', () => {
    expect(Q.recognize({ normalizedPoints: [], strokeCount: 0, boundingBoxRatio: 1 }, templates)).toEqual([]);
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
