import { describe, expect, it } from 'vitest';
import { MAX_TAGS, MAX_TAG_LENGTH, normalizeTags, suggestTags, tallyTags } from './tags';

describe('normalizeTags', () => {
  it('met en minuscules, retire les espaces et les doublons', () => {
    expect(normalizeTags(['Famille', ' maison ', 'famille', '', '  '])).toEqual(['famille', 'maison']);
  });

  it('limite la longueur et le nombre de tags', () => {
    expect(normalizeTags(['x'.repeat(50)])[0]).toHaveLength(MAX_TAG_LENGTH);
    expect(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(MAX_TAGS);
  });
});

describe('tallyTags', () => {
  it('compte les utilisations, du plus utilisé au moins utilisé', () => {
    expect(tallyTags(['maison', 'famille', 'maison', 'animaux', 'famille', 'maison'])).toEqual([
      { tag: 'maison', count: 3 },
      { tag: 'famille', count: 2 },
      { tag: 'animaux', count: 1 },
    ]);
  });

  it('trie à égalité par ordre alphabétique', () => {
    expect(tallyTags(['b', 'a', 'é', 'c']).map((t) => t.tag)).toEqual(['a', 'b', 'c', 'é']);
  });
});

describe('suggestTags', () => {
  const all = tallyTags(['animaux', 'animaux', 'émotions', 'famille', 'famille', 'famille', 'fête', 'maison']);

  it('sans saisie : les plus utilisés, hors tags déjà choisis', () => {
    expect(suggestTags(all, '', ['famille']).map((t) => t.tag)).toEqual(['animaux', 'émotions', 'fête', 'maison']);
  });

  it('ignore accents et casse, et classe « commence par » avant « contient »', () => {
    expect(suggestTags(all, 'EMO', []).map((t) => t.tag)).toEqual(['émotions']);
    expect(suggestTags(all, 'f', []).map((t) => t.tag)).toEqual(['famille', 'fête']);
    // « maison » commence par « ma » : avant « animaux » (qui le contient), bien que moins utilisé.
    expect(suggestTags(all, 'ma', []).map((t) => t.tag)).toEqual(['maison', 'animaux']);
    // À rang égal : le plus utilisé d'abord, puis l'ordre alphabétique.
    expect(suggestTags(all, 'on', []).map((t) => t.tag)).toEqual(['émotions', 'maison']);
  });

  it('respecte la limite et ne propose rien sans correspondance', () => {
    expect(suggestTags(all, '', [], 2)).toHaveLength(2);
    expect(suggestTags(all, 'zzz', [])).toEqual([]);
  });
});
