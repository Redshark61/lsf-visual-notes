import { describe, expect, it } from 'vitest';
import { NORMALIZED_POINT_COUNT, boundingBoxRatio, normalizeStrokes } from '../utils/gesture-geometry';
import { Stroke } from '../models/sign.model';
import * as Q from './q-recognizer';
import { SHAPES, VARIATIONS, Variation, scribble, seededRandom, variant, vary } from '../../../testing/shapes';
import { decideMatches } from '../utils/recognition-policy';

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
  it("le groupe d'essai des variantes ne change pas le meilleur signe (abandon anticipé sans perte)", () => {
    const rand = seededRandom(7);
    for (const name of names) {
      for (let k = 0; k < 5; k++) {
        const cand = candidateOf(variant(SHAPES[name], rand));
        const fast = Q.recognize(cand, templates); // groupe de 8 : abandon anticipé
        const exhaustive = Q.recognize(cand, templates, 3, Infinity); // toutes les variantes, aucun abandon
        expect(fast[0].signId).toBe(exhaustive[0].signId);
        for (const m of fast) {
          expect(m.score).toBeGreaterThanOrEqual(0);
          expect(m.score).toBeLessThanOrEqual(1);
        }
        expect(fast.map((m) => m.score)).toEqual([...fast.map((m) => m.score)].sort((x, y) => y - x));
      }
    }
  });

  it('renvoie une liste vide sans candidat compatible', () => {
    expect(Q.recognize({ strokeCount: 0, boundingBoxRatio: 1, normalize: () => [] }, templates)).toEqual([]);
    // 5 traits : aucun modèle n'a 3 traits ou plus (tolérance de ±2 traits).
    const fiveStrokes = candidateOf([...SHAPES['croix'], ...SHAPES['plus'], ...SHAPES['ligneH']]);
    expect(Q.recognize(fiveStrokes, templates)).toEqual([]);
  });

  /**
   * Garde-fou de calibration : 14 glyphes redessinés avec des variations réalistes. Le remplacement
   * automatique (politique de recognition-policy.ts) doit presque jamais se tromper, et reconnaître
   * la grande majorité des redessins.
   */
  describe('tolérance aux variations d\'un redessin', () => {
    const mildRand = seededRandom(99);
    const mildTemplates = names.map((id) => templateOf(id, vary(SHAPES[id], mildRand, VARIATIONS.mild)));

    function measure(v: Variation, seed: number, perShape = 25) {
      const rand = seededRandom(seed);
      let total = 0;
      let top1 = 0;
      let top3 = 0;
      let autoOk = 0;
      let autoWrong = 0;
      for (const name of names) {
        for (let k = 0; k < perShape; k++) {
          const matches = Q.recognize(candidateOf(vary(SHAPES[name], rand, v)), mildTemplates);
          total++;
          if (matches[0]?.signId === name) top1++;
          if (matches.some((m) => m.signId === name)) top3++;
          if (decideMatches(matches) === 'auto') (matches[0].signId === name ? autoOk++ : autoWrong++);
        }
      }
      return { top1: top1 / total, top3: top3 / total, autoOk: autoOk / total, autoWrong: autoWrong / total };
    }

    it('la taille seule ne gêne pas la reconnaissance', () => {
      const r = measure(VARIATIONS.size, 11);
      expect(r.top1).toBe(1);
      expect(r.autoWrong).toBe(0);
      expect(r.autoOk).toBeGreaterThan(0.95);
    });

    it('un redessin « un peu différent » est reconnu sans se tromper', () => {
      const r = measure(VARIATIONS.slight, 12);
      expect(r.top1).toBeGreaterThan(0.95);
      expect(r.top3).toBeGreaterThan(0.99);
      expect(r.autoWrong).toBeLessThan(0.02);
      expect(r.autoOk).toBeGreaterThan(0.85); // était ~40 % avec le seuil de 80 %
    });

    it('un redessin difficile (tout à la fois) reste bien reconnu', () => {
      const r = measure(VARIATIONS.hard, 13);
      expect(r.top1).toBeGreaterThan(0.94);
      expect(r.top3).toBeGreaterThan(0.98);
      expect(r.autoWrong).toBeLessThan(0.03);
      expect(r.autoOk).toBeGreaterThan(0.85);
    });

    it('un cercle tracé en deux fois (stylet levé) est reconnu comme le cercle', () => {
      const circle = SHAPES['cercle'][0];
      const half = Math.floor(circle.length / 2);
      const twoStrokes = [circle.slice(0, half + 1), circle.slice(half)];
      const matches = Q.recognize(candidateOf(twoStrokes), templates);
      expect(matches[0].signId).toBe('cercle');
      expect(decideMatches(matches)).toBe('auto');
    });

    it('un gribouillis hors dictionnaire est rarement pris pour un signe (garde-fou de la pénalité de traits)', () => {
      const rand = seededRandom(3);
      let auto = 0;
      const trials = 300;
      for (let i = 0; i < trials; i++) {
        if (decideMatches(Q.recognize(candidateOf(scribble(rand)), mildTemplates)) === 'auto') auto++;
      }
      expect(auto / trials).toBeLessThan(0.25); // mesuré : ~15 % (28 % sans pénalité pour un nombre de traits différent)
    });
  });

  it('reconnaît les glyphes redessinés (anciennes variations, tremblement proportionnel)', () => {
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
        if (decideMatches(matches) === 'auto' && matches[0].signId !== name) autoWrong++;
      }
    }
    expect(autoWrong / total).toBeLessThan(0.02);
    expect(top1 / total).toBeGreaterThan(0.95);
    expect(top3 / total).toBeGreaterThan(0.99);
  });

  it('le pré-filtrage tolère un trait de plus ou de moins et des proportions un peu autres', () => {
    const base = { strokeCount: 2, boundingBoxRatio: 1.0 };
    const t = Q.toTemplate({ id: 't', ...base, normalizedGesturePoints: normalizeStrokes(SHAPES['croix']) });
    expect(Q.isCompatible(t, { ...base, strokeCount: 1, normalize: () => [] })).toBe(true);
    expect(Q.isCompatible(t, { ...base, strokeCount: 4, normalize: () => [] })).toBe(true);
    expect(Q.isCompatible(t, { ...base, strokeCount: 5, normalize: () => [] })).toBe(false);
    expect(Q.isCompatible(t, { ...base, boundingBoxRatio: 1.9, normalize: () => [] })).toBe(true);
    expect(Q.isCompatible(t, { ...base, boundingBoxRatio: 2.4, normalize: () => [] })).toBe(false);
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

  it('ne remplace presque jamais automatiquement par un dessin sans rapport, et reconnaît le bon', () => {
    const rand = seededRandom(21);
    let top1 = 0;
    let autoWrong = 0;
    let total = 0;
    for (const [id, names] of Object.entries(drawings)) {
      for (let k = 0; k < 10; k++) {
        const matches = Q.recognize(candidateOf(variant(composite(names), rand)), complexTemplates);
        total++;
        if (matches[0]?.signId === id) top1++;
        if (decideMatches(matches) === 'auto' && matches[0].signId !== id) autoWrong++;
      }
    }
    expect(autoWrong / total).toBeLessThanOrEqual(0.02);
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

describe('lissage, étirement et rotation', () => {
  const pts = (list: [number, number, number][]) => list.map(([x, y, strokeId]) => ({ x, y, strokeId }));

  it('le lissage garde les extrémités et ne mélange pas deux traits', () => {
    const input = pts([[0, 0, 1], [1, 4, 1], [2, 0, 1], [10, 10, 2], [11, 14, 2], [12, 10, 2]]);
    const out = Q.smoothPoints(input);
    expect(out[0]).toEqual(input[0]);
    expect(out[2]).toEqual(input[2]); // extrémité du 1er trait
    expect(out[3]).toEqual(input[3]); // début du 2e trait
    expect(out[5]).toEqual(input[5]);
    expect(out[1].y).toBeCloseTo(2, 9); // (0 + 2×4 + 0) / 4 : le pic est atténué
    expect(out[4].y).toBeCloseTo(12, 9);
  });

  it('étire une forme sur une boîte 1×1, centrée ; jamais une ligne', () => {
    const rect = pts([[0, 0, 1], [4, 0, 1], [4, 2, 1], [0, 2, 1]]);
    const stretched = Q.stretchPoints(rect)!;
    const xs = stretched.map((p) => p.x);
    const ys = stretched.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 9);
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 9);
    expect(Q.stretchPoints(pts([[0, 0, 1], [10, 0.5, 1]]))).toBeNull();
    expect(Q.stretchPoints([])).toBeNull();
  });

  it('tourne les points autour de l\'origine', () => {
    const [p] = Q.rotatePoints(pts([[1, 0, 1]]), 90);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(1, 9);
  });
});
