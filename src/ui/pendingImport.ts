import { useSyncExternalStore } from 'react';

/** Text from a file dropped anywhere in the app, handed to the Import screen. */
let pending: { text: string; name: string; id: number } | null = null;
let nextId = 0;
const listeners = new Set<() => void>();

export function setPendingImport(text: string, name: string) {
  pending = { text, name, id: ++nextId };
  listeners.forEach((l) => l());
}

export function takePendingImport() {
  const p = pending;
  pending = null;
  return p;
}

export function usePendingImport() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
  );
}
