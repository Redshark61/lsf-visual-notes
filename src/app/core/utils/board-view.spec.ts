import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH } from '../models/board.model';
import {
  BoardView,
  MAX_ZOOM,
  clampView,
  fitView,
  minZoom,
  panBy,
  pinchView,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './board-view';

const container = { width: 1000, height: 600 };
const view = (zoom: number, panX = 0, panY = 0): BoardView => ({ zoom, panX, panY });

describe('vue du plateau', () => {
  it('le zoom minimal fait toujours recouvrir la zone visible par le plateau', () => {
    const z = minZoom(container);
    expect(BOARD_WIDTH * z).toBeGreaterThanOrEqual(container.width - 1e-9);
    expect(BOARD_HEIGHT * z).toBeGreaterThanOrEqual(container.height - 1e-9);
  });

  it('screenToWorld et worldToScreen sont inverses', () => {
    const v = view(1.7, -230, -90);
    const p = { x: 412, y: 187 };
    const back = screenToWorld(v, worldToScreen(v, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('le déplacement ne sort jamais du plateau', () => {
    const v = clampView(view(1, 500, 500), container);
    expect(v.panX).toBe(0);
    expect(v.panY).toBe(0);
    const far = clampView(view(1, -99999, -99999), container);
    expect(far.panX).toBe(container.width - BOARD_WIDTH);
    expect(far.panY).toBe(container.height - BOARD_HEIGHT);
    expect(panBy(view(1), 40, 40, container)).toEqual(view(1)); // déjà au bord
  });

  it('le zoom reste entre le minimum et le maximum', () => {
    expect(clampView(view(0.0001), container).zoom).toBeCloseTo(minZoom(container));
    expect(clampView(view(100), container).zoom).toBe(MAX_ZOOM);
  });

  it('zoomAt garde fixe le point du plateau sous le curseur', () => {
    const start = view(1, -300, -200);
    const anchor = { x: 420, y: 250 };
    const before = screenToWorld(start, anchor);
    const next = zoomAt(start, 2, anchor, container);
    const after = screenToWorld(next, anchor);
    expect(next.zoom).toBeCloseTo(2);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('zoomAt borné : zoomer fort au bord ne dépasse pas le plateau', () => {
    const next = zoomAt(view(1), 0.01, { x: 0, y: 0 }, container);
    expect(next.zoom).toBeCloseTo(minZoom(container));
    expect(next.panX).toBeLessThanOrEqual(0);
  });

  it('pinchView : le point sous le centre des doigts les suit', () => {
    const start = view(1, -100, -100);
    const startCenter = { x: 400, y: 300 };
    const world = screenToWorld(start, startCenter);
    const next = pinchView(start, startCenter, 100, { x: 420, y: 310 }, 200, container);
    expect(next.zoom).toBeCloseTo(2);
    const screen = worldToScreen(next, world);
    expect(screen.x).toBeCloseTo(420, 6);
    expect(screen.y).toBeCloseTo(310, 6);
  });

  it('fitView sans contenu : coin supérieur gauche à l\'échelle 1', () => {
    expect(fitView(container, null)).toEqual(view(1));
  });

  it('fitView montre tout le contenu', () => {
    const bounds = { x: 1000, y: 800, width: 400, height: 300 };
    const v = fitView(container, bounds);
    const tl = worldToScreen(v, { x: bounds.x, y: bounds.y });
    const br = worldToScreen(v, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(container.width);
    expect(br.y).toBeLessThanOrEqual(container.height);
  });

  it('ne fait rien tant que la zone n\'est pas mesurée', () => {
    const v = view(3, -5, -5);
    expect(clampView(v, { width: 0, height: 0 })).toBe(v);
  });
});
