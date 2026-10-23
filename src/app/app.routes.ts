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
    path: 'sauvegarde',
    title: 'Sauvegarde · LSF Notes',
    loadComponent: () => import('./features/backup/backup.component').then((m) => m.BackupComponent),
  },
  { path: '**', redirectTo: 'carnet' },
];
