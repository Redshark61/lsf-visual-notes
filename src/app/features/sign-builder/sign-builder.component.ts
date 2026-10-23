import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet, PercentPipe } from '@angular/common';
import { SmartCanvasComponent } from '../../shared/smart-canvas/smart-canvas.component';
import { CatalogPickerComponent } from '../../shared/catalog-picker/catalog-picker.component';
import { BodyMapComponent } from '../../shared/body-map/body-map.component';
import { HandshapePhotoComponent } from '../../shared/handshape-photo/handshape-photo.component';
import { HandParamsComponent } from '../../shared/hand-params/hand-params.component';
import { describeHand } from '../../shared/sign-detail/describe-hand';
import { CatalogService } from '../../core/services/catalog.service';
import { RecognitionService } from '../../core/services/recognition.service';
import {
  MAX_NOTE_LENGTH,
  MAX_TAGS,
  MAX_WORD_LENGTH,
  SignDraft,
  StorageService,
  normalizeTags,
} from '../../core/services/storage.service';
import { SignGlyph, Stroke, UserSign } from '../../core/models/sign.model';
import { GLYPH_VIEWBOX } from '../../core/utils/freehand';
import { extractGesture } from '../../core/utils/gesture';
import { boundingBox } from '../../core/utils/gesture-geometry';
import { SignDraftTransferService } from '../../core/services/sign-draft-transfer.service';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

/** Délai après le dernier trait avant de vérifier la ressemblance avec le dictionnaire. */
const SIMILARITY_DEBOUNCE_MS = 450;
/** Au-delà, le Carnet remplacerait automatiquement le tracé par ce signe : risque de confusion. */
const CONFUSION_SCORE = 0.8;

type StepId = 'glyph' | 'word' | 'dominant' | 'nonDominant' | 'zones' | 'note';

interface Step {
  id: StepId;
  title: string;
  optional: boolean;
}

const STEPS: Step[] = [
  { id: 'glyph', title: 'Dessin', optional: true },
  { id: 'word', title: 'Nom', optional: false },
  { id: 'dominant', title: 'Main dominante', optional: false },
  { id: 'nonDominant', title: 'Main dominée', optional: true },
  { id: 'zones', title: 'Emplacement', optional: true },
  { id: 'note', title: 'Note', optional: true },
];

interface Similar {
  word: string;
  score: number;
}

@Component({
  selector: 'app-sign-builder',
  imports: [
    SmartCanvasComponent,
    CatalogPickerComponent,
    BodyMapComponent,
    HandshapePhotoComponent,
    HandParamsComponent, NgTemplateOutlet, PercentPipe, RouterLink],
  templateUrl: './sign-builder.component.html',
  styleUrl: './sign-builder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignBuilderComponent {
  protected readonly catalog = inject(CatalogService);
  private readonly storage = inject(StorageService);
  private readonly recognition = inject(RecognitionService);
  private readonly injector = inject(Injector);
  private readonly transfer = inject(SignDraftTransferService);
  private readonly router = inject(Router);

  private readonly canvas = viewChild(SmartCanvasComponent);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('stepHeading');
  private readonly movementPicker = viewChild('movementPicker', { read: ElementRef<HTMLElement> });

  protected readonly steps = STEPS;
  protected readonly viewBox = `0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`;
  protected readonly maxWordLength = MAX_WORD_LENGTH;
  protected readonly maxNoteLength = MAX_NOTE_LENGTH;
  protected readonly maxTags = MAX_TAGS;

  // --- Brouillon
  protected readonly strokes = signal<Stroke[]>([]);
  protected readonly glyph = signal<SignGlyph | null>(null);
  protected readonly word = signal('');
  protected readonly dominantHandId = signal<string | null>(null);
  protected readonly dominantMovementId = signal<string | null>(null);
  protected readonly dominantDirectionId = signal<string | null>(null);
  protected readonly dominantRepeated = signal(false);
  protected readonly dominantOrientationId = signal<string | null>(null);
  protected readonly nonDominantHandId = signal<string | null>(null);
  protected readonly nonDominantMovementId = signal<string | null>(null);
  protected readonly nonDominantDirectionId = signal<string | null>(null);
  protected readonly nonDominantRepeated = signal(false);
  protected readonly nonDominantOrientationId = signal<string | null>(null);
  protected readonly zoneIds = signal<string[]>([]);
  protected readonly note = signal('');
  protected readonly tagsInput = signal('');

  // --- Navigation et état
  protected readonly stepIndex = signal(0);
  protected readonly step = computed(() => STEPS[this.stepIndex()]);
  protected readonly isLast = computed(() => this.stepIndex() === STEPS.length - 1);
  protected readonly saved = signal<UserSign | null>(null);
  /** Note d'origine quand on vient du Carnet (« Créer un nouveau signe à partir de ce dessin »). */
  protected readonly fromNoteId = signal<string | null>(null);
  /** Signe en cours de modification (route /atelier/:id). */
  protected readonly editing = signal<UserSign | null>(null);
  /** Dessin existant conservé tant que l'utilisateur ne redessine pas (modification). */
  protected readonly keptGlyph = signal<SignGlyph | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly catalogError = signal<string | null>(null);
  protected readonly similar = signal<Similar[]>([]);

  protected readonly tags = computed(() => normalizeTags(this.tagsInput().split(',')));
  /** Récapitulatif : « Arc, vers le haut, répété · Paume vers soi ». */
  protected readonly dominantSummary = computed(() =>
    describeHand(this.catalog, {
      movementId: this.dominantMovementId(),
      directionId: this.dominantDirectionId(),
      repeated: this.dominantRepeated(),
      orientationId: this.dominantOrientationId(),
    }),
  );
  protected readonly nonDominantSummary = computed(() =>
    describeHand(this.catalog, {
      movementId: this.nonDominantMovementId(),
      directionId: this.nonDominantDirectionId(),
      repeated: this.nonDominantRepeated(),
      orientationId: this.nonDominantOrientationId(),
    }),
  );
  protected readonly confusable = computed(() => this.similar().filter((s) => s.score >= CONFUSION_SCORE));
  protected readonly handshapeSources = computed(() =>
    (this.catalog.catalog()?.sources ?? []).filter((s) => s.scope === 'handshapes'),
  );

  /** Une étape est valide quand on peut la quitter vers l'avant. */
  private readonly valid = computed<Record<StepId, boolean>>(() => ({
    glyph: true,
    word: this.word().trim().length > 0,
    dominant: !!this.dominantHandId() && !!this.dominantMovementId(),
    nonDominant: !this.nonDominantHandId() || !!this.nonDominantMovementId(),
    zones: true,
    note: true,
  }));
  protected readonly canAdvance = computed(() => this.valid()[this.step().id]);
  /** Ce qui empêche de passer à l'étape suivante, affiché à côté du bouton grisé. */
  protected readonly blocker = computed(() => {
    switch (this.step().id) {
      case 'word':
        return this.word().trim() ? null : 'Indiquez le nom du signe.';
      case 'dominant':
        if (!this.dominantHandId()) return 'Choisissez une configuration.';
        return this.dominantMovementId() ? null : 'Choisissez aussi le mouvement de la main dominante.';
      case 'nonDominant':
        return this.valid().nonDominant ? null : 'Choisissez le mouvement de la main dominée.';
      default:
        return null;
    }
  });
  /** Une étape est accessible depuis le fil d'Ariane si toutes les précédentes sont valides. */
  protected readonly reachable = computed(() => {
    const v = this.valid();
    return STEPS.map((_, i) => STEPS.slice(0, i).every((s) => v[s.id]));
  });
  /** L'étape optionnelle est-elle vide (bouton « Passer » plutôt que « Suivant ») ? */
  protected readonly stepIsEmpty = computed(() => {
    switch (this.step().id) {
      case 'glyph':
        return !this.glyph();
      case 'nonDominant':
        return !this.nonDominantHandId();
      case 'zones':
        return this.zoneIds().length === 0;
      default:
        return false;
    }
  });

  private debounce: ReturnType<typeof setTimeout> | undefined;
  private similarityRequest = 0;

  constructor() {
    this.loadCatalog();
    const draft = this.transfer.takeDraft();
    if (draft) {
      this.fromNoteId.set(draft.noteId);
      if (draft.word) this.word.set(draft.word);
      if (draft.strokes?.length) {
        // Le dessin vient d'un canevas d'une autre taille : on le ramène dans le coin supérieur gauche.
        const { minX, minY } = boundingBox(draft.strokes.flat());
        const strokes = draft.strokes.map((s) => s.map((p) => ({ ...p, x: p.x - minX + 24, y: p.y - minY + 24 })));
        this.strokes.set(strokes);
        this.glyph.set(extractGesture(strokes));
        this.stepIndex.set(1); // le dessin est fait : on passe directement au nom
      }
    }
    const editId = inject(ActivatedRoute).snapshot.paramMap.get('id');
    if (editId) this.loadForEdit(editId);
    inject(DestroyRef).onDestroy(() => clearTimeout(this.debounce));
  }

  protected loadCatalog(): void {
    this.catalogError.set(null);
    this.catalog.load().catch(() => this.catalogError.set('Impossible de charger le catalogue.'));
  }

  protected catalogName(id: string | null | undefined): string {
    return this.catalog.find(id ?? undefined)?.name ?? '—';
  }

  // --- Navigation

  protected goTo(index: number): void {
    if (index < 0 || index >= STEPS.length || !this.reachable()[index]) return;
    this.stepIndex.set(index);
    this.error.set(null);
    // Accessibilité : on annonce la nouvelle étape en y plaçant le focus.
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }

  protected next(): void {
    if (!this.canAdvance()) return;
    if (this.isLast()) this.save();
    else this.goTo(this.stepIndex() + 1);
  }

  protected previous(): void {
    this.goTo(this.stepIndex() - 1);
  }

  protected setDominantHand(id: string | null): void {
    this.dominantHandId.set(id);
    if (id && !this.dominantMovementId()) this.revealMovement();
  }

  protected setNonDominantHand(id: string | null): void {
    this.nonDominantHandId.set(id);
    if (!id) {
      this.nonDominantMovementId.set(null);
      this.nonDominantDirectionId.set(null);
      this.nonDominantRepeated.set(false);
      this.nonDominantOrientationId.set(null);
    } else if (!this.nonDominantMovementId()) this.revealMovement();
  }

  /** Le choix du mouvement est sous la grille des configurations, souvent hors écran. */
  private revealMovement(): void {
    afterNextRender(
      () => this.movementPicker()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      { injector: this.injector },
    );
  }

  // --- Étape dessin

  protected undo(): void {
    this.canvas()?.undo();
  }

  protected clearDrawing(): void {
    this.canvas()?.clear();
  }

  protected onStrokeStart(): void {
    clearTimeout(this.debounce);
    this.similarityRequest++; // invalide une vérification en cours
  }

  private async loadForEdit(id: string): Promise<void> {
    const sign = await this.storage.getSign(id);
    if (!sign) {
      this.error.set("Ce signe n'existe plus.");
      return;
    }
    const a = sign.anatomy;
    this.editing.set(sign);
    this.keptGlyph.set(sign.glyph ?? null);
    this.glyph.set(sign.glyph ?? null);
    this.word.set(sign.word);
    this.dominantHandId.set(a.dominantHandId);
    this.dominantMovementId.set(a.dominantMovementId);
    this.dominantDirectionId.set(a.dominantDirectionId ?? null);
    this.dominantRepeated.set(a.dominantRepeated ?? false);
    this.dominantOrientationId.set(a.dominantOrientationId ?? null);
    this.nonDominantHandId.set(a.nonDominantHandId ?? null);
    this.nonDominantMovementId.set(a.nonDominantMovementId ?? null);
    this.nonDominantDirectionId.set(a.nonDominantDirectionId ?? null);
    this.nonDominantRepeated.set(a.nonDominantRepeated ?? false);
    this.nonDominantOrientationId.set(a.nonDominantOrientationId ?? null);
    this.zoneIds.set([...a.locationZoneIds]);
    this.note.set(sign.note ?? '');
    this.tagsInput.set(sign.tags.join(', '));
    this.stepIndex.set(STEPS.length - 1); // récapitulatif : chaque étape a un lien « Modifier »
  }

  /** Modification : supprime le dessin (le signe devient une simple entrée de lexique). */
  protected removeGlyph(): void {
    this.keptGlyph.set(null);
    this.glyph.set(null);
    this.similar.set([]);
    this.canvas()?.clear();
  }

  protected onStrokesChange(strokes: Stroke[]): void {
    this.strokes.set(strokes);
    // Canevas vide en modification : on retombe sur le dessin existant.
    this.glyph.set(strokes.length ? (this.canvas()?.extractGesture() ?? null) : this.keptGlyph());
    clearTimeout(this.debounce);
    const request = ++this.similarityRequest;
    if (strokes.length === 0) {
      this.similar.set([]);
      return;
    }
    this.debounce = setTimeout(() => this.checkSimilarity(strokes, request), SIMILARITY_DEBOUNCE_MS);
  }

  private async checkSimilarity(strokes: Stroke[], request: number): Promise<void> {
    try {
      const { matches } = await this.recognition.recognize(strokes);
      const found = await Promise.all(
        matches
          .filter((m) => m.score >= 0.5 && m.signId !== this.editing()?.id)
          .map(async (m) => ({ word: (await this.storage.getSign(m.signId))?.word ?? '?', score: m.score })),
      );
      if (request === this.similarityRequest) this.similar.set(found);
    } catch {
      if (request === this.similarityRequest) this.similar.set([]);
    }
  }

  // --- Enregistrement

  protected async save(): Promise<void> {
    const dominantHandId = this.dominantHandId();
    const dominantMovementId = this.dominantMovementId();
    if (this.saving() || !this.reachable()[STEPS.length - 1] || !dominantHandId || !dominantMovementId) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      const nonDominantHandId = this.nonDominantHandId();
      const editing = this.editing();
      const draft = {
        word: this.word(),
        tags: this.tags(),
        anatomy: {
          dominantHandId,
          dominantMovementId,
          dominantDirectionId: this.dominantDirectionId() ?? undefined,
          dominantRepeated: this.dominantRepeated(),
          dominantOrientationId: this.dominantOrientationId() ?? undefined,
          ...(nonDominantHandId
            ? {
                nonDominantHandId,
                nonDominantMovementId: this.nonDominantMovementId() ?? undefined,
                nonDominantDirectionId: this.nonDominantDirectionId() ?? undefined,
                nonDominantRepeated: this.nonDominantRepeated(),
                nonDominantOrientationId: this.nonDominantOrientationId() ?? undefined,
              }
            : {}),
          locationZoneIds: this.zoneIds(),
        },
        glyph: this.glyph() ?? undefined,
        note: this.note(),
      } satisfies SignDraft;
      const sign = editing ? await this.storage.updateSign(editing.id, draft) : await this.storage.createSign(draft);
      this.saved.set(sign);
    } catch (e) {
      this.error.set(`Échec de l'enregistrement : ${(e as Error).message}`);
    } finally {
      this.saving.set(false);
    }
  }

  /** Retour au Carnet ; le signe créé (s'il existe) y sera inséré. */
  protected backToNotebook(): void {
    const noteId = this.fromNoteId();
    if (!noteId) return;
    const sign = this.saved();
    if (sign) this.transfer.reportCreated(sign.id, noteId);
    this.router.navigate(['/carnet'], { queryParams: { note: noteId } });
  }

  protected startOver(): void {
    clearTimeout(this.debounce);
    this.similarityRequest++;
    this.strokes.set([]);
    this.glyph.set(null);
    this.similar.set([]);
    this.word.set('');
    this.dominantHandId.set(null);
    this.dominantMovementId.set(null);
    this.dominantDirectionId.set(null);
    this.dominantRepeated.set(false);
    this.dominantOrientationId.set(null);
    this.setNonDominantHand(null);
    this.zoneIds.set([]);
    this.note.set('');
    this.tagsInput.set('');
    this.saved.set(null);
    this.fromNoteId.set(null);
    this.editing.set(null);
    this.keptGlyph.set(null);
    this.goTo(0);
  }
}
