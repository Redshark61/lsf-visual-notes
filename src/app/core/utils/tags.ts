export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS = 10;

export interface TagCount {
  tag: string;
  count: number;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** « Famille, maison ,famille » → ["famille", "maison"] (minuscules, sans doublon, 10 au plus). */
export function normalizeTags(tags: string[]): string[] {
  const clean = tags.map((t) => t.trim().toLowerCase().slice(0, MAX_TAG_LENGTH)).filter(Boolean);
  return [...new Set(clean)].slice(0, MAX_TAGS);
}

/** Tags avec leur nombre d'utilisations, du plus utilisé au moins utilisé (puis alphabétique). */
export function tallyTags(allTags: readonly string[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const tag of allTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'fr'));
}

/**
 * Suggestions pour une saisie : tags existants non encore choisis dont le nom contient la saisie
 * (accents et casse ignorés), ceux qui commencent par la saisie d'abord. Sans saisie : les plus utilisés.
 */
export function suggestTags(all: readonly TagCount[], query: string, selected: readonly string[], limit = 6): TagCount[] {
  const q = fold(query);
  const taken = new Set(selected);
  const rank = (t: TagCount) => {
    const name = fold(t.tag);
    return !q ? 0 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : -1;
  };
  return all
    .filter((t) => !taken.has(t.tag) && rank(t) >= 0)
    .sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.tag.localeCompare(b.tag, 'fr'))
    .slice(0, limit);
}
