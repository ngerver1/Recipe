import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from './Icon';

/* ---------- tiny external stores for dialogs and toasts ---------- */

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      listeners.forEach((l) => l());
    },
    use: () =>
      useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => value,
      ),
  };
}

/* ---------- dialogs ---------- */

export interface DialogAction {
  label: string;
  value: string;
  kind?: 'primary' | 'danger' | 'plain';
}

interface DialogRequest {
  title: string;
  body?: ReactNode;
  actions: DialogAction[];
  resolve: (value: string | null) => void;
}

const dialogs = createStore<DialogRequest | null>(null);

/** Shows a dialog and resolves with the chosen action's value, or null if dismissed. */
export function ask(opts: { title: string; body?: ReactNode; actions: DialogAction[] }): Promise<string | null> {
  dialogs.get()?.resolve(null);
  return new Promise((resolve) => dialogs.set({ ...opts, resolve }));
}

export async function confirmDialog(opts: {
  title: string;
  body?: ReactNode;
  confirm: string;
  cancel?: string;
  danger?: boolean;
}): Promise<boolean> {
  const answer = await ask({
    title: opts.title,
    body: opts.body,
    actions: [
      { label: opts.cancel ?? 'Cancel', value: 'cancel', kind: 'plain' },
      { label: opts.confirm, value: 'ok', kind: opts.danger ? 'danger' : 'primary' },
    ],
  });
  return answer === 'ok';
}

export function DialogHost() {
  const request = dialogs.use();
  const firstButton = useRef<HTMLButtonElement>(null);
  const close = (value: string | null) => {
    dialogs.set(null);
    request?.resolve(value);
  };

  useEffect(() => {
    if (!request) return;
    firstButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dialogs.set(null);
        request.resolve(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);

  if (!request) return null;

  return (
    <div className="overlay overlay-center" onClick={(e) => e.target === e.currentTarget && close(null)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{request.title}</h2>
        {request.body && <div className="dialog-body">{request.body}</div>}
        <div className="dialog-actions">
          {request.actions.map((a, i) => (
            <button
              key={a.value}
              ref={i === 0 ? firstButton : undefined}
              className={`btn ${a.kind === 'danger' ? 'btn-danger' : a.kind === 'primary' ? 'btn-primary' : 'btn-plain'}`}
              onClick={() => close(a.value)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- toasts ---------- */

interface Toast {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  placement: 'bottom' | 'cook';
}

const toasts = createStore<Toast | null>(null);
let toastTimer: number | undefined;
let toastId = 0;

export function showToast(
  message: string,
  opts: { action?: Toast['action']; durationMs?: number; placement?: Toast['placement'] } = {},
): void {
  window.clearTimeout(toastTimer);
  const id = ++toastId;
  toasts.set({ id, message, ...(opts.action ? { action: opts.action } : {}), placement: opts.placement ?? 'bottom' });
  toastTimer = window.setTimeout(() => {
    if (toasts.get()?.id === id) toasts.set(null);
  }, opts.durationMs ?? 3500);
}

export function hideToast(): void {
  window.clearTimeout(toastTimer);
  toasts.set(null);
}

export function ToastHost() {
  const toast = toasts.use();
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.placement}`} role="status" key={toast.id}>
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          className="btn btn-toast"
          onClick={() => {
            toast.action!.onClick();
            hideToast();
          }}
        >
          <Icon name="undo" />
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

/* ---------- sheets ---------- */

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [opened] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opened?.focus?.();
    };
  }, [onClose, opened]);

  return (
    <div className="overlay overlay-sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-header">
          <h2>{title}</h2>
          <button ref={closeButton} className="btn btn-icon btn-plain" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-footer">{footer}</footer>}
      </section>
    </div>
  );
}
