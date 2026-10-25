import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { formatTimerLength } from '../../core/format';
import { groupIngredients, ingredientLabel, ingredientMap, useLabel } from '../../core/recipe';
import type { Recipe, Step } from '../../core/schema';
import { goToStep, markDone, toggleGathered, toggleStepDone, undoDone, type CookSession } from '../../core/session';
import { isFinished, isRunning } from '../../core/timers';
import { unlockAudio, useAudioReady } from '../../platform/audio';
import { findRecipe, getState, markCooked, updateSession, useAppState } from '../../state/store';
import { Icon } from '../components/Icon';
import { confirmDialog, hideToast, Sheet, showToast } from '../components/overlays';
import { QuickTimerSheet, TimerControl, TimerTray } from '../components/timers';
import { useMediaQuery, withTransition } from '../hooks';
import { navigate } from '../router';

type SheetName = 'ingredients' | 'steps' | 'timer' | null;

/** Undo for the last Done. Works from cook mode and from the Finished screen. */
export function undoLastDone() {
  const session = getState().session;
  if (!session?.undo) return;
  const wasFinished = session.stage === 'finished';
  const apply = () => updateSession((s) => undoDone(s, Date.now()));
  if (wasFinished) {
    apply();
    navigate({ name: 'cook' }, { replace: true });
  } else {
    withTransition(apply, 'back');
  }
}

export function CookScreen() {
  const { session, loaded } = useAppState();
  const entry = findRecipe(session?.recipeId);
  const recipe = entry?.recipe;

  useEffect(() => {
    if (!loaded) return;
    if (!session || !recipe) navigate({ name: 'library' }, { replace: true });
    else if (session.stage === 'finished') navigate({ name: 'finished' }, { replace: true });
  }, [loaded, session, recipe]);

  if (!session || !recipe || session.stage !== 'cook') return <div className="screen" />;
  return <CookView session={session} recipe={recipe} />;
}

function CookView({ session, recipe }: { session: CookSession; recipe: Recipe }) {
  const [sheet, setSheet] = useState<SheetName>(null);
  const landscape = useMediaQuery('(orientation: landscape)');
  const audioReady = useAudioReady();
  const steps = recipe.steps;
  const index = Math.min(session.currentIndex, steps.length - 1);
  const step = steps[index]!;
  const prev = steps[index - 1];
  const next = steps[index + 1];
  const doneCount = steps.filter((s) => session.done.includes(s.id)).length;

  const go = (to: number) =>
    withTransition(() => updateSession((s) => goToStep(s, to, steps.length, Date.now())), to < index ? 'back' : 'forward');

  const done = () => {
    unlockAudio();
    const isLast = index >= steps.length - 1;
    const title = step.title;
    if (isLast) {
      updateSession((s) => markDone(s, steps, Date.now()));
      void markCooked(session.recipeId);
      navigate({ name: 'finished' }, { replace: true });
    } else {
      withTransition(() => updateSession((s) => markDone(s, steps, Date.now())));
    }
    showToast(`Done: ${title}`, { action: { label: 'Undo', onClick: undoLastDone }, durationMs: 5000, placement: 'cook' });
  };

  const exit = async () => {
    const now = Date.now();
    const running = session.timers.filter((t) => isRunning(t, now) || isFinished(t, now) || t.remainingMs !== null);
    if (running.length) {
      const ok = await confirmDialog({
        title: 'Leave cook mode?',
        body: (
          <p>
            {running.length === 1 ? `The ${running[0]!.label} timer is` : `${running.length} timers are`} still going. They keep running and
            will still ring while the app is open. Resume cooking from the Library.
          </p>
        ),
        confirm: 'Leave',
        cancel: 'Stay',
      });
      if (!ok) return;
    }
    hideToast();
    navigate({ name: 'library' });
  };

  // Swipe left/right (or up/down in portrait) as an extra; taps do everything too.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 80 && Math.abs(dx) > 2 * Math.abs(dy)) {
      if (dx < 0 && next) go(index + 1);
      if (dx > 0 && prev) go(index - 1);
    }
  };

  return (
    <div className="screen cook">
      <div className="cook-top">
        <div className="cook-heading">
          <h1 className="cook-title">{recipe.title}</h1>
          <p className="cook-count">
            Step {index + 1} of {steps.length}
          </p>
        </div>
        {session.timers.length > 0 && <TimerTray session={session} />}
        <nav className="cook-actions" aria-label="Cook mode">
          {!audioReady && (
            <button className="btn btn-sound" onClick={() => unlockAudio()}>
              <Icon name="soundOff" />
              <span>Tap for sound</span>
            </button>
          )}
          <button className="btn btn-icon-label" onClick={() => setSheet('timer')} aria-label="Add a timer">
            <Icon name="plus" />
            <span>Timer</span>
          </button>
          <button className="btn btn-icon-label" onClick={() => setSheet('ingredients')}>
            <Icon name="basket" />
            <span>Ingredients</span>
          </button>
          <button className="btn btn-icon-label" onClick={() => setSheet('steps')}>
            <Icon name="steps" />
            <span>Steps</span>
          </button>
          <button className="btn btn-icon-label" onClick={exit}>
            <Icon name="exit" />
            <span>Exit</span>
          </button>
        </nav>
        <div
          className="progress"
          role="progressbar"
          aria-label="Steps done"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
        >
          <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </div>

      <main className="cards" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipe.current = null)}>
        {prev ? (
          <SideCard kind="prev" step={prev} index={index - 1} done={session.done.includes(prev.id)} landscape={landscape} onClick={() => go(index - 1)} />
        ) : (
          <div className="card card-side card-empty card-prev-slot">{landscape && <p>First step</p>}</div>
        )}
        <CurrentCard session={session} recipe={recipe} step={step} index={index} onDone={done} />
        {next ? (
          <SideCard kind="next" step={next} index={index + 1} done={session.done.includes(next.id)} landscape={landscape} onClick={() => go(index + 1)} />
        ) : (
          <div className="card card-side card-empty card-next-slot">
            <p>{landscape ? 'Last step. Done finishes the recipe.' : 'Last step'}</p>
          </div>
        )}
      </main>

      {sheet === 'ingredients' && <IngredientsSheet session={session} recipe={recipe} onClose={() => setSheet(null)} />}
      {sheet === 'steps' && (
        <StepsSheet
          session={session}
          recipe={recipe}
          onClose={() => setSheet(null)}
          onJump={(i) => {
            setSheet(null);
            go(i);
          }}
        />
      )}
      {sheet === 'timer' && <QuickTimerSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

const vt = (index: number): CSSProperties => ({ viewTransitionName: `step-${index}` }) as CSSProperties;

function SideCard({
  kind,
  step,
  index,
  done,
  landscape,
  onClick,
}: {
  kind: 'prev' | 'next';
  step: Step;
  index: number;
  done: boolean;
  landscape: boolean;
  onClick: () => void;
}) {
  const timer = step.timer ? formatTimerLength(step.timer.seconds, step.timer.maxSeconds) : null;
  const label = kind === 'prev' ? 'Previous' : 'Next';
  return (
    <button
      className={`card card-side card-${kind}${done ? ' is-done' : ''}`}
      style={vt(index)}
      onClick={onClick}
      aria-label={`${label} step: ${step.title}${done ? ', done' : ''}. Go to this step.`}
    >
      {landscape ? (
        <>
          <span className="side-label">
            {done && <Icon name="check" size={20} />}
            {label}
          </span>
          <span className="side-title">
            {index + 1}. {step.title}
          </span>
          <span className="side-text">{step.text}</span>
          {kind === 'next' && timer && (
            <span className="side-timer">
              <Icon name="timer" size={18} />
              {timer}
            </span>
          )}
        </>
      ) : (
        <span className="side-row">
          {done ? <Icon name="check" size={22} /> : null}
          <span className="side-row-text">
            {kind === 'next' ? 'Next: ' : ''}
            <strong>
              {index + 1}. {step.title}
            </strong>
            {kind === 'next' && timer ? ` · ${timer}` : ''}
          </span>
        </span>
      )}
    </button>
  );
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

function CurrentCard({
  session,
  recipe,
  step,
  index,
  onDone,
}: {
  session: CookSession;
  recipe: Recipe;
  step: Step;
  index: number;
  onDone: () => void;
}) {
  const ingredients = ingredientMap(recipe);
  const isDone = session.done.includes(step.id);
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [step.id]);

  // Show a "More" hint while part of the step is scrolled out of view.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 12);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(el);
    Array.from(el.children).forEach((child) => observer.observe(child));
    return () => {
      el.removeEventListener('scroll', check);
      observer.disconnect();
    };
  }, [step.id]);

  return (
    <article className={`card card-current${isDone ? ' is-done' : ''}`} style={vt(index)} aria-labelledby="current-step-title">
      <div className="card-body" ref={body}>
        <h2 className="step-title" id="current-step-title">
          {index + 1}. {step.title}
          {isDone && (
            <span className="done-badge">
              <Icon name="check" size={16} /> Done
            </span>
          )}
        </h2>
        <p className="step-text">{step.text}</p>
        {!!step.uses?.length && (
          <div className="needs">
            <h3 className="needs-label">You’ll need</h3>
            <ul className="chips">
              {step.uses.map((use, i) => (
                <li key={`${use.ingredient}-${i}`} className="chip">
                  {useLabel(use, ingredients)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {step.cue && (
          <p className="cue">
            <Icon name="eye" />
            <span>
              <strong>Done when:</strong> {lowerFirst(step.cue)}
            </span>
          </p>
        )}
        {step.tip && (
          <p className="tip">
            <Icon name="bulb" />
            <span>{step.tip}</span>
          </p>
        )}
        <TimerControl session={session} step={step} />
      </div>
      <div className={`card-footer${more ? ' has-more' : ''}`}>
        {more && (
          <button
            className="btn more-hint"
            onClick={() => body.current?.scrollBy({ top: body.current.clientHeight * 0.7, behavior: 'smooth' })}
            aria-label="Scroll down for the rest of this step"
          >
            More
            <Icon name="back" size={20} className="icon-down" />
          </button>
        )}
        <button className="btn btn-done" onClick={onDone}>
          <Icon name="check" size={32} />
          Done
        </button>
      </div>
    </article>
  );
}

export function IngredientList({
  recipe,
  gathered,
  onToggle,
}: {
  recipe: Recipe;
  gathered: string[];
  onToggle: (id: string) => void;
}) {
  const ingredients = recipe.ingredients ?? [];
  if (!ingredients.length) return <p className="muted">This recipe has no ingredient list.</p>;
  const groups = groupIngredients(ingredients);
  return (
    <div className="ingredient-groups">
      {groups.map((g) => (
        <section key={g.group || '_'} className="ingredient-group">
          {groups.length > 1 && <h3 className="group-title">{g.group || 'Other'}</h3>}
          <ul className="checklist">
            {g.items.map((ing) => {
              const checked = gathered.includes(ing.id);
              return (
                <li key={ing.id}>
                  <label className={`check-row${checked ? ' is-checked' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => onToggle(ing.id)} />
                    <span className="check-box" aria-hidden="true">
                      <Icon name="check" size={22} />
                    </span>
                    <span className="check-text">
                      <span className="check-main">{ingredientLabel(ing)}</span>
                      {ing.note && <span className="check-note">{ing.note}</span>}
                      {ing.original && <span className="check-original">Recipe: {ing.original}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function IngredientsSheet({ session, recipe, onClose }: { session: CookSession; recipe: Recipe; onClose: () => void }) {
  return (
    <Sheet title="Ingredients" onClose={onClose}>
      <IngredientList recipe={recipe} gathered={session.gathered} onToggle={(id) => updateSession((s) => toggleGathered(s, id, Date.now()))} />
    </Sheet>
  );
}

function StepsSheet({
  session,
  recipe,
  onClose,
  onJump,
}: {
  session: CookSession;
  recipe: Recipe;
  onClose: () => void;
  onJump: (index: number) => void;
}) {
  const current = useRef<HTMLLIElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'center' });
  }, []);
  let lastSection: string | undefined;
  return (
    <Sheet title="Steps" onClose={onClose}>
      <ol className="step-list">
        {recipe.steps.map((step, i) => {
          const done = session.done.includes(step.id);
          const isCurrent = i === session.currentIndex;
          const heading = step.section && step.section !== lastSection ? step.section : null;
          lastSection = step.section ?? lastSection;
          return (
            <li key={step.id} ref={isCurrent ? current : undefined}>
              {heading && <h3 className="group-title">{heading}</h3>}
              <div className={`step-row${isCurrent ? ' is-current' : ''}${done ? ' is-done' : ''}`}>
                <button
                  className={`check-button${done ? ' is-checked' : ''}`}
                  onClick={() => updateSession((s) => toggleStepDone(s, step.id, Date.now()))}
                  aria-pressed={done}
                  aria-label={`${done ? 'Untick' : 'Tick'} step ${i + 1}, ${step.title}`}
                >
                  <Icon name="check" size={22} />
                </button>
                <button className="step-row-main" onClick={() => onJump(i)}>
                  <span className="step-row-title">
                    {i + 1}. {step.title}
                    {isCurrent && <span className="current-badge">Now</span>}
                  </span>
                  <span className="step-row-text">{step.text}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}
