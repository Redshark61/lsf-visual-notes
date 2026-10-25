import { HandSpec, MAX_HANDSHAPE_SEQUENCE } from '../models/sign.model';

export const STATIC_MOVEMENT = 'move_none';

export const emptyHand = (): HandSpec => ({ handshapeIds: [], movementIds: [], directionIds: [] });

/** Aucune information saisie pour cette main. */
export function isEmptyHand(hand: HandSpec | null | undefined): boolean {
  return (
    !hand ||
    (hand.handshapeIds.length === 0 &&
      hand.movementIds.length === 0 &&
      hand.directionIds.length === 0 &&
      !hand.repeated &&
      !hand.orientationId)
  );
}

const unique = (ids: string[]) => [...new Set(ids)].filter(Boolean);

/**
 * HandSpec propre, ou null si rien n'est renseigné : sans doublons, suite limitée à
 * MAX_HANDSHAPE_SEQUENCE, « statique » exclu s'il est combiné à de vrais mouvements,
 * direction et répétition seulement s'il y a un mouvement.
 * Tout est facultatif : une main peut n'avoir qu'une configuration, ou qu'un mouvement.
 */
export function normalizeHand(hand: HandSpec | null | undefined): HandSpec | null {
  if (!hand || isEmptyHand(hand)) return null;
  let movementIds = unique(hand.movementIds);
  if (movementIds.length > 1) movementIds = movementIds.filter((m) => m !== STATIC_MOVEMENT);
  const moving = movementIds.some((m) => m !== STATIC_MOVEMENT);
  const result: HandSpec = {
    handshapeIds: unique(hand.handshapeIds).slice(0, MAX_HANDSHAPE_SEQUENCE),
    movementIds,
    directionIds: moving ? unique(hand.directionIds) : [],
    ...(moving && hand.repeated ? { repeated: true } : {}),
    ...(hand.orientationId ? { orientationId: hand.orientationId } : {}),
  };
  return isEmptyHand(result) ? null : result;
}
