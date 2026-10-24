import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'home', component: () => import('../pages/HomePage.vue') },
      { path: 'manage/:classId?', name: 'manage', component: () => import('../pages/ManagePage.vue') },
      { path: 'scan', name: 'scan', component: () => import('../pages/ScanPage.vue') },
      { path: 'confirm', name: 'confirm', component: () => import('../pages/ConfirmPage.vue') },
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('../pages/ErrorNotFound.vue'),
  },
];

export default routes;