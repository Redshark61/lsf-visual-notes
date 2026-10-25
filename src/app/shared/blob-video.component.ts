import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';

/** Lecture d'une vidéo stockée (Blob) : boucle muette, en ligne (iOS), adresse blob: libérée. */
@Component({
  selector: 'app-blob-video',
  template: `
    @if (url(); as src) {
      <video
        [src]="src"
        [class.mirrored]="mirrored()"
        autoplay
        loop
        muted
        playsinline
        [controls]="controls()"
        [attr.aria-label]="label()"
      ></video>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    video {
      display: block;
      width: 100%;
      max-height: 50vh;
      border-radius: 8px;
      background: #000;
    }
    /* Miroir (comme l'aperçu de la caméra) : on se voit comme dans un reflet, utile pour imiter le signe. */
    video.mirrored {
      transform: scaleX(-1);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlobVideoComponent {
  readonly blob = input.required<Blob>();
  readonly controls = input(true);
  readonly label = input('Vidéo du signe');
  /** Affichage en miroir (le fichier lui-même n'est pas modifié). */
  readonly mirrored = input(true);
  protected readonly url = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const url = URL.createObjectURL(this.blob());
      this.url.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });
    inject(DestroyRef).onDestroy(() => this.url.set(null));
  }
}
