import { useEffect } from 'react';
import { goToStep } from '../../core/session';
import { isFinished, isRunning } from '../../core/timers';
import { findRecipe, setSession, useAppState } from '../../state/store';
import { Icon } from '../components/Icon';
import { confirmDialog, hideToast } from '../components/overlays';
import { TimerTray } from '../components/timers';
import { useNow } from '../hooks';
import { navigate } from '../router';
import { undoLastDone } from './Cook';

export function FinishedScreen() {
  const { loaded, session } = useAppState();
  const recipe = findRecipe(session?.recipeId)?.recipe;
  const now = useNow(1000);

  useEffect(() => {
    if (!loaded) return;
    if (!session || !recipe) navigate({ name: 'library' }, { replace: true });
    else if (session.stage !== 'finished') navigate({ name: 'cook' }, { replace: true });
  }, [loaded, session, recipe]);

  if (!session || !recipe || session.stage !== 'finished') return <div className="screen" />;

  const live = session.timers.filter((t) => isRunning(t, now) || isFinished(t, now) || t.remainingMs !== null);

  const finish = async () => {
    if (live.length) {
      const ok = await confirmDialog({
        title: 'Timers are still going',
        body: <p>Going back to the Library cancels {live.length === 1 ? `the ${live[0]!.label} timer` : `${live.length} timers`}.</p>,
        confirm: 'Cancel them',
        cancel: 'Keep them',
        danger: true,
      });
      if (!ok) return;
    }
    hideToast();
    setSession(null);
    navigate({ name: 'library' }, { replace: true });
  };

  const backToLastStep = () => {
    if (session.undo) {
      undoLastDone();
      return;
    }
    setSession(goToStep(session, recipe.steps.length - 1, recipe.steps.length, Date.now()));
    navigate({ name: 'cook' }, { replace: true });
  };

  const cookedOn = new Date(session.finishedAt ?? Date.now()).toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="screen finished">
      {session.timers.length > 0 && (
        <div className="finished-tray">
          <TimerTray session={session} />
        </div>
      )}
      <main className="finished-content">
        <div className="finished-mark" aria-hidden="true">
          <Icon name="check" size={88} />
        </div>
        <h1>Done</h1>
        <p className="finished-title">{recipe.title}</p>
        <p className="muted">Cooked {cookedOn}. Enjoy!</p>
        <button className="btn btn-primary btn-big" onClick={finish}>
          Back to Library
        </button>
        <button className="btn btn-plain" onClick={backToLastStep}>
          Go back to the last step
        </button>
      </main>
    </div>
  );
}
