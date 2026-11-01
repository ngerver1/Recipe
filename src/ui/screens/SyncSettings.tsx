import { useState } from 'react';
import { formatAgo } from '../../core/format';
import { SyncError } from '../../core/sync';
import { connectSync, disconnectSync, getSyncToken, syncNow, useSyncStatus } from '../../state/sync';
import { useAppState } from '../../state/store';
import { Icon } from '../components/Icon';
import { confirmDialog, showToast } from '../components/overlays';
import { useNow } from '../hooks';

const DEFAULT_REPO = 'ngerver1/recipe-data';

export function SyncSettings() {
  const status = useSyncStatus();
  const { recipes } = useAppState();
  const now = useNow(15_000);
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const paste = async () => {
    try {
      setToken((await navigator.clipboard.readText()).trim());
      setError('');
    } catch {
      setError('Couldn’t read the clipboard. Paste into the box instead.');
    }
  };

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const info = await connectSync(repo, token);
      setToken('');
      showToast(info.private ? 'Sync is on' : 'Sync is on. Note: that repository is public, so anyone can see your recipes.', {
        durationMs: info.private ? 3500 : 8000,
      });
    } catch (e) {
      setError(e instanceof SyncError ? e.message : 'Something went wrong. Check the repository name and key.');
    } finally {
      setBusy(false);
    }
  };

  if (!status.config) {
    return (
      <section className="settings-group">
        <h2>Sync between devices</h2>
        <p className="muted">
          Keep the same recipes on every device. They’re kept in a private GitHub repository of yours, and each device with the sync key keeps it up
          to date.
        </p>
        <label className="field">
          <span className="field-label">Repository</span>
          <input
            className="input"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="field-label">Sync key</span>
          <span className="input-row">
            <input
              className="input"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button className="btn btn-plain" type="button" onClick={paste}>
              <Icon name="paste" />
              Paste
            </button>
          </span>
        </label>
        <button className="btn btn-primary" onClick={connect} disabled={busy || !token.trim()}>
          {busy ? 'Connecting…' : 'Turn on sync'}
        </button>
        {error && <p className="error-text">{error}</p>}
        <details className="howto">
          <summary>How to make a sync key</summary>
          <ol>
            <li>
              Open{' '}
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                GitHub’s new fine-grained token page
              </a>
              .
            </li>
            <li>Name it “Recipe Cards sync”. Pick an expiry; the app tells you when the key stops working.</li>
            <li>
              Under <strong>Repository access</strong>, choose <strong>Only select repositories</strong> and pick <strong>{repo || DEFAULT_REPO}</strong>.
            </li>
            <li>
              Under <strong>Permissions</strong>, add <strong>Contents</strong> and set it to <strong>Read and write</strong>.
            </li>
            <li>Tap Generate token, copy it, and paste it above. Use the same key on each device.</li>
          </ol>
        </details>
      </section>
    );
  }

  const stateText = {
    off: 'Off',
    idle: status.lastSyncedAt ? `Up to date · synced ${formatAgo(now - status.lastSyncedAt)}` : 'On',
    syncing: 'Syncing…',
    error: 'Not syncing',
    offline: 'Offline · changes will sync when you’re back online',
  }[status.state];

  const copyKey = async () => {
    const key = getSyncToken();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      showToast('Sync key copied. Paste it into Settings on your other device.', { durationMs: 5000 });
    } catch {
      showToast('Couldn’t copy the key on this device.');
    }
  };

  const turnOff = async () => {
    const ok = await confirmDialog({
      title: 'Turn off sync on this device?',
      body: <p>Recipes stay on this device and on GitHub. Changes here won’t reach your other devices until you turn sync back on.</p>,
      confirm: 'Turn off',
      danger: true,
    });
    if (ok) disconnectSync();
  };

  return (
    <section className="settings-group">
      <h2>Sync between devices</h2>
      <p className={`status-line${status.state === 'error' ? ' error-text' : ''}`}>
        <Icon name={status.state === 'error' ? 'x' : 'check'} size={20} /> {stateText}
      </p>
      {status.message && status.state !== 'idle' && <p className={status.state === 'error' ? 'error-text' : 'muted'}>{status.message}</p>}
      <p className="muted small">
        {recipes.length} recipe{recipes.length === 1 ? '' : 's'} · stored in {status.config.repo} on GitHub
      </p>
      <div className="button-row">
        <button className="btn btn-primary" onClick={() => void syncNow()} disabled={status.state === 'syncing'}>
          Sync now
        </button>
        <button className="btn btn-plain" onClick={copyKey}>
          Copy sync key
        </button>
        <button className="btn btn-plain" onClick={turnOff}>
          Turn off
        </button>
      </div>
      <p className="muted small">To add another device, open Settings there, turn on sync and paste the same key.</p>
    </section>
  );
}
