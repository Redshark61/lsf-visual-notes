import { describe, expect, it } from 'vitest';
import { migrateSignV1 } from './app.db';

const pts = Array.from({ length: 32 }, (_, i) => ({ x: i / 32 - 0.5, y: 0, strokeId: 1 }));
const v1 = {
  id: 'a',
  word: 'Maison',
  tags: ['lieux'],
  anatomy: {
    dominantHandId: 'hand_a',
    nonDominantHandId: 'hand_b',
    locationZoneId: 'zone_torso',
    movementId: 'move_circle',
  },
  normalizedGesturePoints: pts,
  boundingBoxRatio: 3,
  strokeCount: 1,
  svgPathData: 'M1,1 Z',
  createdAt: 1,
  updatedAt: 2,
};

describe('migration des signes v1 → v2', () => {
  it('regroupe le glyphe et convertit mouvement et emplacement', () => {
    expect(migrateSignV1(v1)).toEqual({
      id: 'a',
      word: 'Maison',
      tags: ['lieux'],
      anatomy: {
        dominantHandId: 'hand_a',
        dominantMovementId: 'move_circle',
        nonDominantHandId: 'hand_b',
        nonDominantMovementId: 'move_none',
        locationZoneIds: ['zone_torso'],
      },
      glyph: { normalizedGesturePoints: pts, boundingBoxRatio: 3, strokeCount: 1, svgPathData: 'M1,1 Z' },
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it("n'invente pas de main dominée pour un signe à une main", () => {
    const oneHand = migrateSignV1({
      ...v1,
      anatomy: { dominantHandId: 'hand_a', locationZoneId: 'zone_torso', movementId: 'move_none' },
    });
    expect(oneHand.anatomy).not.toHaveProperty('nonDominantHandId');
    expect(oneHand.anatomy).not.toHaveProperty('nonDominantMovementId');
  });
});
