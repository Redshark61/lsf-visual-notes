import { UserSign } from '../models/sign.model';
import { tallyTags, TagCount } from './tags';
import { videoSigns } from './composition';

/** Sens d'une carte : la vidéo est montrée et l'on devine le nom, ou l'inverse. */
export type CardDirection = 'video-to-word' | 'word-to-video';
/** Choix de l'utilisateur : un seul sens, ou les deux au hasard. */
export type DeckMode = CardDirection | 'mixed';

export interface Flashcard {
  signId: string;
  direction: CardDirection;
}

export const DEFAULT_SERIES_SIZE = 10;
export const MIN_SERIES_SIZE = 3;
export const MAX_SERIES_SIZE = 50;

/** Taille de série valide (entier entre 3 et 50), sinon la valeur par défaut. */
export function clampSeriesSize(value: unknown): number {
  const n = typeof value === 'number' ? Math.round(value) : NaN;
  return Number.isFinite(n) ? Math.min(MAX_SERIES_SIZE, Math.max(MIN_SERIES_SIZE, n)) : DEFAULT_SERIES_SIZE;
}

/**
 * Un signe peut-il servir de carte ? Il faut une vidéo à montrer : la sienne, ou pour un signe composé
 * celles de ses composants (enchaînées).
 */
export function hasPlayableVideo(sign: UserSign, byId: ReadonlyMap<string, UserSign>): boolean {
  return !!sign.video || (!!sign.components?.length && videoSigns(sign, byId).length > 0);
}

/** Signes utilisables pour une révision : tous, ou ceux d'un tag. */
export function eligibleSigns(signs: readonly UserSign[], tag: string | null): UserSign[] {
  const byId = new Map(signs.map((s) => [s.id, s]));
  return signs.filter((s) => (tag === null || s.tags.includes(tag)) && hasPlayableVideo(s, byId));
}

/** Tags proposés comme catégories, avec le nombre de signes révisables de chacun (tags vides exclus). */
export function deckTags(signs: readonly UserSign[]): TagCount[] {
  return tallyTags(eligibleSigns(signs, null).flatMap((s) => s.tags));
}

/** Mélange de Fisher-Yates (le hasard est injectable pour les tests). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Série de cartes : `size` signes tirés au hasard parmi `signs` (sans doublon ; moins s'il n'y en a pas
 * assez), chacun dans le sens demandé ou, en mode mélangé, dans un sens tiré au hasard.
 */
export function buildDeck(
  signs: readonly Pick<UserSign, 'id'>[],
  size: number,
  mode: DeckMode,
  random: () => number = Math.random,
): Flashcard[] {
  return shuffle(signs, random)
    .slice(0, Math.max(0, size))
    .map((s) => ({
      signId: s.id,
      direction: mode === 'mixed' ? (random() < 0.5 ? 'video-to-word' : 'word-to-video') : mode,
    }));
}
