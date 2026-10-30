import { describe, expect, it } from 'vitest';
import { SIGN_BASE_SIZE } from '../models/board.model';
import { SignGlyph, UserSign } from '../models/sign.model';
import { signLayout } from './board-sign-layout';

const glyph = {} as SignGlyph;
const sign = (id: string, over: Partial<UserSign> = {}): UserSign => ({
  id, word: id, tags: [], anatomy: { locationZoneIds: [] }, createdAt: 1, updatedAt: 1, ...over,
});
const index = (...signs: UserSign[]) => new Map(signs.map((s) => [s.id, s]));

describe('signLayout', () => {
  const maison = sign('maison', { glyph });

  it('glyphe seul : un carré à l\'échelle', () => {
    const l = signLayout(maison, index(maison), 2, 'signs');
    expect(l.tiles).toHaveLength(1);
    expect(l.tiles[0]).toMatchObject({ kind: 'glyph', glyphSignId: 'maison', size: SIGN_BASE_SIZE * 2 });
    expect(l.width).toBe(SIGN_BASE_SIZE * 2);
    expect(l.caption).toBeNull();
  });

  it('affichage « les deux » : glyphe centré avec son mot dessous', () => {
    const l = signLayout(maison, index(maison), 1, 'both');
    expect(l.caption?.text).toBe('maison');
    expect(l.height).toBeGreaterThan(SIGN_BASE_SIZE);
    expect(l.tiles[0].x).toBeGreaterThanOrEqual(0);
  });

  it('affichage « mots » : le mot seul, sans cadre', () => {
    const l = signLayout(maison, index(maison), 1, 'words');
    expect(l.tiles).toEqual([expect.objectContaining({ kind: 'word', word: 'maison', boxed: false })]);
  });

  it('signe sans dessin : son mot dans un cadre pointillé', () => {
    const noGlyph = sign('lexique');
    const l = signLayout(noGlyph, index(noGlyph), 1, 'signs');
    expect(l.tiles).toEqual([expect.objectContaining({ kind: 'word', word: 'lexique', boxed: true })]);
  });

  it('signe composé sans dessin : les dessins de ses composants côte à côte', () => {
    const a = sign('attention', { glyph });
    const b = sign('soin', { glyph });
    const composed = sign('bienveillance', { components: ['attention', 'soin'] });
    const l = signLayout(composed, index(a, b, composed), 1, 'signs');
    expect(l.tiles.map((t) => t.glyphSignId)).toEqual(['attention', 'soin']);
    expect(l.tiles[1].x).toBeGreaterThan(l.tiles[0].x + l.tiles[0].size - 1);
    expect(l.width).toBeGreaterThan(l.tiles[0].size);
  });

  it('signe composé dont aucun composant n\'a de dessin : repli sur le mot', () => {
    const a = sign('a');
    const composed = sign('c', { components: ['a'] });
    expect(signLayout(composed, index(a, composed), 1, 'signs').tiles[0].kind).toBe('word');
  });

  it('signe supprimé : indiqué, sans planter', () => {
    const l = signLayout(undefined, new Map(), 1, 'signs');
    expect(l.tiles[0]).toMatchObject({ kind: 'word', word: 'Signe supprimé' });
  });
});
