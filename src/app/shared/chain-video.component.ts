import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { BlobVideoComponent } from './blob-video.component';

export interface VideoClip {
  word: string;
  blob: Blob;
}

/**
 * Lit des clips les uns après les autres, en boucle (ex. signe composé : « attention » puis
 * « prendre soin »). Un clip seul se rejoue en boucle. La vitesse choisie est conservée d'un clip à l'autre.
 */
@Component({
  selector: 'app-chain-video',
  imports: [BlobVideoComponent],
  template: `
    @if (current(); as clip) {
      <app-blob-video
        [blob]="clip.blob"
        [loop]="clips().length === 1"
        [label]="'Vidéo : ' + clip.word"
        [(speed)]="speed"
        (ended)="advance()"
      />
      @if (clips().length > 1) {
        <ol class="steps" aria-label="Enchaînement des signes">
          @for (c of clips(); track $index; let i = $index) {
            <li>
              <button type="button" [attr.aria-current]="i === index() ? 'step' : null" (click)="index.set(i)">
                {{ c.word }}
              </button>
            </li>
          }
        </ol>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .steps {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.35rem;
      margin: 0.4rem 0 0;
      padding: 0;
      list-style: none;
    }
    li + li::before {
      content: '→';
      margin-right: 0.35rem;
      opacity: 0.55;
    }
    li {
      display: inline-flex;
      align-items: center;
    }
    button {
      padding: 0.15rem 0.6rem;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      background: #fff;
      color: inherit;
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
    }
    button[aria-current='step'] {
      border-color: var(--color-primary);
      background: var(--color-primary);
      color: #fff;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainVideoComponent {
  readonly clips = input.required<readonly VideoClip[]>();
  protected readonly index = signal(0);
  protected readonly speed = signal(1);
  protected readonly current = computed(() => this.clips()[this.index()] ?? null);

  constructor() {
    // Nouvelle série de clips : on repart du premier.
    effect(() => {
      this.clips();
      this.index.set(0);
    });
  }

  /** Fin d'un clip : le suivant, puis retour au premier (boucle sur l'ensemble). */
  protected advance(): void {
    this.index.update((i) => (i + 1) % this.clips().length);
  }
}
