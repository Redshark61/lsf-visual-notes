import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'carnet' },
  {
    path: 'atelier',
    title: 'Atelier · LSF Notes',
    loadComponent: () =>
      import('./features/sign-builder/sign-builder.component').then((m) => m.SignBuilderComponent),
  },
  {
    path: 'atelier/:id',
    title: 'Modifier un signe · LSF Notes',
    loadComponent: () =>
      import('./features/sign-builder/sign-builder.component').then((m) => m.SignBuilderComponent),
  },
  {
    path: 'dictionnaire',
    title: 'Dictionnaire · LSF Notes',
    loadComponent: () => import('./features/dictionary/dictionary.component').then((m) => m.DictionaryComponent),
  },
  {
    path: 'carnet',
    title: 'Carnet · LSF Notes',
    loadComponent: () => import('./features/notebook/notebook.component').then((m) => m.NotebookComponent),
  },
  {
    path: 'parametres',
    title: 'Paramètres · LSF Notes',
    loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
  // Ancienne adresse de la page Sauvegarde, désormais dans les Paramètres.
  { path: 'sauvegarde', redirectTo: 'parametres' },
  { path: '**', redirectTo: 'carnet' },
];
