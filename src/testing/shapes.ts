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

/** Gribouillis sans rapport avec un dictionnaire de formes : marches aléatoires lisses de 1 à 3 traits. */
export function scribble(rand: () => number): Stroke[] {
  return Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
    const points: Stroke = [];
    let x = rand() * 100;
    let y = rand() * 100;
    let angle = rand() * 6.28;
    const n = 12 + Math.floor(rand() * 30);
    for (let i = 0; i < n; i++) {
      angle += (rand() - 0.5) * 1.6;
      x += Math.cos(angle) * 6;
      y += Math.sin(angle) * 6;
      points.push({ x: x * 2 + 300, y: y * 2 + 300 });
    }
    return points;
  });
}

// --- Variations réalistes d'un redessin (pour mesurer la tolérance de la reconnaissance)

export interface Variation {
  /** Pixels par unité de forme (la forme fait 100 unités) : [min, max]. */
  scale: [number, number];
  /** Écart maximal de proportions (1 = aucun). */
  aspect: number;
  /** Rotation maximale, en radians. */
  rot: number;
  /** Déformation douce de la forme, en unités. */
  deform: number;
  /** Tremblement de la main en pixels : constant, donc plus gênant sur un petit dessin. */
  tremor: number;
  /** Probabilité de couper un tracé unique en deux traits. */
  split: number;
}

export const VARIATIONS = {
  /** Modèle enregistré : un dessin soigné. */
  mild: { scale: [1.2, 2], aspect: 1.08, rot: 0.05, deform: 2, tremor: 1, split: 0 },
  /** Seulement la taille (de 35 à 320 px) et le tremblement. */
  size: { scale: [0.35, 3.2], aspect: 1.0, rot: 0, deform: 0, tremor: 1.8, split: 0 },
  /** « Un peu différent » : proportions, légère rotation, forme déformée, trait coupé. */
  slight: { scale: [1.2, 2], aspect: 1.25, rot: 0.2, deform: 7, tremor: 1.2, split: 0.1 },
  /** Tout à la fois. */
  hard: { scale: [0.35, 3.2], aspect: 1.3, rot: 0.26, deform: 6, tremor: 1.8, split: 0.12 },
} satisfies Record<string, Variation>;

/** Garde un point tous les `minDist` px, comme la saisie (un point au moins tous les 4 px). */
function thin(points: Stroke, minDist: number): Stroke {
  const out = [points[0]];
  for (const p of points.slice(1, -1)) {
    const last = out[out.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function vary(strokes: Stroke[], rand: () => number, v: Variation): Stroke[] {
  const s = v.scale[0] + rand() * (v.scale[1] - v.scale[0]);
  const a = Math.exp((rand() * 2 - 1) * Math.log(v.aspect));
  const sx = s * Math.sqrt(a);
  const sy = s / Math.sqrt(a);
  const rot = (rand() * 2 - 1) * v.rot;
  const [cos, sin] = [Math.cos(rot), Math.sin(rot)];
  const amp = v.deform * (0.5 + rand() * 0.5);
  const [f1, f2] = [0.7 + rand() * 1.3, 0.7 + rand() * 1.3];
  const [p1, p2] = [rand() * 6.28, rand() * 6.28];
  const [tx, ty] = [200 + rand() * 600, 200 + rand() * 400];
  const transform = (p: { x: number; y: number }) => {
    let x = p.x - 50;
    let y = p.y - 50;
    x += amp * Math.sin(2 * Math.PI * (p.y / 100) * f1 + p1);
    y += amp * Math.sin(2 * Math.PI * (p.x / 100) * f2 + p2);
    x *= sx;
    y *= sy;
    return {
      x: tx + x * cos - y * sin + (rand() - 0.5) * 2 * v.tremor,
      y: ty + x * sin + y * cos + (rand() - 0.5) * 2 * v.tremor,
    };
  };
  let out = strokes.map((st) => (st.length > 1 ? thin(st.map(transform), 4) : st.map(transform)));
  if (out.length === 1 && rand() < v.split && out[0].length > 8) {
    const k = 3 + Math.floor(rand() * (out[0].length - 6));
    out = [out[0].slice(0, k + 1), out[0].slice(k)];
  }
  return out;
}
