/**
 * Que fait l'application d'un résultat de reconnaissance ? Seuils et règle de décision communs au
 * Carnet (mode texte), au plateau de dessin libre et à l'Atelier.
 */

/** À partir de ce score, le tracé est remplacé automatiquement par le signe reconnu (sous réserve de la marge). */
export const AUTO_REPLACE_SCORE = 0.55;
/** À partir de ce score, les signes proches sont proposés ; en dessous : « aucun signe reconnu ». */
export const SUGGESTION_SCORE = 0.5;
/**
 * Écart minimal avec le deuxième meilleur signe pour remplacer automatiquement. Si deux signes se
 * ressemblent autant, on propose le choix plutôt que de se tromper.
 *
 * Mesures (seuil à 55 %, redessins « un peu différents » : proportions, rotation, forme déformée, trait
 * coupé en deux) : 93 % remplacés à juste titre, 0,4 % à tort (était 40 % / 0 % au seuil de 80 %).
 * Une marge plus grande réduit peu les faux remplacements de gribouillis mais coûte du bon rappel :
 * 0,08 → 87 %, 0,10 → 84 %.
 *
 * Limite connue : un gribouillis qui n'est pas dans le dictionnaire est parfois pris pour un signe
 * (~15 % avec un dictionnaire de 14 formes variées) ; « Annuler », les pastilles « Plutôt » et
 * « Garder comme dessin » permettent de corriger.
 */
export const AUTO_MARGIN = 0.05;
/** L'Atelier avertit qu'un nouveau dessin ressemble beaucoup à un signe existant à partir de ce score. */
export const CONFUSION_SCORE = 0.7;

export type MatchDecision = 'auto' | 'suggest' | 'none';

/** `matches` : signes reconnus, du plus au moins probable. */
export function decideMatches(matches: readonly { score: number }[]): MatchDecision {
  const best = matches[0];
  if (!best || best.score < SUGGESTION_SCORE) return 'none';
  const second = matches[1]?.score ?? 0;
  return best.score >= AUTO_REPLACE_SCORE && best.score - second >= AUTO_MARGIN ? 'auto' : 'suggest';
}
