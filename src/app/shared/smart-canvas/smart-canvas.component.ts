import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Point, SignGlyph, Stroke } from '../../core/models/sign.model';
import { strokeToSvgPath } from '../../core/utils/freehand';
import { extractGesture } from '../../core/utils/gesture';

/** Throttling spatial : un point n'est enregistré que s'il est à au moins 4 px du précédent. */
const MIN_POINT_DISTANCE = 4;

/**
 * Zone de saisie au doigt / stylet.
 *
 * Tous les Pointer Events et le rendu sont gérés hors zone Angular, par des écouteurs natifs,
 * sans aucune écriture de signal : le pointermove ne déclenche jamais de détection de changements.
 * Les sorties sont émises une fois par trait (pointerdown / pointerup), jamais pendant le tracé.
 */
@Component({
  selector: 'app-smart-canvas',
  template: '<canvas #canvas></canvas>',
  styles: `
    :host {
      display: block;
      position: relative;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      cursor: crosshair;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SmartCanvasComponent {
  readonly color = input('#1d1d1f');
  /** Traits à afficher au montage (ex. retour sur l'étape de dessin). Lu une seule fois. */
  readonly initialStrokes = input<Stroke[]>([]);

  /** Début d'un nouveau trait (permet d'annuler un debounce de reconnaissance en cours). */
  readonly strokeStart = output<void>();
  /** Liste complète des traits après un lever de stylet, une annulation ou un effacement. */
  readonly strokesChange = output<Stroke[]>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private ctx!: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private committedPaths: Path2D[] = [];
  private current: Stroke | null = null;
  private activePointerId: number | null = null;
  private rect: DOMRect | null = null;
  private dpr = 1;
  private frame = 0;

  constructor() {
    afterNextRender(() => this.ngZone.runOutsideAngular(() => this.setup()));
  }

  /** Copie des traits en coordonnées CSS px relatives au canevas. */
  getStrokes(): Stroke[] {
    return this.strokes.map((s) => s.map((p) => ({ ...p })));
  }

  get strokeCount(): number {
    return this.strokes.length;
  }

  /** Nuage normalisé ($Q), ratio, nombre de traits et chemin SVG de rendu. */
  extractGesture(): SignGlyph | null {
    return extractGesture(this.strokes);
  }

  undo(): void {
    if (this.strokes.length === 0) return;
    this.strokes.pop();
    this.committedPaths.pop();
    this.draw();
    this.strokesChange.emit(this.getStrokes());
  }

  /**
   * Remplace les traits affichés (ex. rétablir un dessin après annulation d'une insertion).
   * N'émet pas strokesChange : l'appelant connaît déjà ces traits, et une émission relancerait
   * la reconnaissance.
   */
  setStrokes(strokes: Stroke[]): void {
    this.cancelCurrent();
    this.strokes = strokes.filter((s) => s.length > 0).map((s) => s.map((p) => ({ ...p })));
    this.committedPaths = this.strokes.map((s) => new Path2D(strokeToSvgPath(s)));
    this.draw();
  }

  clear(): void {
    this.cancelCurrent();
    if (this.strokes.length === 0) return;
    this.strokes = [];
    this.committedPaths = [];
    this.draw();
    this.strokesChange.emit([]);
  }

  private setup(): void {
    const canvas = this.canvasRef().nativeElement;
    this.ctx = canvas.getContext('2d')!;

    this.strokes = this.initialStrokes()
      .filter((s) => s.length > 0)
      .map((s) => s.map((p) => ({ ...p })));
    this.committedPaths = this.strokes.map((s) => new Path2D(strokeToSvgPath(s)));

    const resizeObserver = new ResizeObserver(() => this.resize());
    resizeObserver.observe(canvas);
    this.resize();

    const down = (e: PointerEvent) => this.onPointerDown(e);
    const move = (e: PointerEvent) => this.onPointerMove(e);
    const up = (e: PointerEvent) => this.onPointerUp(e);
    const cancel = (e: PointerEvent) => e.pointerId === this.activePointerId && this.cancelCurrent();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);

    this.destroyRef.onDestroy(() => {
      resizeObserver.disconnect();
      cancelAnimationFrame(this.frame);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
    });
  }

  private onPointerDown(e: PointerEvent): void {
    // Un seul pointeur à la fois (ignore la paume / un 2e doigt) ; clic gauche uniquement.
    if (this.activePointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const canvas = this.canvasRef().nativeElement;
    canvas.setPointerCapture(e.pointerId);
    this.activePointerId = e.pointerId;
    this.rect = canvas.getBoundingClientRect();
    this.current = [this.toPoint(e)];
    this.scheduleDraw();
    this.strokeStart.emit();
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.activePointerId || !this.current) return;
    const events = e.getCoalescedEvents?.() ?? [];
    let added = false;
    for (const ev of events.length ? events : [e]) {
      added = this.addPoint(this.toPoint(ev), MIN_POINT_DISTANCE) || added;
    }
    if (added) this.scheduleDraw();
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.activePointerId || !this.current) return;
    this.addPoint(this.toPoint(e), 0.5); // conserve le point final exact
    const stroke = this.current;
    this.current = null;
    this.activePointerId = null;
    this.strokes.push(stroke);
    this.committedPaths.push(new Path2D(strokeToSvgPath(stroke)));
    this.draw();
    this.strokesChange.emit(this.getStrokes());
  }

  private cancelCurrent(): void {
    if (!this.current) return;
    this.current = null;
    this.activePointerId = null;
    this.draw();
  }

  private addPoint(p: Point, minDistance: number): boolean {
    const last = this.current![this.current!.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < minDistance) return false;
    this.current!.push(p);
    return true;
  }

  private toPoint(e: PointerEvent): Point {
    const rect = this.rect!;
    const p: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    // Seul le stylet fournit une pression réelle (souris : 0.5 constant, doigt : souvent 0).
    if (e.pointerType === 'pen') p.pressure = e.pressure;
    return p;
  }

  private resize(): void {
    const canvas = this.canvasRef().nativeElement;
    this.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * this.dpr);
    canvas.height = Math.round(canvas.clientHeight * this.dpr);
    this.draw();
  }

  private scheduleDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const { ctx } = this;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.color();
    for (const path of this.committedPaths) ctx.fill(path);
    if (this.current) ctx.fill(new Path2D(strokeToSvgPath(this.current)));
  }
}
