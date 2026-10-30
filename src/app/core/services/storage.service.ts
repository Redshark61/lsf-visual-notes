import { Injectable, inject, signal } from '@angular/core';
import type { Table } from 'dexie';
import { db } from '../db/app.db';
import { BACKUP_FORMAT, BACKUP_VERSION, Backup } from '../models/backup.model';
import { CustomHandshape } from '../models/catalog.model';
import { blobToDataUrl, dataUrlToBlob } from '../utils/image';
import { normalizeHand } from '../utils/hand-spec';
import { missingComponentIds, videoSigns } from '../utils/composition';
import { TagCount, normalizeTags, tallyTags } from '../utils/tags';
import { CatalogService } from './catalog.service';
import {
  MAX_COMPONENTS,
  NoteElement,
  NotePage,
  SignVideo,
  SignVideoInfo,
  VideoMimeType,
  SignAnatomy,
  SignGlyph,
  UserSign,
} from '../models/sign.model';
import { RecognitionService } from './recognition.service';

export const MAX_WORD_LENGTH = 80;

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
  /** Nouvelle vidéo ; null = supprimer la vidéo existante ; absent = ne pas y toucher. */
  video?: VideoDraft | null;
  /** Signes composants (signe composé), dans l'ordre. Absent ou vide = signe simple. */
  components?: string[];
}

export interface VideoDraft {
  blob: Blob;
  mimeType: VideoMimeType;
  durationMs: number;
}

/** "Famille, maison ,famille" → ["famille", "maison"] */

async function mergeInto<T extends { id: string; updatedAt: number }>(
  table: Table<T, string>,
  incoming: T[],
  counts: { added: number; updated: number; skipped: number },
): Promise<T[]> {
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
  return toPut;
}

function videoInfo(video: { blob: Blob; mimeType: VideoMimeType; durationMs: number }): SignVideoInfo {
  return { mimeType: video.mimeType, durationMs: Math.round(video.durationMs), bytes: video.blob.size };
}

function toVideoRow(signId: string, video: VideoDraft): SignVideo {
  return { signId, blob: video.blob, mimeType: video.mimeType, durationMs: Math.round(video.durationMs) };
}

/** Applique la vidéo du brouillon à la fiche du signe (null = retirée). */
function withVideo(sign: UserSign, video: VideoDraft | null | undefined): UserSign {
  const { video: _previous, ...rest } = sign;
  return video ? { ...rest, video: videoInfo(video) } : rest;
}

function buildSign(draft: SignDraft, meta: Pick<UserSign, 'id' | 'createdAt' | 'updatedAt'>): UserSign {
  const word = draft.word.trim().slice(0, MAX_WORD_LENGTH);
  if (!word) throw new Error('Le mot est obligatoire');
  // Seul le mot est obligatoire : une main sans aucune information n'est pas enregistrée.
  const dominant = normalizeHand(draft.anatomy.dominant);
  const nonDominant = normalizeHand(draft.anatomy.nonDominant);
  const note = draft.note?.trim().slice(0, MAX_NOTE_LENGTH);
  const components = (draft.components ?? []).filter(Boolean).slice(0, MAX_COMPONENTS);
  return {
    id: meta.id,
    word,
    tags: normalizeTags(draft.tags),
    anatomy: {
      ...(dominant ? { dominant } : {}),
      ...(nonDominant ? { nonDominant } : {}),
      locationZoneIds: [...new Set(draft.anatomy.locationZoneIds)],
    },
    ...(draft.glyph ? { glyph: draft.glyph } : {}),
    ...(note ? { note } : {}),
    ...(components.length ? { components } : {}),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

export type ImportMode = 'merge' | 'replace';

export interface ImportReport {
  videos: { added: number };
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
    const sign = withVideo(buildSign(draft, { id: crypto.randomUUID(), createdAt: now, updatedAt: now }), draft.video);
    await this.assertValidComponents(sign.id, sign.components);
    await db.transaction('rw', db.signs, db.videos, async () => {
      await db.signs.add(sign);
      if (draft.video) await db.videos.put(toVideoRow(sign.id, draft.video));
    });
    if (sign.glyph) this.recognition.invalidate();
    return sign;
  }

  /** Remplace le contenu du signe ; sans `draft.glyph`, le dessin est retiré (vidéo : voir SignDraft). */
  async updateSign(id: string, draft: SignDraft): Promise<UserSign> {
    const existing = await db.signs.get(id);
    if (!existing) throw new Error('Ce signe n\'existe plus');
    const built = buildSign(draft, { id, createdAt: existing.createdAt, updatedAt: Date.now() });
    await this.assertValidComponents(id, built.components);
    const sign =
      draft.video === undefined ? (existing.video ? { ...built, video: existing.video } : built) : withVideo(built, draft.video);
    await db.transaction('rw', db.signs, db.videos, async () => {
      await db.signs.put(sign);
      if (draft.video === null) await db.videos.delete(id);
      else if (draft.video) await db.videos.put(toVideoRow(id, draft.video));
    });
    this.recognition.invalidate();
    return sign;
  }

  /** Les composants existent et ne forment aucune boucle avec le signe. */
  private async assertValidComponents(signId: string, components: string[] | undefined): Promise<void> {
    if (!components?.length) return;
    const found = await db.signs.bulkGet(components);
    if (found.some((s) => !s)) throw new Error("Un des signes composants n'existe plus");
    // Parcours des composants (et de leurs composants…) à la recherche du signe lui-même.
    const seen = new Set<string>();
    let frontier = components;
    while (frontier.length) {
      if (frontier.includes(signId)) throw new Error('Un signe ne peut pas se contenir lui-même (boucle de composition)');
      frontier.forEach((id) => seen.add(id));
      const next = (await db.signs.bulkGet(frontier)).flatMap((s) => s?.components ?? []);
      frontier = [...new Set(next)].filter((id) => !seen.has(id));
    }
  }

  /**
   * Clips à lire pour un signe composé qui n'a pas de vidéo propre : les vidéos de ses composants
   * (et de leurs composants…), dans l'ordre. Vide si aucun composant n'a de vidéo.
   */
  async compositionVideos(sign: UserSign): Promise<{ word: string; blob: Blob }[]> {
    const known = new Map<string, UserSign>([[sign.id, sign]]);
    let wanted = missingComponentIds([sign], known);
    for (let depth = 0; wanted.length && depth < 8; depth++) {
      const found = (await db.signs.bulkGet(wanted)).filter((s): s is UserSign => !!s);
      found.forEach((s) => known.set(s.id, s));
      wanted = missingComponentIds(found, known).filter((id) => !wanted.includes(id));
    }
    const leaves = videoSigns(sign, known);
    const videos = await db.videos.bulkGet(leaves.map((s) => s.id));
    return leaves.flatMap((s, i) => (videos[i] ? [{ word: s.word, blob: videos[i]!.blob }] : []));
  }

  /** Nombre d'autres signes dont ce signe est un composant. */
  countCompositesUsing(signId: string): Promise<number> {
    return db.signs.filter((s) => !!s.components?.includes(signId)).count();
  }

  getVideo(signId: string): Promise<SignVideo | undefined> {
    return db.videos.get(signId);
  }

  /** Tags existants avec leur nombre d'utilisations (index multi-entrées de Dexie, sans charger les signes). */
  async listTags(): Promise<TagCount[]> {
    return tallyTags((await db.signs.orderBy('tags').keys()) as string[]);
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

  /**
   * Charge des signes et, de proche en proche, leurs composants (un signe composé affiche ceux-ci).
   * Renvoie seulement les signes nouvellement chargés (ceux de `known` ne sont pas relus).
   */
  async loadSignsWithComponents(
    ids: readonly string[],
    known: ReadonlyMap<string, UserSign>,
  ): Promise<Map<string, UserSign>> {
    const loaded = new Map<string, UserSign>();
    const attempted = new Set<string>();
    let wanted = [...new Set(ids)].filter((id) => !known.has(id));
    while (wanted.length) {
      wanted.forEach((id) => attempted.add(id));
      const found = await this.getSigns(wanted);
      found.forEach((sign, id) => loaded.set(id, sign));
      wanted = missingComponentIds(found.values(), new Map([...known, ...loaded])).filter((id) => !attempted.has(id));
    }
    return loaded;
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
    const order = (elements: NoteElement[]) => elements.map((e, orderIndex) => ({ ...e, orderIndex }));
    const saved: NotePage = {
      ...note,
      title: note.title.trim().slice(0, MAX_NOTE_TITLE_LENGTH) || defaultNoteTitle(),
      elements: order(note.elements),
      ...(note.map
        ? { map: { ...note.map, nodes: note.map.nodes.map((n) => ({ ...n, elements: order(n.elements) })) } }
        : {}),
      updatedAt: Date.now(),
    };
    await db.notes.put(saved);
    return saved;
  }

  deleteNote(id: string): Promise<void> {
    return db.notes.delete(id);
  }

  // --- Sauvegarde

  /** Sauvegarde complète ; `includeVideos: false` allège le fichier (les vidéos restent sur l'appareil). */
  async exportBackup(includeVideos = true): Promise<Backup> {
    const [handshapes, signs, notes, videoRows] = await db.transaction(
      'r',
      [db.customHandshapes, db.signs, db.notes, db.videos],
      () =>
        Promise.all([
          db.customHandshapes.toArray(),
          db.signs.toArray(),
          db.notes.toArray(),
          includeVideos ? db.videos.toArray() : Promise.resolve([] as SignVideo[]),
        ]),
    );
    const customHandshapes = await Promise.all(
      handshapes.map(async ({ image, ...rest }) => ({ ...rest, image: await blobToDataUrl(image) })),
    );
    const videos = await Promise.all(
      videoRows.map(async (v) => ({
        signId: v.signId,
        mimeType: v.mimeType,
        durationMs: v.durationMs,
        // Type sans paramètres (codecs) : la data URL reste au format attendu à l'import.
        data: await blobToDataUrl(new Blob([v.blob], { type: v.mimeType })),
      })),
    );
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      customHandshapes,
      videos,
      signs,
      notes,
    };
  }

  /**
   * Importe une sauvegarde DÉJÀ validée par parseBackup().
   * - merge : ajoute les nouveautés ; un élément existant n'est remplacé que si l'import est plus récent.
   * - replace : efface configurations personnelles, signes, vidéos et notes, puis importe tout.
   * Une vidéo locale n'est jamais perdue à cause d'un fichier exporté sans les vidéos (fusion).
   * Tout se fait dans une transaction : en cas d'erreur, rien n'est modifié.
   */
  async importBackup(backup: Backup, mode: ImportMode): Promise<ImportReport> {
    const empty = () => ({ added: 0, updated: 0, skipped: 0 });
    const report: ImportReport = { videos: { added: 0 }, handshapes: empty(), signs: empty(), notes: empty() };
    // Conversions hors transaction (IndexedDB ne tolère pas d'attente sur autre chose qu'elle-même).
    const handshapes: CustomHandshape[] = backup.customHandshapes.map(({ image, ...rest }) => ({
      ...rest,
      image: dataUrlToBlob(image),
    }));
    const fileVideos = new Map(
      backup.videos.map((v) => [
        v.signId,
        { signId: v.signId, blob: dataUrlToBlob(v.data), mimeType: v.mimeType, durationMs: v.durationMs } as SignVideo,
      ]),
    );
    await db.transaction('rw', [db.customHandshapes, db.signs, db.notes, db.videos], async () => {
      const localVideos = new Set(mode === 'merge' ? await db.videos.toCollection().primaryKeys() : []);
      const local = new Map(
        mode === 'merge'
          ? (await db.signs.bulkGet(backup.signs.map((s) => s.id))).filter((s): s is UserSign => !!s).map((s) => [s.id, s])
          : [],
      );
      // Fiche vidéo cohérente avec ce qui sera réellement stocké.
      const signs = backup.signs.map((sign) => {
        const { video: _declared, ...rest } = sign;
        const fromFile = fileVideos.get(sign.id);
        if (fromFile) return { ...rest, video: videoInfo(fromFile) };
        const kept = localVideos.has(sign.id) ? local.get(sign.id)?.video : undefined;
        return kept ? { ...rest, video: kept } : rest;
      });

      if (mode === 'replace') {
        await Promise.all([db.customHandshapes.clear(), db.signs.clear(), db.notes.clear(), db.videos.clear()]);
        await db.customHandshapes.bulkAdd(handshapes);
        await db.signs.bulkAdd(signs);
        await db.notes.bulkAdd(backup.notes);
        await db.videos.bulkAdd([...fileVideos.values()]);
        report.handshapes.added = handshapes.length;
        report.signs.added = signs.length;
        report.notes.added = backup.notes.length;
        report.videos.added = fileVideos.size;
        return;
      }
      await mergeInto(db.customHandshapes, handshapes, report.handshapes);
      const written = await mergeInto(db.signs, signs, report.signs);
      await mergeInto(db.notes, backup.notes, report.notes);
      // Vidéos : seulement pour les signes effectivement ajoutés ou mis à jour.
      const videos = written.map((s) => fileVideos.get(s.id)).filter((v): v is SignVideo => !!v);
      await db.videos.bulkPut(videos);
      report.videos.added = videos.length;
    });
    this.recognition.invalidate();
    await this.catalog.reloadCustomHandshapes();
    return report;
  }

  /** Supprime le signe, sa vidéo, et le retire des signes composés qui l'utilisaient. */
  async deleteSign(id: string): Promise<void> {
    await db.transaction('rw', db.signs, db.videos, async () => {
      const users = await db.signs.filter((s) => !!s.components?.includes(id)).toArray();
      await db.signs.bulkPut(
        users.map((s) => {
          const { components: _before, ...rest } = s;
          const remaining = (s.components ?? []).filter((c) => c !== id);
          return { ...rest, ...(remaining.length ? { components: remaining } : {}), updatedAt: Date.now() };
        }),
      );
      await Promise.all([db.signs.delete(id), db.videos.delete(id)]);
    });
    this.recognition.invalidate();
  }
}
