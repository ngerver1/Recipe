import { useState } from 'react';
import { formatMinutes } from '../../core/format';
import { servingsLabel, timerCount } from '../../core/recipe';
import { startSession, toggleGathered } from '../../core/session';
import { unlockAudio } from '../../platform/audio';
import { getGathered, setGathered } from '../../platform/prefs';
import { findRecipe, setSession, updateSession, useAppState } from '../../state/store';
import { Icon } from '../components/Icon';
import { TopBar } from '../components/TopBar';
import { confirmDialog, hideToast } from '../components/overlays';
import { navigate } from '../router';
import { IngredientList } from './Cook';

/** "Before you start": everything about the recipe, ingredient ticks, and the big Start cooking button. */
export function PrepScreen({ id }: { id: string }) {
  const { loaded, session } = useAppState();
  const entry = findRecipe(id);
  const [localGathered, setLocalGathered] = useState(() => getGathered(id));

  if (!loaded) return <div className="screen" />;
  if (!entry?.recipe) {
    return (
      <div className="screen">
        <TopBar title="Recipe not found" />
        <main className="content">
          <p>This recipe isn’t saved on this device any more.</p>
        </main>
      </div>
    );
  }
  const recipe = entry.recipe;
  const thisSession = session?.recipeId === id ? session : null;
  const gathered = thisSession ? thisSession.gathered : localGathered;

  const toggle = (ingredientId: string) => {
    if (thisSession) {
      updateSession((s) => toggleGathered(s, ingredientId, Date.now()));
    } else {
      const next = gathered.includes(ingredientId) ? gathered.filter((g) => g !== ingredientId) : [...gathered, ingredientId];
      setLocalGathered(next);
      setGathered(id, next);
    }
  };

  const start = async () => {
    // Unlock sound within this tap: iPad Safari won't play the chime otherwise.
    unlockAudio();
    if (thisSession) {
      navigate({ name: thisSession.stage === 'finished' ? 'finished' : 'cook' });
      return;
    }
    if (session) {
      const other = findRecipe(session.recipeId)?.recipe?.title ?? 'another recipe';
      const ok = await confirmDialog({
        title: 'Stop the other cook?',
        body: <p>You’re partway through {other}. Starting this recipe clears your place and any timers there.</p>,
        confirm: 'Start this one',
        cancel: 'Keep it',
        danger: true,
      });
      if (!ok) return;
      unlockAudio();
    }
    hideToast();
    setSession(startSession({ recipeId: id, now: Date.now(), gathered }));
    setGathered(id, null);
    navigate({ name: 'cook' });
  };

  const startOver = async () => {
    const ok = await confirmDialog({
      title: 'Start over?',
      body: <p>This clears your place in the recipe and any timers.</p>,
      confirm: 'Start over',
      danger: true,
    });
    if (!ok) return;
    unlockAudio();
    hideToast();
    setSession(startSession({ recipeId: id, now: Date.now(), gathered: thisSession?.gathered ?? [] }));
    navigate({ name: 'cook' });
  };

  const t = recipe.times;
  const times = [
    t?.prepMinutes ? `Prep ${formatMinutes(t.prepMinutes)}` : null,
    t?.cookMinutes ? `Cook ${formatMinutes(t.cookMinutes)}` : null,
    t?.totalMinutes ? `Total ${formatMinutes(t.totalMinutes)}` : null,
  ].filter(Boolean);
  const timers = timerCount(recipe);
  const ingredientCount = recipe.ingredients?.length ?? 0;
  const source = recipe.source;
  const sourceText = [source?.site, source?.author].filter(Boolean).join(' · ');
  const sourceUrl = safeUrl(source?.url);

  return (
    <div className="screen prep">
      <TopBar title="Before you start" />
      <main className="content prep-content">
        <header className="prep-header">
          <h1 className="prep-title">{recipe.title}</h1>
          {(sourceText || sourceUrl) && (
            <p className="prep-source">
              {sourceUrl ? (
                <a href={sourceUrl.href} target="_blank" rel="noopener noreferrer">
                  {sourceText || sourceUrl.hostname}
                  <Icon name="link" size={18} />
                </a>
              ) : (
                sourceText
              )}
            </p>
          )}
          <ul className="facts">
            {servingsLabel(recipe) && <li>{servingsLabel(recipe)}</li>}
            {times.map((x) => (
              <li key={x}>{x}</li>
            ))}
            <li>
              {recipe.steps.length} steps{timers ? ` · ${timers} timer${timers === 1 ? '' : 's'}` : ''}
            </li>
          </ul>
        </header>

        <div className="prep-columns">
          <section className="prep-ingredients" aria-labelledby="ingredients-heading">
            <h2 id="ingredients-heading">
              Ingredients
              {ingredientCount > 0 && (
                <span className="count">
                  {gathered.filter((g) => recipe.ingredients?.some((i) => i.id === g)).length} of {ingredientCount} gathered
                </span>
              )}
            </h2>
            <IngredientList recipe={recipe} gathered={gathered} onToggle={toggle} />
          </section>
          <div className="prep-side">
            {!!recipe.equipment?.length && (
              <section aria-labelledby="equipment-heading">
                <h2 id="equipment-heading">Equipment</h2>
                <ul className="plain-list">
                  {recipe.equipment.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </section>
            )}
            {recipe.notes && (
              <section aria-labelledby="notes-heading">
                <h2 id="notes-heading">Notes</h2>
                <p className="notes">{recipe.notes}</p>
              </section>
            )}
          </div>
        </div>
      </main>
      <footer className="action-bar">
        {thisSession && (
          <button className="btn btn-plain btn-big" onClick={startOver}>
            Start over
          </button>
        )}
        <button className="btn btn-primary btn-big btn-start" onClick={start}>
          {thisSession
            ? thisSession.stage === 'finished'
              ? 'Back to the finish'
              : `Resume cooking · step ${thisSession.currentIndex + 1}`
            : 'Start cooking'}
        </button>
      </footer>
    </div>
  );
}

/** Only http(s) links are clickable. */
function safeUrl(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null;
  } catch {
    return null;
  }
}
