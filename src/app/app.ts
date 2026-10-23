import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { StorageService } from './core/services/storage.service';
import { InstallBannerComponent } from './shared/install-banner/install-banner.component';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, InstallBannerComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  constructor() {
    inject(StorageService).requestPersistence();
  }
}
