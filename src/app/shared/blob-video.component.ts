import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';

const SPEEDS = [1, 0.5, 0.25] as const;

/**
 * Lecture d'une vidéo stockée (Blob) : boucle muette, en ligne (iOS), adresse blob: libérée.
 *
 * Contrôles personnalisés (lecture/pause, barre de progression, ralenti) : seule l'IMAGE est mise
 * en miroir ; les contrôles natifs, eux, se retourneraient avec la vidéo (boutons et barre inversés).
 */
@Component({
  selector: 'app-blob-video',
  template: `
    @if (url(); as src) {
      <video
        #video
        [src]="src"
        [class.mirrored]="mirrored()"
        autoplay
        loop
        muted
        playsinline
        [attr.aria-label]="label()"
        (click)="toggle(video)"
        (play)="playing.set(true)"
        (pause)="playing.set(false)"
        (loadedmetadata)="duration.set(video.duration)"
        (timeupdate)="time.set(video.currentTime)"
      ></video>
      @if (controls()) {
        <div class="bar">
          <button type="button" (click)="toggle(video)" [attr.aria-label]="playing() ? 'Pause' : 'Lecture'">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              @if (playing()) {
                <path d="M8 5v14M16 5v14" />
              } @else {
                <path d="M7 4l13 8-13 8z" />
              }
            </svg>
          </button>
          <input
            type="range"
            min="0"
            max="1000"
            step="1"
            aria-label="Position dans la vidéo"
            [value]="progress()"
            (input)="seek(video, +$any($event.target).value)"
          />
          <button type="button" class="speed" (click)="nextSpeed(video)" aria-label="Vitesse de lecture">
            ×{{ speed() }}
          </button>
        </div>
      }
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
      border-radius: 8px 8px 0 0;
      background: #000;
      cursor: pointer;
    }
    /* Miroir (comme l'aperçu de la caméra) : on se voit comme dans un reflet, utile pour imiter le signe. */
    video.mirrored {
      transform: scaleX(-1);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.5rem;
      border-radius: 0 0 8px 8px;
      background: #1d1d1f;
      color: #fff;
    }
    button {
      display: inline-grid;
      place-items: center;
      min-width: 2.25rem;
      height: 2.25rem;
      padding: 0 0.4rem;
      border: none;
      border-radius: 6px;
      background: rgb(255 255 255 / 15%);
      color: inherit;
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
    }
    svg {
      width: 1.2rem;
      height: 1.2rem;
      fill: currentColor;
      stroke: currentColor;
      stroke-width: 2.5;
      stroke-linejoin: round;
    }
    input {
      flex: 1;
      min-width: 0;
      height: 2.25rem;
      accent-color: #fff;
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
  protected readonly playing = signal(true);
  protected readonly duration = signal(0);
  protected readonly time = signal(0);
  protected readonly speed = signal<number>(1);

  protected progress(): number {
    const d = this.duration();
    return d > 0 && Number.isFinite(d) ? Math.round((this.time() / d) * 1000) : 0;
  }

  constructor() {
    effect((onCleanup) => {
      const url = URL.createObjectURL(this.blob());
      this.url.set(url);
      this.time.set(0);
      this.speed.set(1); // le nouvel élément <video> repart à la vitesse normale
      this.playing.set(true);
      onCleanup(() => URL.revokeObjectURL(url));
    });
    inject(DestroyRef).onDestroy(() => this.url.set(null));
  }

  protected toggle(video: HTMLVideoElement): void {
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }

  protected seek(video: HTMLVideoElement, value: number): void {
    if (video.duration > 0 && Number.isFinite(video.duration)) video.currentTime = (value / 1000) * video.duration;
  }

  /** 1× → 0,5× → 0,25× → 1× : ralenti pour bien voir le mouvement. */
  protected nextSpeed(video: HTMLVideoElement): void {
    const next = SPEEDS[(SPEEDS.indexOf(this.speed() as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    video.playbackRate = next;
    this.speed.set(next);
  }
}
