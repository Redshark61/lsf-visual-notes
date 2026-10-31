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
import { VideoRecorderComponent } from '../../shared/video-recorder/video-recorder.component';
import { BlobVideoComponent } from '../../shared/blob-video.component';
import { HandsPreviewComponent, isSymmetric } from '../../shared/hands-preview/hands-preview.component';
import { summarizeHand } from '../../shared/sign-detail/describe-hand';
import { emptyHand, isEmptyHand } from '../../core/utils/hand-spec';
import { WizardStepperComponent } from './wizard-stepper.component';
import { SheetComponent } from '../../shared/sheet/sheet.component';
import { TagInputComponent } from '../../shared/tag-input/tag-input.component';
import { CatalogService } from '../../core/services/catalog.service';
import { RecognitionService } from '../../core/services/recognition.service';
import {
  MAX_NOTE_LENGTH,
  MAX_WORD_LENGTH,
  SignDraft,
  StorageService,
  VideoDraft,
} from '../../core/services/storage.service';
import { TagCount, normalizeTags } from '../../core/utils/tags';
import { HandSpec, MAX_COMPONENTS, SignGlyph, Stroke, UserSign } from '../../core/models/sign.model';
import { createsCycle } from '../../core/utils/composition';
import { WordEntryComponent } from '../../shared/word-entry/word-entry.component';
import { GLYPH_VIEWBOX } from '../../core/utils/freehand';
import { glyphPaths } from '../../core/utils/glyph-paths';
import { SimplifiedKind } from '../../core/utils/stroke-simplify';
import { CONFUSION_SCORE, SUGGESTION_SCORE } from '../../core/utils/recognition-policy';
import { GlyphPathsPipe } from '../../shared/glyph-paths.pipe';
import { ColorPaletteComponent } from '../../shared/color-palette.component';
import { extractGesture } from '../../core/utils/gesture';
import { boundingBox } from '../../core/utils/gesture-geometry';
import { SignDraftTransferService } from '../../core/services/sign-draft-transfer.service';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

/** Délai après le dernier trait avant de vérifier la ressemblance avec le dictionnaire. */
const SIMILARITY_DEBOUNCE_MS = 450;

type StepId = 'word' | 'components' | 'dominant' | 'nonDominant' | 'zones' | 'note';

interface Step {
  id: StepId;
  title: string;
  optional: boolean;
}

const STEPS: Step[] = [
  { id: 'word', title: 'Nom', optional: false },
  { id: 'components', title: 'Composition', optional: true },
  { id: 'dominant', title: 'Main dominante', optional: true },
  { id: 'nonDominant', title: 'Main dominée', optional: true },
  { id: 'zones', title: 'Emplacement', optional: true },
  { id: 'note', title: 'Note et tags', optional: true },
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
/** Index des étapes (liens « Modifier » du récapitulatif). */
const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.id, i])) as Record<StepId, number>;

const SIMPLIFIED_LABELS: Record<Exclude<SimplifiedKind, 'free'>, string> = {
  line: 'en ligne droite',
  polyline: 'en segments droits',
  circle: 'en cercle',
  ellipse: 'en ellipse',
  arc: 'en arc de cercle',
};

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
    VideoRecorderComponent,
    WizardStepperComponent,
    SheetComponent,
    TagInputComponent,
    WordEntryComponent,
    BlobVideoComponent,
    HandsPreviewComponent,
    GlyphPathsPipe,
    ColorPaletteComponent,
    PercentPipe,
    RouterLink,
  ],
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
  private readonly drawingSheet = viewChild<SheetComponent>('drawingSheet');
  private readonly videoSheet = viewChild<SheetComponent>('videoSheet');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('stepHeading');

  protected readonly steps = STEPS;
  protected readonly viewBox = `0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`;
  protected readonly maxWordLength = MAX_WORD_LENGTH;
  protected readonly maxNoteLength = MAX_NOTE_LENGTH;
  protected readonly stepIndexOf = STEP_INDEX;

  // --- Brouillon
  protected readonly strokes = signal<Stroke[]>([]);
  protected readonly glyph = signal<SignGlyph | null>(null);
  /** Simplification automatique des traits (préférence d'affichage, mémorisée). */
  protected readonly simplify = signal(readSimplifyPref());
  /** Dernier trait simplifié, pour proposer de garder le tracé d'origine. */
  protected readonly lastSimplified = signal<{ index: number; label: string } | null>(null);
  /**
   * Vidéo : undefined = inchangée (modification), null = supprimée, sinon nouvelle prise.
   * `existingVideo` : vidéo déjà enregistrée du signe modifié.
   */
  protected readonly videoDraft = signal<VideoDraft | null | undefined>(undefined);
  protected readonly existingVideo = signal<Blob | null>(null);
  /** Vidéo à afficher : nouvelle prise, sinon vidéo existante si elle n'est pas supprimée. */
  protected readonly currentVideo = computed<Blob | null>(() => {
    const draft = this.videoDraft();
    if (draft) return draft.blob;
    return draft === null ? null : this.existingVideo();
  });
  protected readonly hasVideo = computed(() => !!this.currentVideo());
  protected readonly recordingAgain = signal(false);
  /** Fenêtres de dessin et de vidéo (boutons flottants) : contenu créé à l'ouverture seulement. */
  protected readonly drawingOpen = signal(false);
  protected readonly videoOpen = signal(false);
  /** Prise filmée, pas encore validée (bouton vert « Utiliser cette vidéo » de la fenêtre). */
  protected readonly pendingVideo = signal<VideoDraft | null>(null);
  private readonly recorder = viewChild(VideoRecorderComponent);
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
  /** Signe composé : ids des signes composants, dans l'ordre. */
  protected readonly components = signal<string[]>([]);
  /** Dictionnaire (chargé à la première visite de l'étape Composition). */
  private readonly allSigns = signal<UserSign[]>([]);
  private signsLoaded = false;
  protected readonly signsById = computed(() => new Map(this.allSigns().map((s) => [s.id, s])));
  /** Signes que l'on peut ajouter : pas le signe modifié, ni un signe qui le contient (boucle). */
  protected readonly composable = computed(() => {
    const editing = this.editing()?.id;
    const byId = this.signsById();
    return this.allSigns().filter((s) => !editing || !createsCycle(editing, s.id, byId));
  });
  protected readonly componentSigns = computed(() =>
    this.components().map((id) => ({ id, sign: this.signsById().get(id) })),
  );
  protected readonly maxComponents = MAX_COMPONENTS;
  protected readonly note = signal('');
  protected readonly tagList = signal<string[]>([]);
  /** Tags déjà utilisés dans le dictionnaire (liste à toucher, suggestions). */
  protected readonly existingTags = signal<TagCount[]>([]);

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

  protected readonly tags = computed(() => normalizeTags(this.tagList()));
  /** Récapitulatif : « Index → Main plate · Arc + Contact, vers le haut, répété · Paume vers soi ». */
  protected readonly dominantSummary = computed(() => summarizeHand(this.catalog, this.dominant()));
  protected readonly nonDominantSummary = computed(() => {
    const hand = this.nonDominant();
    return hand && !isEmptyHand(hand) ? summarizeHand(this.catalog, hand) : 'Aucune';
  });
  protected readonly confusable = computed(() => this.similar().filter((s) => s.score >= CONFUSION_SCORE));

  /** Une étape est valide quand on peut la quitter vers l'avant : seul le nom est obligatoire. */
  private readonly valid = computed<Record<StepId, boolean>>(() => ({
    word: this.word().trim().length > 0,
    components: true,
    dominant: true,
    nonDominant: true,
    zones: true,
    note: true,
  }));
  protected readonly canAdvance = computed(() => this.valid()[this.step().id]);
  /** Enregistrement possible à n'importe quelle étape dès que le nom est saisi. */
  protected readonly canSave = computed(() => this.word().trim().length > 0);
  /** Ce qui empêche de passer à l'étape suivante, affiché à côté du bouton grisé. */
  protected readonly blocker = computed(() =>
    this.step().id === 'word' && !this.word().trim() ? 'Indiquez le nom du signe (seul champ obligatoire).' : null,
  );
  /** Une étape est accessible depuis le fil d'Ariane si toutes les précédentes sont valides. */
  protected readonly reachable = computed(() => {
    const v = this.valid();
    return STEPS.map((_, i) => STEPS.slice(0, i).every((s) => v[s.id]));
  });
  /** L'étape optionnelle est-elle vide (bouton « Passer » plutôt que « Suivant ») ? */
  protected readonly stepIsEmpty = computed(() => {
    switch (this.step().id) {
      case 'components':
        return this.components().length === 0;
      case 'dominant':
        return isEmptyHand(this.dominant());
      case 'nonDominant':
        return isEmptyHand(this.nonDominant());
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
    this.storage.listTags().then((tags) => this.existingTags.set(tags));
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
      }
    }
    const route = inject(ActivatedRoute).snapshot;
    const editId = route.paramMap.get('id');
    // ?etape=dessin : ajout rapide d'un dessin depuis le Dictionnaire.
    if (editId) this.loadForEdit(editId, route.queryParamMap.get('etape') === 'dessin');
    // ?mot=… : création proposée par le Dictionnaire quand une recherche ne trouve rien.
    const proposedWord = route.queryParamMap.get('mot')?.trim();
    if (!editId && proposedWord && !this.word()) this.word.set(proposedWord.slice(0, MAX_WORD_LENGTH));
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
    if (STEPS[index].id === 'components') this.loadAllSigns();
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

  // --- Composition (signe composé)

  private loadAllSigns(): void {
    if (this.signsLoaded) return;
    this.signsLoaded = true;
    this.storage
      .listSigns()
      .then((signs) => this.allSigns.set(signs))
      .catch(() => (this.signsLoaded = false));
  }

  protected addComponent(signId: string): void {
    if (this.components().length < MAX_COMPONENTS) this.components.update((c) => [...c, signId]);
  }

  protected removeComponent(index: number): void {
    this.components.update((c) => c.filter((_, i) => i !== index));
  }

  protected moveComponent(index: number, delta: -1 | 1): void {
    const target = index + delta;
    this.components.update((c) => {
      if (target < 0 || target >= c.length) return c;
      const next = [...c];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  /** « attention + prendre soin » (les signes supprimés sont signalés). */
  protected readonly compositionText = computed(() =>
    this.componentSigns()
      .map((c) => c.sign?.word ?? 'signe supprimé')
      .join(' + '),
  );

  // --- Fenêtres : dessin et vidéo (boutons flottants)

  protected openDrawing(): void {
    this.drawingOpen.set(true);
    this.drawingSheet()?.show(); // ouverte avant la création du contenu : le canevas se mesure à la bonne taille
  }

  protected onDrawingClosed(): void {
    this.drawingOpen.set(false);
    this.lastSimplified.set(null);
  }

  protected openVideo(): void {
    this.recordingAgain.set(false);
    this.videoOpen.set(true);
    this.videoSheet()?.show();
  }

  /** Fermer la fenêtre libère la caméra ; une prise non validée est abandonnée. */
  protected onVideoClosed(): void {
    this.videoOpen.set(false);
    this.pendingVideo.set(null);
    this.recordingAgain.set(false);
  }

  // --- Dessin

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
    this.dominant.set(a.dominant ? structuredClone(a.dominant) : emptyHand());
    this.nonDominant.set(a.nonDominant ? structuredClone(a.nonDominant) : null);
    this.zoneIds.set([...a.locationZoneIds]);
    this.components.set([...(sign.components ?? [])]);
    if (sign.components?.length) this.loadAllSigns();
    if (sign.video) this.storage.getVideo(sign.id).then((v) => this.existingVideo.set(v?.blob ?? null));
    this.note.set(sign.note ?? '');
    this.tagList.set([...sign.tags]);
    // Récapitulatif (chaque étape a un lien « Modifier ») ; ou directement la fenêtre de dessin.
    this.stepIndex.set(STEPS.length - 1);
    if (drawingFirst) afterNextRender(() => this.openDrawing(), { injector: this.injector });
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
          .filter((m) => m.score >= SUGGESTION_SCORE && m.signId !== this.editing()?.id)
          .map(async (m) => ({ word: (await this.storage.getSign(m.signId))?.word ?? '?', score: m.score })),
      );
      if (request === this.similarityRequest) this.similar.set(found);
    } catch {
      if (request === this.similarityRequest) this.similar.set([]);
    }
  }

  // --- Enregistrement

  protected async save(): Promise<void> {
    if (this.saving() || !this.canSave()) return;

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
        components: this.components(),
      } satisfies SignDraft;
      const withVideo = { ...draft, video: this.videoDraft() };
      const sign = editing
        ? await this.storage.updateSign(editing.id, withVideo)
        : await this.storage.createSign(withVideo);
      this.saved.set(sign);
    } catch (e) {
      this.error.set(`Échec de l'enregistrement : ${(e as Error).message}`);
    } finally {
      this.saving.set(false);
    }
  }

  protected onVideoPending(video: VideoDraft | null): void {
    this.pendingVideo.set(video);
  }

  /** Valide la prise et ferme la fenêtre. */
  protected useVideo(): void {
    const pending = this.pendingVideo();
    if (!pending) return;
    this.videoDraft.set(pending);
    this.recordingAgain.set(false);
    this.videoSheet()?.hide();
  }

  protected retakeVideo(): void {
    this.recorder()?.retake();
  }

  protected removeVideo(): void {
    this.videoDraft.set(null);
    this.recordingAgain.set(false);
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
    this.components.set([]);
    this.videoDraft.set(undefined);
    this.pendingVideo.set(null);
    this.existingVideo.set(null);
    this.recordingAgain.set(false);
    this.note.set('');
    this.tagList.set([]);
    this.saved.set(null);
    this.fromNoteId.set(null);
    this.editing.set(null);
    this.keptGlyph.set(null);
    this.drawingOpen.set(false);
    this.videoOpen.set(false);
    this.storage.listTags().then((tags) => this.existingTags.set(tags));
    this.goTo(0);
  }
}
