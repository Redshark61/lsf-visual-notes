import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BoardObject,
  InkObject,
  MAX_BOARD_OBJECTS,
  MAX_SIGN_SCALE,
  MAX_TEXT_SIZE,
  MIN_SIGN_SCALE,
  MIN_TEXT_SIZE,
  SIGN_BASE_SIZE,
  SignObject,
} from '../models/board.model';
import { Point, Stroke } from '../models/sign.model';
import { PEN_OPTIONS, strokeToSvgPath } from './freehand';
import { Rect } from './board-view';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// --- Géométrie des objets

/** Emprise (estimée pour le texte) d'un objet, pour le replacer dans le plateau et ajuster la vue. */
export function objectBounds(o: BoardObject): Rect {
  switch (o.type) {
    case 'ink':
      return { x: o.x, y: o.y, width: o.w, height: o.h };
    case 'sign': {
      const size = SIGN_BASE_SIZE * o.scale;
      return { x: o.x, y: o.y, width: size, height: size };
    }
    case 'text': {
      const lines = o.text.split('\n');
      const longest = Math.max(...lines.map((l) => l.length), 1);
      return { x: o.x, y: o.y, width: longest * o.size * 0.6, height: lines.length * o.size * 1.25 };
    }
  }
}

export function contentBounds(objects: readonly BoardObject[]): Rect | null {
  if (!objects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of objects) {
    const b = objectBounds(o);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// --- Opérations sur la scène (immuables)

export function canAddObject(objects: readonly BoardObject[]): boolean {
  return objects.length < MAX_BOARD_OBJECTS;
}

export function addObject(objects: readonly BoardObject[], object: BoardObject): BoardObject[] {
  return canAddObject(objects) ? [...objects, object] : [...objects];
}

export function addObjects(objects: readonly BoardObject[], added: readonly BoardObject[]): BoardObject[] {
  return [...objects, ...added].slice(0, MAX_BOARD_OBJECTS);
}

export function removeObject(objects: readonly BoardObject[], id: string): BoardObject[] {
  return objects.filter((o) => o.id !== id);
}

export function replaceObject(objects: readonly BoardObject[], object: BoardObject): BoardObject[] {
  return objects.map((o) => (o.id === object.id ? object : o));
}

/** Déplace un objet sans jamais le faire sortir du plateau. */
export function moveObject(objects: readonly BoardObject[], id: string, dx: number, dy: number): BoardObject[] {
  return objects.map((o) => {
    if (o.id !== id) return o;
    const b = objectBounds(o);
    return {
      ...o,
      x: clamp(o.x + dx, 0, Math.max(0, BOARD_WIDTH - b.width)),
      y: clamp(o.y + dy, 0, Math.max(0, BOARD_HEIGHT - b.height)),
    };
  });
}

/** Agrandit ou réduit un signe (échelle) ou un texte (taille) ; l'encre ne change pas. */
export function resizeObject(objects: readonly BoardObject[], id: string, factor: number): BoardObject[] {
  return objects.map((o) => {
    if (o.id !== id) return o;
    if (o.type === 'sign') return { ...o, scale: round(clamp(o.scale * factor, MIN_SIGN_SCALE, MAX_SIGN_SCALE)) };
    if (o.type === 'text') return { ...o, size: Math.round(clamp(o.size * factor, MIN_TEXT_SIZE, MAX_TEXT_SIZE)) };
    return o;
  });
}

const round = (v: number) => Math.round(v * 100) / 100;

// --- Historique (annuler / rétablir)

export const HISTORY_LIMIT = 100;

export interface History<T> {
  past: T[];
  future: T[];
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

/** Mémorise l'état courant avant une modification (efface le « rétablir »). */
export function pushHistory<T>(h: History<T>, current: T): History<T> {
  return { past: [...h.past, current].slice(-HISTORY_LIMIT), future: [] };
}

export function undoHistory<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  const value = h.past.at(-1);
  if (value === undefined) return null;
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, value };
}

export function redoHistory<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  const [value, ...future] = h.future;
  if (value === undefined) return null;
  return { history: { past: [...h.past, current], future }, value };
}

// --- Création d'objets

/**
 * Trait à main levée → objet encre. `penSize` est l'épaisseur en unités du plateau. Le chemin est
 * relatif au coin de l'objet pour qu'un déplacement ne change que (x, y).
 */
export function inkFromPoints(
  points: readonly Point[],
  color: string,
  penSize: number,
  id: string = crypto.randomUUID(),
): InkObject | null {
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = penSize;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const d = strokeToSvgPath(
    points.map((p) => ({ x: p.x - x, y: p.y - y })),
    { ...PEN_OPTIONS, size: penSize },
  );
  if (!d) return null;
  return {
    type: 'ink',
    id,
    x: round(x),
    y: round(y),
    w: round(Math.max(...xs) - Math.min(...xs) + 2 * pad),
    h: round(Math.max(...ys) - Math.min(...ys) + 2 * pad),
    d,
    color,
  };
}

/** Position et échelle d'un signe reconnu à partir du dessin : il apparaît où et à la taille du tracé. */
export function signPlacement(strokes: readonly Stroke[]): { x: number; y: number; scale: number } {
  const all = strokes.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const scale = round(clamp(Math.max(width, height) / SIGN_BASE_SIZE, 0.6, 5));
  const size = SIGN_BASE_SIZE * scale;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return {
    x: round(clamp(cx - size / 2, 0, BOARD_WIDTH - size)),
    y: round(clamp(cy - size / 2, 0, BOARD_HEIGHT - size)),
    scale,
  };
}

/** Signe centré sur un point (recherche puis tap sur le plateau, ou insertion au centre de la vue). */
export function signAt(signId: string, center: Point, scale = 1, id: string = crypto.randomUUID()): SignObject {
  const size = SIGN_BASE_SIZE * scale;
  return {
    type: 'sign',
    id,
    signId,
    scale,
    x: round(clamp(center.x - size / 2, 0, BOARD_WIDTH - size)),
    y: round(clamp(center.y - size / 2, 0, BOARD_HEIGHT - size)),
  };
}
