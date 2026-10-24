import { describe, expect, it } from 'vitest';
import { simplifyStroke } from './stroke-simplify';
import { Point } from '../models/sign.model';
import { seededRandom } from '../../../testing/shapes';

/** Tracé « à main levée » : ~4 px entre points, tremblement + légère ondulation. */
function handDrawn(path: (t: number) => Point, length: number, rand: () => number, noise = 1.5): Point[] {
  const n = Math.max(8, Math.round(length / 4));
  const phase = rand() * 6;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const p = path(t);
    const wobble = Math.sin(t * 7 + phase) * noise;
    return { x: p.x + (rand() - 0.5) * 2 * noise + wobble, y: p.y + (rand() - 0.5) * 2 * noise - wobble };
  });
}
const polyPath = (v: number[][]) => (t: number) => {
  const segs = v.length - 1;
  const k = Math.min(segs - 1, Math.floor(t * segs));
  const u = t * segs - k;
  return { x: v[k][0] + u * (v[k + 1][0] - v[k][0]), y: v[k][1] + u * (v[k + 1][1] - v[k][1]) };
};
const circlePath = (cx: number, cy: number, r: number, from = 0, sweep = 2 * Math.PI) => (t: number) => ({
  x: cx + r * Math.cos(from + sweep * t),
  y: cy + r * Math.sin(from + sweep * t),
});
const kindsOver = (make: (rand: () => number) => Point[], runs = 20, seed = 1) => {
  const rand = seededRandom(seed);
  return Array.from({ length: runs }, () => simplifyStroke(make(rand)).kind);
};

describe('simplifyStroke', () => {
  it('redresse une ligne tremblée et l’aligne sur l’horizontale', () => {
    const rand = seededRandom(2);
    const r = simplifyStroke(handDrawn(polyPath([[20, 100], [220, 108]]), 200, rand));
    expect(r.kind).toBe('line');
    const [a, b] = [r.points[0], r.points[r.points.length - 1]];
    expect(Math.abs(a.y - b.y)).toBeLessThan(1e-6); // 2,3° d'inclinaison → horizontale
    expect(r.points.every((p) => p.pressure === undefined)).toBe(true);
  });

  it('reconnaît les lignes de façon fiable', () => {
    expect(kindsOver((rand) => handDrawn(polyPath([[0, 0], [150, 90]]), 175, rand))).toEqual(Array(20).fill('line'));
  });

  it('transforme un triangle en 3 segments fermés', () => {
    const kinds = kindsOver((rand) => handDrawn(polyPath([[100, 0], [200, 170], [0, 170], [100, 0]]), 590, rand));
    expect(kinds.filter((k) => k === 'polyline').length).toBeGreaterThanOrEqual(18);
    const r = simplifyStroke(handDrawn(polyPath([[100, 0], [200, 170], [0, 170], [100, 0]]), 590, seededRandom(5)));
    if (r.kind === 'polyline') {
      expect(r.points[0]).toEqual(r.points[r.points.length - 1]); // forme refermée
    }
  });

  it('garde un carré anguleux (jamais transformé en cercle)', () => {
    const kinds = kindsOver((rand) => handDrawn(polyPath([[0, 0], [150, 0], [150, 150], [0, 150], [0, 0]]), 600, rand));
    expect(kinds).not.toContain('circle');
    expect(kinds.filter((k) => k === 'polyline').length).toBeGreaterThanOrEqual(18);
  });

  it('régularise un cercle mal fait (même mal refermé)', () => {
    const kinds = kindsOver((rand) => handDrawn(circlePath(150, 150, 80, 0.3, 2 * Math.PI * 0.95), 480, rand, 3));
    expect(kinds.filter((k) => k === 'circle').length).toBeGreaterThanOrEqual(18);
    const r = simplifyStroke(handDrawn(circlePath(150, 150, 80), 500, seededRandom(9), 3));
    expect(r.kind).toBe('circle');
    // Centre du cercle produit (moyenne d'un tour complet, sans le point de fermeture en double).
    const ring = r.points.slice(0, -1);
    const c = { x: ring.reduce((t, p) => t + p.x, 0) / ring.length, y: ring.reduce((t, p) => t + p.y, 0) / ring.length };
    expect(Math.hypot(c.x - 150, c.y - 150)).toBeLessThan(5); // proche du centre voulu
    const radii = ring.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-6); // cercle parfait
    expect(Math.abs(radii[0] - 80)).toBeLessThan(5);
  });

  it('reconnaît une ellipse allongée', () => {
    const ellipse = (t: number) => ({ x: 150 + 120 * Math.cos(2 * Math.PI * t), y: 100 + 50 * Math.sin(2 * Math.PI * t) });
    const kinds = kindsOver((rand) => handDrawn(ellipse, 560, rand, 2));
    expect(kinds.filter((k) => k === 'ellipse').length).toBeGreaterThanOrEqual(18);
  });

  it('régularise un arc (demi-cercle) sans le rendre anguleux', () => {
    const kinds = kindsOver((rand) => handDrawn(circlePath(150, 100, 80, Math.PI, Math.PI), 250, rand));
    expect(kinds).not.toContain('polyline');
    expect(kinds.filter((k) => k === 'arc').length).toBeGreaterThanOrEqual(18);
  });

  it('laisse intacts les traits libres (spirale, S, zigzag doux)', () => {
    const spiral = (t: number) => ({ x: 150 + 90 * t * Math.cos(t * 12), y: 150 + 90 * t * Math.sin(t * 12) });
    const s = (t: number) => ({ x: 50 + 200 * t, y: 100 + 60 * Math.sin(t * 2 * Math.PI) });
    expect(kindsOver((rand) => handDrawn(spiral, 600, rand))).toEqual(Array(20).fill('free'));
    expect(kindsOver((rand) => handDrawn(s, 300, rand))).toEqual(Array(20).fill('free'));
  });

  it('ne touche pas aux points et petits tirets', () => {
    expect(simplifyStroke([{ x: 5, y: 5 }]).kind).toBe('free');
    expect(simplifyStroke([{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 8, y: 0 }]).kind).toBe('free');
  });
});
