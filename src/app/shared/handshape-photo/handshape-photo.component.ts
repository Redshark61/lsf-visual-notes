import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { CatalogService } from '../../core/services/catalog.service';
import { CatalogItem } from '../../core/models/catalog.model';
import { toHandshapeImage } from '../../core/utils/image';

/** « Photographier ma main » : crée une configuration personnelle et la liste avec suppression. */
@Component({
  selector: 'app-handshape-photo',
  templateUrl: './handshape-photo.component.html',
  styleUrl: './handshape-photo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HandshapePhotoComponent {
  protected readonly catalog = inject(CatalogService);
  /** Configuration créée (pour la sélectionner aussitôt). */
  readonly created = output<string>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');

  protected readonly image = signal<Blob | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.setPreview(null));
  }

  protected open(): void {
    this.reset();
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      const blob = await toHandshapeImage(file);
      this.image.set(blob);
      this.setPreview(blob);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async save(): Promise<void> {
    const image = this.image();
    if (!image || !this.name().trim() || this.busy()) return;
    this.busy.set(true);
    try {
      const item = await this.catalog.addCustomHandshape(this.name(), image);
      this.created.emit(item.id);
      this.close();
    } catch (e) {
      this.error.set(`Enregistrement impossible : ${(e as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(item: CatalogItem): Promise<void> {
    const uses = await this.catalog.countUses(item.id);
    if (uses) {
      alert(
        `« ${item.name} » est utilisée par ${uses} signe${uses > 1 ? 's' : ''}. ` +
          'Modifiez ces signes avant de la supprimer.',
      );
      return;
    }
    if (!confirm(`Supprimer la configuration « ${item.name} » ?`)) return;
    await this.catalog.deleteCustomHandshape(item.id);
  }

  /** Clic sur le fond assombri : ferme la fenêtre. */
  protected onDialogClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  private reset(): void {
    this.image.set(null);
    this.setPreview(null);
    this.name.set('');
    this.error.set(null);
    this.fileInput().nativeElement.value = '';
  }

  private setPreview(blob: Blob | null): void {
    const old = this.previewUrl();
    if (old) URL.revokeObjectURL(old);
    this.previewUrl.set(blob ? URL.createObjectURL(blob) : null);
  }
}
