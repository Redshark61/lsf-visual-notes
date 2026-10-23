import { Injectable } from '@angular/core';
import { Stroke } from '../models/sign.model';

/** Brouillon envoyé par le Carnet à l'Atelier : un dessin non reconnu ou un mot introuvable. */
export interface NotebookDraft {
  noteId: string;
  strokes?: Stroke[];
  word?: string;
}

/**
 * Aller-retour Carnet → Atelier → Carnet (« Créer un nouveau signe à partir de ce dessin / ce mot »).
 * Volontairement en mémoire : un rechargement de page abandonne simplement le brouillon.
 */
@Injectable({ providedIn: 'root' })
export class SignDraftTransferService {
  private draft: NotebookDraft | null = null;
  private created: { signId: string; noteId: string } | null = null;

  offerDraft(draft: NotebookDraft): void {
    this.draft = draft;
  }

  takeDraft(): NotebookDraft | null {
    const d = this.draft;
    this.draft = null;
    return d;
  }

  reportCreated(signId: string, noteId: string): void {
    this.created = { signId, noteId };
  }

  /** Signe créé depuis cette note, à insérer à son retour. */
  takeCreated(noteId: string): string | null {
    if (this.created?.noteId !== noteId) return null;
    const id = this.created.signId;
    this.created = null;
    return id;
  }
}
