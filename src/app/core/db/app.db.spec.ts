import { describe, expect, it } from 'vitest';
import { migrateSignV1, migrateSignV2 } from './migrations';

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

describe('migration des signes v2 → v3 (HandSpec)', () => {
  it('transforme chaque main en suite de configurations et listes de mouvements', () => {
    const v2 = migrateSignV1(v1);
    v2.anatomy.dominantDirectionId = 'dir_up';
    v2.anatomy.dominantRepeated = true;
    v2.anatomy.dominantOrientationId = 'orient_palm_self';
    expect(migrateSignV2(v2).anatomy).toEqual({
      dominant: {
        handshapeIds: ['hand_a'],
        movementIds: ['move_circle'],
        directionIds: ['dir_up'],
        repeated: true,
        orientationId: 'orient_palm_self',
      },
      nonDominant: { handshapeIds: ['hand_b'], movementIds: ['move_none'], directionIds: [] },
      locationZoneIds: ['zone_torso'],
    });
  });

  it('enchaîne v1 → v2 → v3 sans main dominée fictive', () => {
    const v3 = migrateSignV2(
      migrateSignV1({ ...v1, anatomy: { dominantHandId: 'hand_a', locationZoneId: '', movementId: 'move_none' } }),
    );
    expect(v3.anatomy).toEqual({
      dominant: { handshapeIds: ['hand_a'], movementIds: ['move_none'], directionIds: [] },
      locationZoneIds: [],
    });
    expect(v3.glyph?.strokeCount).toBe(1);
  });
});
