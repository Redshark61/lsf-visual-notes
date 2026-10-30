import { describe, expect, it } from 'vitest';
import { createsCycle, findCompositionCycle, leafSigns, missingComponentIds, videoSigns } from './composition';
import { SignGlyph, UserSign } from '../models/sign.model';

const glyph = {} as SignGlyph;
const withVideo = (s: UserSign): UserSign => ({ ...s, video: { mimeType: 'video/mp4', durationMs: 1000, bytes: 10 } });
const sign = (id: string, components?: string[], withGlyph = true): UserSign => ({
  id,
  word: id,
  tags: [],
  anatomy: { locationZoneIds: [] },
  ...(withGlyph ? { glyph } : {}),
  ...(components ? { components } : {}),
  createdAt: 1,
  updatedAt: 1,
});
const index = (...signs: UserSign[]) => new Map(signs.map((s) => [s.id, s]));

describe('createsCycle', () => {
  const byId = index(sign('a'), sign('b', ['a']), sign('c', ['b']));

  it('refuse un signe comme composant de lui-même', () => {
    expect(createsCycle('a', 'a', byId)).toBe(true);
  });

  it('refuse un composant qui contient déjà le signe, directement ou non', () => {
    expect(createsCycle('a', 'b', byId)).toBe(true); // b contient a
    expect(createsCycle('a', 'c', byId)).toBe(true); // c contient b qui contient a
  });

  it('accepte les compositions sans boucle', () => {
    expect(createsCycle('c', 'a', byId)).toBe(false);
    expect(createsCycle('b', 'a', byId)).toBe(false);
  });

  it('tolère un cycle préexistant sans boucler à l\'infini', () => {
    const loop = index(sign('x', ['y']), sign('y', ['x']));
    expect(createsCycle('z', 'x', loop)).toBe(false);
  });
});

describe('findCompositionCycle', () => {
  it('ne signale rien pour une composition en arbre (même composant utilisé deux fois)', () => {
    expect(findCompositionCycle([sign('a'), sign('b', ['a', 'a']), sign('c', ['a', 'b'])])).toBeNull();
  });

  it('détecte une boucle simple, indirecte ou sur soi-même', () => {
    expect(findCompositionCycle([sign('a', ['a'])])).toBe('a');
    expect(findCompositionCycle([sign('a', ['b']), sign('b', ['a'])])).not.toBeNull();
    expect(findCompositionCycle([sign('a', ['b']), sign('b', ['c']), sign('c', ['a'])])).not.toBeNull();
  });

  it('ignore les composants absents du fichier', () => {
    expect(findCompositionCycle([sign('a', ['inconnu'])])).toBeNull();
  });
});

describe('leafSigns', () => {
  it('liste les composants dans l\'ordre, en ignorant les signes supprimés', () => {
    const byId = index(sign('attention'), sign('soin'), sign('bienveillance', ['attention', 'supprime', 'soin']));
    expect(leafSigns(byId.get('bienveillance')!, byId).map((s) => s.id)).toEqual(['attention', 'soin']);
  });

  it('développe un composant composé sans dessin, garde celui qui a son propre dessin', () => {
    const byId = index(
      sign('a'),
      sign('b'),
      sign('sansDessin', ['a', 'b'], false),
      sign('avecDessin', ['a', 'b'], true),
      sign('top', ['sansDessin', 'avecDessin']),
    );
    expect(leafSigns(byId.get('top')!, byId).map((s) => s.id)).toEqual(['a', 'b', 'avecDessin']);
  });

  it('ne boucle pas sur un cycle', () => {
    const byId = index(sign('x', ['y'], false), sign('y', ['x'], false));
    expect(leafSigns(byId.get('x')!, byId)).toEqual([]);
  });
});

describe('missingComponentIds', () => {
  it('liste les composants pas encore chargés, sans doublon', () => {
    const known = index(sign('a'));
    expect(missingComponentIds([sign('t', ['a', 'b', 'b', 'c'])], known).sort()).toEqual(['b', 'c']);
  });
});

describe('videoSigns', () => {
  it('enchaîne les vidéos des composants dans l\'ordre, en sautant ceux sans vidéo', () => {
    const byId = index(withVideo(sign('attention')), sign('sansVideo'), withVideo(sign('soin')), sign('top', ['attention', 'sansVideo', 'soin']));
    expect(videoSigns(byId.get('top')!, byId).map((s) => s.id)).toEqual(['attention', 'soin']);
  });

  it('développe un composant composé sans vidéo, garde celui qui a sa propre vidéo', () => {
    const byId = index(
      withVideo(sign('a')),
      withVideo(sign('b')),
      sign('sansVideo', ['a', 'b']),
      withVideo(sign('avecVideo', ['a', 'b'])),
      sign('top', ['sansVideo', 'avecVideo']),
    );
    expect(videoSigns(byId.get('top')!, byId).map((s) => s.id)).toEqual(['a', 'b', 'avecVideo']);
  });

  it('rejoue un composant utilisé deux fois et ignore les signes supprimés', () => {
    const byId = index(withVideo(sign('tres')), sign('top', ['tres', 'supprime', 'tres']));
    expect(videoSigns(byId.get('top')!, byId).map((s) => s.id)).toEqual(['tres', 'tres']);
  });

  it('ne boucle pas sur un cycle et renvoie vide sans vidéo', () => {
    expect(videoSigns(sign('x', ['y']), index(sign('x', ['y']), sign('y', ['x'])))).toEqual([]);
    expect(videoSigns(sign('t', ['a']), index(sign('a')))).toEqual([]);
  });
});
