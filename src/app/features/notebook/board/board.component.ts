import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { PercentPipe } from '@angular/common';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BoardObject,
  INK_COLOR_DEFAULT,
  PEN_WIDTHS,
  PenWidth,
  SignObject,
  TEXT_SIZES,
  TextObject,
} from '../../../core/models/board.model';
import { Point, Stroke, UserSign } from '../../../core/models/sign.model';
import { PEN_OPTIONS, strokeToSvgPath } from '../../../core/utils/freehand';
import {
  BoardView,
  Size,
  clampView,
  fitView,
  panBy,
  pinchView,
  screenToWorld,
  zoomAt,
} from '../../../core/utils/board-view';
import {
  History,
  addObject,
  addObjects,
  contentBounds,
  emptyHistory,
  inkFromPoints,
  moveObject,
  objectBounds,
  pushHistory,
  redoHistory,
  removeObject,
  replaceObject,
  resizeObject,
  signAt,
  signPlacement,
  undoHistory,
} from '../../../core/utils/board-scene';
import { SignDisplay, SignLayout, signLayout } from '../../../core/utils/board-sign-layout';
import { BoardTool, TAP_MAX_MOVE_PX, decidePointerAction, isTap } from '../../../core/utils/board-input';
import { RecognitionService } from '../../../core/services/recognition.service';
import { SettingsService } from '../../../core/services/settings.service';
import { StorageService } from '../../../core/services/storage.service';
import { GlyphPathsPipe } from '../../../shared/glyph-paths.pipe';
import { WordEntryComponent } from '../../../shared/word-entry/word-entry.component';
import { BoardToolbarComponent } from './board-toolbar.component';

const MIN_POINT_DISTANCE_PX = 4;
const RECOGNITION_DEBOUNCE_MS = 450;
const AUTO_REPLACE_SCORE = 0.8;
const SUGGESTION_SCORE = 0.5;
const WHEEL_ZOOM_SPEED = 0.0025;
const ZOOM_STEP = 1.25;
const SIZE_STEP = 1.25;
const ARROW_STEP = 8;
/** Pas (px) entre deux tests d'objet sous la gomme : un geste rapide ne saute pas un trait fin. */
const ERASE_STEP_PX = 6;

interface Candidate {
  sign: UserSign;
  score: number;
}

interface PreviewStroke {
  points: Point[];
  size: number;
}

type Proposal =
  /** Signe posé automatiquement ; pastilles pour corriger, ou garder le tracé comme dessin. */
  | { kind: 'auto'; objectId: string; candidates: Candidate[]; strokes: PreviewStroke[] }
  /** Hésitation : le tracé reste affiché, on propose les signes les plus proches. */
  | { kind: 'suggestions'; candidates: Candidate[]; strokes: PreviewStroke[] }
  | { kind: 'none'; strokes: PreviewStroke[] };

interface EditingText {
  /** null : nouveau texte. */
  id: string | null;
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  original: string;
}

type Gesture =
  | { kind: 'pinch'; startView: BoardView; startCenter: Point; startDistance: number }
  | { kind: 'pan'; pointerId: number; last: Point }
  | { kind: 'stroke'; pointerId: number; pointerType: string; points: Point[]; size: number; tool: 'draw' | 'sign' }
  | { kind: 'drag'; pointerId: number; objectId: string; element: Element; start: Point; startTime: number; moved: boolean }
  | { kind: 'tap'; pointerId: number; purpose: 'text' | 'place'; objectId: string | null; start: Point; startTime: number }
  /** Gomme : `last` est en coordonnées de la fenêtre (pour tester les objets entre deux positions). */
  | { kind: 'erase'; pointerId: number; last: Point };

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Plateau de dessin libre : plateau borné (zoom, déplacement) où l'on écrit, dessine au pinceau et
 * pose des signes où l'on veut. Les objets (encre, signes, texte) sont vectoriels et rendus en SVG ;
 * le trait en cours est dessiné dans la même scène (mise à jour une fois par image).
 *
 * Le parent possède les données : ce composant reçoit `objects` et émet `objectsChange` (une fois par
 * geste terminé), et garde seulement l'historique annuler/rétablir.
 */
@Component({
  selector: 'app-board',
  imports: [BoardToolbarComponent, WordEntryComponent, GlyphPathsPipe, PercentPipe],
  templateUrl: './board.component.html',
  styleUrl: './board.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardComponent {
  readonly noteId = input.required<string>();
  readonly objects = input.required<readonly BoardObject[]>();
  readonly display = input<SignDisplay>('signs');

  readonly objectsChange = output<BoardObject[]>();
  /** Tap sur un signe (outil Sélection) : le Carnet ouvre sa bulle (nom, vidéo, définition). */
  readonly signTap = output<{ signId: string; objectId: string; rect: DOMRect }>();
  /** Dessin non reconnu : créer un signe à partir de ce tracé. */
  readonly createSign = output<Stroke[]>();
  readonly createSignFromWord = output<string>();

  private readonly storage = inject(StorageService);
  private readonly recognition = inject(RecognitionService);
  private readonly settings = inject(SettingsService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  protected readonly boardWidth = BOARD_WIDTH;
  protected readonly boardHeight = BOARD_HEIGHT;

  // --- État
  protected readonly view = signal<BoardView>({ zoom: 1, panX: 0, panY: 0 });
  private readonly container = signal<Size>({ width: 0, height: 0 });
  protected readonly tool = signal<BoardTool>('draw');
  protected readonly color = signal<string | null>(null);
  protected readonly penWidth = signal<PenWidth>('medium');
  protected readonly textSize = signal<number>(TEXT_SIZES[1]);
  protected readonly selectedId = signal<string | null>(null);
  private readonly history = signal<History<readonly BoardObject[]>>(emptyHistory());
  protected readonly liveStroke = signal<{ points: Point[]; size: number } | null>(null);
  protected readonly preview = signal<PreviewStroke[]>([]);
  protected readonly drag = signal<{ id: string; dx: number; dy: number } | null>(null);
  /** Objets effacés pendant le geste de gomme en cours (supprimés d'un coup au relâchement). */
  protected readonly erasing = signal<ReadonlySet<string>>(new Set());
  protected readonly editing = signal<EditingText | null>(null);
  protected readonly placingSignId = signal<string | null>(null);
  protected readonly searchOpen = signal(false);
  protected readonly dictionary = signal<UserSign[]>([]);
  protected readonly signs = signal<ReadonlyMap<string, UserSign>>(new Map());
  protected readonly proposal = signal<Proposal | null>(null);
  protected readonly recognizing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly panning = signal(false);
  protected readonly selectionBox = signal<{ x: number; y: number; width: number; height: number } | null>(null);

  /** Objets à jour dans ce composant (le parent met à jour son entrée un peu plus tard). */
  private working: readonly BoardObject[] = [];
  private gesture: Gesture | null = null;
  private readonly pointers = new Map<number, Point & { type: string }>();
  private spaceDown = false;
  private pendingView: BoardView | null = null;
  private viewFrame = 0;
  private liveFrame = 0;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private recognitionRequest = 0;
  private initializedFor: string | null = null;

  // --- Dérivés
  protected readonly transform = computed(() => {
    const v = this.view();
    return `translate(${v.panX} ${v.panY}) scale(${v.zoom})`;
  });
  protected readonly zoomPercent = computed(() => Math.round(this.view().zoom * 100));
  protected readonly inkColor = computed(() => this.color() ?? INK_COLOR_DEFAULT);
  /** Épaisseur en unités du plateau : constante à l'écran quel que soit le zoom. */
  private readonly penSize = computed(() => PEN_WIDTHS[this.penWidth()] / this.view().zoom);
  protected readonly liveD = computed(() => {
    const s = this.liveStroke();
    return s ? strokeToSvgPath(s.points, { ...PEN_OPTIONS, size: s.size }) : '';
  });
  protected readonly previewDs = computed(() =>
    this.preview().map((s) => strokeToSvgPath(s.points, { ...PEN_OPTIONS, size: s.size })),
  );
  protected readonly glyphSigns = computed(() => [...this.signs().values()].filter((s) => !!s.glyph));
  protected readonly layouts = computed(() => {
    const byId = this.signs();
    const display = this.display();
    const map = new Map<string, SignLayout>();
    for (const o of this.objects()) {
      if (o.type === 'sign') map.set(o.id, signLayout(byId.get(o.signId), byId, o.scale, display));
    }
    return map;
  });
  protected readonly selectedObject = computed(() => this.objects().find((o) => o.id === this.selectedId()));
  protected readonly canUndo = computed(() => this.history().past.length > 0);
  protected readonly canRedo = computed(() => this.history().future.length > 0);
  protected readonly placingWord = computed(() => this.signs().get(this.placingSignId() ?? '')?.word ?? '');
  protected readonly editorStyle = computed(() => {
    const e = this.editing();
    const v = this.view();
    if (!e) return null;
    const lines = e.text.split('\n');
    const longest = Math.max(...lines.map((l) => l.length), 4);
    return {
      left: e.x * v.zoom + v.panX,
      top: e.y * v.zoom + v.panY,
      fontSize: e.size * v.zoom,
      width: (longest + 2) * e.size * v.zoom * 0.6,
      height: lines.length * e.size * v.zoom * 1.25 + 8,
      color: e.color,
    };
  });

  constructor() {
    // Le parent est la source des objets ; on garde une copie à jour pour enchaîner plusieurs opérations.
    effect(() => {
      this.working = this.objects();
    });

    // Initialisation (et changement de note) : vue ajustée au contenu, historique vide.
    effect(() => {
      const size = this.container();
      const id = this.noteId();
      if (size.width <= 0 || size.height <= 0) return;
      untracked(() => {
        if (this.initializedFor !== id) {
          this.initializedFor = id;
          this.view.set(fitView(size, contentBounds(this.objects())));
          this.history.set(emptyHistory());
          this.selectedId.set(null);
          this.preview.set([]);
          this.proposal.set(null);
          this.editing.set(null);
          this.tool.set(this.objects().length ? 'select' : 'draw');
        } else {
          this.view.update((v) => clampView(v, size));
        }
      });
    });

    // Signes posés sur le plateau (et leurs composants) à charger pour les afficher.
    effect(() => {
      const ids = this.objects().flatMap((o) => (o.type === 'sign' ? [o.signId] : []));
      untracked(() => void this.ensureSigns(ids));
    });

    // Cadre de sélection : mesuré dans le DOM une fois la scène rendue.
    afterRenderEffect(() => {
      const id = this.selectedId();
      this.objects();
      this.layouts();
      this.editing();
      if (!id) {
        if (untracked(this.selectionBox)) this.selectionBox.set(null);
        return;
      }
      const content = this.host.nativeElement.querySelector<SVGGraphicsElement>(
        `[data-obj="${CSS.escape(id)}"] > .content`,
      );
      if (!content) {
        if (untracked(this.selectionBox)) this.selectionBox.set(null);
        return;
      }
      const b = content.getBBox();
      const next = { x: b.x - 6, y: b.y - 6, width: b.width + 12, height: b.height + 12 };
      const prev = untracked(this.selectionBox);
      if (!prev || prev.x !== next.x || prev.y !== next.y || prev.width !== next.width || prev.height !== next.height) {
        this.selectionBox.set(next);
      }
    });

    afterNextRender(() => this.listen());
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.debounce);
      cancelAnimationFrame(this.viewFrame);
      cancelAnimationFrame(this.liveFrame);
    });
  }

  // --- API pour le Carnet

  /** Centre de la zone visible, en coordonnées du plateau (insertion d'un signe créé ailleurs). */
  viewCenter(): Point {
    const c = this.container();
    return screenToWorld(this.currentView(), { x: c.width / 2, y: c.height / 2 });
  }

  deleteObject(id: string): void {
    this.commit(removeObject(this.working, id));
    if (this.selectedId() === id) this.selectedId.set(null);
  }

  // --- Écouteurs natifs (hors cycle de détection : un mouvement = pas de rendu Angular superflu)

  private listen(): void {
    const stage = this.stage().nativeElement;
    const down = (e: PointerEvent) => this.onPointerDown(e);
    const move = (e: PointerEvent) => this.onPointerMove(e);
    const up = (e: PointerEvent) => this.onPointerUp(e, false);
    const cancel = (e: PointerEvent) => this.onPointerUp(e, true);
    const wheel = (e: WheelEvent) => this.onWheel(e);
    const noMenu = (e: Event) => e.preventDefault();
    const keydown = (e: KeyboardEvent) => this.onKeyDown(e);
    const keyup = (e: KeyboardEvent) => this.onKeyUp(e);
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', cancel);
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('contextmenu', noMenu);
    document.addEventListener('keydown', keydown);
    document.addEventListener('keyup', keyup);

    const observer = new ResizeObserver(() => {
      this.container.set({ width: stage.clientWidth, height: stage.clientHeight });
    });
    observer.observe(stage);
    this.container.set({ width: stage.clientWidth, height: stage.clientHeight });

    this.destroyRef.onDestroy(() => {
      observer.disconnect();
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', cancel);
      stage.removeEventListener('wheel', wheel);
      stage.removeEventListener('contextmenu', noMenu);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
    });
  }

  // --- Vue (mise à jour regroupée : une fois par image)

  private currentView(): BoardView {
    return this.pendingView ?? this.view();
  }

  private setView(view: BoardView): void {
    this.pendingView = view;
    if (this.viewFrame) return;
    this.viewFrame = requestAnimationFrame(() => {
      this.viewFrame = 0;
      if (this.pendingView) this.view.set(this.pendingView);
      this.pendingView = null;
    });
  }

  protected zoomBy(factor: number): void {
    const c = this.container();
    this.setView(zoomAt(this.currentView(), factor, { x: c.width / 2, y: c.height / 2 }, c));
  }

  protected fit(): void {
    this.setView(fitView(this.container(), contentBounds(this.working)));
  }

  private localPoint(e: PointerEvent | WheelEvent): Point {
    const rect = this.stage().nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // --- Pointeurs

  private onPointerDown(e: PointerEvent): void {
    const target = e.target as Element;
    if (target.closest('[data-ui]')) return; // barres et panneaux : comportement normal
    this.commitText(); // un texte en cours de saisie se valide quand on touche le plateau
    if (e.pointerType === 'pen') this.settings.markPenDetected();
    // Protection de la paume : pendant un tracé au stylet, un doigt qui se pose est ignoré.
    if (this.gesture?.kind === 'stroke' && this.gesture.pointerType === 'pen' && e.pointerType === 'touch') return;
    e.preventDefault();

    const p = this.localPoint(e);
    this.pointers.set(e.pointerId, { ...p, type: e.pointerType });
    try {
      this.stage().nativeElement.setPointerCapture(e.pointerId);
    } catch {
      // pointeur déjà relâché
    }

    if (this.pointers.size === 2) return this.startPinch();
    if (this.pointers.size > 2) return;

    const action = decidePointerAction({
      pointerType: e.pointerType,
      button: e.button,
      tool: this.tool(),
      touchDrawing: this.settings.touchDrawing(),
      penDetected: this.settings.penDetected(),
      spaceDown: this.spaceDown,
      placing: !!this.placingSignId(),
    });
    const now = performance.now();
    const objectEl = target.closest('[data-obj]');
    const objectId = objectEl?.getAttribute('data-obj') ?? null;

    switch (action) {
      case 'ignore':
        this.pointers.delete(e.pointerId);
        return;
      case 'pan':
        this.panning.set(true);
        this.gesture = { kind: 'pan', pointerId: e.pointerId, last: p };
        return;
      case 'draw': {
        const tool = this.tool() === 'sign' ? 'sign' : 'draw';
        if (tool === 'sign') this.beginSignStroke();
        const world = screenToWorld(this.currentView(), p);
        this.gesture = { kind: 'stroke', pointerId: e.pointerId, pointerType: e.pointerType, points: [world], size: this.penSize(), tool };
        this.liveStroke.set({ points: [world], size: this.penSize() });
        return;
      }
      case 'erase':
        this.gesture = { kind: 'erase', pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY } };
        this.eraseAt(e.clientX, e.clientY);
        return;
      case 'select':
        if (objectEl && objectId) {
          this.selectedId.set(objectId);
          this.gesture = { kind: 'drag', pointerId: e.pointerId, objectId, element: objectEl, start: p, startTime: now, moved: false };
        } else {
          this.selectedId.set(null);
          this.panning.set(true);
          this.gesture = { kind: 'pan', pointerId: e.pointerId, last: p };
        }
        return;
      case 'text':
      case 'place':
        this.gesture = { kind: 'tap', pointerId: e.pointerId, purpose: action, objectId, start: p, startTime: now };
        return;
    }
  }

  private startPinch(): void {
    this.abortGesture();
    const [a, b] = [...this.pointers.values()];
    this.panning.set(true);
    this.gesture = { kind: 'pinch', startView: this.currentView(), startCenter: midpoint(a, b), startDistance: distance(a, b) };
  }

  private abortGesture(): void {
    if (this.gesture?.kind === 'stroke') this.liveStroke.set(null);
    if (this.gesture?.kind === 'drag') this.drag.set(null);
    if (this.gesture?.kind === 'erase') this.erasing.set(new Set());
    this.gesture = null;
  }

  private onPointerMove(e: PointerEvent): void {
    const known = this.pointers.get(e.pointerId);
    if (!known) return;
    const p = this.localPoint(e);
    this.pointers.set(e.pointerId, { ...p, type: e.pointerType });
    const g = this.gesture;
    if (!g) return;

    switch (g.kind) {
      case 'pinch': {
        const [a, b] = [...this.pointers.values()];
        if (!a || !b) return;
        this.setView(pinchView(g.startView, g.startCenter, g.startDistance, midpoint(a, b), distance(a, b), this.container()));
        return;
      }
      case 'pan':
        if (g.pointerId !== e.pointerId) return;
        this.setView(panBy(this.currentView(), p.x - g.last.x, p.y - g.last.y, this.container()));
        g.last = p;
        return;
      case 'stroke': {
        if (g.pointerId !== e.pointerId) return;
        const events = e.getCoalescedEvents?.() ?? [];
        const minDistance = MIN_POINT_DISTANCE_PX / this.currentView().zoom;
        for (const ev of events.length ? events : [e]) {
          const world = screenToWorld(this.currentView(), this.localPoint(ev));
          if (distance(g.points[g.points.length - 1], world) >= minDistance) g.points.push(world);
        }
        this.scheduleLiveStroke(g.points, g.size);
        return;
      }
      case 'drag': {
        if (g.pointerId !== e.pointerId) return;
        if (!g.moved && distance(g.start, p) < TAP_MAX_MOVE_PX) return;
        g.moved = true;
        const zoom = this.currentView().zoom;
        this.drag.set({ id: g.objectId, dx: (p.x - g.start.x) / zoom, dy: (p.y - g.start.y) / zoom });
        return;
      }
      case 'erase': {
        if (g.pointerId !== e.pointerId) return;
        const to = { x: e.clientX, y: e.clientY };
        this.eraseAlong(g.last, to);
        g.last = to;
        return;
      }
      case 'tap':
        // Trop de mouvement : ce n'est plus un tap, c'est un déplacement de la vue.
        if (g.pointerId === e.pointerId && distance(g.start, p) >= TAP_MAX_MOVE_PX) {
          this.panning.set(true);
          this.gesture = { kind: 'pan', pointerId: g.pointerId, last: p };
        }
        return;
    }
  }

  private scheduleLiveStroke(points: Point[], size: number): void {
    if (this.liveFrame) return;
    this.liveFrame = requestAnimationFrame(() => {
      this.liveFrame = 0;
      this.liveStroke.set({ points: [...points], size });
    });
  }

  private onPointerUp(e: PointerEvent, cancelled: boolean): void {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.localPoint(e);
    this.pointers.delete(e.pointerId);
    try {
      this.stage().nativeElement.releasePointerCapture(e.pointerId);
    } catch {
      // déjà relâché
    }
    const g = this.gesture;
    if (!g) return;

    if (g.kind === 'pinch') {
      if (this.pointers.size < 2) {
        this.gesture = null;
        this.panning.set(false);
      }
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    this.gesture = null;
    this.panning.set(false);
    const moved = 'start' in g ? distance(g.start, p) : 0;
    const duration = 'startTime' in g ? performance.now() - g.startTime : 0;

    switch (g.kind) {
      case 'stroke':
        cancelAnimationFrame(this.liveFrame);
        this.liveFrame = 0;
        this.liveStroke.set(null);
        if (!cancelled) this.finishStroke(g.points, g.size, g.tool);
        return;
      case 'drag': {
        const offset = this.drag();
        this.drag.set(null);
        if (cancelled) return;
        if (g.moved && offset) {
          this.commit(moveObject(this.working, g.objectId, offset.dx, offset.dy));
        } else if (isTap(moved, duration)) {
          this.tapObject(g.objectId, g.element);
        }
        return;
      }
      case 'tap':
        if (!cancelled && isTap(moved, duration)) {
          const world = screenToWorld(this.currentView(), g.start);
          if (g.purpose === 'place') this.placeSign(world);
          else this.startText(world, g.objectId);
        }
        return;
      case 'erase': {
        const ids = this.erasing();
        this.erasing.set(new Set());
        if (cancelled || !ids.size) return;
        this.commit(this.working.filter((o) => !ids.has(o.id)));
        const selected = this.selectedId();
        if (selected && ids.has(selected)) this.selectedId.set(null);
        return;
      }
      case 'pan':
        return;
    }
  }

  /** Marque pour effacement les objets rencontrés entre deux positions de la gomme. */
  private eraseAlong(from: Point, to: Point): void {
    const steps = Math.max(1, Math.ceil(distance(from, to) / ERASE_STEP_PX));
    for (let i = 1; i <= steps; i++) {
      this.eraseAt(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    }
  }

  private eraseAt(clientX: number, clientY: number): void {
    const hit = document.elementFromPoint(clientX, clientY)?.closest('[data-obj]');
    const id = hit?.getAttribute('data-obj');
    if (!hit || !id || !this.stage().nativeElement.contains(hit)) return;
    if (!this.erasing().has(id)) this.erasing.update((ids) => new Set(ids).add(id));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const c = this.container();
    if (e.ctrlKey || e.metaKey) {
      // Pincement du pavé tactile ou Ctrl + molette : zoom autour du curseur.
      this.setView(zoomAt(this.currentView(), Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED), this.localPoint(e), c));
    } else {
      this.setView(panBy(this.currentView(), -e.deltaX, -e.deltaY, c));
    }
  }

  // --- Clavier

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === ' ' && !target?.closest('button, a, [role="radio"]')) {
      this.spaceDown = true; // espace maintenu + glisser = déplacer la vue
      e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    const selected = this.selectedId();
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        if (selected) {
          e.preventDefault();
          this.deleteObject(selected);
        }
        return;
      case 'Escape':
        this.cancelPlacing();
        this.searchOpen.set(false);
        this.selectedId.set(null);
        return;
      case '+':
      case '=':
        this.zoomBy(ZOOM_STEP);
        return;
      case '-':
        this.zoomBy(1 / ZOOM_STEP);
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!selected) return;
        e.preventDefault();
        const step = e.shiftKey ? ARROW_STEP * 5 : ARROW_STEP;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this.commit(moveObject(this.working, selected, dx, dy));
      }
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') this.spaceDown = false;
  }

  // --- Modifications de la scène (avec historique)

  private commit(next: readonly BoardObject[]): void {
    this.history.update((h) => pushHistory(h, this.working));
    this.working = next;
    this.objectsChange.emit([...next]);
  }

  private applyHistory(value: readonly BoardObject[]): void {
    this.working = value;
    this.objectsChange.emit([...value]);
    if (this.selectedId() && !value.some((o) => o.id === this.selectedId())) this.selectedId.set(null);
  }

  protected undo(): void {
    const r = undoHistory(this.history(), this.working);
    if (!r) return;
    this.history.set(r.history);
    this.applyHistory(r.value);
  }

  protected redo(): void {
    const r = redoHistory(this.history(), this.working);
    if (!r) return;
    this.history.set(r.history);
    this.applyHistory(r.value);
  }

  // --- Dessin libre et signes

  private finishStroke(points: Point[], size: number, tool: 'draw' | 'sign'): void {
    if (tool === 'draw') {
      const ink = inkFromPoints(points, this.inkColor(), size);
      if (ink) this.commit(addObject(this.working, ink));
      return;
    }
    // Outil Signe : le tracé est conservé en aperçu, puis reconnu quand le stylet reste levé.
    this.preview.update((list) => [...list, { points, size }]);
    this.scheduleRecognition();
  }

  /** Nouveau trait avec l'outil Signe : on repart d'une proposition vierge. */
  private beginSignStroke(): void {
    clearTimeout(this.debounce);
    this.recognitionRequest++;
    this.recognizing.set(false);
    this.proposal.set(null);
    this.error.set(null);
  }

  private scheduleRecognition(): void {
    clearTimeout(this.debounce);
    const request = ++this.recognitionRequest;
    this.debounce = setTimeout(() => void this.recognize(request), RECOGNITION_DEBOUNCE_MS);
  }

  private async recognize(request: number): Promise<void> {
    const strokes = this.preview();
    if (!strokes.length) return;
    this.recognizing.set(true);
    try {
      const { matches } = await this.recognition.recognize(strokes.map((s) => s.points));
      await this.ensureSigns(matches.map((m) => m.signId));
      if (request !== this.recognitionRequest) return;
      const candidates = matches
        .map((m) => ({ sign: this.signs().get(m.signId), score: m.score }))
        .filter((c): c is Candidate => !!c.sign);
      const best = candidates[0];
      if (best && best.score > AUTO_REPLACE_SCORE) {
        const objectId = this.placeRecognized(best.sign.id, strokes);
        this.proposal.set({ kind: 'auto', objectId, candidates, strokes });
      } else if (best && best.score >= SUGGESTION_SCORE) {
        this.proposal.set({ kind: 'suggestions', candidates, strokes });
      } else {
        this.proposal.set({ kind: 'none', strokes });
      }
    } catch (e) {
      if (request === this.recognitionRequest) this.error.set(`Reconnaissance impossible : ${e}`);
    } finally {
      if (request === this.recognitionRequest) this.recognizing.set(false);
    }
  }

  /** Pose le signe reconnu où et à la taille du dessin, et retire l'aperçu. */
  private placeRecognized(signId: string, strokes: PreviewStroke[]): string {
    const { x, y, scale } = signPlacement(strokes.map((s) => s.points));
    const object: SignObject = { type: 'sign', id: crypto.randomUUID(), signId, x, y, scale };
    this.commit(addObject(this.working, object));
    this.preview.set([]);
    return object.id;
  }

  protected chooseCandidate(signId: string): void {
    const p = this.proposal();
    if (!p || p.kind === 'auto') return;
    this.placeRecognized(signId, p.strokes);
    this.proposal.set(null);
  }

  /** Pastille de correction : remplace le signe posé automatiquement. */
  protected correctAuto(signId: string): void {
    const p = this.proposal();
    if (p?.kind !== 'auto') return;
    const object = this.working.find((o) => o.id === p.objectId);
    if (object?.type === 'sign') this.commit(replaceObject(this.working, { ...object, signId }));
    this.proposal.set(null);
  }

  /** Garde le tracé comme dessin libre (annule la reconnaissance du signe si elle a eu lieu). */
  protected keepAsDrawing(): void {
    const p = this.proposal();
    if (!p) return;
    const inks = p.strokes.flatMap((s) => inkFromPoints(s.points, this.inkColor(), s.size) ?? []);
    const base = p.kind === 'auto' ? removeObject(this.working, p.objectId) : this.working;
    this.commit(addObjects(base, inks));
    this.preview.set([]);
    this.proposal.set(null);
  }

  protected discardPreview(): void {
    clearTimeout(this.debounce);
    this.recognitionRequest++;
    this.preview.set([]);
    this.proposal.set(null);
    this.recognizing.set(false);
  }

  protected createFromDrawing(): void {
    const p = this.proposal();
    if (p) this.createSign.emit(p.strokes.map((s) => s.points));
  }

  protected shape(candidate: Candidate): string {
    return candidate.sign.glyph ? 'glyph' : 'word';
  }

  // --- Recherche d'un signe puis pose où l'on touche

  protected openSearch(): void {
    this.searchOpen.set(true);
    if (!this.dictionary().length) {
      this.storage
        .listSigns()
        .then((list) => this.dictionary.set(list))
        .catch((e) => this.error.set(`Impossible de lire le dictionnaire : ${e}`));
    }
  }

  protected startPlacing(signId: string): void {
    this.searchOpen.set(false);
    this.placingSignId.set(signId);
    void this.ensureSigns([signId]);
  }

  protected cancelPlacing(): void {
    this.placingSignId.set(null);
  }

  private placeSign(world: Point): void {
    const signId = this.placingSignId();
    if (!signId) return;
    const object = signAt(signId, world);
    this.commit(addObject(this.working, object));
    this.placingSignId.set(null);
    this.selectedId.set(object.id);
  }

  private async ensureSigns(ids: readonly string[]): Promise<void> {
    const found = await this.storage.loadSignsWithComponents(ids, this.signs());
    if (found.size) this.signs.update((m) => new Map([...m, ...found]));
  }

  // --- Sélection

  private tapObject(objectId: string, element: Element): void {
    const object = this.working.find((o) => o.id === objectId);
    if (object?.type === 'sign') {
      this.signTap.emit({ signId: object.signId, objectId, rect: element.getBoundingClientRect() });
    }
  }

  protected deleteSelected(): void {
    const id = this.selectedId();
    if (id) this.deleteObject(id);
  }

  protected resizeSelected(factor: number): void {
    const id = this.selectedId();
    if (id) this.commit(resizeObject(this.working, id, factor));
  }

  protected readonly sizeStep = SIZE_STEP;

  protected editSelectedText(): void {
    const o = this.selectedObject();
    if (o?.type === 'text') this.startText({ x: o.x, y: o.y }, o.id);
  }

  // --- Texte

  /** Ouvre l'éditeur : sur un texte existant, ou nouveau texte au point touché. */
  private startText(world: Point, objectId: string | null): void {
    const existing = this.working.find((o): o is TextObject => o.id === objectId && o.type === 'text');
    if (existing) {
      this.selectedId.set(existing.id);
      this.editing.set({
        id: existing.id, x: existing.x, y: existing.y, text: existing.text,
        size: existing.size, color: existing.color, original: existing.text,
      });
    } else {
      const size = this.textSize();
      this.selectedId.set(null);
      this.editing.set({
        id: null,
        x: Math.max(0, Math.min(BOARD_WIDTH - 40, world.x)),
        y: Math.max(0, Math.min(BOARD_HEIGHT - size, world.y - size / 2)),
        text: '', size, color: this.inkColor(), original: '',
      });
    }
    afterNextRender(() => this.editor()?.nativeElement.focus(), { injector: this.injector });
  }

  protected onEditorInput(value: string): void {
    this.editing.update((e) => (e ? { ...e, text: value } : e));
  }

  protected onEditorKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.editing.set(null); // annule la saisie
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.commitText();
    }
  }

  /** Valide le texte saisi : crée, modifie, ou supprime s'il est vide. */
  protected commitText(): void {
    const e = this.editing();
    if (!e) return;
    this.editing.set(null);
    const text = e.text.replace(/\s+$/, '');
    if (e.id) {
      if (!text.trim()) this.commit(removeObject(this.working, e.id));
      else if (text !== e.original) {
        const o = this.working.find((x): x is TextObject => x.id === e.id && x.type === 'text');
        if (o) this.commit(replaceObject(this.working, { ...o, text }));
      }
    } else if (text.trim()) {
      const object: TextObject = { type: 'text', id: crypto.randomUUID(), x: e.x, y: e.y, text, size: e.size, color: e.color };
      this.commit(addObject(this.working, object));
      this.selectedId.set(object.id);
    }
  }

  // --- Aides de rendu

  protected objectTransform(o: BoardObject): string {
    const d = this.drag();
    const dx = d?.id === o.id ? d.dx : 0;
    const dy = d?.id === o.id ? d.dy : 0;
    return `translate(${o.x + dx} ${o.y + dy})`;
  }

  protected lines(text: string): string[] {
    return text.split('\n');
  }

  protected hitBox(o: BoardObject): { width: number; height: number } {
    const b = objectBounds(o);
    return { width: b.width, height: b.height };
  }
}
