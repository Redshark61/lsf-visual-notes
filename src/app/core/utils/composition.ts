import { UserSign } from '../models/sign.model';

type Composite = Pick<UserSign, 'id' | 'components'>;

/** Profondeur maximale suivie : protège l'affichage d'éventuels cycles venus d'une fusion de sauvegardes. */
const MAX_DEPTH = 8;

/**
 * Ajouter `candidateId` comme composant de `signId` créerait-il une boucle ?
 * Oui si c'est le signe lui-même, ou si le candidat le contient (directement ou non).
 */
export function createsCycle(signId: string, candidateId: string, byId: ReadonlyMap<string, Composite>): boolean {
  const seen = new Set<string>();
  const stack = [candidateId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === signId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.components ?? []));
  }
  return false;
}

/** Premier signe qui fait partie d'une boucle de composition, ou null (pour valider une sauvegarde). */
export function findCompositionCycle(signs: readonly Composite[]): string | null {
  const byId = new Map(signs.map((s) => [s.id, s]));
  const done = new Set<string>();
  const visit = (id: string, path: Set<string>): string | null => {
    if (path.has(id)) return id;
    if (done.has(id)) return null;
    path.add(id);
    for (const child of byId.get(id)?.components ?? []) {
      const found = visit(child, path);
      if (found) return found;
    }
    path.delete(id);
    done.add(id);
    return null;
  };
  for (const s of signs) {
    const found = visit(s.id, new Set());
    if (found) return found;
  }
  return null;
}

/**
 * Signes à afficher pour un composé, dans l'ordre : un composant qui est lui-même composé SANS dessin
 * propre est développé en ses propres composants ; sinon il est gardé tel quel. Les signes absents
 * (supprimés) sont ignorés.
 */
export function leafSigns(sign: Composite, byId: ReadonlyMap<string, UserSign>, depth = 0): UserSign[] {
  if (depth > MAX_DEPTH) return [];
  return (sign.components ?? []).flatMap((id) => {
    const component = byId.get(id);
    if (!component) return [];
    return component.components?.length && !component.glyph ? leafSigns(component, byId, depth + 1) : [component];
  });
}

/**
 * Signes dont il faut enchaîner la vidéo pour un signe composé, dans l'ordre : un composant qui a sa
 * propre vidéo est joué tel quel ; un composant composé sans vidéo est développé en ses composants ;
 * les autres sont sautés.
 */
export function videoSigns(sign: Composite, byId: ReadonlyMap<string, UserSign>, depth = 0): UserSign[] {
  if (depth > MAX_DEPTH) return [];
  return (sign.components ?? []).flatMap((id) => {
    const component = byId.get(id);
    if (!component) return [];
    if (component.video) return [component];
    return component.components?.length ? videoSigns(component, byId, depth + 1) : [];
  });
}

/** Ids des signes à charger pour afficher un signe composé (composants, et leurs composants…). */
export function missingComponentIds(
  signs: Iterable<Composite>,
  known: ReadonlyMap<string, Composite>,
): string[] {
  const missing = new Set<string>();
  for (const s of signs) {
    for (const id of s.components ?? []) if (!known.has(id)) missing.add(id);
  }
  return [...missing];
}
