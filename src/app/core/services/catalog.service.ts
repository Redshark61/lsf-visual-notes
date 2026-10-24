import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { db } from '../db/app.db';
import {
  CUSTOM_HANDSHAPE_CATEGORY,
  Catalog,
  CatalogItem,
  CustomHandshape,
  newCustomHandshapeId,
} from '../models/catalog.model';

/**
 * Catalogue statique (public/data) + configurations photographiées par l'utilisateur (IndexedDB).
 * Les secondes apparaissent en tête de `handshapes()`, dans la catégorie « Mes configurations ».
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private loading: Promise<Catalog> | null = null;
  /** URL blob: par configuration personnelle, révoquées au rechargement / à la suppression. */
  private readonly objectUrls = new Map<string, string>();

  readonly catalog = signal<Catalog | null>(null);
  readonly customHandshapes = signal<CatalogItem[]>([]);
  readonly handshapes = computed(() => [...this.customHandshapes(), ...(this.catalog()?.handshapes ?? [])]);
  readonly zones = computed(() => this.catalog()?.zones ?? []);
  readonly movements = computed(() => this.catalog()?.movements ?? []);
  readonly orientations = computed(() => this.catalog()?.orientations ?? []);
  readonly directions = computed(() => this.catalog()?.directions ?? []);
  private readonly byId = computed(
    () =>
      new Map(
        [
          ...this.handshapes(),
          ...this.zones(),
          ...this.movements(),
          ...this.orientations(),
          ...this.directions(),
        ].map((i) => [i.id, i]),
      ),
  );

  load(): Promise<Catalog> {
    this.loading ??= Promise.all([
      firstValueFrom(this.http.get<unknown>('/data/handshapes-catalog.json')),
      this.reloadCustomHandshapes(),
    ])
      .then(async ([raw]) => {
        // Import dynamique : Zod n'entre pas dans le bundle initial (StorageService dépend de ce service).
        const { catalogSchema } = await import('../models/catalog.schema');
        const catalog: Catalog = catalogSchema.parse(raw);
        this.catalog.set(catalog);
        return catalog;
      })
      .catch((e) => {
        this.loading = null; // permet de réessayer
        throw e;
      });
    return this.loading;
  }

  find(id: string | undefined): CatalogItem | undefined {
    return id ? this.byId().get(id) : undefined;
  }

  /** À rappeler après un import de sauvegarde. */
  async reloadCustomHandshapes(): Promise<void> {
    const rows = await db.customHandshapes.orderBy('createdAt').toArray();
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.customHandshapes.set(rows.map((r) => this.toItem(r)));
  }

  async addCustomHandshape(name: string, image: Blob): Promise<CatalogItem> {
    const now = Date.now();
    const record: CustomHandshape = {
      id: newCustomHandshapeId(),
      name: name.trim().slice(0, 80),
      image,
      createdAt: now,
      updatedAt: now,
    };
    if (!record.name) throw new Error('Le nom est obligatoire.');
    await db.customHandshapes.add(record);
    const item = this.toItem(record);
    this.customHandshapes.update((list) => [...list, item]);
    return item;
  }

  /** Nombre de signes qui utilisent cette configuration (main dominante ou dominée). */
  async countUses(id: string): Promise<number> {
    return db.signs
      .filter((s) => [s.anatomy.dominant, s.anatomy.nonDominant].some((h) => h?.handshapeIds.includes(id)))
      .count();
  }

  async deleteCustomHandshape(id: string): Promise<void> {
    const uses = await this.countUses(id);
    if (uses) throw new Error(`Configuration utilisée par ${uses} signe${uses > 1 ? 's' : ''}.`);
    await db.customHandshapes.delete(id);
    const url = this.objectUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.objectUrls.delete(id);
    this.customHandshapes.update((list) => list.filter((i) => i.id !== id));
  }

  private toItem(record: CustomHandshape): CatalogItem {
    const url = URL.createObjectURL(record.image);
    this.objectUrls.set(record.id, url);
    return { id: record.id, name: record.name, category: CUSTOM_HANDSHAPE_CATEGORY, imageUrl: url };
  }
}
