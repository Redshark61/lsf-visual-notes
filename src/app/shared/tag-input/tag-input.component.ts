import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { MAX_TAGS, MAX_TAG_LENGTH, TagCount, normalizeTags, suggestTags } from '../../core/utils/tags';

/** Nombre de tags existants affichés avant « Voir tout ». */
const COLLAPSED_COUNT = 12;

/**
 * Saisie des tags : tags choisis, champ avec suggestions au fil de la frappe, et liste des tags
 * déjà utilisés à toucher (plus besoin de retaper exactement un tag existant).
 */
@Component({
  selector: 'app-tag-input',
  templateUrl: './tag-input.component.html',
  styleUrl: './tag-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagInputComponent {
  /** Tags existants dans le dictionnaire, avec leur nombre d'utilisations. */
  readonly known = input<readonly TagCount[]>([]);
  readonly tags = model<string[]>([]);

  protected readonly maxTags = MAX_TAGS;
  protected readonly maxLength = MAX_TAG_LENGTH;
  protected readonly query = signal('');
  protected readonly showAll = signal(false);
  protected readonly full = computed(() => this.tags().length >= MAX_TAGS);
  /** Complétion pendant la frappe. */
  protected readonly suggestions = computed(() =>
    this.query().trim() ? suggestTags(this.known(), this.query(), this.tags()) : [],
  );
  /** Tags existants à toucher (les plus utilisés d'abord). */
  protected readonly available = computed(() => {
    const all = suggestTags(this.known(), '', this.tags(), Infinity);
    return this.showAll() ? all : all.slice(0, COLLAPSED_COUNT);
  });
  protected readonly hiddenCount = computed(
    () => suggestTags(this.known(), '', this.tags(), Infinity).length - COLLAPSED_COUNT,
  );
  protected readonly isNew = computed(() => {
    const [typed] = normalizeTags([this.query()]);
    return !!typed && !this.tags().includes(typed) && !this.known().some((k) => k.tag === typed);
  });

  protected add(raw: string): void {
    // La virgule reste un séparateur : « famille, lieux » ajoute deux tags.
    const added = normalizeTags(raw.split(','));
    if (!added.length) return;
    this.tags.set(normalizeTags([...this.tags(), ...added]));
    this.query.set('');
  }

  protected remove(tag: string): void {
    this.tags.set(this.tags().filter((t) => t !== tag));
  }

  protected onInput(value: string): void {
    // Saisie d'une virgule : valide le tag en cours.
    if (value.includes(',')) this.add(value);
    else this.query.set(value);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.add(this.query());
    } else if (event.key === 'Backspace' && !this.query() && this.tags().length) {
      this.remove(this.tags().at(-1)!);
    }
  }
}
