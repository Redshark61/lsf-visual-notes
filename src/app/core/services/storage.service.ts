import { Injectable, inject, signal } from '@angular/core';
import type { Table } from 'dexie';
import { db } from '../db/app.db';
import { BACKUP_FORMAT, BACKUP_VERSION, Backup } from '../models/backup.model';
import { CustomHandshape } from '../models/catalog.model';
import { blobToDataUrl, dataUrlToBlob } from '../utils/image';
import { CatalogService } from './catalog.service';
import { NotePage, SignAnatomy, SignGlyph, UserSign } from '../models/sign.model';
import { RecognitionService } from './recognition.service';

export const MAX_WORD_LENGTH = 80;
export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS = 10;

export const MAX_NOTE_LENGTH = 2000;
export const MAX_NOTE_TITLE_LENGTH = 120;

export function defaultNoteTitle(date = new Date()): string {
  return `Note du ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

export interface SignDraft {
  word: string;
  tags: string[];
  anatomy: SignAnatomy;
  glyph?: SignGlyph;
  note?: string;
}

/** "Famille, maison ,famille" → ["famille", "maison"] */
export function normalizeTags(tags: string[]): string[] {
  const clean = tags.map((t) => t.trim().toLowerCase().slice(0, MAX_TAG_LENGTH)).filter(Boolean);
  return [...new Set(clean)].slice(0, MAX_TAGS);
}

async function mergeInto<T extends { id: string; updatedAt: number }>(
  table: Table<T, string>,
  incoming: T[],
  counts: { added: number; updated: number; skipped: number },
): Promise<void> {
  const existing = await table.bulkGet(incoming.map((i) => i.id));
  const toPut: T[] = [];
  incoming.forEach((item, i) => {
    const current = existing[i];
    if (!current) counts.added++;
    else if (item.updatedAt > current.updatedAt) counts.updated++;
    else {
      counts.skipped++;
      return;
    }
    toPut.push(item);
  });
  await table.bulkPut(toPut);
}

function buildSign(draft: SignDraft, meta: Pick<UserSign, 'id' | 'createdAt' | 'updatedAt'>): UserSign {
  const word = draft.word.trim().slice(0, MAX_WORD_LENGTH);
  if (!word) throw new Error('Le mot est obligatoire');
  const a = draft.anatomy;
  if (!a.dominantHandId || !a.dominantMovementId) throw new Error('La main dominante est obligatoire');
  const note = draft.note?.trim().slice(0, MAX_NOTE_LENGTH);
  /** Direction et répétition n'ont de sens que s'il y a un mouvement. */
  const moving = (movementId: string | undefined) => !!movementId && movementId !== 'move_none';
  const optional = <K extends string, V>(key: K, value: V | undefined | null | false) =>
    (value ? { [key]: value } : {}) as Partial<Record<K, V>>;
  const nonDominantMovementId = a.nonDominantMovementId ?? 'move_none';
  return {
    id: meta.id,
    word,
    tags: normalizeTags(draft.tags),
    anatomy: {
      dominantHandId: a.dominantHandId,
      dominantMovementId: a.dominantMovementId,
      ...optional('dominantDirectionId', moving(a.dominantMovementId) && a.dominantDirectionId),
      ...optional('dominantRepeated', moving(a.dominantMovementId) && a.dominantRepeated),
      ...optional('dominantOrientationId', a.dominantOrientationId),
      ...(a.nonDominantHandId
        ? {
            nonDominantHandId: a.nonDominantHandId,
            nonDominantMovementId,
            ...optional('nonDominantDirectionId', moving(nonDominantMovementId) && a.nonDominantDirectionId),
            ...optional('nonDominantRepeated', moving(nonDominantMovementId) && a.nonDominantRepeated),
            ...optional('nonDominantOrientationId', a.nonDominantOrientationId),
          }
        : {}),
      locationZoneIds: [...new Set(a.locationZoneIds)],
    },
    ...(draft.glyph ? { glyph: draft.glyph } : {}),
    ...(note ? { note } : {}),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

export type ImportMode = 'merge' | 'replace';

export interface ImportReport {
  handshapes: { added: number; updated: number; skipped: number };
  signs: { added: number; updated: number; skipped: number };
  notes: { added: number; updated: number; skipped: number };
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly recognition = inject(RecognitionService);
  private readonly catalog = inject(CatalogService);

  /** null = inconnu / API indisponible. */
  readonly persisted = signal<boolean | null>(null);

  /** Protège IndexedDB contre l'éviction automatique (notamment iOS/Safari). */
  async requestPersistence(): Promise<void> {
    if (!navigator.storage?.persist) return;
    const already = await navigator.storage.persisted();
    this.persisted.set(already || (await navigator.storage.persist()));
  }

  async createSign(draft: SignDraft): Promise<UserSign> {
    const now = Date.now();
    const sign = buildSign(draft, { id: crypto.randomUUID(), createdAt: now, updatedAt: now });
    await db.signs.add(sign);
    if (sign.glyph) this.recognition.invalidate();
    return sign;
  }

  /** Remplace le contenu du signe ; sans `draft.glyph`, le dessin est retiré. */
  async updateSign(id: string, draft: SignDraft): Promise<UserSign> {
    const existing = await db.signs.get(id);
    if (!existing) throw new Error('Ce signe n\'existe plus');
    const sign = buildSign(draft, { id, createdAt: existing.createdAt, updatedAt: Date.now() });
    await db.signs.put(sign);
    this.recognition.invalidate();
    return sign;
  }

  /** Tous les signes, par ordre alphabétique. */
  listSigns(): Promise<UserSign[]> {
    return db.signs.orderBy('word').toArray();
  }

  /** Nombre de notes qui contiennent ce signe. */
  countNotesUsing(signId: string): Promise<number> {
    return db.notes.filter((n) => n.elements.some((e) => e.signId === signId)).count();
  }

  getSign(id: string): Promise<UserSign | undefined> {
    return db.signs.get(id);
  }

  /** Signes trouvés, indexés par id (les ids inconnus sont ignorés). */
  async getSigns(ids: string[]): Promise<Map<string, UserSign>> {
    const unique = [...new Set(ids)];
    const signs = await db.signs.bulkGet(unique);
    return new Map(signs.filter((s): s is UserSign => !!s).map((s) => [s.id, s]));
  }

  countSigns(): Promise<number> {
    return db.signs.count();
  }

  countNotes(): Promise<number> {
    return db.notes.count();
  }

  // --- Notes

  /** Notes de la plus récente à la plus ancienne. */
  listNotes(): Promise<NotePage[]> {
    return db.notes.orderBy('updatedAt').reverse().toArray();
  }

  getNote(id: string): Promise<NotePage | undefined> {
    return db.notes.get(id);
  }

  async createNote(title = defaultNoteTitle()): Promise<NotePage> {
    const note: NotePage = { id: crypto.randomUUID(), title, elements: [], updatedAt: Date.now() };
    await db.notes.add(note);
    return note;
  }

  /** Enregistre la note (orderIndex recalculé d'après l'ordre du tableau). */
  async saveNote(note: NotePage): Promise<NotePage> {
    const saved: NotePage = {
      ...note,
      title: note.title.trim().slice(0, MAX_NOTE_TITLE_LENGTH) || defaultNoteTitle(),
      elements: note.elements.map((e, orderIndex) => ({ ...e, orderIndex })),
      updatedAt: Date.now(),
    };
    await db.notes.put(saved);
    return saved;
  }

  deleteNote(id: string): Promise<void> {
    return db.notes.delete(id);
  }

  // --- Sauvegarde

  async exportBackup(): Promise<Backup> {
    const [handshapes, signs, notes] = await db.transaction('r', db.customHandshapes, db.signs, db.notes, () =>
      Promise.all([db.customHandshapes.toArray(), db.signs.toArray(), db.notes.toArray()]),
    );
    const customHandshapes = await Promise.all(
      handshapes.map(async ({ image, ...rest }) => ({ ...rest, image: await blobToDataUrl(image) })),
    );
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      customHandshapes,
      signs,
      notes,
    };
  }

  /**
   * Importe une sauvegarde DÉJÀ validée par parseBackup().
   * - merge : ajoute les nouveautés ; un élément existant n'est remplacé que si l'import est plus récent.
   * - replace : efface configurations personnelles, signes et notes, puis importe tout.
   * Tout se fait dans une transaction : en cas d'erreur, rien n'est modifié.
   */
  async importBackup(backup: Backup, mode: ImportMode): Promise<ImportReport> {
    const empty = () => ({ added: 0, updated: 0, skipped: 0 });
    const report: ImportReport = { handshapes: empty(), signs: empty(), notes: empty() };
    // Conversion hors transaction (IndexedDB ne tolère pas d'attente sur autre chose qu'elle-même).
    const handshapes: CustomHandshape[] = backup.customHandshapes.map(({ image, ...rest }) => ({
      ...rest,
      image: dataUrlToBlob(image),
    }));
    await db.transaction('rw', db.customHandshapes, db.signs, db.notes, async () => {
      if (mode === 'replace') {
        await Promise.all([db.customHandshapes.clear(), db.signs.clear(), db.notes.clear()]);
        await db.customHandshapes.bulkAdd(handshapes);
        await db.signs.bulkAdd(backup.signs);
        await db.notes.bulkAdd(backup.notes);
        report.handshapes.added = handshapes.length;
        report.signs.added = backup.signs.length;
        report.notes.added = backup.notes.length;
        return;
      }
      await mergeInto(db.customHandshapes, handshapes, report.handshapes);
      await mergeInto(db.signs, backup.signs, report.signs);
      await mergeInto(db.notes, backup.notes, report.notes);
    });
    this.recognition.invalidate();
    await this.catalog.reloadCustomHandshapes();
    return report;
  }

  async deleteSign(id: string): Promise<void> {
    await db.signs.delete(id);
    this.recognition.invalidate();
  }
}
