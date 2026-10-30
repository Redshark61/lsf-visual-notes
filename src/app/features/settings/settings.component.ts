import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SettingsService } from '../../core/services/settings.service';
import { TouchDrawing } from '../../core/utils/board-input';
import { BackupComponent } from '../backup/backup.component';

interface TouchOption {
  value: TouchDrawing;
  title: string;
  description: string;
}

/** Paramètres de l'application : comportement du doigt sur le plateau de dessin, sauvegarde et restauration. */
@Component({
  selector: 'app-settings',
  imports: [BackupComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  protected readonly settings = inject(SettingsService);

  protected readonly options: TouchOption[] = [
    {
      value: 'auto',
      title: 'Automatique (recommandé)',
      description: 'Le doigt dessine, sauf si vous utilisez un stylet : alors il sert à déplacer et zoomer.',
    },
    {
      value: 'draw',
      title: 'Toujours dessiner',
      description: 'Le doigt dessine toujours, même si vous avez aussi un stylet.',
    },
    {
      value: 'pan',
      title: 'Toujours déplacer',
      description: 'Le doigt ne dessine jamais : il déplace le plateau. On dessine au stylet ou à la souris.',
    },
  ];
}
