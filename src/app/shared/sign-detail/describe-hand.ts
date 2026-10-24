import { CatalogService } from '../../core/services/catalog.service';
import { HandSpec } from '../../core/models/sign.model';

const STATIC_MOVEMENT = 'move_none';

const nameOf = (catalog: CatalogService, id: string) => catalog.find(id)?.name ?? id;

/** « Index → Main plate » */
export function handshapeNames(catalog: CatalogService, hand: HandSpec | null | undefined): string {
  return hand?.handshapeIds.map((id) => nameOf(catalog, id)).join(' → ') || '—';
}

/** « Rotation / cercle + Contact, vers le haut, répété · Paume vers soi » (éléments absents omis). */
export function describeHand(catalog: CatalogService, hand: HandSpec | null | undefined): string {
  if (!hand) return '';
  const moving = hand.movementIds.some((m) => m !== STATIC_MOVEMENT);
  const movement = [
    hand.movementIds.map((id) => nameOf(catalog, id)).join(' + ') || 'Mouvement non précisé',
    ...(moving ? hand.directionIds.map((id) => nameOf(catalog, id).toLowerCase()) : []),
    moving && hand.repeated ? 'répété' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return [movement, hand.orientationId ? nameOf(catalog, hand.orientationId) : null].filter(Boolean).join(' · ');
}
