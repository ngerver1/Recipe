import { useRef, useState } from 'react';
import { SUPPORTED_VERSION } from '../../core/schema';
import { extractJson } from '../../core/parse';
import { testChime } from '../../platform/audio';
import { isAppleTouchDevice, refreshKeepAwake, useKeepAwakeStatus } from '../../platform/keepAwake';
import {
  getKeepAwakeMode,
  getThemePref,
  setKeepAwakeMode,
  setThemePref,
  type KeepAwakeMode,
  type ThemePref,
} from '../../platform/prefs';
import { useAppState } from '../../state/store';
import { useSyncStatus } from '../../state/sync';
import { canShareFiles, downloadBackup, restoreBackup, shareBackup } from '../backupActions';
import { Icon } from '../components/Icon';
import { showToast } from '../components/overlays';
import { TopBar } from '../components/TopBar';
import { SyncSettings } from './SyncSettings';
import { navigate } from '../router';

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} className={`segment${value === v ? ' is-selected' : ''}`} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function SettingsScreen({ updateReady, onUpdate }: { updateReady: boolean; onUpdate: () => void }) {
  const { recipes, persisted } = useAppState();
  const sync = useSyncStatus();
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [keepAwake, setKeepAwake] = useState<KeepAwakeMode>(getKeepAwakeMode);
  const status = useKeepAwakeStatus();
  const fileInput = useRef<HTMLInputElement>(null);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

  const restore = async (file: File | undefined) => {
    if (!file) return;
    const extracted = extractJson(await file.text());
    if (!extracted.ok || extracted.values.length !== 1) {
      showToast('That file isn’t a Recipe Cards backup.', { durationMs: 5000 });
      return;
    }
    if (await restoreBackup(extracted.values[0])) navigate({ name: 'library' });
  };

  const wakeLockText = {
    holding: 'on',
    released: 'released, asking again',
    refused: 'refused by this device',
    unsupported: 'not available in this browser',
    off: 'off',
  }[status.wakeLock];
  const videoText = { playing: 'playing', 'waiting-for-tap': 'starts on your next tap', off: 'not needed here' }[status.video];
  const appleDevice = isAppleTouchDevice();

  return (
    <div className="screen settings">
      <TopBar title="Settings" />
      <main className="content settings-content">
        <section className="settings-group">
          <h2>Theme</h2>
          <Segmented
            label="Theme"
            value={theme}
            options={[
              ['system', 'Match device'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
            onChange={(v) => {
              setTheme(v);
              setThemePref(v);
            }}
          />
        </section>

        <SyncSettings />

        <section className="settings-group">
          <h2>Keep the screen on</h2>
          <p className="muted">The screen stays on whenever this app is open.</p>
          <ul className="plain-list status-line">
            <li>
              <strong>Screen Wake Lock:</strong> {wakeLockText}
            </li>
            <li>
              <strong>Silent video:</strong> {videoText}
            </li>
          </ul>
          <Segmented
            label="Silent video"
            value={keepAwake}
            options={[
              ['auto', appleDevice ? 'Automatic (on for iPad)' : 'Only if needed'],
              ['video', 'Always'],
            ]}
            onChange={(v) => {
              setKeepAwake(v);
              setKeepAwakeMode(v);
              refreshKeepAwake();
            }}
          />
          <p className="muted small">
            The silent video is an invisible, soundless clip that plays in the background, because iPads and phones stay awake while a video plays. It
            starts on your first tap after opening the app. If the screen still turns off on this device, choose Always.
          </p>
        </section>

        <section className="settings-group">
          <h2>Sound</h2>
          <p className="muted">The chime repeats when a timer ends, for up to 2 minutes. The Pixel also vibrates.</p>
          <button className="btn btn-plain" onClick={testChime}>
            <Icon name="sound" />
            Test the chime
          </button>
        </section>

        <section className="settings-group">
          <h2>Backup</h2>
          <p className="muted">
            {recipes.length} recipe{recipes.length === 1 ? '' : 's'} on this device.{' '}
            {sync.config
              ? 'Sync keeps a copy on GitHub too. A backup file is an extra copy you control.'
              : 'Without sync, recipes are stored only on this device, so keep a backup file somewhere safe, like Files or Google Drive.'}
          </p>
          <div className="button-row">
            {canShareFiles() && (
              <button className="btn btn-primary" onClick={shareBackup} disabled={!recipes.length}>
                <Icon name="share" />
                Share backup…
              </button>
            )}
            <button className={`btn ${canShareFiles() ? 'btn-plain' : 'btn-primary'}`} onClick={downloadBackup} disabled={!recipes.length}>
              <Icon name="download" />
              Download backup
            </button>
            <button className="btn btn-plain" onClick={() => fileInput.current?.click()}>
              <Icon name="upload" />
              Restore from backup
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                void restore(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <p className="muted small">On the iPad, choose Share backup… then Save to Files. Restoring never deletes anything; recipes already here are kept.</p>
        </section>

        <section className="settings-group">
          <h2>About</h2>
          <ul className="plain-list small">
            <li>Storage: {persisted === true ? 'protected from automatic clearing' : persisted === false ? 'may be cleared by the browser if space runs low' : 'unknown'}</li>
            <li>{standalone ? 'Running as an installed app' : 'Running in a browser tab. Install it to the Home Screen for best results.'}</li>
            <li>Reads recipe format version {SUPPORTED_VERSION}</li>
            <li>
              <a href="recipe-cards.v1.schema.json" target="_blank" rel="noopener">
                Format schema (JSON)
              </a>
            </li>
            <li>App version {__APP_VERSION__}</li>
          </ul>
          {updateReady && (
            <button className="btn btn-primary" onClick={onUpdate}>
              Update to the new version
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
