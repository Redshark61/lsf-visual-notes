import { Stroke } from '../app/core/models/sign.model';

/** Formes de référence (glyphes synthétiques) pour tester la géométrie et la reconnaissance. */
const poly = (pts: number[][], per = 20): Stroke => {
  const out: Stroke = [];
  for (let i = 0; i < pts.length - 1; i++)
    for (let k = 0; k < per; k++) {
      const t = k / per;
      out.push({ x: pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), y: pts[i][1] + t * (pts[i + 1][1] - pts[i][1]) });
    }
  const last = pts[pts.length - 1];
  out.push({ x: last[0], y: last[1] });
  return out;
};

export const arc = (from: number, to: number, r = 50, cx = 50, cy = 50, n = 60): Stroke =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

export const SHAPES: Record<string, Stroke[]> = {
  cercle: [arc(0, 2 * Math.PI)],
  triangle: [poly([[50, 0], [100, 90], [0, 90], [50, 0]])],
  carre: [poly([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]])],
  zigzag: [poly([[0, 0], [25, 60], [50, 0], [75, 60], [100, 0]])],
  coche: [poly([[0, 50], [30, 90], [100, 0]])],
  croix: [poly([[0, 0], [100, 100]]), poly([[100, 0], [0, 100]])],
  plus: [poly([[50, 0], [50, 100]]), poly([[0, 50], [100, 50]])],
  exclamation: [poly([[50, 0], [50, 70]]), [{ x: 50, y: 95 }]],
  ligneH: [poly([[0, 50], [100, 50]])],
  vague: [Array.from({ length: 80 }, (_, i) => ({ x: i * 1.25, y: 50 + 25 * Math.sin((i / 80) * 4 * Math.PI) }))],
  spirale: [
    Array.from({ length: 120 }, (_, i) => ({
      x: 50 + (i / 120) * 50 * Math.cos(i / 8),
      y: 50 + (i / 120) * 50 * Math.sin(i / 8),
    })),
  ],
  maison: [poly([[0, 100], [0, 40], [50, 0], [100, 40], [100, 100], [0, 100]])],
  u: [arc(Math.PI, 0).map((p) => ({ x: p.x, y: 100 - p.y }))],
  fleche: [poly([[0, 50], [100, 50]]), poly([[70, 20], [100, 50], [70, 80]])],
};

/** Générateur pseudo-aléatoire déterministe (tests reproductibles). */
export function seededRandom(seed = 42): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Redessin « humain » : échelle, position, rotation ±10°, bruit 3 %, échantillonnage irrégulier. */
export function variant(strokes: Stroke[], rand: () => number): Stroke[] {
  const s = 0.3 + rand() * 3;
  const dx = rand() * 500;
  const dy = rand() * 500;
  const rot = (rand() - 0.5) * (Math.PI / 9);
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  return strokes.map((st) =>
    st
      .filter((_, i) => i === 0 || i === st.length - 1 || rand() > 0.3)
      .map((p) => {
        const x = p.x - 50 + (rand() - 0.5) * 6;
        const y = p.y - 50 + (rand() - 0.5) * 6;
        return { x: dx + s * (x * c - y * sn), y: dy + s * (x * sn + y * c) };
      }),
  );
}
