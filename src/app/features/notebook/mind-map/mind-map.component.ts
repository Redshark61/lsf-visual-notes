import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { MIND_MAP_HEIGHT, MIND_MAP_WIDTH, MapNode, MindMap, UserSign } from '../../../core/models/sign.model';

type Display = 'signs' | 'words' | 'both';
interface Size {
  w: number;
  h: number;
}

/** Point où le segment centre(a) → centre(b) sort du rectangle de b (pour que la flèche touche le bord). */
function edgePoint(from: { x: number; y: number }, center: { x: number; y: number }, size: Size, margin = 6) {
  const dx = center.x - from.x;
  const dy = center.y - from.y;
  if (dx === 0 && dy === 0) return center;
  const s = Math.min((size.w / 2 + margin) / Math.abs(dx || 1e-9), (size.h / 2 + margin) / Math.abs(dy || 1e-9));
  return { x: center.x - dx * Math.min(s, 1), y: center.y - dy * Math.min(s, 1) };
}

/**
 * Carte mentale : bulles déplaçables (contenant des signes) reliées par des flèches ou des traits.
 * Les glyphes sont rendus via <use href="#glyph-…"> (sprite déclaré par le Carnet).
 */
@Component({
  selector: 'app-mind-map',
  templateUrl: './mind-map.component.html',
  styleUrl: './mind-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'cancelLinking()' },
})
export class MindMapComponent {
  readonly map = input.required<MindMap>();
  readonly signs = input.required<ReadonlyMap<string, UserSign>>();
  readonly display = input<Display>('signs');
  /** Bulle cible des prochains signes insérés. */
  readonly selectedNodeId = model<string | null>(null);
  /** Élément mis en évidence (bulle d'informations ouverte). */
  readonly selectedElementId = input<string | null>(null);
  readonly freshElementId = input<string | null>(null);

  readonly mapChange = output<MindMap>();
  readonly elementClick = output<{ elementId: string; event: MouseEvent }>();
  /** Défilement de la carte (la bulle d'informations, en position fixe, doit se fermer). */
  readonly scrolled = output<void>();

  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly nodeEls = viewChildren<ElementRef<HTMLElement>>('nodeEl');

  protected readonly width = MIND_MAP_WIDTH;
  protected readonly height = MIND_MAP_HEIGHT;
  protected readonly linking = signal(false);
  protected readonly linkFrom = signal<string | null>(null);
  protected readonly selectedLinkId = signal<string | null>(null);
  /** Position en cours de glissement (appliquée à la carte au relâchement). */
  private readonly drag = signal<{ id: string; x: number; y: number } | null>(null);
  private readonly sizes = signal(new Map<string, Size>());

  protected readonly selectedLink = computed(() => this.map().links.find((l) => l.id === this.selectedLinkId()));
  protected readonly hint = computed(() => {
    if (this.linking()) return this.linkFrom() ? 'Touchez la bulle d’arrivée.' : 'Touchez la bulle de départ.';
    if (!this.map().nodes.length) return 'Ajoutez une bulle, puis dessinez ou écrivez un signe.';
    return this.selectedNodeId() ? 'Les prochains signes iront dans la bulle sélectionnée.' : '';
  });
  protected readonly linkGeoms = computed(() => {
    const sizes = this.sizes();
    const center = (n: MapNode) => {
      const p = this.pos(n);
      const s = sizes.get(n.id) ?? { w: 120, h: 60 };
      return { x: p.x + s.w / 2, y: p.y + s.h / 2 };
    };
    const byId = new Map(this.map().nodes.map((n) => [n.id, n]));
    return this.map().links.flatMap((l) => {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (!a || !b) return [];
      const ca = center(a);
      const cb = center(b);
      const start = edgePoint(cb, ca, sizes.get(a.id) ?? { w: 120, h: 60 }, 2);
      const end = edgePoint(ca, cb, sizes.get(b.id) ?? { w: 120, h: 60 });
      return [{ ...l, x1: start.x, y1: start.y, x2: end.x, y2: end.y }];
    });
  });

  constructor() {
    // Taille réelle des bulles (contenu variable) pour placer les extrémités des liens.
    const observer = new ResizeObserver((entries) =>
      this.sizes.update((map) => {
        const next = new Map(map);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset['id'];
          if (id) next.set(id, { w: (e.target as HTMLElement).offsetWidth, h: (e.target as HTMLElement).offsetHeight });
        }
        return next;
      }),
    );
    effect(() => {
      observer.disconnect();
      for (const el of this.nodeEls()) observer.observe(el.nativeElement);
    });
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  protected pos(node: MapNode): { x: number; y: number } {
    const d = this.drag();
    return d?.id === node.id ? d : node;
  }

  /** Position libre au centre de la zone visible (décalée si une bulle y est déjà). */
  suggestPosition(): { x: number; y: number } {
    const v = this.viewport().nativeElement;
    let x = Math.round(v.scrollLeft + v.clientWidth / 2 - 80);
    let y = Math.round(v.scrollTop + v.clientHeight / 2 - 40);
    while (this.map().nodes.some((n) => Math.abs(n.x - x) < 24 && Math.abs(n.y - y) < 24)) {
      x += 32;
      y += 32;
    }
    return { x: clamp(x, 0, MIND_MAP_WIDTH - 160), y: clamp(y, 0, MIND_MAP_HEIGHT - 80) };
  }

  // --- Bulles

  protected addNode(): void {
    const node: MapNode = { id: crypto.randomUUID(), ...this.suggestPosition(), elements: [] };
    this.emit({ ...this.map(), nodes: [...this.map().nodes, node] });
    this.selectedNodeId.set(node.id);
    this.selectedLinkId.set(null);
  }

  protected deleteNode(): void {
    const id = this.selectedNodeId();
    const node = this.map().nodes.find((n) => n.id === id);
    if (!node) return;
    if (node.elements.length && !confirm('Supprimer cette bulle et ses signes ?')) return;
    this.emit({
      nodes: this.map().nodes.filter((n) => n.id !== id),
      links: this.map().links.filter((l) => l.from !== id && l.to !== id),
    });
    this.selectedNodeId.set(null);
  }

  protected onNodeClick(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedLinkId.set(null);
    if (!this.linking()) {
      this.selectedNodeId.set(id);
      return;
    }
    const from = this.linkFrom();
    if (!from) {
      this.linkFrom.set(id);
      return;
    }
    if (from !== id && !this.map().links.some((l) => (l.from === from && l.to === id) || (l.from === id && l.to === from))) {
      this.emit({ ...this.map(), links: [...this.map().links, { id: crypto.randomUUID(), from, to: id, arrow: true }] });
    }
    this.cancelLinking();
  }

  protected onBackgroundClick(): void {
    if (this.linking()) return;
    this.selectedNodeId.set(null);
    this.selectedLinkId.set(null);
  }

  // --- Glisser une bulle (par sa poignée)

  protected startDrag(node: MapNode, event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const size = this.sizes().get(node.id) ?? { w: 120, h: 60 };
    const offset = { x: event.clientX - node.x, y: event.clientY - node.y };
    this.selectedNodeId.set(node.id);

    const move = (e: PointerEvent) =>
      this.drag.set({
        id: node.id,
        x: clamp(e.clientX - offset.x, 0, MIND_MAP_WIDTH - size.w),
        y: clamp(e.clientY - offset.y, 0, MIND_MAP_HEIGHT - size.h),
      });
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      const d = this.drag();
      this.drag.set(null);
      if (d && (d.x !== node.x || d.y !== node.y)) {
        this.emit({
          ...this.map(),
          nodes: this.map().nodes.map((n) => (n.id === d.id ? { ...n, x: Math.round(d.x), y: Math.round(d.y) } : n)),
        });
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** Clavier : flèches sur la poignée pour déplacer la bulle (accessibilité). */
  protected onHandleKey(node: MapNode, event: KeyboardEvent): void {
    const step = event.shiftKey ? 40 : 10;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    const size = this.sizes().get(node.id) ?? { w: 120, h: 60 };
    this.emit({
      ...this.map(),
      nodes: this.map().nodes.map((n) =>
        n.id === node.id
          ? { ...n, x: clamp(n.x + d[0], 0, MIND_MAP_WIDTH - size.w), y: clamp(n.y + d[1], 0, MIND_MAP_HEIGHT - size.h) }
          : n,
      ),
    });
  }

  // --- Liens

  protected toggleLinking(): void {
    this.linking.update((v) => !v);
    this.linkFrom.set(null);
    this.selectedLinkId.set(null);
  }

  cancelLinking(): void {
    this.linking.set(false);
    this.linkFrom.set(null);
  }

  protected selectLink(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedLinkId.set(id);
    this.selectedNodeId.set(null);
  }

  protected toggleArrow(): void {
    const id = this.selectedLinkId();
    this.emit({ ...this.map(), links: this.map().links.map((l) => (l.id === id ? { ...l, arrow: !l.arrow } : l)) });
  }

  protected reverseLink(): void {
    const id = this.selectedLinkId();
    this.emit({
      ...this.map(),
      links: this.map().links.map((l) => (l.id === id ? { ...l, from: l.to, to: l.from } : l)),
    });
  }

  protected deleteLink(): void {
    const id = this.selectedLinkId();
    this.emit({ ...this.map(), links: this.map().links.filter((l) => l.id !== id) });
    this.selectedLinkId.set(null);
  }

  protected onElementClick(elementId: string, event: MouseEvent, nodeId: string): void {
    event.stopPropagation();
    if (this.linking()) {
      this.onNodeClick(nodeId, event);
      return;
    }
    this.selectedNodeId.set(nodeId);
    this.elementClick.emit({ elementId, event });
  }

  private emit(map: MindMap): void {
    this.mapChange.emit(map);
  }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
