import { useSyncExternalStore } from 'react';

/** Hash routes, because GitHub Pages can't send unknown paths back to the app. */
export type Route =
  | { name: 'library' }
  | { name: 'import' }
  | { name: 'recipe'; id: string }
  | { name: 'cook' }
  | { name: 'finished' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [first, second] = path.split('/');
  switch (first) {
    case 'import':
      return { name: 'import' };
    case 'recipe':
      return second ? { name: 'recipe', id: decodeURIComponent(second) } : { name: 'library' };
    case 'cook':
      return { name: 'cook' };
    case 'finished':
      return { name: 'finished' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'library' };
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'library':
      return '#/';
    case 'recipe':
      return `#/recipe/${encodeURIComponent(route.id)}`;
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const href = hrefFor(route);
  if (opts.replace) {
    history.replaceState(null, '', href);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (location.hash !== href) {
    location.hash = href;
  }
}

let current = parseHash(location.hash);
let currentHash = location.hash;

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener('hashchange', l);
      return () => window.removeEventListener('hashchange', l);
    },
    () => {
      if (location.hash !== currentHash) {
        currentHash = location.hash;
        current = parseHash(location.hash);
      }
      return current;
    },
  );
}
