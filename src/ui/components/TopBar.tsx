import type { ReactNode } from 'react';
import { navigate } from '../router';
import { Icon } from './Icon';

export function TopBar({ title, actions, back = true }: { title: string; actions?: ReactNode; back?: boolean }) {
  return (
    <header className="topbar">
      {back && (
        <button className="btn btn-icon btn-plain" onClick={() => navigate({ name: 'library' })} aria-label="Back to Library">
          <Icon name="back" />
        </button>
      )}
      <h1 className="topbar-title">{title}</h1>
      {actions && <div className="topbar-actions">{actions}</div>}
    </header>
  );
}
