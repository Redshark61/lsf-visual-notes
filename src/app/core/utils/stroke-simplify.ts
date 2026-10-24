import { Point } from '../models/sign.model';

/**
 * Simplification (« embellissement ») d'un trait dessiné à main levée :
 * ligne droite, segments droits, cercle, ellipse ou arc ; sinon le trait est laissé tel quel.
 * Module pur (aucun accès DOM) : coordonnées en px CSS.
 */
export type SimplifiedKind = 'line' | 'polyline' | 'circle' | 'ellipse' | 'arc' | 'free';

export interface SimplifyResult {
  kind: SimplifiedKind;
  points: Point[];
}

/** Espacement des points générés (≈ échantillonnage du canevas). */
const SPACING = 4;
/** En dessous, c'est un point ou un petit tiret : on ne touche à rien. */
const MIN_LENGTH = 15;
/** Tolérance d'alignement sur 0°, 45°, 90°… */
const SNAP_ANGLE = (6 * Math.PI) / 180;

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function pathLength(pts: Point[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
  return d;
}

function bboxDiagonal(pts: Point[]): number {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/** Distance du point p au segment [a, b]. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function maxDeviation(pts: Point[], a: Point, b: Point): number {
  return pts.reduce((m, p) => Math.max(m, segmentDistance(p, a, b)), 0);
}

/** Points régulièrement espacés de a à b (a inclus, b inclus si `withEnd`). */
function sampleSegment(a: Point, b: Point, withEnd: boolean): Point[] {
  const n = Math.max(1, Math.round(dist(a, b) / SPACING));
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }
  if (withEnd) out.push({ x: b.x, y: b.y }); // extrémité exacte (forme refermée sans écart d'arrondi)
  return out;
}

function samplePolyline(vertices: Point[]): Point[] {
  return vertices.flatMap((v, i) =>
    i === vertices.length - 1 ? [] : sampleSegment(v, vertices[i + 1], i === vertices.length - 2),
  );
}

/** Ramer-Douglas-Peucker : indices des sommets conservés. */
function rdp(pts: Point[], eps: number, first = 0, last = pts.length - 1, out: number[] = []): number[] {
  if (out.length === 0) out.push(first);
  let index = -1;
  let max = 0;
  for (let i = first + 1; i < last; i++) {
    const d = segmentDistance(pts[i], pts[first], pts[last]);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max > eps && index > 0) {
    rdp(pts, eps, first, index, out);
    rdp(pts, eps, index, last, out);
  } else {
    out.push(last);
  }
  return out;
}

/** Angle balayé (signé, radians) autour de c le long du trait. */
function sweptAngle(pts: Point[], c: Point): number {
  let total = 0;
  let prev = Math.atan2(pts[0].y - c.y, pts[0].x - c.x);
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i].y - c.y, pts[i].x - c.x);
    let d = a - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    total += d;
    prev = a;
  }
  return total;
}

/** Cercle des moindres carrés (méthode de Kåsa), calculé autour du centroïde pour la stabilité. */
function fitCircle(pts: Point[]): { c: Point; r: number; residual: number } | null {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx;
    const v = p.y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null; // points alignés
  const bu = (suuu + suvv) / 2;
  const bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det;
  const vc = (bv * suu - bu * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  const c = { x: uc + mx, y: vc + my };
  const residual = Math.sqrt(pts.reduce((s, p) => s + ((dist(p, c) - r) / r) ** 2, 0) / n);
  return { c, r, residual };
}

function sampleArc(c: Point, r: number, start: number, sweep: number): Point[] {
  const n = Math.max(8, Math.ceil((Math.abs(sweep) * r) / SPACING));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = start + (sweep * i) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

// --- Détecteurs

function asLine(pts: Point[], length: number): SimplifyResult | null {
  let a = pts[0];
  let b = pts[pts.length - 1];
  const chord = dist(a, b);
  if (chord / length < 0.9 || maxDeviation(pts, a, b) > Math.max(3, 0.05 * chord)) return null;
  // Alignement sur l'horizontale, la verticale ou les diagonales si l'écart est faible.
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  if (Math.abs(angle - snapped) < SNAP_ANGLE) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const h = chord / 2;
    a = { x: mid.x - h * Math.cos(snapped), y: mid.y - h * Math.sin(snapped) };
    b = { x: mid.x + h * Math.cos(snapped), y: mid.y + h * Math.sin(snapped) };
  }
  return { kind: 'line', points: sampleSegment(a, b, true) };
}

/**
 * Segments droits à angles nets (2 à 5 segments). Chaque segment doit être réellement droit et
 * chaque coin réellement marqué : un arrondi (U, cercle) n'est jamais transformé en polygone.
 */
function asPolyline(pts: Point[], length: number): SimplifyResult | null {
  const eps = Math.max(3, 0.05 * bboxDiagonal(pts));
  const idx = rdp(pts, eps);
  if (idx.length < 3 || idx.length > 6) return null;
  for (let i = 0; i < idx.length - 1; i++) {
    const a = pts[idx[i]];
    const b = pts[idx[i + 1]];
    const inner = pts.slice(idx[i], idx[i + 1] + 1);
    if (maxDeviation(inner, a, b) > Math.max(2.5, 0.06 * dist(a, b))) return null;
  }
  for (let i = 1; i < idx.length - 1; i++) {
    const [p, q, r] = [pts[idx[i - 1]], pts[idx[i]], pts[idx[i + 1]]];
    const turn = Math.abs(
      Math.atan2(
        (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x),
        (q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y),
      ),
    );
    if (turn < (25 * Math.PI) / 180) return null;
  }
  const vertices = idx.map((i) => ({ x: pts[i].x, y: pts[i].y }));
  const closed = dist(vertices[0], vertices[vertices.length - 1]) < Math.max(10, 0.12 * length);
  if (closed && vertices.length >= 4) vertices[vertices.length - 1] = { ...vertices[0] };
  return { kind: 'polyline', points: samplePolyline(vertices) };
}

function asClosedCurve(pts: Point[], length: number): SimplifyResult | null {
  if (dist(pts[0], pts[pts.length - 1]) > 0.2 * length) return null;
  const circle = fitCircle(pts);
  if (!circle) return null;
  const sweep = sweptAngle(pts, circle.c);
  if (Math.abs(sweep) < 1.6 * Math.PI) return null;
  const direction = Math.sign(sweep);
  if (circle.residual <= 0.1) {
    const start = Math.atan2(pts[0].y - circle.c.y, pts[0].x - circle.c.x);
    return { kind: 'circle', points: sampleArc(circle.c, circle.r, start, direction * 2 * Math.PI) };
  }
  return asEllipse(pts, direction);
}

/** Ellipse (éventuellement inclinée) par analyse en composantes principales. */
function asEllipse(pts: Point[], direction: number): SimplifyResult | null {
  const n = pts.length;
  const m = { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  let cxx = 0, cyy = 0, cxy = 0;
  for (const p of pts) {
    cxx += (p.x - m.x) ** 2;
    cyy += (p.y - m.y) ** 2;
    cxy += (p.x - m.x) * (p.y - m.y);
  }
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const [cos, sin] = [Math.cos(theta), Math.sin(theta)];
  const uv = pts.map((p) => ({ u: (p.x - m.x) * cos + (p.y - m.y) * sin, v: -(p.x - m.x) * sin + (p.y - m.y) * cos }));
  const a = Math.sqrt((2 * uv.reduce((s, q) => s + q.u * q.u, 0)) / n);
  const b = Math.sqrt((2 * uv.reduce((s, q) => s + q.v * q.v, 0)) / n);
  if (!a || !b || b / a > 0.95) return null;
  const residual = Math.sqrt(uv.reduce((s, q) => s + (Math.hypot(q.u / a, q.v / b) - 1) ** 2, 0) / n);
  if (residual > 0.12) return null;
  const t0 = Math.atan2(uv[0].v / b, uv[0].u / a);
  const count = Math.max(16, Math.ceil((Math.PI * (a + b)) / SPACING));
  const points = Array.from({ length: count + 1 }, (_, i) => {
    const t = t0 + (direction * 2 * Math.PI * i) / count;
    const [u, v] = [a * Math.cos(t), b * Math.sin(t)];
    return { x: m.x + u * cos - v * sin, y: m.y + u * sin + v * cos };
  });
  return { kind: 'ellipse', points };
}

function asArc(pts: Point[]): SimplifyResult | null {
  const circle = fitCircle(pts);
  if (!circle || circle.residual > 0.07) return null;
  const sweep = sweptAngle(pts, circle.c);
  const span = Math.abs(sweep);
  if (span < (40 * Math.PI) / 180 || span > (300 * Math.PI) / 180) return null;
  const start = Math.atan2(pts[0].y - circle.c.y, pts[0].x - circle.c.x);
  return { kind: 'arc', points: sampleArc(circle.c, circle.r, start, sweep) };
}

export function simplifyStroke(stroke: Point[]): SimplifyResult {
  const pts = stroke.map((p) => ({ x: p.x, y: p.y }));
  const length = pts.length >= 3 ? pathLength(pts) : 0;
  if (length < MIN_LENGTH) return { kind: 'free', points: stroke };
  return (
    asLine(pts, length) ??
    asPolyline(pts, length) ??
    asClosedCurve(pts, length) ??
    asArc(pts) ?? { kind: 'free', points: stroke }
  );
}
