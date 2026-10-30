import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKUP_VERSION, parseBackup } from './backup.schema';
import { catalogSchema } from './catalog.schema';
import { extractGesture } from '../utils/gesture';
import { inkFromPoints, signAt } from '../utils/board-scene';
import { SHAPES } from '../../../testing/shapes';

const root = (p: string) => resolve(process.cwd(), p);
const catalog = catalogSchema.parse(JSON.parse(readFileSync(root('public/data/handshapes-catalog.json'), 'utf8')));
const customId = 'hand_custom_' + randomUUID().replaceAll('-', '');
const jpeg =
  'data:image/jpeg;base64,' + readFileSync(root('public/icons/handshapes/wikisign/hand_a.jpg')).toString('base64');

const signs = Object.keys(SHAPES).map((word, i) => ({
  id: randomUUID(),
  word,
  tags: ['test'],
  anatomy: {
    dominant: {
      handshapeIds: i === 0 ? [customId, 'hand_main_plate'] : ['hand_a'],
      movementIds: ['move_arc', 'move_contact', 'move_symmetric'],
      directionIds: ['dir_up', 'dir_forward'],
      repeated: true,
      orientationId: 'orient_palm_self',
    },
    ...(i % 2
      ? { nonDominant: { handshapeIds: ['hand_b'], movementIds: ['move_none'], directionIds: [], orientationId: 'orient_palm_up' } }
      : {}),
    locationZoneIds: ['zone_chin', 'zone_temple'],
  },
  ...(i % 3 ? { glyph: extractGesture(SHAPES[word])! } : {}),
  ...(i % 4 ? {} : { note: 'note perso' }),
  createdAt: 1,
  updatedAt: 1,
}));
const valid = {
  format: 'lsf-visual-notes',
  version: 3,
  exportedAt: new Date().toISOString(),
  customHandshapes: [{ id: customId, name: 'Ma main', image: jpeg, createdAt: 1, updatedAt: 1 }],
  signs,
  notes: [
    {
      id: randomUUID(),
      title: 'Ma note',
      elements: signs.slice(0, 3).map((s, orderIndex) => ({ id: randomUUID(), signId: s.id, orderIndex })),
      updatedAt: 1,
    },
  ],
};

/** Applique une modification à une copie de la sauvegarde valide et renvoie le résultat. */
const parse = (mutate: (b: any) => void | string, existing = new Set<string>()) => {
  const b = structuredClone(valid);
  const raw = mutate(b);
  return parseBackup(typeof raw === 'string' ? raw : JSON.stringify(b), catalog, existing);
};

describe('parseBackup', () => {
  it('accepte une sauvegarde v2 complète', () => {
    const r = parseBackup(JSON.stringify(valid), catalog);
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
    if (r.ok) {
      expect(r.backup.signs).toHaveLength(14);
      expect(r.backup.customHandshapes).toHaveLength(1);
    }
  });

  it('convertit les sauvegardes v1/v2 (une configuration et un mouvement par main) au format actuel', () => {
    const legacySign = {
      id: randomUUID(),
      word: 'Ancien',
      tags: [],
      anatomy: {
        dominantHandId: 'hand_a',
        dominantMovementId: 'move_arc',
        dominantDirectionId: 'dir_up',
        nonDominantHandId: 'hand_b',
        nonDominantMovementId: 'move_none',
        locationZoneIds: ['zone_chin'],
      },
      createdAt: 1,
      updatedAt: 1,
    };
    for (const version of [1, 2]) {
      const r = parseBackup(
        JSON.stringify({ format: 'lsf-visual-notes', version, exportedAt: 'x', signs: [legacySign], notes: [] }),
        catalog,
      );
      expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
      if (r.ok) {
        expect(r.backup.version).toBe(BACKUP_VERSION);
        expect(r.backup.customHandshapes).toEqual([]);
        expect(r.backup.signs[0].anatomy.dominant).toEqual({
          handshapeIds: ['hand_a'],
          movementIds: ['move_arc'],
          directionIds: ['dir_up'],
        });
      }
    }
  });

  it('rejette une ancienne sauvegarde dont la conversion donne un signe invalide', () => {
    const bad = { id: randomUUID(), word: 'x', tags: [], anatomy: { dominantHandId: 'hand_inventee', dominantMovementId: 'move_arc', locationZoneIds: [] }, createdAt: 1, updatedAt: 1 };
    const r = parseBackup(JSON.stringify({ format: 'lsf-visual-notes', version: 2, exportedAt: 'x', signs: [bad], notes: [] }), catalog);
    expect(r.ok).toBe(false);
  });

  it('accepte une note en carte mentale', () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const r = parse((bk) => {
      bk.notes[0].layout = 'map';
      bk.notes[0].map = {
        nodes: [
          { id: a, x: 40, y: 40, elements: [{ id: randomUUID(), signId: signs[0].id, orderIndex: 0 }] },
          { id: b, x: 400, y: 200, elements: [] },
        ],
        links: [{ id: randomUUID(), from: a, to: b, arrow: true }],
      };
    });
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
  });

  it('accepte la vidéo d\'un signe (MP4 ou WebM)', () => {
    const r = parse((b) => {
      b.version = 4;
      b.signs[1].video = { mimeType: 'video/mp4', durationMs: 3200, bytes: 12 };
      b.videos = [{ signId: b.signs[1].id, mimeType: 'video/mp4', durationMs: 3200, data: 'data:video/mp4;base64,AAAAIGZ0eXBpc29t' }];
    });
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
    if (r.ok) expect(r.backup.videos).toHaveLength(1);
  });

  it('accepte une sauvegarde v3 (sans vidéos)', () => {
    const r = parse((b) => void (b.version = 3));
    expect(r.ok && r.backup.videos.length === 0).toBe(true);
  });

  it('accepte les glyphes enregistrés avant le passage à 48 points (32 points)', () => {
    expect(parse((b) => void (b.signs[1].glyph.normalizedGesturePoints = b.signs[1].glyph.normalizedGesturePoints.slice(0, 32))).ok).toBe(true);
  });

  it('accepte un signe réduit au mot (seul champ obligatoire) : aucune main', () => {
    const r = parse((b) => void (b.signs[1].anatomy = { locationZoneIds: [] }));
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
  });

  it('accepte une main partiellement renseignée (configuration sans mouvement, ou mouvement seul)', () => {
    expect(parse((b) => void (b.signs[1].anatomy.dominant = { handshapeIds: ['hand_a'], movementIds: [], directionIds: [] })).ok).toBe(true);
    expect(parse((b) => void (b.signs[1].anatomy.dominant = { handshapeIds: [], movementIds: ['move_arc'], directionIds: [] })).ok).toBe(true);
    expect(parse((b) => void (b.signs[1].anatomy.nonDominant = { handshapeIds: [], movementIds: [], directionIds: [], orientationId: 'orient_palm_up' })).ok).toBe(true);
  });

  it('accepte un signe composé (« bienveillance » = « attention » + « prendre soin »)', () => {
    const r = parse((b) => void (b.signs[0].components = [b.signs[1].id, b.signs[2].id]));
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
    expect(r.ok && r.backup.signs[0].components).toHaveLength(2);
  });

  it('accepte un composé de composés, et un composant absent du fichier (signe local)', () => {
    expect(parse((b) => { b.signs[0].components = [b.signs[1].id]; b.signs[1].components = [b.signs[2].id]; }).ok).toBe(true);
    expect(parse((b) => void (b.signs[0].components = [randomUUID()])).ok).toBe(true);
  });

  it('accepte une note en dessin libre (encre, signe, texte)', () => {
    const r = parse((b) => {
      b.notes[0].layout = 'canvas';
      b.notes[0].canvas = { objects: [
        { type: 'ink', id: randomUUID(), x: 120.5, y: 80, w: 150, h: 60, d: 'M10,10 Q20,20 30,30 T40,40Z', color: '#c62828' },
        { type: 'sign', id: randomUUID(), x: 500, y: 400, signId: b.signs[0].id, scale: 1.5 },
        { type: 'text', id: randomUUID(), x: 300, y: 600, text: 'Bonjour\nle monde', size: 36, color: '#1d1d1f' },
      ] };
    });
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
  });

  it('accepte ce que le plateau produit réellement (encre, signe posé au centre, signe reconnu)', () => {
    const points = Array.from({ length: 60 }, (_, i) => ({ x: 300 + i * 4, y: 500 + Math.sin(i / 6) * 40 }));
    const r = parse((b) => {
      b.notes[0].layout = 'canvas';
      b.notes[0].canvas = { objects: [
        inkFromPoints(points, '#1565c0', 3.3, randomUUID()),
        inkFromPoints([{ x: 10, y: 10 }], '#1d1d1f', 6, randomUUID()), // simple point
        signAt(b.signs[0].id, { x: 900, y: 700 }, 1, randomUUID()),
        signAt(b.signs[1].id, { x: 0, y: 0 }, 2.5, randomUUID()), // coin du plateau
      ] };
    });
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
  });

  it('accepte un ancien fichier avec une carte mentale (conservée, non affichée)', () => {
    expect(parse((b) => void ((b.notes[0].layout = 'map'), (b.notes[0].map = { nodes: [], links: [] }))).ok).toBe(true);
  });

  it("accepte les sauvegardes v5 (sans plateau)", () => {
    expect(parse((b) => void (b.version = 5)).ok).toBe(true);
  });

  it("accepte les sauvegardes v4 (sans signes composés)", () => {
    expect(parse((b) => void (b.version = 4)).ok).toBe(true);
  });

  it("accepte la couleur d'affichage d'un glyphe (globale ou par trait)", () => {
    expect(parse((b) => void (b.signs[1].glyph.color = '#e0a100')).ok).toBe(true);
    expect(parse((b) => void (b.signs[1].glyph.strokes[0].color = '#c62828')).ok).toBe(true);
  });

  it("accepte une configuration personnelle déjà présente dans l'application", () => {
    expect(parse((b) => void (b.customHandshapes = []), new Set([customId])).ok).toBe(true);
  });

  it('rejette sans pollution de prototype', () => {
    const r = parse(() => JSON.stringify(valid).replace('"format"', '"__proto__":{"polluted":true},"format"'));
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it.each<[string, (b: any) => void | string, RegExp?]>([
    ['JSON invalide', () => '{oops', /JSON valide/],
    ['autre format', (b) => void (b.format = 'autre')],
    ['version future', (b) => void (b.version = 7), /Version/],
    ['configuration inconnue', (b) => void (b.signs[1].anatomy.dominant.handshapeIds = ['hand_inventee']), /signs\[1\]\.anatomy\.dominant\.handshapeIds\[0\]/],
    ['config perso absente', (b) => void (b.customHandshapes = []), /Configuration personnelle absente/],
    ['suite de configurations trop longue', (b) => void (b.signs[1].anatomy.dominant.handshapeIds = Array(6).fill('hand_a'))],
    ['direction inconnue', (b) => void b.signs[1].anatomy.dominant.directionIds.push('dir_x'), /Direction/],
    ['ancien format dans une v3', (b) => void (b.signs[1].anatomy = { dominantHandId: 'hand_a', dominantMovementId: 'move_arc', locationZoneIds: [] })],
    ['zone inconnue', (b) => void b.signs[0].anatomy.locationZoneIds.push('zone_x'), /locationZoneIds\[2\]/],
    ['orientation inconnue', (b) => void (b.signs[0].anatomy.dominant.orientationId = 'orient_x'), /Orientation/],
    ['répétition non booléenne', (b) => void (b.signs[0].anatomy.dominant.repeated = 'oui')],
    ['balise dans svgPathData', (b) => void (b.signs[1].glyph.svgPathData = 'M0,0 Z"/><script>alert(1)</script>'), /svgPathData/],
    ['lien vers une bulle inexistante', (b) => void ((b.notes[0].layout = 'map'), (b.notes[0].map = { nodes: [{ id: randomUUID(), x: 0, y: 0, elements: [] }], links: [{ id: randomUUID(), from: randomUUID(), to: randomUUID(), arrow: true }] })), /bulle inexistante/],
    ['lien d\'une bulle vers elle-même', (b) => { const id = randomUUID(); b.notes[0].map = { nodes: [{ id, x: 0, y: 0, elements: [] }], links: [{ id: randomUUID(), from: id, to: id, arrow: false }] }; }],
    ['bulle hors de la surface', (b) => void (b.notes[0].map = { nodes: [{ id: randomUUID(), x: 99_999, y: 0, elements: [] }], links: [] })],
    ['disposition inconnue', (b) => void (b.notes[0].layout = 'grille')],
    ['vidéo sans signe correspondant', (b) => void (b.videos = [{ signId: randomUUID(), mimeType: 'video/mp4', durationMs: 1000, data: 'data:video/mp4;base64,AAAA' }]), /Vidéo sans signe/],
    ['vidéo au format non autorisé', (b) => void (b.videos = [{ signId: b.signs[0].id, mimeType: 'video/quicktime', durationMs: 1000, data: 'data:video/quicktime;base64,AAAA' }])],
    ['vidéo déguisée (HTML)', (b) => void (b.videos = [{ signId: b.signs[0].id, mimeType: 'video/mp4', durationMs: 1000, data: 'data:text/html;base64,PHNjcmlwdD4=' }])],
    ['vidéo trop lourde', (b) => void (b.videos = [{ signId: b.signs[0].id, mimeType: 'video/mp4', durationMs: 1000, data: 'data:video/mp4;base64,' + 'A'.repeat(4_300_000) }])],
    ['deux vidéos pour un signe', (b) => void (b.videos = [0, 1].map(() => ({ signId: b.signs[0].id, mimeType: 'video/webm', durationMs: 1000, data: 'data:video/webm;base64,AAAA' }))), /même signe/],
    ['fiche vidéo trop longue', (b) => void (b.signs[0].video = { mimeType: 'video/mp4', durationMs: 60_000, bytes: 10 })],
    ['objet de plateau de type inconnu', (b) => void (b.notes[0].canvas = { objects: [{ type: 'script', id: randomUUID(), x: 0, y: 0 }] })],
    ['encre avec balise dans le chemin', (b) => void (b.notes[0].canvas = { objects: [{ type: 'ink', id: randomUUID(), x: 0, y: 0, w: 5, h: 5, d: 'M0,0 Z"/><script>', color: '#000000' }] })],
    ['encre avec couleur piégée', (b) => void (b.notes[0].canvas = { objects: [{ type: 'ink', id: randomUUID(), x: 0, y: 0, w: 5, h: 5, d: 'M0,0Z', color: 'url(javascript:1)' }] })],
    ['objet hors du plateau', (b) => void (b.notes[0].canvas = { objects: [{ type: 'text', id: randomUUID(), x: 99999, y: 0, text: 'x', size: 20, color: '#000000' }] })],
    ['texte vide', (b) => void (b.notes[0].canvas = { objects: [{ type: 'text', id: randomUUID(), x: 0, y: 0, text: '', size: 20, color: '#000000' }] })],
    ['échelle de signe démesurée', (b) => void (b.notes[0].canvas = { objects: [{ type: 'sign', id: randomUUID(), x: 0, y: 0, signId: randomUUID(), scale: 1000 }] })],
    ['champ inconnu sur un objet', (b) => void (b.notes[0].canvas = { objects: [{ type: 'sign', id: randomUUID(), x: 0, y: 0, signId: randomUUID(), scale: 1, onclick: 'x' }] })],
    ['identifiants d\'objets en double', (b) => { const o = { type: 'sign', id: randomUUID(), x: 0, y: 0, signId: randomUUID(), scale: 1 }; b.notes[0].canvas = { objects: [o, { ...o }] }; }, /double/],
    ['trop d\'objets sur le plateau', (b) => void (b.notes[0].canvas = { objects: Array.from({ length: 3001 }, () => ({ type: 'sign', id: randomUUID(), x: 0, y: 0, signId: randomUUID(), scale: 1 })) })],
    ['disposition inconnue (grille)', (b) => void (b.notes[0].layout = 'grille')],
    ['signe composé de lui-même', (b) => void (b.signs[0].components = [b.signs[0].id]), /se contenir/],
    ['boucle de composition entre deux signes', (b) => { b.signs[0].components = [b.signs[1].id]; b.signs[1].components = [b.signs[0].id]; }, /Boucle de composition/],
    ['boucle de composition entre trois signes', (b) => { b.signs[0].components = [b.signs[1].id]; b.signs[1].components = [b.signs[2].id]; b.signs[2].components = [b.signs[0].id]; }, /Boucle/],
    ['trop de composants', (b) => void (b.signs[0].components = Array.from({ length: 7 }, () => b.signs[1].id))],
    ['composant qui n\'est pas un identifiant', (b) => void (b.signs[0].components = ['../../x'])],
    ['couleur de trait piégée', (b) => void (b.signs[1].glyph.strokes[0].color = 'url(javascript:alert(1))')],
    ['balise dans un trait', (b) => void (b.signs[1].glyph.strokes[0].d = 'M0,0 Z"/><script>')],
    ['nombre de traits incohérent', (b) => void b.signs[1].glyph.strokes.push({ d: 'M0,0 Z' }), /Un tracé par trait/],
    ['couleur non hexadécimale', (b) => void (b.signs[1].glyph.color = 'red')],
    ['couleur piégée', (b) => void (b.signs[1].glyph.color = 'url(javascript:alert(1))')],
    ['49 points', (b) => void b.signs[1].glyph.normalizedGesturePoints.push({ x: 0, y: 0, strokeId: 1 })],
    ['40 points', (b) => void (b.signs[1].glyph.normalizedGesturePoints = b.signs[1].glyph.normalizedGesturePoints.slice(0, 40))],
    ['coordonnée hors bornes', (b) => void (b.signs[1].glyph.normalizedGesturePoints[0].x = 1e9)],
    ['champ inconnu', (b) => void (b.signs[0].isAdmin = true), /isAdmin/],
    ['id non UUID', (b) => void (b.signs[0].id = '../../etc')],
    ['ids en double', (b) => void (b.signs[1].id = b.signs[0].id), /double/],
    ['mot vide', (b) => void (b.signs[0].word = '')],
    ['11 tags', (b) => void (b.signs[0].tags = Array.from({ length: 11 }, (_, i) => 't' + i))],
    ['image SVG', (b) => void (b.customHandshapes[0].image = 'data:image/svg+xml;base64,PHN2Zz4=')],
    ['image non base64', (b) => void (b.customHandshapes[0].image = 'data:image/jpeg;base64,<script>')],
    ['image trop lourde', (b) => void (b.customHandshapes[0].image = 'data:image/jpeg;base64,' + 'A'.repeat(1_000_000))],
    ['id de config perso invalide', (b) => void (b.customHandshapes[0].id = 'hand_custom_xyz')],
    ['trop de signes', (b) => void (b.signs = Array.from({ length: 10_001 }, () => ({ ...signs[1], id: randomUUID() })))],
  ])('rejette : %s', (_label, mutate, expected) => {
    const r = parse(mutate);
    expect(r.ok).toBe(false);
    if (!r.ok && expected) expect(r.errors.join(' | ')).toMatch(expected);
  });
});
