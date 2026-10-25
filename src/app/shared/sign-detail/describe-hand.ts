import { CatalogService } from '../../core/services/catalog.service';
import { HandSpec } from '../../core/models/sign.model';
import { STATIC_MOVEMENT, isEmptyHand } from '../../core/utils/hand-spec';

const nameOf = (catalog: CatalogService, id: string) => catalog.find(id)?.name ?? id;

/** « Index → Main plate » ('' si aucune configuration). */
export function handshapeNames(catalog: CatalogService, hand: HandSpec | null | undefined): string {
  return hand?.handshapeIds.map((id) => nameOf(catalog, id)).join(' → ') ?? '';
}

/**
 * « Rotation / cercle + Contact, vers le haut, répété · Paume vers soi ».
 * Les éléments non précisés sont omis ('' si rien n'est précisé).
 */
export function describeHand(catalog: CatalogService, hand: HandSpec | null | undefined): string {
  if (!hand) return '';
  const moving = hand.movementIds.some((m) => m !== STATIC_MOVEMENT);
  const movement = [
    hand.movementIds.map((id) => nameOf(catalog, id)).join(' + '),
    ...(moving ? hand.directionIds.map((id) => nameOf(catalog, id).toLowerCase()) : []),
    moving && hand.repeated ? 'répété' : '',
  ]
    .filter(Boolean)
    .join(', ');
  return [movement, hand.orientationId ? nameOf(catalog, hand.orientationId) : ''].filter(Boolean).join(' · ');
}

/** Récapitulatif d'une main : « Index → Main plate · Arc, vers le haut » ou « Non précisée ». */
export function summarizeHand(catalog: CatalogService, hand: HandSpec | null | undefined): string {
  if (!hand || isEmptyHand(hand)) return 'Non précisée';
  const shapes = hand.handshapeIds.length ? handshapeNames(catalog, hand) : 'Configuration non précisée';
  return [shapes, describeHand(catalog, hand)].filter(Boolean).join(' · ');
}
