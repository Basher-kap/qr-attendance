// Registers the service worker (build/sw-template.js) that lets the installed app open and work
// with no internet. Only in the built app: during development it would keep serving old files.
export default () => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Without a service worker the app still works online, just not offline.
    });
  };

  // The app can finish starting after the page's "load" event, so do not only wait for it.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
};
