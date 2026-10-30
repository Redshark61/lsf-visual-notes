import { BOARD_HEIGHT, BOARD_WIDTH } from '../models/board.model';
import { Point } from '../models/sign.model';

/** Vue du plateau : écran = monde × zoom + déplacement. */
export interface BoardView {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_ZOOM = 4;
/** Marge autour du contenu quand on « ajuste » la vue. */
const FIT_MARGIN = 60;
const MAX_FIT_ZOOM = 1.5;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Zoom minimal : le plateau recouvre toujours entièrement la zone visible (jamais de vide). */
export const minZoom = (c: Size): number => Math.max(c.width / BOARD_WIDTH, c.height / BOARD_HEIGHT);

const clampZoom = (zoom: number, c: Size) => Math.max(minZoom(c), Math.min(MAX_ZOOM, zoom));

/** Zoom et déplacement ramenés dans les limites du plateau (sans effet tant que la zone n'est pas mesurée). */
export function clampView(view: BoardView, c: Size): BoardView {
  if (c.width <= 0 || c.height <= 0) return view;
  const zoom = clampZoom(view.zoom, c);
  return {
    zoom,
    panX: clamp(view.panX, c.width - BOARD_WIDTH * zoom, 0),
    panY: clamp(view.panY, c.height - BOARD_HEIGHT * zoom, 0),
  };
}

export const screenToWorld = (view: BoardView, p: Point): Point => ({
  x: (p.x - view.panX) / view.zoom,
  y: (p.y - view.panY) / view.zoom,
});

export const worldToScreen = (view: BoardView, p: Point): Point => ({
  x: p.x * view.zoom + view.panX,
  y: p.y * view.zoom + view.panY,
});

export function panBy(view: BoardView, dx: number, dy: number, c: Size): BoardView {
  return clampView({ ...view, panX: view.panX + dx, panY: view.panY + dy }, c);
}

/** Zoom en gardant fixe le point du plateau situé sous `anchor` (écran). */
export function zoomAt(view: BoardView, factor: number, anchor: Point, c: Size): BoardView {
  const zoom = clampZoom(view.zoom * factor, c);
  const world = screenToWorld(view, anchor);
  return clampView({ zoom, panX: anchor.x - world.x * zoom, panY: anchor.y - world.y * zoom }, c);
}

/**
 * Geste à deux doigts : le point du plateau initialement sous le centre des doigts les suit,
 * et l'écart des doigts règle le zoom.
 */
export function pinchView(
  start: BoardView,
  startCenter: Point,
  startDistance: number,
  center: Point,
  distance: number,
  c: Size,
): BoardView {
  const zoom = clampZoom(start.zoom * (distance / Math.max(startDistance, 1)), c);
  const world = screenToWorld(start, startCenter);
  return clampView({ zoom, panX: center.x - world.x * zoom, panY: center.y - world.y * zoom }, c);
}

/** Vue qui montre `bounds` en entier ; sans contenu : coin supérieur gauche à l'échelle 1. */
export function fitView(c: Size, bounds?: Rect | null): BoardView {
  if (!bounds) return clampView({ zoom: 1, panX: 0, panY: 0 }, c);
  const zoom = Math.min(
    MAX_FIT_ZOOM,
    c.width / (bounds.width + 2 * FIT_MARGIN),
    c.height / (bounds.height + 2 * FIT_MARGIN),
  );
  const z = clampZoom(zoom, c);
  return clampView(
    {
      zoom: z,
      panX: c.width / 2 - (bounds.x + bounds.width / 2) * z,
      panY: c.height / 2 - (bounds.y + bounds.height / 2) * z,
    },
    c,
  );
}
