import { Stroke } from './sign.model';

export interface RecognitionMatch {
  signId: string;
  /** Confiance de 0 à 1. */
  score: number;
}

export interface RecognitionResult {
  /** Top 3, confiance décroissante. Vide si aucun signe compatible. */
  matches: RecognitionMatch[];
  /** Nombre de signes retenus par le pré-filtrage (traits, ratio). */
  candidateCount: number;
  durationMs: number;
}

export type RecognizerRequest =
  | { type: 'recognize'; requestId: number; strokes: Stroke[] }
  /** Le dictionnaire a changé : le Worker relira IndexedDB à la prochaine reconnaissance. */
  | { type: 'invalidate' };

export type RecognizerResponse =
  | ({ type: 'result'; requestId: number } & RecognitionResult)
  | { type: 'error'; requestId: number; message: string };
