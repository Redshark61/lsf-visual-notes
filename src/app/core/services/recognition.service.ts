import { DestroyRef, Injectable, NgZone, inject } from '@angular/core';
import { RecognitionResult, RecognizerRequest, RecognizerResponse } from '../models/recognition.model';
import { Stroke } from '../models/sign.model';

/**
 * Pont vers gesture-recognizer.worker.ts. Le Worker et ses messages vivent hors zone Angular ;
 * on ne réintègre la zone qu'au moment de résoudre la promesse avec le résultat.
 */
@Injectable({ providedIn: 'root' })
export class RecognitionService {
  private readonly ngZone = inject(NgZone);
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (r: RecognitionResult) => void; reject: (e: Error) => void }
  >();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.worker?.terminate();
      for (const p of this.pending.values()) p.reject(new Error('RecognitionService détruit'));
      this.pending.clear();
    });
  }

  /** Top 3 des signes du dictionnaire les plus proches du dessin (coordonnées brutes). */
  recognize(strokes: Stroke[]): Promise<RecognitionResult> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.post({ type: 'recognize', requestId, strokes });
    });
  }

  /** À appeler après toute écriture dans la table des signes. */
  invalidate(): void {
    if (this.worker) this.post({ type: 'invalidate' });
  }

  private post(message: RecognizerRequest): void {
    this.ngZone.runOutsideAngular(() => this.getWorker().postMessage(message));
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/gesture-recognizer.worker', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', ({ data }: MessageEvent<RecognizerResponse>) => {
        const p = this.pending.get(data.requestId);
        if (!p) return;
        this.pending.delete(data.requestId);
        this.ngZone.run(() =>
          data.type === 'result'
            ? p.resolve({ matches: data.matches, candidateCount: data.candidateCount, durationMs: data.durationMs })
            : p.reject(new Error(data.message)),
        );
      });
      this.worker.addEventListener('error', (e) => {
        const err = new Error(`Worker de reconnaissance : ${e.message}`);
        for (const p of this.pending.values()) this.ngZone.run(() => p.reject(err));
        this.pending.clear();
      });
    }
    return this.worker;
  }
}
