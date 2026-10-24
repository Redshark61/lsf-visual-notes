import { describe, expect, it } from 'vitest';
import { NORMALIZED_POINT_COUNT, boundingBox, boundingBoxRatio, normalizeStrokes } from './gesture-geometry';
import { extractGesture } from './gesture';
import { arc } from '../../../testing/shapes';

const maxDiff = (a: { x: number; y: number }[], b: { x: number; y: number }[]) =>
  Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
const circle = (cx: number, cy: number, r: number) => arc(0, 2 * Math.PI, r, cx, cy);

describe('normalizeStrokes', () => {
  it('est insensible à la taille et à la position, dans une boîte 1x1', () => {
    const big = normalizeStrokes([circle(400, 300, 200)]);
    const small = normalizeStrokes([circle(20, 700, 15)]);
    expect(big).toHaveLength(NORMALIZED_POINT_COUNT);
    expect(maxDiff(big, small)).toBeLessThan(1e-6);
    const bb = boundingBox(big);
    expect(Math.max(bb.width, bb.height)).toBeCloseTo(1, 6);
  });

  it('ne déforme pas une ligne droite en diagonale (mise à l\'échelle proportionnelle)', () => {
    const h = boundingBox(normalizeStrokes([[{ x: 10, y: 50 }, { x: 300, y: 52 }]]));
    expect(h.width).toBeGreaterThan(0.99);
    expect(h.height).toBeLessThan(0.01);
    expect(boundingBox(normalizeStrokes([[{ x: 50, y: 10 }, { x: 50, y: 300 }]])).width).toBeLessThan(0.01);
  });

  it('répartit les points sur plusieurs traits et centre le nuage sur (0,0)', () => {
    const cross = normalizeStrokes([
      [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      [{ x: 100, y: 0 }, { x: 0, y: 100 }],
    ]);
    expect(cross).toHaveLength(NORMALIZED_POINT_COUNT);
    expect([...new Set(cross.map((p) => p.strokeId))]).toEqual([1, 2]);
    expect(cross.reduce((s, p) => s + p.x, 0) / cross.length).toBeCloseTo(0, 9);
    expect(cross.reduce((s, p) => s + p.y, 0) / cross.length).toBeCloseTo(0, 9);
  });

  it('gère un simple tap sans NaN', () => {
    const tap = normalizeStrokes([[{ x: 5, y: 5 }], []]);
    expect(tap).toHaveLength(NORMALIZED_POINT_COUNT);
    expect(tap.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe('boundingBoxRatio', () => {
  it('reste fini et borné à [1/3, 3] pour les lignes', () => {
    expect(boundingBoxRatio([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe(3);
    expect(boundingBoxRatio([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toBeCloseTo(1 / 3);
  });
});

describe('extractGesture', () => {
  it('renvoie null sans trait', () => {
    expect(extractGesture([[], []])).toBeNull();
  });

  it('produit un chemin SVG sûr dans le viewBox 0..100', () => {
    const g = extractGesture([
      circle(400, 300, 200),
      [{ x: 200, y: 300, pressure: 0.8 }, { x: 600, y: 300, pressure: 0.3 }],
    ])!;
    expect(g.strokeCount).toBe(2);
    expect(g.normalizedGesturePoints).toHaveLength(NORMALIZED_POINT_COUNT);
    // Un chemin par trait (couleurs individuelles), dont la concaténation donne svgPathData.
    expect(g.strokes).toHaveLength(2);
    expect(g.strokes!.map((s) => s.d).join(' ')).toBe(g.svgPathData);
    expect(g.svgPathData).toMatch(/^M[\d.,\sQTMZ-]+Z$/);
    const nums = g.svgPathData.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...nums)).toBeLessThanOrEqual(100);
  });
});
