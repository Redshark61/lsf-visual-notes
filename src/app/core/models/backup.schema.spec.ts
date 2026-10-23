import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBackup } from './backup.schema';
import { catalogSchema } from './catalog.schema';
import { extractGesture } from '../utils/gesture';
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
    dominantHandId: i === 0 ? customId : 'hand_a',
    dominantMovementId: 'move_arc',
    dominantDirectionId: 'dir_up',
    dominantRepeated: true,
    dominantOrientationId: 'orient_palm_self',
    ...(i % 2
      ? { nonDominantHandId: 'hand_b', nonDominantMovementId: 'move_none', nonDominantOrientationId: 'orient_palm_up' }
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
  version: 2,
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

  it('lit encore les sauvegardes v1 (normalisées en v2)', () => {
    const r = parseBackup(
      JSON.stringify({ format: 'lsf-visual-notes', version: 1, exportedAt: 'x', signs: signs.slice(1), notes: [] }),
      catalog,
    );
    expect(r.ok && r.backup.version === 2 && r.backup.customHandshapes.length === 0).toBe(true);
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
    ['version future', (b) => void (b.version = 3), /Version/],
    ['configuration inconnue', (b) => void (b.signs[1].anatomy.dominantHandId = 'hand_inventee'), /signs\[1\]\.anatomy\.dominantHandId/],
    ['config perso absente', (b) => void (b.customHandshapes = []), /Configuration personnelle absente/],
    ['zone inconnue', (b) => void b.signs[0].anatomy.locationZoneIds.push('zone_x'), /locationZoneIds\[2\]/],
    ['orientation inconnue', (b) => void (b.signs[0].anatomy.dominantOrientationId = 'orient_x'), /Orientation/],
    ['répétition non booléenne', (b) => void (b.signs[0].anatomy.dominantRepeated = 'oui')],
    ['balise dans svgPathData', (b) => void (b.signs[1].glyph.svgPathData = 'M0,0 Z"/><script>alert(1)</script>'), /svgPathData/],
    ['33 points', (b) => void b.signs[1].glyph.normalizedGesturePoints.push({ x: 0, y: 0, strokeId: 1 })],
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
