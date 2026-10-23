import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { InstallService } from '../../core/services/install.service';

@Component({
  selector: 'app-install-banner',
  template: `
    @if (install.showBanner()) {
      <aside class="banner" role="region" aria-label="Installer l'application">
        <p>
          <strong>Installez LSF Notes sur votre écran d'accueil</strong> : elle fonctionnera hors-ligne et vos signes
          seront mieux protégés contre l'effacement.
          @if (!install.canPrompt() && install.ios) {
            <br />
            Touchez
            <svg class="share" viewBox="0 0 24 24" role="img" aria-label="Partager">
              <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" />
            </svg>
            <strong>Partager</strong>, puis <strong>« Sur l'écran d'accueil »</strong>.
          }
        </p>
        <div class="actions">
          @if (install.canPrompt()) {
            <button type="button" class="primary" (click)="install.install()">Installer</button>
          }
          <button type="button" (click)="install.dismiss()">Plus tard</button>
        </div>
      </aside>
    }
  `,
  styles: `
    .banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      padding: 0.5rem 1rem;
      background: #eef2f7;
      border-bottom: 1px solid var(--color-border);
      font-size: 0.9rem;
    }
    p {
      flex: 1 1 280px;
      margin: 0;
    }
    .share {
      width: 1.1em;
      height: 1.1em;
      vertical-align: -0.2em;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
    }
    button {
      font: inherit;
      padding: 0.3rem 0.8rem;
      border-radius: 6px;
      border: 1px solid var(--color-border);
      background: #fff;
      cursor: pointer;
    }
    .primary {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallBannerComponent {
  protected readonly install = inject(InstallService);
}
