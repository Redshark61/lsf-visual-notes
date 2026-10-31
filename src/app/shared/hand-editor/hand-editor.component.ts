import { ChangeDetectionStrategy, Component, afterNextRender, computed, ElementRef, inject, Injector, input, model, signal, viewChild } from '@angular/core';
import { CatalogPickerComponent } from '../catalog-picker/catalog-picker.component';
import { HandshapePhotoComponent } from '../handshape-photo/handshape-photo.component';
import { CatalogService } from '../../core/services/catalog.service';
import { SYMMETRIC_MOVEMENT } from '../hands-preview/hands-preview.component';
import { HandSpec, MAX_HANDSHAPE_SEQUENCE } from '../../core/models/sign.model';

type Section = 'config' | 'movement' | 'direction' | 'orientation';
const STATIC_MOVEMENT = 'move_none';

/**
 * Édition d'une main en sections repliables : suite de configurations, mouvements (plusieurs),
 * directions (plusieurs) et répétition, orientation de la paume.
 */
@Component({
  selector: 'app-hand-editor',
  imports: [CatalogPickerComponent, HandshapePhotoComponent],
  templateUrl: './hand-editor.component.html',
  styleUrl: './hand-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HandEditorComponent {
  protected readonly catalog = inject(CatalogService);
  private readonly injector = inject(Injector);
  readonly hand = model.required<HandSpec>();
  /** Affiche la case « mains symétriques » (main dominante, quand il y a deux mains). */
  readonly showSymmetric = input(false);
  private readonly movementSection = viewChild<ElementRef<HTMLElement>>('movementSection');

  protected readonly maxSequence = MAX_HANDSHAPE_SEQUENCE;
  /** Étape de la suite en cours d'édition ; = longueur de la suite pour « configuration suivante ». */
  protected readonly activeSlot = signal(0);
  private readonly openSections = signal(new Set<Section>(['config']));

  protected readonly symmetric = computed(() => this.hand().movementIds.includes(SYMMETRIC_MOVEMENT));
  /** Avec la case à cocher, « symétrique » n'est plus proposé dans la liste des mouvements. */
  protected readonly movementItems = computed(() =>
    this.showSymmetric() ? this.catalog.movements().filter((m) => m.id !== SYMMETRIC_MOVEMENT) : this.catalog.movements(),
  );
  protected readonly chipMovements = computed(() =>
    this.showSymmetric() ? this.hand().movementIds.filter((m) => m !== SYMMETRIC_MOVEMENT) : this.hand().movementIds,
  );
  protected readonly moving = computed(() =>
    this.hand().movementIds.some((m) => m !== STATIC_MOVEMENT && m !== SYMMETRIC_MOVEMENT),
  );
  protected readonly pendingSlot = computed(
    () => this.hand().handshapeIds.length > 0 && this.activeSlot() === this.hand().handshapeIds.length,
  );
  protected readonly configSummary = computed(() => this.names(this.hand().handshapeIds, ' → '));
  protected readonly movementSummary = computed(() => this.names(this.hand().movementIds, ' + '));
  protected readonly directionSummary = computed(() =>
    [this.names(this.hand().directionIds, ', '), this.hand().repeated ? 'répété' : ''].filter(Boolean).join(', '),
  );
  protected readonly orientationSummary = computed(() => this.names(this.hand().orientationId ? [this.hand().orientationId!] : [], ''));
  protected readonly sources = computed(() =>
    (this.catalog.catalog()?.sources ?? []).filter((s) => s.scope === 'handshapes'),
  );

  protected isOpen(section: Section): boolean {
    return this.openSections().has(section);
  }

  protected onToggle(section: Section, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    this.openSections.update((set) => {
      const next = new Set(set);
      if (open) next.add(section);
      else next.delete(section);
      return next;
    });
  }

  protected item(id: string) {
    return this.catalog.find(id);
  }

  // --- Configurations

  protected setSlot(id: string | null): void {
    if (!id) return;
    const ids = [...this.hand().handshapeIds];
    ids[Math.min(this.activeSlot(), ids.length)] = id;
    const first = this.hand().handshapeIds.length === 0;
    this.patch({ handshapeIds: ids });
    // Premier choix : on enchaîne naturellement sur le mouvement (ouvert et amené à l'écran).
    if (first && this.hand().movementIds.length === 0) {
      this.openSections.update((s) => new Set([...s, 'movement']));
      afterNextRender(() => this.movementSection()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), {
        injector: this.injector,
      });
    }
  }

  protected addSlot(): void {
    if (this.hand().handshapeIds.length < MAX_HANDSHAPE_SEQUENCE) this.activeSlot.set(this.hand().handshapeIds.length);
  }

  protected removeSlot(index: number): void {
    const ids = this.hand().handshapeIds.filter((_, i) => i !== index);
    this.patch({ handshapeIds: ids });
    this.activeSlot.set(Math.max(0, Math.min(this.activeSlot(), ids.length - 1)));
  }

  protected cancelPending(): void {
    this.activeSlot.set(Math.max(0, this.hand().handshapeIds.length - 1));
  }

  // --- Mouvements, directions, orientation

  /** « Aucun (statique) » est exclusif : il remplace les autres, et inversement. */
  protected setMovements(chosen: string[]): void {
    const previous = this.chipMovements();
    const added = chosen.find((id) => !previous.includes(id));
    const picked =
      added === STATIC_MOVEMENT ? [STATIC_MOVEMENT] : chosen.filter((id) => id !== STATIC_MOVEMENT || chosen.length === 1);
    const moving = picked.some((m) => m !== STATIC_MOVEMENT);
    const symmetric = this.showSymmetric() && this.symmetric();
    this.patch({
      movementIds: symmetric ? [...picked, SYMMETRIC_MOVEMENT] : picked,
      ...(moving ? {} : { directionIds: [], repeated: undefined }),
    });
  }

  protected setSymmetric(on: boolean): void {
    const others = this.hand().movementIds.filter((m) => m !== SYMMETRIC_MOVEMENT);
    this.patch({ movementIds: on ? [...others, SYMMETRIC_MOVEMENT] : others });
  }

  protected setDirections(directionIds: string[]): void {
    this.patch({ directionIds });
  }

  protected setRepeated(repeated: boolean): void {
    this.patch({ repeated: repeated || undefined });
  }

  protected setOrientation(orientationId: string | null): void {
    this.patch({ orientationId: orientationId ?? undefined });
  }

  private patch(change: Partial<HandSpec>): void {
    const next: HandSpec = { ...this.hand(), ...change };
    if (next.repeated === undefined) delete next.repeated;
    if (next.orientationId === undefined) delete next.orientationId;
    this.hand.set(next);
  }

  private names(ids: string[], separator: string): string {
    return ids.map((id) => this.catalog.find(id)?.name ?? id).join(separator);
  }
}
