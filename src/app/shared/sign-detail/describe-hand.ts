import { CatalogService } from '../../core/services/catalog.service';

export interface HandParams {
  movementId?: string | null;
  directionId?: string | null;
  repeated?: boolean | null;
  orientationId?: string | null;
}

/** « Arc, vers le haut, répété · Paume vers soi » (les éléments absents sont omis). */
export function describeHand(catalog: CatalogService, h: HandParams): string {
  const name = (id?: string | null) => (id ? (catalog.find(id)?.name ?? id) : null);
  const moving = !!h.movementId && h.movementId !== 'move_none';
  const movement = [
    name(h.movementId) ?? 'Mouvement non précisé',
    moving ? name(h.directionId)?.toLowerCase() : null,
    moving && h.repeated ? 'répété' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return [movement, name(h.orientationId)].filter(Boolean).join(' · ');
}
