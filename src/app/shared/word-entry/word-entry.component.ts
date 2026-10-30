import { GlyphPathsPipe } from '../glyph-paths.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { UserSign } from '../../core/models/sign.model';
import { GLYPH_VIEWBOX } from '../../core/utils/freehand';

const MAX_MATCHES = 8;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Saisie d'un mot avec liste de signes correspondants (combobox accessible).
 * Classement : mot exact, puis début du mot, puis contenu dans le mot, puis tag.
 */
@Component({
  selector: 'app-word-entry',
  imports: [GlyphPathsPipe],
  templateUrl: './word-entry.component.html',
  styleUrl: './word-entry.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WordEntryComponent {
  readonly signs = input.required<UserSign[]>();
  /** Signe choisi (clic ou Entrée). */
  readonly pick = output<string>();
  /** Aucun signe ne correspond : l'utilisateur veut créer ce mot. */
  readonly create = output<string>();
  /** Propose « Créer le signe » quand rien ne correspond (inutile pour choisir un composant). */
  readonly allowCreate = input(true);
  readonly placeholder = input('Tapez un mot…');

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected readonly viewBox = `0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`;
  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);
  protected readonly trimmed = computed(() => this.query().trim());
  protected readonly matches = computed(() => {
    const q = fold(this.query());
    if (!q) return [];
    const rank = (s: UserSign) => {
      const w = fold(s.word);
      if (w === q) return 0;
      if (w.startsWith(q)) return 1;
      if (w.includes(q)) return 2;
      if (s.tags.some((t) => fold(t).includes(q))) return 3;
      return -1;
    };
    return this.signs()
      .map((sign) => ({ sign, rank: rank(sign) }))
      .filter((m) => m.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.sign.word.localeCompare(b.sign.word, 'fr'))
      .slice(0, MAX_MATCHES)
      .map((m) => m.sign);
  });

  focus(): void {
    this.inputRef().nativeElement.focus();
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.matches().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count) this.activeIndex.update((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count) this.activeIndex.update((i) => (i - 1 + count) % count);
        break;
      case 'Enter': {
        event.preventDefault();
        const sign = this.matches()[this.activeIndex()];
        if (sign) this.choose(sign.id);
        else if (this.trimmed() && this.allowCreate()) this.create.emit(this.trimmed());
        break;
      }
      case 'Escape':
        if (this.query()) {
          event.stopPropagation(); // vide seulement le champ
          this.onInput('');
        }
        break;
    }
  }

  protected choose(signId: string): void {
    this.pick.emit(signId);
    this.onInput('');
    this.focus();
  }
}
