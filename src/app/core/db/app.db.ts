import Dexie, { type Table } from 'dexie';
import { NotePage, SignGlyph, StrokePoint, UserSign } from '../models/sign.model';
import { CustomHandshape } from '../models/catalog.model';

/** Format v1 (avant l'assistant en étapes) : un seul mouvement, une seule zone, glyphe à plat. */
interface UserSignV1 {
  id: string;
  word: string;
  tags: string[];
  anatomy: { dominantHandId: string; nonDominantHandId?: string; locationZoneId: string; movementId: string };
  normalizedGesturePoints: StrokePoint[];
  boundingBoxRatio: number;
  strokeCount: number;
  svgPathData: string;
  createdAt: number;
  updatedAt: number;
}

export function migrateSignV1(old: UserSignV1): UserSign {
  const { anatomy, normalizedGesturePoints, boundingBoxRatio, strokeCount, svgPathData, ...rest } = old;
  const glyph: SignGlyph = { normalizedGesturePoints, boundingBoxRatio, strokeCount, svgPathData };
  return {
    ...rest,
    anatomy: {
      dominantHandId: anatomy.dominantHandId,
      dominantMovementId: anatomy.movementId,
      ...(anatomy.nonDominantHandId
        ? { nonDominantHandId: anatomy.nonDominantHandId, nonDominantMovementId: 'move_none' }
        : {}),
      locationZoneIds: anatomy.locationZoneId ? [anatomy.locationZoneId] : [],
    },
    glyph,
  };
}

export class AppDb extends Dexie {
  signs!: Table<UserSign, string>;
  notes!: Table<NotePage, string>;
  customHandshapes!: Table<CustomHandshape, string>;

  constructor() {
    super('lsf-visual-notes');
    this.version(1).stores({
      signs: 'id, word, *tags, anatomy.dominantHandId, strokeCount, createdAt',
      notes: 'id, updatedAt',
    });
    this.version(2)
      .stores({
        signs: 'id, word, *tags, anatomy.dominantHandId, *anatomy.locationZoneIds, glyph.strokeCount, createdAt',
      })
      .upgrade((tx) =>
        tx
          .table('signs')
          .toCollection()
          .modify((sign, ref) => {
            if ('glyph' in sign || !('svgPathData' in sign)) return; // déjà au format v2
            ref.value = migrateSignV1(sign as UserSignV1);
          }),
      );
    this.version(3).stores({ customHandshapes: 'id, createdAt' });
  }
}

export const db = new AppDb();
