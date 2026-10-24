import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CatalogService } from '../../core/services/catalog.service';
import { ImportMode, ImportReport, StorageService } from '../../core/services/storage.service';
import { Backup, MAX_BACKUP_BYTES, parseBackup } from '../../core/models/backup.schema';

@Component({
  selector: 'app-backup',
  imports: [DatePipe],
  templateUrl: './backup.component.html',
  styleUrl: './backup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupComponent {
  private readonly storage = inject(StorageService);
  private readonly catalog = inject(CatalogService);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');

  protected readonly persisted = this.storage.persisted;
  protected readonly counts = signal<{ signs: number; notes: number } | null>(null);
  protected readonly canShare = typeof navigator.canShare === 'function';
  protected readonly busy = signal(false);
  /** Les vidéos alourdissent le fichier (~150 Ko par signe) : on peut les laisser sur l'appareil. */
  protected readonly includeVideos = signal(true);
  protected readonly exportError = signal<string | null>(null);

  protected readonly pending = signal<{ fileName: string; backup: Backup } | null>(null);
  protected readonly importErrors = signal<string[]>([]);
  protected readonly mode = signal<ImportMode>('merge');
  protected readonly report = signal<ImportReport | null>(null);

  constructor() {
    this.refreshCounts();
  }

  private refreshCounts(): void {
    Promise.all([this.storage.countSigns(), this.storage.countNotes()]).then(([signs, notes]) =>
      this.counts.set({ signs, notes }),
    );
  }

  // --- Export

  private async buildFile(): Promise<File> {
    const backup = await this.storage.exportBackup(this.includeVideos());
    const date = new Date().toISOString().slice(0, 10);
    return new File([JSON.stringify(backup, null, 2)], `lsf-notes-${date}.json`, { type: 'application/json' });
  }

  protected async download(): Promise<void> {
    await this.run(async () => {
      const file = await this.buildFile();
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }

  /** Mobile : feuille de partage du système (Fichiers, Drive, mail…). */
  protected async share(): Promise<void> {
    await this.run(async () => {
      const file = await this.buildFile();
      if (!navigator.canShare({ files: [file] })) throw new Error('Partage de fichier non pris en charge.');
      try {
        await navigator.share({ files: [file], title: 'Sauvegarde LSF Notes' });
      } catch (e) {
        if ((e as DOMException).name !== 'AbortError') throw e; // partage annulé : pas une erreur
      }
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.exportError.set(null);
    try {
      await action();
    } catch (e) {
      this.exportError.set(`Échec de l'export : ${(e as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }

  // --- Import

  protected async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    this.pending.set(null);
    this.importErrors.set([]);
    this.report.set(null);
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      this.importErrors.set(['Fichier trop volumineux (100 Mo maximum).']);
      return;
    }
    try {
      const [text, catalog] = await Promise.all([file.text(), this.catalog.load()]);
      const existingCustomIds = new Set(this.catalog.customHandshapes().map((h) => h.id));
      const result = parseBackup(text, catalog, existingCustomIds);
      if (result.ok) this.pending.set({ fileName: file.name, backup: result.backup });
      else this.importErrors.set(result.errors);
    } catch (e) {
      this.importErrors.set([`Lecture impossible : ${(e as Error).message}`]);
    }
  }

  protected async confirmImport(): Promise<void> {
    const pending = this.pending();
    const counts = this.counts();
    if (!pending) return;
    if (
      this.mode() === 'replace' &&
      !confirm(
        `Tout remplacer ? Vos ${counts?.signs ?? 0} signes et ${counts?.notes ?? 0} notes actuels seront définitivement effacés.`,
      )
    ) {
      return;
    }
    this.busy.set(true);
    try {
      this.report.set(await this.storage.importBackup(pending.backup, this.mode()));
      this.cancelImport();
      this.refreshCounts();
    } catch (e) {
      this.importErrors.set([`Échec de l'import (aucune donnée modifiée) : ${(e as Error).message}`]);
    } finally {
      this.busy.set(false);
    }
  }

  protected cancelImport(): void {
    this.pending.set(null);
    this.importErrors.set([]);
    this.fileInput().nativeElement.value = '';
  }
}
