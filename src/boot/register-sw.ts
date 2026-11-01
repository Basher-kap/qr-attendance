import { defineBoot } from '#q-app';
import { setUpdateHandler } from '../lib/app-update';

// Registers the service worker that keeps the app available offline. Only in the built app:
// the dev server does not use it.
export default defineBoot(() => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const start = () => {
    const hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        const announce = (worker: ServiceWorker) =>
          setUpdateHandler(() => worker.postMessage('SKIP_WAITING'));

        // A new version was downloaded earlier and is waiting.
        if (registration.waiting && hadController) announce(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              announce(worker);
            }
          });
        });
      })
      .catch(() => {
        /* the app still works online without it */
      });

    // The first install also takes control of the page. Only reload for a real update.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
  };

  // Boot files run after the first render, so the page may already be fully loaded.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
});
