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
import { PercentPipe } from '@angular/common';
import { SmartCanvasComponent } from '../../shared/smart-canvas/smart-canvas.component';
import { BodyMapComponent } from '../../shared/body-map/body-map.component';
import { HandEditorComponent } from '../../shared/hand-editor/hand-editor.component';
import { HandsPreviewComponent, isSymmetric } from '../../shared/hands-preview/hands-preview.component';
import { describeHand, handshapeNames } from '../../shared/sign-detail/describe-hand';
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
import { HandSpec, SignGlyph, Stroke, UserSign } from '../../core/models/sign.model';
import { GLYPH_VIEWBOX } from '../../core/utils/freehand';
import { glyphPaths } from '../../core/utils/glyph-paths';
import { SimplifiedKind } from '../../core/utils/stroke-simplify';
import { GlyphPathsPipe } from '../../shared/glyph-paths.pipe';
import { ColorPaletteComponent } from '../../shared/color-palette.component';
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

/** Préférence d'affichage seulement (jamais de signes ni de notes ici). */
const SIMPLIFY_PREF_KEY = 'lsf.atelier.simplify';
const readSimplifyPref = () => {
  try {
    return localStorage.getItem(SIMPLIFY_PREF_KEY) !== '0'; // activée par défaut
  } catch {
    return true;
  }
};
const SIMPLIFIED_LABELS: Record<Exclude<SimplifiedKind, 'free'>, string> = {
  line: 'en ligne droite',
  polyline: 'en segments droits',
  circle: 'en cercle',
  ellipse: 'en ellipse',
  arc: 'en arc de cercle',
};

const emptyHand = (): HandSpec => ({ handshapeIds: [], movementIds: [], directionIds: [] });
const isComplete = (hand: HandSpec) => hand.handshapeIds.length > 0 && hand.movementIds.length > 0;

interface Similar {
  word: string;
  score: number;
}

@Component({
  selector: 'app-sign-builder',
  imports: [
    SmartCanvasComponent,
    BodyMapComponent,
    HandEditorComponent,
    HandsPreviewComponent,
    GlyphPathsPipe,
    ColorPaletteComponent, PercentPipe, RouterLink],
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

  protected readonly steps = STEPS;
  protected readonly viewBox = `0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`;
  protected readonly maxWordLength = MAX_WORD_LENGTH;
  protected readonly maxNoteLength = MAX_NOTE_LENGTH;
  protected readonly maxTags = MAX_TAGS;

  // --- Brouillon
  protected readonly strokes = signal<Stroke[]>([]);
  protected readonly glyph = signal<SignGlyph | null>(null);
  /** Simplification automatique des traits (préférence d'affichage, mémorisée). */
  protected readonly simplify = signal(readSimplifyPref());
  /** Dernier trait simplifié, pour proposer de garder le tracé d'origine. */
  protected readonly lastSimplified = signal<{ index: number; label: string } | null>(null);
  /** Couleur du pinceau pour les prochains traits (null = noir). La reconnaissance l'ignore. */
  protected readonly brushColor = signal<string | null>(null);
  /** Couleur de chaque trait du glyphe courant (dessin en cours, ou dessin conservé en modification). */
  protected readonly strokeColors = signal<(string | null)[]>([]);
  /** Aperçu coloré, un chemin par trait (cliquable pour appliquer la couleur du pinceau). */
  protected readonly previewPaths = computed(() => {
    const glyph = this.glyph();
    if (!glyph) return [];
    return glyphPaths(glyph).map((p, i) => ({ d: p.d, color: this.strokeColors()[i] ?? null }));
  });
  protected readonly word = signal('');
  protected readonly dominant = signal<HandSpec>(emptyHand());
  /** null : signe à une main. */
  protected readonly nonDominant = signal<HandSpec | null>(null);
  /** La main dominée vient d'être recopiée depuis la dominante (symétrie). */
  protected readonly mirroredFromDominant = signal(false);
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
  /** Récapitulatif : « Index → Main plate · Arc + Contact, vers le haut, répété · Paume vers soi ». */
  protected readonly dominantSummary = computed(
    () => `${handshapeNames(this.catalog, this.dominant())} · ${describeHand(this.catalog, this.dominant())}`,
  );
  protected readonly nonDominantSummary = computed(() => {
    const hand = this.nonDominant();
    return hand ? `${handshapeNames(this.catalog, hand)} · ${describeHand(this.catalog, hand)}` : 'Aucune';
  });
  protected readonly confusable = computed(() => this.similar().filter((s) => s.score >= CONFUSION_SCORE));

  /** Une étape est valide quand on peut la quitter vers l'avant. */
  private readonly valid = computed<Record<StepId, boolean>>(() => ({
    glyph: true,
    word: this.word().trim().length > 0,
    dominant: isComplete(this.dominant()),
    nonDominant: this.nonDominant() === null || isComplete(this.nonDominant()!),
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
        if (!this.dominant().handshapeIds.length) return 'Choisissez une configuration.';
        return this.dominant().movementIds.length ? null : 'Choisissez aussi au moins un mouvement.';
      case 'nonDominant': {
        const hand = this.nonDominant();
        if (!hand || isComplete(hand)) return null;
        if (!hand.handshapeIds.length) return 'Choisissez la configuration de la main dominée, ou « Signe à une main ».';
        return 'Choisissez aussi au moins un mouvement pour la main dominée.';
      }
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
        return this.nonDominant() === null;
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
    const route = inject(ActivatedRoute).snapshot;
    const editId = route.paramMap.get('id');
    // ?etape=dessin : ajout rapide d'un dessin depuis le Dictionnaire.
    if (editId) this.loadForEdit(editId, route.queryParamMap.get('etape') === 'dessin');
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
    if (STEPS[index].id === 'nonDominant') this.prefillSymmetricHand();
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

  /** Étape « Main dominée » : signe à une main, ou deux mains. */
  protected setTwoHands(two: boolean): void {
    if (two === (this.nonDominant() !== null)) return;
    this.mirroredFromDominant.set(false);
    this.nonDominant.set(two ? emptyHand() : null);
    if (two) this.prefillSymmetricHand();
  }

  /**
   * Symétrie : la main dominée reprend par défaut toute la main dominante (configurations,
   * mouvements, directions, orientation — vocabulaire relatif, donc juste en miroir).
   * Ne remplace jamais une main dominée déjà renseignée.
   */
  private prefillSymmetricHand(): void {
    const current = this.nonDominant();
    if (!isSymmetric(this.dominant()) || (current && current.handshapeIds.length)) return;
    this.nonDominant.set(structuredClone(this.dominant()));
    this.mirroredFromDominant.set(true);
  }

  // --- Étape dessin

  protected undo(): void {
    this.lastSimplified.set(null);
    this.canvas()?.undo();
  }

  protected clearDrawing(): void {
    this.canvas()?.clear();
  }

  protected onStrokeSimplified(event: { index: number; kind: Exclude<SimplifiedKind, 'free'> }): void {
    this.lastSimplified.set({ index: event.index, label: SIMPLIFIED_LABELS[event.kind] });
  }

  protected keepOriginal(): void {
    const last = this.lastSimplified();
    if (!last) return;
    this.lastSimplified.set(null);
    this.canvas()?.restoreRaw(last.index);
  }

  protected toggleSimplify(on: boolean): void {
    this.simplify.set(on);
    try {
      localStorage.setItem(SIMPLIFY_PREF_KEY, on ? '1' : '0');
    } catch {
      // stockage indisponible : préférence non conservée
    }
  }

  protected onStrokeStart(): void {
    this.lastSimplified.set(null);
    clearTimeout(this.debounce);
    this.similarityRequest++; // invalide une vérification en cours
  }

  private async loadForEdit(id: string, drawingFirst = false): Promise<void> {
    const sign = await this.storage.getSign(id);
    if (!sign) {
      this.error.set("Ce signe n'existe plus.");
      return;
    }
    const a = sign.anatomy;
    this.editing.set(sign);
    this.keptGlyph.set(sign.glyph ?? null);
    this.glyph.set(sign.glyph ?? null);
    this.strokeColors.set(sign.glyph ? glyphPaths(sign.glyph).map((p) => p.color) : []);
    this.word.set(sign.word);
    this.dominant.set(structuredClone(a.dominant));
    this.nonDominant.set(a.nonDominant ? structuredClone(a.nonDominant) : null);
    this.zoneIds.set([...a.locationZoneIds]);
    this.note.set(sign.note ?? '');
    this.tagsInput.set(sign.tags.join(', '));
    // Récapitulatif (chaque étape a un lien « Modifier »), ou directement le dessin.
    this.stepIndex.set(drawingFirst ? 0 : STEPS.length - 1);
  }

  /** Modification : supprime le dessin (le signe devient une simple entrée de lexique). */
  protected removeGlyph(): void {
    this.keptGlyph.set(null);
    this.glyph.set(null);
    this.strokeColors.set([]);
    this.similar.set([]);
    this.canvas()?.clear();
  }

  protected onStrokesChange(strokes: Stroke[]): void {
    this.strokes.set(strokes);
    // Canevas vide en modification : on retombe sur le dessin existant.
    this.glyph.set(strokes.length ? (this.canvas()?.extractGesture() ?? null) : this.keptGlyph());
    const kept = this.keptGlyph();
    this.strokeColors.set(
      strokes.length ? (this.canvas()?.getStrokeColors() ?? []) : kept ? glyphPaths(kept).map((p) => p.color) : [],
    );
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
    if (this.saving() || !this.reachable()[STEPS.length - 1]) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      const editing = this.editing();
      const nonDominant = this.nonDominant();
      const draft = {
        word: this.word(),
        tags: this.tags(),
        anatomy: {
          dominant: this.dominant(),
          ...(nonDominant ? { nonDominant } : {}),
          locationZoneIds: this.zoneIds(),
        },
        glyph: this.glyphWithColor(),
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

  /** Glyphe à enregistrer, avec la couleur de chaque trait. */
  private glyphWithColor(): SignGlyph | undefined {
    const glyph = this.glyph();
    if (!glyph) return undefined;
    const { color: _legacy, strokes, ...rest } = glyph;
    const colors = this.strokeColors();
    if (!strokes?.length) {
      // Ancien glyphe sans détail par trait : une seule couleur pour l'ensemble.
      return colors[0] ? { ...rest, color: colors[0] } : rest;
    }
    return { ...rest, strokes: strokes.map((s, i) => (colors[i] ? { d: s.d, color: colors[i]! } : { d: s.d })) };
  }

  /** Aperçu : touche d'un trait → couleur du pinceau. */
  protected recolor(index: number): void {
    const color = this.brushColor();
    this.strokeColors.update((colors) => {
      const next = [...colors];
      next[index] = color;
      return next;
    });
    if (this.strokes().length) this.canvas()?.setStrokeColor(index, color);
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
    this.brushColor.set(null);
    this.strokeColors.set([]);
    this.similar.set([]);
    this.word.set('');
    this.dominant.set(emptyHand());
    this.nonDominant.set(null);
    this.mirroredFromDominant.set(false);
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
