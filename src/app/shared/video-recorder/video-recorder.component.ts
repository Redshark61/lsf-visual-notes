import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { BlobVideoComponent } from '../blob-video.component';
import { MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_MS, VideoMimeType } from '../../core/models/sign.model';
import { VideoDraft } from '../../core/services/storage.service';

type Phase = 'idle' | 'starting' | 'preview' | 'countdown' | 'recording' | 'review' | 'error';

/** Basse définition suffisante pour un signe : ~200 Ko pour 5 s. */
const CAPTURE: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 480 },
  height: { ideal: 360 },
  frameRate: { ideal: 15, max: 24 },
};
const VIDEO_BITRATE = 300_000;
/** MP4/H.264 d'abord (lisible partout, iPhone compris), WebM sinon. */
const MIME_CANDIDATES: [string, VideoMimeType][] = [
  ['video/mp4;codecs=avc1', 'video/mp4'],
  ['video/mp4', 'video/mp4'],
  ['video/webm;codecs=vp9', 'video/webm'],
  ['video/webm;codecs=vp8', 'video/webm'],
  ['video/webm', 'video/webm'],
];

function pickMime(): [string, VideoMimeType] | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find(([type]) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/**
 * Enregistrement d'une courte vidéo de signe avec la caméra avant : aperçu en miroir,
 * compte à rebours, arrêt automatique à MAX_VIDEO_DURATION_MS, relecture avant validation.
 */
@Component({
  selector: 'app-video-recorder',
  imports: [BlobVideoComponent, DecimalPipe, NgTemplateOutlet],
  templateUrl: './video-recorder.component.html',
  styleUrl: './video-recorder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoRecorderComponent {
  /** Prise en attente de validation (null : plus de prise). La validation se fait dans le pied de l'assistant. */
  readonly pending = output<VideoDraft | null>();

  private readonly injector = inject(Injector);
  private readonly live = viewChild<ElementRef<HTMLVideoElement>>('live');

  protected readonly maxSeconds = MAX_VIDEO_DURATION_MS / 1000;
  protected readonly supported = !!navigator.mediaDevices?.getUserMedia && !!pickMime();
  protected readonly phase = signal<Phase>('idle');
  protected readonly countdown = signal(3);
  protected readonly elapsed = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<VideoDraft | null>(null);

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cleanup());
  }

  /** Recommence une prise. */
  retake(): void {
    void this.startCamera();
  }

  protected async startCamera(): Promise<void> {
    this.error.set(null);
    this.setResult(null);
    this.phase.set('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: CAPTURE, audio: false });
      this.phase.set('preview');
      afterNextRender(
        () => {
          const video = this.live()?.nativeElement;
          if (video && this.stream) video.srcObject = this.stream;
        },
        { injector: this.injector },
      );
    } catch (e) {
      const name = (e as DOMException).name;
      this.fail(
        name === 'NotAllowedError'
          ? "L'accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur, puis réessayez."
          : name === 'NotFoundError'
            ? 'Aucune caméra détectée sur cet appareil.'
            : `Caméra indisponible (${name || e}).`,
      );
    }
  }

  protected record(): void {
    if (!this.stream) return;
    this.phase.set('countdown');
    this.countdown.set(3);
    for (const n of [2, 1]) this.later(() => this.countdown.set(n), (3 - n) * 1000);
    this.later(() => this.beginRecording(), 3000);
  }

  private beginRecording(): void {
    const mime = pickMime();
    if (!this.stream || !mime) return this.fail("L'enregistrement vidéo n'est pas pris en charge par ce navigateur.");
    const [type, baseType] = mime;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(this.stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITRATE });
    this.recorder = recorder;
    const start = performance.now();
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const durationMs = Math.min(performance.now() - start, MAX_VIDEO_DURATION_MS);
      // Type sans paramètres de codec : simple à stocker et à valider.
      const blob = new Blob(chunks, { type: baseType });
      this.stopCamera();
      if (blob.size > MAX_VIDEO_BYTES) return this.fail('Vidéo trop lourde, recommencez.');
      this.setResult({ blob, mimeType: baseType, durationMs });
      this.phase.set('review');
    };
    recorder.start(250);
    this.phase.set('recording');
    this.elapsed.set(0);
    const tick = () => {
      if (this.phase() !== 'recording') return;
      this.elapsed.set((performance.now() - start) / 1000);
      this.later(tick, 100);
    };
    tick();
    this.later(() => this.stop(), MAX_VIDEO_DURATION_MS);
  }

  protected stop(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  private setResult(result: VideoDraft | null): void {
    this.result.set(result);
    this.pending.emit(result);
  }

  /** Secours sans MediaRecorder : fichier MP4/WebM léger choisi ou filmé avec l'appareil. */
  protected onFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const type = file.type.split(';')[0] as VideoMimeType;
    if (type !== 'video/mp4' && type !== 'video/webm') return this.fail('Format non pris en charge (MP4 ou WebM uniquement).');
    if (file.size > MAX_VIDEO_BYTES) return this.fail('Vidéo trop lourde (3 Mo maximum) : filmez moins longtemps.');
    const probe = document.createElement('video');
    const url = URL.createObjectURL(file);
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const blob = new Blob([file], { type });
      this.setResult({ blob, mimeType: type, durationMs: Math.min(probe.duration * 1000 || 0, MAX_VIDEO_DURATION_MS * 2) });
      this.phase.set('review');
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      this.fail('Vidéo illisible.');
    };
    probe.src = url;
  }

  private fail(message: string): void {
    this.stopCamera();
    this.error.set(message);
    this.phase.set('error');
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private stopCamera(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private cleanup(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.stopCamera();
  }
}
