import Dexie, { type Table } from 'dexie';
import { NotePage, SignVideo, UserSign } from '../models/sign.model';
import { UserSignV1, isSignV2, migrateSignV1, migrateSignV2 } from './migrations';

export { migrateSignV1, migrateSignV2 } from './migrations';
import { CustomHandshape } from '../models/catalog.model';

export class AppDb extends Dexie {
  signs!: Table<UserSign, string>;
  notes!: Table<NotePage, string>;
  customHandshapes!: Table<CustomHandshape, string>;
  videos!: Table<SignVideo, string>;

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
    // v4 : HandSpec par main (suites de configurations, plusieurs mouvements et directions).
    this.version(4)
      .stores({
        signs: 'id, word, *tags, *anatomy.dominant.handshapeIds, *anatomy.locationZoneIds, glyph.strokeCount, createdAt',
      })
      .upgrade((tx) =>
        tx
          .table('signs')
          .toCollection()
          .modify((sign, ref) => {
            if (isSignV2(sign)) ref.value = migrateSignV2(sign);
          }),
      );
    // v5 : vidéos des signes, à part (clé = id du signe).
    this.version(5).stores({ videos: 'signId' });
  }
}

export const db = new AppDb();
