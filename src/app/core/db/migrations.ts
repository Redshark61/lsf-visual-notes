import { HandSpec, SignGlyph, StrokePoint, UserSign } from '../models/sign.model';

/**
 * Migrations des signes entre formats successifs. Module pur (sans Dexie) : utilisé par la base
 * (mises à jour de version) et par l'import des anciennes sauvegardes.
 */

/** v1 (avant l'assistant en étapes) : un seul mouvement, une seule zone, glyphe à plat. */
export interface UserSignV1 {
  id: string;
  word: string;
  tags: string[];
  anatomy: { dominantHandId: string; nonDominantHandId?: string; locationZoneId: string; movementId: string };
  normalizedGesturePoints: StrokePoint[];
  boundingBoxRatio: number;
  strokeCount: number;
  svgPathData: string;
  createdAt: number;
  updatedAt: number;
}

/** v2 : une configuration et un mouvement par main, champs à plat (sauvegardes v1 et v2). */
export interface UserSignV2 extends Omit<UserSign, 'anatomy'> {
  anatomy: {
    dominantHandId: string;
    dominantMovementId: string;
    dominantDirectionId?: string;
    dominantRepeated?: boolean;
    dominantOrientationId?: string;
    nonDominantHandId?: string;
    nonDominantMovementId?: string;
    nonDominantDirectionId?: string;
    nonDominantRepeated?: boolean;
    nonDominantOrientationId?: string;
    locationZoneIds: string[];
  };
}

export function migrateSignV1(old: UserSignV1): UserSignV2 {
  const { anatomy, normalizedGesturePoints, boundingBoxRatio, strokeCount, svgPathData, ...rest } = old;
  const glyph: SignGlyph = { normalizedGesturePoints, boundingBoxRatio, strokeCount, svgPathData };
  return {
    ...rest,
    anatomy: {
      dominantHandId: anatomy.dominantHandId,
      dominantMovementId: anatomy.movementId,
      ...(anatomy.nonDominantHandId
        ? { nonDominantHandId: anatomy.nonDominantHandId, nonDominantMovementId: 'move_none' }
        : {}),
      locationZoneIds: anatomy.locationZoneId ? [anatomy.locationZoneId] : [],
    },
    glyph,
  };
}

function handV2(
  handId: string,
  movementId: string | undefined,
  directionId: string | undefined,
  repeated: boolean | undefined,
  orientationId: string | undefined,
): HandSpec {
  return {
    handshapeIds: [handId],
    movementIds: [movementId ?? 'move_none'],
    directionIds: directionId ? [directionId] : [],
    ...(repeated ? { repeated } : {}),
    ...(orientationId ? { orientationId } : {}),
  };
}

/** v2 → v3 : chaque main devient un HandSpec (suites de configurations, plusieurs mouvements). */
export function migrateSignV2(old: UserSignV2): UserSign {
  const a = old.anatomy;
  return {
    ...old,
    anatomy: {
      dominant: handV2(a.dominantHandId, a.dominantMovementId, a.dominantDirectionId, a.dominantRepeated, a.dominantOrientationId),
      ...(a.nonDominantHandId
        ? {
            nonDominant: handV2(
              a.nonDominantHandId,
              a.nonDominantMovementId,
              a.nonDominantDirectionId,
              a.nonDominantRepeated,
              a.nonDominantOrientationId,
            ),
          }
        : {}),
      locationZoneIds: a.locationZoneIds,
    },
  };
}

/** Le signe est-il au format v2 (champs à plat) ? Prudent : sert aussi sur des données importées. */
export function isSignV2(value: unknown): value is UserSignV2 {
  const anatomy = (value as { anatomy?: unknown } | null)?.anatomy;
  return typeof anatomy === 'object' && anatomy !== null && 'dominantHandId' in anatomy && !('dominant' in anatomy);
}
