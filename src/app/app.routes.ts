import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Central de Comando · Sentinela GeoIA',
    loadComponent: () =>
      import('./presentation/views/pages/command-center/command-center.page').then(
        (m) => m.CommandCenterPage,
      ),
  },
  { path: '**', redirectTo: '' },
];
