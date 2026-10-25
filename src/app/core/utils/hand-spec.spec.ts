import { describe, expect, it } from 'vitest';
import { emptyHand, isEmptyHand, normalizeHand } from './hand-spec';
import { HandSpec } from '../models/sign.model';

const hand = (over: Partial<HandSpec> = {}): HandSpec => ({ ...emptyHand(), ...over });

describe('isEmptyHand / normalizeHand', () => {
  it('une main sans aucune information est vide (signe à une main, ou rien de précisé)', () => {
    expect(isEmptyHand(null)).toBe(true);
    expect(isEmptyHand(emptyHand())).toBe(true);
    expect(normalizeHand(emptyHand())).toBeNull();
    expect(normalizeHand(null)).toBeNull();
  });

  it('seul le mouvement ou seule la configuration suffisent (tout est facultatif)', () => {
    expect(normalizeHand(hand({ handshapeIds: ['hand_a'] }))).toEqual({
      handshapeIds: ['hand_a'],
      movementIds: [],
      directionIds: [],
    });
    expect(normalizeHand(hand({ movementIds: ['move_arc'] }))?.movementIds).toEqual(['move_arc']);
    expect(normalizeHand(hand({ orientationId: 'orient_palm_up' }))?.orientationId).toBe('orient_palm_up');
  });

  it('« statique » explicite compte comme une information', () => {
    expect(normalizeHand(hand({ movementIds: ['move_none'] }))?.movementIds).toEqual(['move_none']);
  });

  it('retire les doublons et limite la suite de configurations à 5', () => {
    const r = normalizeHand(hand({ handshapeIds: ['hand_a', 'hand_a', 'hand_b', 'hand_c', 'hand_d', 'hand_e', 'hand_f', 'hand_g'] }))!;
    expect(r.handshapeIds).toEqual(['hand_a', 'hand_b', 'hand_c', 'hand_d', 'hand_e']);
  });

  it('« statique » est exclu dès qu\'un vrai mouvement est choisi', () => {
    expect(normalizeHand(hand({ movementIds: ['move_none', 'move_arc'] }))?.movementIds).toEqual(['move_arc']);
  });

  it('ignore direction et répétition sans mouvement réel', () => {
    for (const movementIds of [[], ['move_none']]) {
      const r = normalizeHand(hand({ handshapeIds: ['hand_a'], movementIds, directionIds: ['dir_up'], repeated: true }))!;
      expect(r.directionIds).toEqual([]);
      expect(r).not.toHaveProperty('repeated');
    }
    expect(normalizeHand(hand({ directionIds: ['dir_up'], repeated: true }))).toBeNull();
  });

  it('garde direction et répétition avec un vrai mouvement', () => {
    const r = normalizeHand(hand({ movementIds: ['move_arc'], directionIds: ['dir_up', 'dir_up', 'dir_forward'], repeated: true }))!;
    expect(r.directionIds).toEqual(['dir_up', 'dir_forward']);
    expect(r.repeated).toBe(true);
  });
});
