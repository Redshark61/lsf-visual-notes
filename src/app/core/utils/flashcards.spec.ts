import { describe, expect, it } from 'vitest';
import { buildDeck, clampSeriesSize, deckTags, DEFAULT_SERIES_SIZE, eligibleSigns, shuffle } from './flashcards';
import { UserSign } from '../models/sign.model';

const video = { mimeType: 'video/mp4' as const, durationMs: 1000, bytes: 10 };
const sign = (id: string, extra: Partial<UserSign> = {}): UserSign => ({
  id,
  word: id,
  tags: [],
  anatomy: { locationZoneIds: [] },
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

/** Suite pseudo-aléatoire reproductible. */
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('eligibleSigns', () => {
  const signs = [
    sign('maison', { video, tags: ['lieux'] }),
    sign('école', { tags: ['lieux'] }), // pas de vidéo
    sign('attention', { video }),
    sign('soin', { video }),
    sign('bienveillance', { components: ['attention', 'soin'], tags: ['valeurs'] }),
    sign('vide', { components: ['école'] }), // composé sans aucune vidéo
  ];

  it('garde les signes ayant une vidéo propre ou des composants filmés', () => {
    expect(eligibleSigns(signs, null).map((s) => s.id)).toEqual(['maison', 'attention', 'soin', 'bienveillance']);
  });

  it('filtre par tag', () => {
    expect(eligibleSigns(signs, 'lieux').map((s) => s.id)).toEqual(['maison']);
    expect(eligibleSigns(signs, 'valeurs').map((s) => s.id)).toEqual(['bienveillance']);
  });

  it('ne propose que les tags ayant des signes révisables', () => {
    expect(deckTags(signs)).toEqual([
      { tag: 'lieux', count: 1 },
      { tag: 'valeurs', count: 1 },
    ]);
  });
});

describe('buildDeck', () => {
  const signs = Array.from({ length: 30 }, (_, i) => sign(`s${i}`));

  it('tire la taille demandée, sans doublon', () => {
    const deck = buildDeck(signs, 10, 'video-to-word', seeded());
    expect(deck).toHaveLength(10);
    expect(new Set(deck.map((c) => c.signId)).size).toBe(10);
    expect(deck.every((c) => c.direction === 'video-to-word')).toBe(true);
  });

  it("s'arrête au nombre de signes disponibles", () => {
    expect(buildDeck(signs.slice(0, 4), 10, 'word-to-video')).toHaveLength(4);
  });

  it('mélange les deux sens en mode mixte', () => {
    const directions = new Set(buildDeck(signs, 30, 'mixed', seeded(7)).map((c) => c.direction));
    expect(directions).toEqual(new Set(['video-to-word', 'word-to-video']));
  });

  it('mélange sans perdre ni dupliquer', () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(shuffle(items, seeded(3)).sort()).toEqual(items);
  });
});

describe('clampSeriesSize', () => {
  it('borne entre 3 et 50, défaut sinon', () => {
    expect(clampSeriesSize(1)).toBe(3);
    expect(clampSeriesSize(500)).toBe(50);
    expect(clampSeriesSize(12.4)).toBe(12);
    expect(clampSeriesSize('x')).toBe(DEFAULT_SERIES_SIZE);
  });
});
