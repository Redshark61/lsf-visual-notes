import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet, PercentPipe } from '@angular/common';
import { SmartCanvasComponent } from '../../shared/smart-canvas/smart-canvas.component';
import { SignDialogComponent } from '../../shared/sign-dialog/sign-dialog.component';
import { WordEntryComponent } from '../../shared/word-entry/word-entry.component';
import { NoteTitleComponent } from './note-title.component';
import { BoardComponent } from './board/board.component';
import { GlyphPathsPipe } from '../../shared/glyph-paths.pipe';
import { ChainVideoComponent, VideoClip } from '../../shared/chain-video.component';
import { RecognitionService } from '../../core/services/recognition.service';
import { MAX_NOTE_TITLE_LENGTH, StorageService } from '../../core/services/storage.service';
import { SignDraftTransferService } from '../../core/services/sign-draft-transfer.service';
import { BoardObject } from '../../core/models/board.model';
import { NoteElement, NotePage, Stroke, UserSign } from '../../core/models/sign.model';
import { addObject, signAt } from '../../core/utils/board-scene';
import { GLYPH_VIEWBOX } from '../../core/utils/freehand';
import { leafSigns, videoSigns } from '../../core/utils/composition';

/** Délai après le lever du stylet, pour laisser le temps de tracer un glyphe en plusieurs traits. */
const RECOGNITION_DEBOUNCE_MS = 450;
/** Au-dessus : remplacement automatique du tracé par le signe. */
const AUTO_REPLACE_SCORE = 0.8;
/** Au-dessus : le signe est proposé en suggestion. */
const SUGGESTION_SCORE = 0.5;
/** Dimensions approximatives de la bulle, pour la garder dans l'écran. */
const BUBBLE_HEIGHT = 110;
const BUBBLE_HALF_WIDTH = 110;
/** Bulle avec vidéo : plus grande (la vidéo se lance au clic sur le signe). */
const VIDEO_BUBBLE_HEIGHT = 390;
const VIDEO_BUBBLE_HALF_WIDTH = 150;

export type NoteDisplay = 'signs' | 'words' | 'both';
export type InputMode = 'draw' | 'type';

/** Préférences d'affichage seulement (jamais de signes ni de notes ici). */
const PREFS_KEY = 'lsf.notebook.prefs';

function readPrefs(): { display: NoteDisplay; inputMode: InputMode } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    return {
      display: raw['display'] === 'words' || raw['display'] === 'both' ? raw['display'] : 'signs',
      inputMode: raw['inputMode'] === 'type' ? 'type' : 'draw',
    };
  } catch {
    return { display: 'signs', inputMode: 'draw' };
  }
}

function allElements(note: NotePage | null | undefined): NoteElement[] {
  return note?.elements ?? [];
}

interface Candidate {
  sign: UserSign;
  score: number;
}

type Proposal =
  /** Signe inséré automatiquement ; pastilles pour corriger, ou annuler et rétablir le dessin. */
  | { kind: 'corrections'; elementId: string; candidates: Candidate[]; strokes: Stroke[] }
  /** Hésitation : le tracé reste, on propose les 3 signes les plus proches. */
  | { kind: 'suggestions'; candidates: Candidate[]; strokes: Stroke[] }
  /** Rien de suffisamment proche. */
  | { kind: 'none'; strokes: Stroke[] };

@Component({
  selector: 'app-notebook',
  imports: [
    SmartCanvasComponent,
    SignDialogComponent,
    WordEntryComponent,
    NoteTitleComponent,
    BoardComponent,
    ChainVideoComponent,
    GlyphPathsPipe,
    NgTemplateOutlet,
    PercentPipe,
    RouterLink,
  ],
  host: {
    // À l'appui et non au clic : avec la capture du pointeur du plateau, le clic ne vise pas le signe touché.
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'closeBubble()',
    '(window:resize)': 'closeBubble()',
    '(document:keydown)': 'onKeydown($event)',
  },
  templateUrl: './notebook.component.html',
  styleUrl: './notebook.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotebookComponent {
  private readonly storage = inject(StorageService);
  private readonly recognition = inject(RecognitionService);
  private readonly transfer = inject(SignDraftTransferService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly injector = inject(Injector);

  /** Absent en mode écrit. */
  private readonly canvas = viewChild(SmartCanvasComponent);
  private readonly wordEntry = viewChild(WordEntryComponent);
  private readonly board = viewChild(BoardComponent);

  protected readonly viewBox = `0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`;
  protected readonly maxTitleLength = MAX_NOTE_TITLE_LENGTH;

  protected readonly notes = signal<NotePage[]>([]);
  /** Note qui vient d'être créée : son titre s'ouvre en mode renommage. */
  protected readonly justCreatedId = signal<string | null>(null);
  protected readonly note = signal<NotePage | null>(null);
  /** Signes connus de la page (éléments de la note + candidats proposés). */
  protected readonly signs = signal<ReadonlyMap<string, UserSign>>(new Map());
  protected readonly glyphSigns = computed(() => [...this.signs().values()].filter((s) => s.glyph));
  protected readonly proposal = signal<Proposal | null>(null);
  protected readonly recognizing = signal(false);
  /** Nombre de traits sur le canevas (boutons « Annuler le trait » / « Effacer »). */
  protected readonly drawnStrokes = signal(0);
  protected readonly selectedId = signal<string | null>(null);
  /** Signe touché sur le plateau de dessin libre (sa bulle s'ouvre comme pour un signe de la note). */
  protected readonly externalSelection = signal<{ signId: string; objectId: string } | null>(null);
  protected readonly isCanvas = computed(() => this.note()?.layout === 'canvas');
  /** Plateau vide (référence stable : évite de réinitialiser l'entrée du plateau à chaque rendu). */
  protected readonly noObjects: BoardObject[] = [];
  protected readonly hasElements = computed(() => allElements(this.note()).length > 0);
  /**
   * Vidéos du signe sélectionné, lancées dans la bulle dès le clic : sa vidéo propre, sinon (signe
   * composé) celles de ses composants enchaînées. null = en chargement ; [] = rien à lire.
   */
  protected readonly bubbleClips = signal<VideoClip[] | null>(null);
  /** « attention + prendre soin » pour le signe composé sélectionné. */
  protected readonly selectedComposition = computed(() => {
    const ids = this.selectedSign()?.components ?? [];
    return ids.map((id) => this.signs().get(id)?.word ?? 'signe supprimé').join(' + ');
  });
  /** Signe de l'élément dont la bulle d'informations est ouverte. */
  protected readonly selectedSign = computed(() => {
    const external = this.externalSelection();
    if (external) return this.signs().get(external.signId);
    const element = allElements(this.note()).find((e) => e.id === this.selectedId());
    return element ? this.signs().get(element.signId) : undefined;
  });
  /** Bulle (nom + actions) du signe sélectionné, en coordonnées écran. */
  protected readonly bubble = signal<{ x: number; y: number; above: boolean } | null>(null);
  /** Signe affiché dans la fenêtre de définition. */
  protected readonly detail = signal<UserSign | null>(null);
  protected readonly lastInsertedId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  // --- Bascules dessin / écrit
  protected readonly display = signal<NoteDisplay>(readPrefs().display);
  protected readonly displayOptions: { value: NoteDisplay; label: string }[] = [
    { value: 'signs', label: 'Signes' },
    { value: 'words', label: 'Mots' },
    { value: 'both', label: 'Les deux' },
  ];
  protected readonly inputMode = signal<InputMode>(readPrefs().inputMode);
  protected readonly layoutOptions: { value: 'linear' | 'canvas'; label: string }[] = [
    { value: 'linear', label: 'Texte' },
    { value: 'canvas', label: 'Dessin libre' },
  ];
  /** Tout le dictionnaire, chargé pour la saisie écrite. */
  protected readonly allSigns = signal<UserSign[]>([]);

  private debounce: ReturnType<typeof setTimeout> | undefined;
  private request = 0;
  private saveChain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => this.open(params.get('note')).catch((e) => this.error.set(String(e))));
    inject(DestroyRef).onDestroy(() => clearTimeout(this.debounce));
    effect(() => {
      const sign = this.selectedSign();
      this.bubbleClips.set(null);
      if (!sign || !this.hasVideoContent(sign)) return;
      const clips = sign.video
        ? this.storage.getVideo(sign.id).then((v) => (v ? [{ word: sign.word, blob: v.blob }] : []))
        : this.storage.compositionVideos(sign);
      clips
        .then((found) => {
          if (this.selectedSign()?.id === sign.id) this.bubbleClips.set(found);
        })
        .catch(() => {
          if (this.selectedSign()?.id === sign.id) this.bubbleClips.set([]);
        });
    });
    effect(() => {
      const prefs = { display: this.display(), inputMode: this.inputMode() };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
        // stockage indisponible (navigation privée) : préférences non conservées
      }
    });
    if (this.inputMode() === 'type') this.loadAllSigns();
  }

  // --- Bascules

  protected setInputMode(mode: InputMode): void {
    if (mode === this.inputMode()) return;
    this.resetRecognition();
    this.drawnStrokes.set(0);
    this.inputMode.set(mode);
    if (mode === 'type') {
      this.loadAllSigns();
      afterNextRender(() => this.wordEntry()?.focus(), { injector: this.injector });
    }
  }

  private loadAllSigns(): void {
    this.storage
      .listSigns()
      .then((signs) => {
        this.allSigns.set(signs);
        this.signs.update((m) => new Map([...m, ...signs.map((s) => [s.id, s] as const)]));
      })
      .catch((e) => this.error.set(`Impossible de lire le dictionnaire : ${e}`));
  }

  protected createFromWord(word: string): void {
    const note = this.note();
    if (!note || !word) return;
    this.transfer.offerDraft({ noteId: note.id, word });
    this.router.navigate(['/atelier']);
  }

  // --- Notes

  private async open(requestedId: string | null): Promise<void> {
    this.resetRecognition();
    let notes = await this.storage.listNotes();
    let note = (requestedId && notes.find((n) => n.id === requestedId)) || notes[0];
    if (!note) {
      note = await this.storage.createNote();
      notes = [note];
    }
    if (note.id !== requestedId) {
      // URL canonique : la note ouverte est toujours dans ?note=
      this.router.navigate([], { queryParams: { note: note.id }, replaceUrl: true });
    }
    this.notes.set(notes);
    this.note.set(note);
    this.closeBubble();
    await this.loadSigns(allElements(note).map((e) => e.signId));

    // Retour de l'Atelier après « Créer un nouveau signe à partir de ce dessin ».
    const created = this.transfer.takeCreated(note.id);
    if (created) {
      await this.loadSigns([created]);
      this.insert(created);
    }
  }

  protected switchNote(id: string): void {
    this.router.navigate([], { queryParams: { note: id } });
  }

  protected async newNote(): Promise<void> {
    const note = await this.storage.createNote();
    this.justCreatedId.set(note.id);
    this.switchNote(note.id);
  }

  protected async deleteNote(): Promise<void> {
    const note = this.note();
    if (!note || !confirm(`Supprimer la note « ${note.title} » ?`)) return;
    await this.saveChain;
    await this.storage.deleteNote(note.id);
    this.note.set(null);
    this.router.navigate([], { queryParams: { note: null } });
  }

  protected rename(title: string): void {
    this.update((n) => ({ ...n, title }));
  }

  /** Applique une modification à la note courante et l'enregistre (écritures sérialisées). */
  private update(change: (note: NotePage) => NotePage): void {
    const current = this.note();
    if (!current) return;
    const next = change(current);
    this.note.set(next);
    this.saveChain = this.saveChain
      .then(() => this.storage.saveNote(next))
      .then((saved) => {
        if (this.note()?.id === saved.id) this.note.update((n) => (n ? { ...n, title: saved.title } : n));
        this.notes.update((list) => [saved, ...list.filter((n) => n.id !== saved.id)]);
      })
      .catch((e) => this.error.set(`Échec de l'enregistrement : ${e}`));
  }

  /** Charge les signes manquants, et leurs composants (un signe composé affiche ceux-ci). */
  private async loadSigns(ids: string[]): Promise<void> {
    const found = await this.storage.loadSignsWithComponents(ids, this.signs());
    if (found.size) this.signs.update((m) => new Map([...m, ...found]));
  }

  /** Le signe a une vidéo, ou (composé) au moins un composant en a une. */
  protected hasVideoContent(sign: UserSign | undefined): boolean {
    return !!sign && (!!sign.video || (!!sign.components?.length && videoSigns(sign, this.signs()).length > 0));
  }

  /** Dessins à afficher pour un signe composé sans dessin propre : ceux de ses composants. */
  protected componentGlyphs(sign: UserSign | undefined): UserSign[] {
    return sign?.components?.length ? leafSigns(sign, this.signs()).filter((s) => !!s.glyph) : [];
  }

  // --- Éléments

  protected insert(signId: string): string {
    if (this.isCanvas()) {
      // Dessin libre : le signe est posé au centre de la vue (ou à une place par défaut).
      const object = signAt(signId, this.board()?.viewCenter() ?? { x: 200, y: 200 });
      this.update((n) => ({ ...n, canvas: { objects: addObject(n.canvas?.objects ?? [], object) } }));
      return object.id;
    }
    const element: NoteElement = { id: crypto.randomUUID(), signId, orderIndex: 0 };
    this.update((n) => ({ ...n, elements: [...n.elements, element] }));
    this.lastInsertedId.set(element.id);
    return element.id;
  }

  /** Applique `change` à la liste d'éléments de la note. */
  private updateElements(change: (elements: NoteElement[]) => NoteElement[]): void {
    this.update((n) => ({ ...n, elements: change(n.elements) }));
  }

  protected onBoardChange(objects: BoardObject[]): void {
    this.update((n) => ({ ...n, layout: 'canvas', canvas: { objects } }));
  }

  /** Texte ↔ dessin libre : deux contenus distincts, rien n'est converti ni perdu en passant de l'un à l'autre. */
  protected setLayout(layout: 'linear' | 'canvas'): void {
    const note = this.note();
    if (!note || layout === (note.layout ?? 'linear')) return;
    this.closeBubble();
    this.resetRecognition();
    this.drawnStrokes.set(0);
    this.update((n) => ({ ...n, layout }));
  }

  protected select(id: string, event: MouseEvent): void {
    if (this.selectedId() === id) {
      this.closeBubble();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const sign = this.signs().get(allElements(this.note()).find((e) => e.id === id)?.signId ?? '');
    this.externalSelection.set(null);
    this.selectedId.set(id);
    this.placeBubble(rect, sign);
  }

  /** Touche d'un signe posé sur le plateau : même bulle (nom, vidéo, définition) que dans la note. */
  protected async onBoardSignTap(tap: { signId: string; objectId: string; rect: DOMRect }): Promise<void> {
    if (this.externalSelection()?.objectId === tap.objectId) {
      this.closeBubble();
      return;
    }
    await this.loadSigns([tap.signId]);
    this.selectedId.set(null);
    this.externalSelection.set({ signId: tap.signId, objectId: tap.objectId });
    this.placeBubble(tap.rect, this.signs().get(tap.signId));
  }

  private placeBubble(rect: DOMRect, sign: UserSign | undefined): void {
    const withVideo = this.hasVideoContent(sign);
    const height = withVideo ? VIDEO_BUBBLE_HEIGHT : BUBBLE_HEIGHT;
    const spaceBelow = window.innerHeight - rect.bottom;
    // Sous le signe, sauf s'il n'y a pas la place et qu'il y en a davantage au-dessus.
    const above = spaceBelow < height && rect.top > spaceBelow;
    const margin = (withVideo ? VIDEO_BUBBLE_HALF_WIDTH : BUBBLE_HALF_WIDTH) + 8;
    this.bubble.set({
      x: Math.min(Math.max(rect.left + rect.width / 2, margin), window.innerWidth - margin),
      y: above ? rect.top - 6 : rect.bottom + 6,
      above,
    });
  }

  protected closeBubble(): void {
    this.selectedId.set(null);
    this.externalSelection.set(null);
    this.bubble.set(null);
  }

  protected onDocumentPointerDown(event: Event): void {
    const target = event.target as Element | null;
    const open = this.selectedId() || this.externalSelection();
    if (open && !target?.closest('.element, .bubble, dialog, [data-sign]')) this.closeBubble();
  }

  protected openDetail(sign: UserSign): void {
    this.closeBubble();
    this.detail.set(sign);
  }

  /** Supprime l'élément sélectionné, à défaut le dernier. */
  protected removeElement(): void {
    const external = this.externalSelection();
    if (external) {
      this.board()?.deleteObject(external.objectId);
      this.closeBubble();
      return;
    }
    const elements = this.note()?.elements ?? [];
    const id = this.selectedId() ?? elements.at(-1)?.id;
    if (!id) return;
    this.updateElements((list) => list.filter((e) => e.id !== id));
    this.closeBubble();
    const p = this.proposal();
    if (p?.kind === 'corrections' && p.elementId === id) this.proposal.set(null);
  }

  // --- Reconnaissance

  protected onStrokeStart(): void {
    clearTimeout(this.debounce);
    this.request++; // un résultat en cours ne s'applique plus
    this.recognizing.set(false);
    this.proposal.set(null);
  }

  /** Annule le dernier trait du dessin en cours (la reconnaissance repart sur les traits restants). */
  protected undoStroke(): void {
    this.canvas()?.undo();
  }

  /** Ctrl+Z / ⌘+Z : annuler le dernier trait (sauf pendant une saisie de texte). */
  protected onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) return;
    if (this.inputMode() !== 'draw' || !this.drawnStrokes()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    this.undoStroke();
  }

  protected onStrokesChange(strokes: Stroke[]): void {
    this.drawnStrokes.set(strokes.length);
    clearTimeout(this.debounce);
    const request = ++this.request;
    this.recognizing.set(false);
    if (strokes.length === 0) {
      this.proposal.set(null);
      return;
    }
    this.debounce = setTimeout(() => this.recognize(strokes, request), RECOGNITION_DEBOUNCE_MS);
  }

  private async recognize(strokes: Stroke[], request: number): Promise<void> {
    this.recognizing.set(true);
    try {
      const { matches } = await this.recognition.recognize(strokes);
      await this.loadSigns(matches.map((m) => m.signId));
      if (request !== this.request) return;
      const candidates = matches
        .map((m) => ({ sign: this.signs().get(m.signId), score: m.score }))
        .filter((c): c is Candidate => !!c.sign);
      const best = candidates[0];

      if (best && best.score > AUTO_REPLACE_SCORE) {
        const elementId = this.insert(best.sign.id);
        this.canvas()?.clear();
        this.proposal.set({ kind: 'corrections', elementId, candidates, strokes });
      } else if (best && best.score >= SUGGESTION_SCORE) {
        this.proposal.set({ kind: 'suggestions', candidates, strokes });
      } else {
        this.proposal.set({ kind: 'none', strokes });
      }
    } catch (e) {
      if (request === this.request) this.error.set(`Reconnaissance impossible : ${e}`);
    } finally {
      if (request === this.request) this.recognizing.set(false);
    }
  }

  /** Pastille de correction : remplace le signe inséré automatiquement. */
  protected correct(elementId: string, signId: string): void {
    this.updateElements((list) => list.map((e) => (e.id === elementId ? { ...e, signId } : e)));
    this.proposal.set(null);
  }

  /** Annule l'insertion automatique et rétablit le dessin, avec les suggestions. */
  protected undoAutoInsert(): void {
    const p = this.proposal();
    if (p?.kind !== 'corrections') return;
    this.updateElements((list) => list.filter((e) => e.id !== p.elementId));
    this.canvas()?.setStrokes(p.strokes);
    this.drawnStrokes.set(p.strokes.length); // setStrokes n'émet pas strokesChange
    this.proposal.set({ kind: 'suggestions', candidates: p.candidates, strokes: p.strokes });
  }

  protected chooseSuggestion(signId: string): void {
    this.insert(signId);
    this.canvas()?.clear();
    this.proposal.set(null);
  }

  protected discardDrawing(): void {
    this.canvas()?.clear();
    this.proposal.set(null);
  }

  protected createFromDrawing(strokes: Stroke[]): void {
    const note = this.note();
    if (!note) return;
    this.transfer.offerDraft({ noteId: note.id, strokes });
    this.router.navigate(['/atelier']);
  }

  /** Candidats autres que le signe inséré (pastilles de correction). */
  protected alternatives(p: { candidates: Candidate[]; elementId: string }): Candidate[] {
    const inserted = allElements(this.note()).find((e) => e.id === p.elementId)?.signId;
    return p.candidates.filter((c) => c.sign.id !== inserted);
  }

  private resetRecognition(): void {
    clearTimeout(this.debounce);
    this.request++;
    this.recognizing.set(false);
    this.proposal.set(null);
    this.error.set(null);
  }
}
