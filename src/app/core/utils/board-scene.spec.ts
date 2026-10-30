import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BoardObject,
  MAX_BOARD_OBJECTS,
  SIGN_BASE_SIZE,
  TextObject,
} from '../models/board.model';
import {
  HISTORY_LIMIT,
  addObject,
  contentBounds,
  emptyHistory,
  inkFromPoints,
  moveObject,
  objectBounds,
  pushHistory,
  redoHistory,
  removeObject,
  resizeObject,
  signAt,
  signPlacement,
  undoHistory,
} from './board-scene';

const text = (id: string, over: Partial<TextObject> = {}): TextObject => ({
  type: 'text', id, x: 100, y: 100, text: 'Bonjour', size: 30, color: '#1d1d1f', ...over,
});

describe('opérations sur la scène', () => {
  it('ajoute et supprime sans modifier la liste d\'origine', () => {
    const base: BoardObject[] = [text('a')];
    const added = addObject(base, text('b'));
    expect(added.map((o) => o.id)).toEqual(['a', 'b']);
    expect(base).toHaveLength(1);
    expect(removeObject(added, 'a').map((o) => o.id)).toEqual(['b']);
  });

  it('refuse d\'ajouter au-delà de la limite d\'objets', () => {
    const full = Array.from({ length: MAX_BOARD_OBJECTS }, (_, i) => text('t' + i));
    expect(addObject(full, text('x'))).toHaveLength(MAX_BOARD_OBJECTS);
  });

  it('déplace un objet et le garde dans le plateau', () => {
    const [moved] = moveObject([text('a')], 'a', 50, -30);
    expect([moved.x, moved.y]).toEqual([150, 70]);
    const [edge] = moveObject([text('a')], 'a', 99999, 99999);
    const b = objectBounds(edge);
    expect(b.x + b.width).toBeLessThanOrEqual(BOARD_WIDTH + 1e-6);
    expect(b.y + b.height).toBeLessThanOrEqual(BOARD_HEIGHT + 1e-6);
    const [corner] = moveObject([text('a')], 'a', -99999, -99999);
    expect([corner.x, corner.y]).toEqual([0, 0]);
  });

  it('redimensionne un signe (échelle) et un texte (taille), pas l\'encre, dans des bornes', () => {
    const sign = signAt('s', { x: 500, y: 500 });
    const ink = inkFromPoints([{ x: 10, y: 10 }, { x: 60, y: 40 }], '#000000', 4)!;
    const objs = [sign, text('t'), ink];
    const bigger = resizeObject(objs, sign.id, 2);
    expect((bigger[0] as typeof sign).scale).toBe(2);
    expect((resizeObject(objs, 't', 2)[1] as TextObject).size).toBe(60);
    expect(resizeObject(objs, ink.id, 2)[2]).toBe(ink);
    expect((resizeObject(objs, sign.id, 1000)[0] as typeof sign).scale).toBe(8);
    expect((resizeObject(objs, sign.id, 0.0001)[0] as typeof sign).scale).toBe(0.3);
  });

  it('emprise du contenu', () => {
    expect(contentBounds([])).toBeNull();
    const b = contentBounds([signAt('a', { x: 200, y: 200 }), signAt('b', { x: 600, y: 500 })])!;
    expect(b.x).toBeLessThan(200);
    expect(b.x + b.width).toBeGreaterThan(600);
  });
});

describe('historique annuler / rétablir', () => {
  it('annule puis rétablit dans l\'ordre', () => {
    let h = emptyHistory<number>();
    h = pushHistory(h, 1); // 1 → 2
    h = pushHistory(h, 2); // 2 → 3
    const undone = undoHistory(h, 3)!;
    expect(undone.value).toBe(2);
    const undone2 = undoHistory(undone.history, 2)!;
    expect(undone2.value).toBe(1);
    expect(undoHistory(undone2.history, 1)).toBeNull();
    const redone = redoHistory(undone2.history, 1)!;
    expect(redone.value).toBe(2);
    expect(redoHistory(redone.history, 2)!.value).toBe(3);
  });

  it('une nouvelle modification efface le « rétablir »', () => {
    let h = pushHistory(emptyHistory<number>(), 1);
    h = undoHistory(h, 2)!.history;
    expect(h.future).toEqual([2]);
    expect(pushHistory(h, 1).future).toEqual([]);
  });

  it('la mémoire est plafonnée', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 50; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past.at(-1)).toBe(HISTORY_LIMIT + 49);
  });

  it('rien à annuler ni rétablir au départ', () => {
    expect(undoHistory(emptyHistory<number>(), 0)).toBeNull();
    expect(redoHistory(emptyHistory<number>(), 0)).toBeNull();
  });
});

describe('création d\'objets', () => {
  it('encre : chemin relatif au coin, emprise couvrant le trait', () => {
    const ink = inkFromPoints([{ x: 500, y: 400 }, { x: 560, y: 430 }, { x: 640, y: 420 }], '#c62828', 6, 'id-1')!;
    expect(ink.type).toBe('ink');
    expect(ink.x).toBeCloseTo(494, 5);
    expect(ink.y).toBeCloseTo(394, 5);
    expect(ink.w).toBeCloseTo(152, 5);
    expect(ink.d).toMatch(/^M[\d.,\sQTMZ-]+Z$/);
    // Tous les nombres du chemin restent dans l'emprise (chemin relatif).
    const nums = ink.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...nums)).toBeLessThanOrEqual(Math.max(ink.w, ink.h) + 1);
  });

  it('encre : un simple point donne un point, aucun point donne rien', () => {
    expect(inkFromPoints([{ x: 100, y: 100 }], '#000000', 6)).not.toBeNull();
    expect(inkFromPoints([], '#000000', 6)).toBeNull();
  });

  it('signe reconnu : posé où et à la taille du dessin', () => {
    const strokes = [[{ x: 1000, y: 800 }, { x: 1144, y: 944 }]]; // 144 × 144 → échelle 2
    const p = signPlacement(strokes);
    expect(p.scale).toBe(2);
    expect(p.x).toBeCloseTo(1000, 5);
    expect(p.y).toBeCloseTo(800, 5);
  });

  it('signe reconnu : échelle bornée et position dans le plateau', () => {
    expect(signPlacement([[{ x: 100, y: 100 }, { x: 101, y: 101 }]]).scale).toBe(0.6);
    expect(signPlacement([[{ x: 0, y: 0 }, { x: 3000, y: 2000 }]]).scale).toBe(5);
    const edge = signPlacement([[{ x: BOARD_WIDTH - 1, y: 0 }, { x: BOARD_WIDTH, y: 5 }]]);
    expect(edge.x + SIGN_BASE_SIZE * edge.scale).toBeLessThanOrEqual(BOARD_WIDTH + 1e-6);
  });

  it('signAt centre le signe sur le point et reste dans le plateau', () => {
    const s = signAt('x', { x: 400, y: 300 });
    expect(s.x).toBe(400 - SIGN_BASE_SIZE / 2);
    expect(signAt('x', { x: -50, y: -50 }).x).toBe(0);
    expect(signAt('x', { x: 99999, y: 99999 }).y).toBeLessThanOrEqual(BOARD_HEIGHT);
  });
});
