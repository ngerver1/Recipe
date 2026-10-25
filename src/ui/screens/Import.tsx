import { useEffect, useRef, useState } from 'react';
import { formatTimerLength } from '../../core/format';
import { readImport, type ImportCandidate, type ImportReadResult } from '../../core/importer';
import { servingsLabel, timerCount } from '../../core/recipe';
import { getState, saveRecipe } from '../../state/store';
import { restoreBackup } from '../backupActions';
import { Icon } from '../components/Icon';
import { ask, showToast } from '../components/overlays';
import { TopBar } from '../components/TopBar';
import { useMediaQuery } from '../hooks';
import { takePendingImport, usePendingImport } from '../pendingImport';
import { navigate } from '../router';

type RecipeCandidate = Extract<ImportCandidate, { kind: 'recipe'; ok: true }>;

/** Asks "Replace or keep both?" when the recipe is already saved. Returns the id to replace, '' to add, or null to cancel. */
async function chooseReplace(candidate: RecipeCandidate): Promise<string | null> {
  const existing = getState().recipes.find((r) => r.record.dedupeKey === candidate.dedupeKey);
  if (!existing) return '';
  const imported = new Date(existing.record.importedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const answer = await ask({
    title: 'You already have this recipe',
    body: (
      <p>
        “{existing.recipe?.title ?? candidate.recipe.title}” was imported on {imported}. Replace it with this version, or keep both?
      </p>
    ),
    actions: [
      { label: 'Cancel', value: 'cancel', kind: 'plain' },
      { label: 'Keep both', value: 'both', kind: 'plain' },
      { label: 'Replace', value: 'replace', kind: 'primary' },
    ],
  });
  if (answer === 'replace') return existing.record.id;
  if (answer === 'both') return '';
  return null;
}

export function ImportScreen() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportReadResult | null>(null);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<Record<number, string>>({});
  const [dragging, setDragging] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const finePointer = useMediaQuery('(pointer: fine)');
  const pending = usePendingImport();

  const process = (value: string, source?: string) => {
    setText(value);
    setSaved({});
    setMessage(source ? `Read ${source}.` : '');
    setResult(value.trim() ? readImport(value) : null);
  };

  useEffect(() => {
    if (!pending) return;
    const p = takePendingImport();
    if (p) process(p.text, p.name);
  }, [pending]);

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        setMessage('The clipboard is empty. Copy the agent’s reply first.');
        return;
      }
      process(clip);
    } catch {
      setMessage('Couldn’t read the clipboard. Paste into the box below instead.');
      textarea.current?.focus();
    }
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    process(await file.text(), file.name);
  };

  const save = async (index: number, candidate: RecipeCandidate, then: 'stay' | 'library' | 'cook') => {
    const replaceId = await chooseReplace(candidate);
    if (replaceId === null) return;
    const record = await saveRecipe(candidate.raw, candidate.recipe, replaceId || undefined);
    setSaved((s) => ({ ...s, [index]: record.id }));
    if (then === 'cook') navigate({ name: 'recipe', id: record.id });
    else if (then === 'library') {
      showToast(`Saved ${candidate.recipe.title}`);
      navigate({ name: 'library' });
    }
  };

  const candidates = result?.ok ? result.candidates : [];
  const valid = candidates.flatMap((c, i) => (c.kind === 'recipe' && c.ok ? [{ c, i }] : []));
  const single = candidates.length === 1;

  const saveAll = async () => {
    for (const { c, i } of valid) {
      if (!saved[i]) await save(i, c, 'stay');
    }
    showToast(`Saved ${valid.length} recipes`);
    navigate({ name: 'library' });
  };

  return (
    <div
      className={`screen import${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        void openFile(e.dataTransfer.files[0]);
      }}
    >
      <TopBar title="Import" />
      <main className="content">
        <div className="import-actions">
          <button className="btn btn-primary btn-big" onClick={paste}>
            <Icon name="paste" />
            Paste
          </button>
          <button className="btn btn-plain btn-big" onClick={() => fileInput.current?.click()}>
            <Icon name="file" />
            Open file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json,text/plain"
            hidden
            onChange={(e) => {
              void openFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        {finePointer && <p className="muted drop-hint">Or drop a .json file anywhere on this page.</p>}
        {message && <p className="import-message">{message}</p>}

        <label className="field">
          <span className="field-label">Or paste the agent’s reply here</span>
          <textarea
            ref={textarea}
            className="input paste-box"
            value={text}
            onChange={(e) => process(e.target.value)}
            placeholder="Paste the whole reply. Extra text around the JSON is fine."
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>

        {result && !result.ok && <p className="banner banner-error">{result.error}</p>}

        {valid.length > 1 && (
          <div className="import-summary">
            <p>
              Found {candidates.length} recipes{valid.length < candidates.length ? `, ${valid.length} can be imported` : ''}.
            </p>
            <button className="btn btn-primary" onClick={saveAll}>
              Save all {valid.length}
            </button>
          </div>
        )}

        {candidates.map((c, i) =>
          c.kind === 'backup' ? (
            <section key={i} className="preview">
              <h2>Backup file</h2>
              <p>
                This is a Recipe Cards backup with {c.count} recipe{c.count === 1 ? '' : 's'}. Restoring adds them to this device without removing
                anything.
              </p>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (await restoreBackup(c.raw)) navigate({ name: 'library' });
                }}
              >
                Restore backup
              </button>
            </section>
          ) : c.ok ? (
            <Preview
              key={i}
              candidate={c}
              savedId={saved[i]}
              onSave={() => save(i, c, single ? 'library' : 'stay')}
              onCook={() => (saved[i] ? navigate({ name: 'recipe', id: saved[i] }) : save(i, c, 'cook'))}
            />
          ) : (
            <section key={i} className="preview preview-error">
              <h2>Can’t import {c.title ? `“${c.title}”` : 'this recipe'}</h2>
              <ul className="problem-list">
                {c.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {!c.errors.some((e) => e.includes('format version')) && <p className="muted">Ask the agent to try again, then paste its new reply.</p>}
            </section>
          ),
        )}
      </main>
    </div>
  );
}

function Preview({
  candidate,
  savedId,
  onSave,
  onCook,
}: {
  candidate: RecipeCandidate;
  savedId?: string;
  onSave: () => void;
  onCook: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const { recipe, warnings } = candidate;
  const timers = timerCount(recipe);
  const source = [recipe.source?.site, recipe.source?.author].filter(Boolean).join(' · ');
  const shownWarnings = showAll ? warnings : warnings.slice(0, 4);

  return (
    <section className="preview">
      <h2 className="preview-title">{recipe.title}</h2>
      {(source || recipe.source?.url) && (
        <p className="muted">
          {source}
          {recipe.source?.url && (
            <>
              {source ? ' · ' : ''}
              <span className="url">{recipe.source.url}</span>
            </>
          )}
        </p>
      )}
      <ul className="facts">
        {servingsLabel(recipe) && <li>{servingsLabel(recipe)}</li>}
        <li>{recipe.steps.length} steps</li>
        <li>
          {timers} timer{timers === 1 ? '' : 's'}
        </li>
        {!!recipe.ingredients?.length && <li>{recipe.ingredients.length} ingredients</li>}
      </ul>

      {warnings.length > 0 && (
        <div className="warnings">
          <p className="warnings-title">
            Imported with {warnings.length} warning{warnings.length === 1 ? '' : 's'}:
          </p>
          <ul className="problem-list">
            {shownWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {warnings.length > shownWarnings.length && (
            <button className="btn btn-plain btn-small" onClick={() => setShowAll(true)}>
              Show {warnings.length - shownWarnings.length} more
            </button>
          )}
        </div>
      )}

      <ol className="preview-steps">
        {recipe.steps.slice(0, 2).map((s) => (
          <li key={s.id}>
            <strong>{s.title}</strong>
            {s.timer && <span className="muted"> · {formatTimerLength(s.timer.seconds, s.timer.maxSeconds)}</span>}
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
      {recipe.steps.length > 2 && <p className="muted small">…and {recipe.steps.length - 2} more steps.</p>}

      <div className="preview-actions">
        {savedId ? (
          <span className="saved-note">
            <Icon name="check" /> Saved
          </span>
        ) : (
          <button className="btn btn-plain btn-big" onClick={onSave}>
            Save
          </button>
        )}
        <button className="btn btn-primary btn-big" onClick={onCook}>
          Cook now
        </button>
      </div>
    </section>
  );
}
