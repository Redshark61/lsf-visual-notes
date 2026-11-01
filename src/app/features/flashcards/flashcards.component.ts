import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChainVideoComponent, VideoClip } from '../../shared/chain-video.component';
import { StorageService } from '../../core/services/storage.service';
import { SettingsService } from '../../core/services/settings.service';
import { UserSign } from '../../core/models/sign.model';
import { buildDeck, DeckMode, deckTags, eligibleSigns, Flashcard, shuffle } from '../../core/utils/flashcards';

type Stage = 'setup' | 'play' | 'done';

interface ModeOption {
  value: DeckMode;
  label: string;
}

/**
 * Révision par cartes : une série de N signes (réglage) tirés de tout le dictionnaire ou d'un tag.
 * Carte « vidéo → nom » ou « nom → vidéo » (les vidéos des composants enchaînées pour un signe composé).
 * L'utilisateur juge lui-même sa réponse ; les cartes ratées peuvent être rejouées.
 */
@Component({
  selector: 'app-flashcards',
  imports: [ChainVideoComponent, RouterLink],
  templateUrl: './flashcards.component.html',
  styleUrl: './flashcards.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlashcardsComponent {
  private readonly storage = inject(StorageService);
  protected readonly settings = inject(SettingsService);

  protected readonly modes: ModeOption[] = [
    { value: 'mixed', label: 'Mélangé' },
    { value: 'video-to-word', label: 'Vidéo → nom' },
    { value: 'word-to-video', label: 'Nom → vidéo' },
  ];

  protected readonly signs = signal<UserSign[] | null>(null);
  /** Catégorie choisie : null = tous les signes. */
  protected readonly tag = signal<string | null>(null);
  protected readonly mode = signal<DeckMode>('mixed');

  protected readonly stage = signal<Stage>('setup');
  protected readonly deck = signal<Flashcard[]>([]);
  protected readonly index = signal(0);
  protected readonly revealed = signal(false);
  protected readonly missed = signal<string[]>([]);
  protected readonly clips = signal<VideoClip[] | null>(null);

  private readonly byId = computed(() => new Map((this.signs() ?? []).map((s) => [s.id, s])));
  protected readonly tags = computed(() => deckTags(this.signs() ?? []));
  protected readonly allCount = computed(() => eligibleSigns(this.signs() ?? [], null).length);
  protected readonly withoutVideo = computed(() => (this.signs()?.length ?? 0) - this.allCount());
  protected readonly pool = computed(() => eligibleSigns(this.signs() ?? [], this.tag()));
  protected readonly seriesLength = computed(() => Math.min(this.settings.seriesSize(), this.pool().length));

  protected readonly card = computed(() => this.deck()[this.index()] ?? null);
  protected readonly cardSign = computed(() => {
    const card = this.card();
    return card ? (this.byId().get(card.signId) ?? null) : null;
  });
  protected readonly score = computed(() => this.deck().length - this.missed().length);
  protected readonly missedSigns = computed(() => this.missed().flatMap((id) => this.byId().get(id) ?? []));

  constructor() {
    this.storage.listSigns().then((signs) => this.signs.set(signs));

    // Vidéo(s) de la carte en cours : la sienne, sinon celles de ses composants, enchaînées.
    effect(() => {
      const sign = this.cardSign();
      this.clips.set(null);
      if (!sign) return;
      const load: Promise<VideoClip[]> = sign.video
        ? this.storage.getVideo(sign.id).then((v) => (v ? [{ word: sign.word, blob: v.blob }] : []))
        : this.storage.compositionVideos(sign);
      load
        .then((clips) => {
          if (this.cardSign()?.id === sign.id) this.clips.set(clips);
        })
        .catch(() => this.clips.set([]));
    });
  }

  protected start(): void {
    this.play(buildDeck(this.pool(), this.settings.seriesSize(), this.mode()));
  }

  /** Rejoue les cartes ratées, dans un nouvel ordre et le même sens. */
  protected retryMissed(): void {
    const missed = new Set(this.missed());
    this.play(shuffle(this.deck().filter((c) => missed.has(c.signId))));
  }

  protected answer(known: boolean): void {
    const card = this.card();
    if (!card) return;
    if (!known) this.missed.update((ids) => [...ids, card.signId]);
    if (this.index() + 1 >= this.deck().length) {
      this.stage.set('done');
    } else {
      this.index.update((i) => i + 1);
      this.revealed.set(false);
    }
  }

  protected backToSetup(): void {
    this.stage.set('setup');
    this.deck.set([]);
  }

  private play(deck: Flashcard[]): void {
    this.deck.set(deck);
    this.index.set(0);
    this.missed.set([]);
    this.revealed.set(false);
    this.stage.set(deck.length ? 'play' : 'setup');
  }
}
