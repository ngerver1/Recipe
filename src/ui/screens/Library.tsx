import { useMemo, useState } from 'react';
import sample from '../../../examples/pressure-cooker-beef-stew.json';
import { formatClock, formatLastCooked, formatMinutes } from '../../core/format';
import { matchesSearch } from '../../core/library';
import { totalMinutes } from '../../core/recipe';
import { isFinished, sortForTray, timeLeft } from '../../core/timers';
import { validateRecipe } from '../../core/validate';
import { findRecipe, removeRecipe, saveRecipe, setSession, useAppState, type LoadedRecipe } from '../../state/store';
import { Icon } from '../components/Icon';
import { confirmDialog, hideToast, showToast } from '../components/overlays';
import { useSyncStatus } from '../../state/sync';
import { useNow } from '../hooks';
import { navigate } from '../router';

export function LibraryScreen({ updateReady, onUpdate }: { updateReady: boolean; onUpdate: () => void }) {
  const { loaded, recipes, session, storageError } = useAppState();
  const sync = useSyncStatus();
  const [query, setQuery] = useState('');
  const now = useNow(1000, !!session?.timers.length);

  const shown = useMemo(() => recipes.filter((r) => !r.recipe || matchesSearch(r.recipe, query)), [recipes, query]);

  const addSample = async () => {
    const result = validateRecipe(sample);
    if (!result.ok) return;
    await saveRecipe(sample, result.recipe);
    showToast('Added the sample recipe');
  };

  return (
    <div className="screen library">
      <header className="topbar">
        <h1 className="topbar-title app-name">Recipe Cards</h1>
        <div className="topbar-actions">
          <button className="btn btn-icon btn-plain" onClick={() => navigate({ name: 'settings' })} aria-label="Settings">
            <Icon name="settings" />
          </button>
          <button className="btn btn-primary" onClick={() => navigate({ name: 'import' })}>
            <Icon name="download" />
            Import
          </button>
        </div>
      </header>

      <main className="content">
        {storageError && <p className="banner banner-error">{storageError}</p>}
        {sync.state === 'error' && (
          <div className="banner banner-error">
            <span>Sync isn’t working: {sync.message}</span>
            <button className="btn btn-plain" onClick={() => navigate({ name: 'settings' })}>
              Settings
            </button>
          </div>
        )}
        {updateReady && (
          <div className="banner banner-info">
            <span>A new version of the app is ready.</span>
            <button className="btn btn-plain" onClick={onUpdate}>
              Update now
            </button>
          </div>
        )}
        {session && <ResumeBanner now={now} />}

        {loaded && recipes.length > 0 && (
          <div className="search">
            <Icon name="search" />
            <input
              className="input search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles, sites, ingredients"
              aria-label="Search recipes"
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
        )}

        {loaded && recipes.length === 0 && (
          <section className="empty">
            <h2>No recipes yet</h2>
            <p>
              Give the <strong>recipe-cards</strong> agent in Claude a recipe link. Copy its reply, then tap <strong>Import</strong> and{' '}
              <strong>Paste</strong>.
            </p>
            <div className="empty-actions">
              <button className="btn btn-primary btn-big" onClick={() => navigate({ name: 'import' })}>
                <Icon name="download" />
                Import a recipe
              </button>
              <button className="btn btn-plain btn-big" onClick={addSample}>
                Add the sample recipe
              </button>
            </div>
            <p className="muted small">The sample is {sample.title} from {sample.source.site}.</p>
          </section>
        )}

        {query && shown.length === 0 && <p className="muted">No recipes match “{query}”.</p>}

        <ul className="recipe-list">
          {shown.map((item) => (
            <RecipeRow key={item.record.id} item={item} now={now} />
          ))}
        </ul>
      </main>
    </div>
  );
}

function ResumeBanner({ now }: { now: number }) {
  const { session } = useAppState();
  const recipe = findRecipe(session?.recipeId)?.recipe;
  if (!session || !recipe) return null;
  const timers = sortForTray(session.timers, now);
  const finished = session.stage === 'finished';

  const end = async () => {
    const ok = await confirmDialog({
      title: 'Stop cooking?',
      body: <p>This clears your place in {recipe.title}{timers.length ? ' and cancels its timers' : ''}.</p>,
      confirm: 'Stop cooking',
      cancel: 'Keep it',
      danger: true,
    });
    if (ok) {
      hideToast();
      setSession(null);
    }
  };

  return (
    <section className="resume" aria-label="Cook in progress">
      <div className="resume-text">
        <p className="resume-label">{finished ? 'Just finished' : 'Cooking now'}</p>
        <p className="resume-title">{recipe.title}</p>
        <p className="resume-detail">
          {finished ? 'All steps done' : `Step ${session.currentIndex + 1} of ${recipe.steps.length}`}
          {timers.map((t) => (
            <span key={t.id} className={`resume-timer${isFinished(t, now) ? ' is-ringing' : ''}`}>
              <Icon name="timer" size={18} />
              {t.label} {isFinished(t, now) ? 'done' : formatClock(timeLeft(t, now))}
            </span>
          ))}
        </p>
      </div>
      <div className="resume-actions">
        <button className="btn btn-plain" onClick={end}>
          Stop
        </button>
        <button className="btn btn-primary btn-big" onClick={() => navigate({ name: finished ? 'finished' : 'cook' })}>
          {finished ? 'Open' : 'Resume cooking'}
        </button>
      </div>
    </section>
  );
}

function RecipeRow({ item, now }: { item: LoadedRecipe; now: number }) {
  const { recipe, record } = item;
  const title = recipe?.title ?? 'Unreadable recipe';

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${title}”?`,
      body: <p>It’s removed from this device. You can import it again later.</p>,
      confirm: 'Delete',
      danger: true,
    });
    if (ok) {
      await removeRecipe(record.id);
      showToast(`Deleted ${title}`);
    }
  };

  const minutes = recipe ? totalMinutes(recipe) : undefined;
  const details = [recipe?.source?.site, minutes ? formatMinutes(minutes) : null, formatLastCooked(record.lastCookedAt, now || Date.now())].filter(
    Boolean,
  );

  return (
    <li className="recipe-row">
      <button className="recipe-open" onClick={() => recipe && navigate({ name: 'recipe', id: record.id })} disabled={!recipe}>
        <span className="recipe-title">{title}</span>
        <span className="recipe-details">{recipe ? details.join(' · ') : item.problems?.[0]}</span>
      </button>
      <button className="btn btn-icon btn-plain recipe-delete" onClick={remove} aria-label={`Delete ${title}`}>
        <Icon name="trash" />
      </button>
    </li>
  );
}
