import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatAgo, formatClock, formatTimerLength, parseTimerInput } from '../../core/format';
import { addQuickTimer, draftSeconds, setDraft, setTimers, startStepTimer, timerForStep, updateTimer, type CookSession } from '../../core/session';
import type { Step } from '../../core/schema';
import {
  finishedWhileAwayMs,
  isFinished,
  isPaused,
  noticeFinished,
  ringingTimers,
  shouldChime,
  sortForTray,
  timeLeft,
  type Timer,
} from '../../core/timers';
import { isAudioReady, startChime, stopChime, unlockAudio } from '../../platform/audio';
import { getState, updateSession, useAppState } from '../../state/store';
import { newId, useNow, useVisible } from '../hooks';
import { Icon } from './Icon';
import { Sheet } from './overlays';

const act = (timerId: string, action: Parameters<typeof updateTimer>[2]) => {
  unlockAudio();
  updateSession((s) => updateTimer(s, timerId, action, Date.now()));
};

/**
 * Watches every timer, wherever you are in the app: marks finished ones as
 * noticed (only while the app is visible, so anything that finished in the
 * background rings on return), runs the chime for up to 2 minutes, and shows
 * the full-width "Rice is done" banner until Stop or +1 min.
 */
export function TimerAlerts() {
  const { session } = useAppState();
  const timers = session?.timers ?? [];
  const visible = useVisible();
  const now = useNow(250, timers.length > 0);

  useEffect(() => {
    if (!visible || !timers.length) return;
    const result = noticeFinished(timers, Date.now());
    if (result.newlyFinished.length) updateSession((s) => setTimers(s, noticeFinished(s.timers, Date.now()).timers, Date.now()));
  }, [now, visible, timers]);

  const chime = visible && shouldChime(timers, now);
  useEffect(() => {
    if (chime) startChime();
    else stopChime();
  }, [chime]);
  useEffect(() => () => stopChime(), []);

  // A cook is on: make sure the next tap anywhere re-enables sound if the system suspended it.
  // (click/touchend, not pointerdown: browsers only accept those as permission to play sound.)
  const cooking = !!session;
  useEffect(() => {
    if (!cooking) return;
    const onTap = () => {
      if (!isAudioReady()) unlockAudio();
    };
    document.addEventListener('click', onTap, true);
    document.addEventListener('touchend', onTap, true);
    return () => {
      document.removeEventListener('click', onTap, true);
      document.removeEventListener('touchend', onTap, true);
    };
  }, [cooking]);

  const ringing = ringingTimers(timers, now);
  if (!ringing.length) return null;
  return (
    <div className="alarm-stack" role="alert">
      {ringing.map((t) => {
        const away = finishedWhileAwayMs(t) > 15_000;
        return (
          <div className="alarm" key={t.id}>
            <div className="alarm-text">
              <Icon name="timer" size={36} />
              <div>
                <p className="alarm-title">{t.label} is done</p>
                {away && t.endsAt !== null && <p className="alarm-sub">Finished {formatAgo(now - t.endsAt)}</p>}
              </div>
            </div>
            <div className="alarm-actions">
              <button className="btn btn-alarm-secondary" onClick={() => act(t.id, 'addMinute')}>
                +1 min
              </button>
              <button className="btn btn-alarm" onClick={() => act(t.id, 'remove')}>
                Stop
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The running timers, each with pause/resume, +1 min and cancel. Nothing when there are none. */
export function TimerTray({ session }: { session: CookSession }) {
  const now = useNow(250, session.timers.length > 0);
  if (!session.timers.length) return null;
  const timers = sortForTray(session.timers, now);
  return (
    <div className="tray" aria-label="Timers">
      {timers.map((t) => (
        <TrayItem key={t.id} timer={t} now={now} />
      ))}
    </div>
  );
}

function TrayItem({ timer, now }: { timer: Timer; now: number }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirming]);

  const finished = isFinished(timer, now);
  const paused = isPaused(timer);
  return (
    <div className={`tray-item${finished ? ' is-ringing' : ''}${paused ? ' is-paused' : ''}`}>
      <div className="tray-time">
        <span className="tray-label">{timer.label}</span>
        <span className="tray-clock">{finished ? 'Done' : formatClock(timeLeft(timer, now))}</span>
      </div>
      {finished ? (
        <button className="btn btn-icon tray-btn" onClick={() => act(timer.id, 'remove')} aria-label={`Stop ${timer.label}`}>
          <Icon name="x" />
        </button>
      ) : (
        <button
          className="btn btn-icon tray-btn"
          onClick={() => act(timer.id, paused ? 'resume' : 'pause')}
          aria-label={`${paused ? 'Resume' : 'Pause'} ${timer.label}`}
        >
          <Icon name={paused ? 'play' : 'pause'} />
        </button>
      )}
      <button className="btn tray-btn tray-plus" onClick={() => act(timer.id, 'addMinute')} aria-label={`Add a minute to ${timer.label}`}>
        +1
      </button>
      {!finished &&
        (confirming ? (
          <button className="btn tray-btn tray-cancel-confirm" onClick={() => act(timer.id, 'remove')}>
            Cancel?
          </button>
        ) : (
          <button className="btn btn-icon tray-btn" onClick={() => setConfirming(true)} aria-label={`Cancel ${timer.label}`}>
            <Icon name="trash" />
          </button>
        ))}
    </div>
  );
}

/** The timer on a step card: set up and Start, or the live countdown once it's running. */
export function TimerControl({ session, step }: { session: CookSession; step: Step }) {
  const timer = timerForStep(session, step.id);
  const now = useNow(250, !!timer);
  if (!step.timer) return null;

  const meta = (
    <p className="timer-meta">
      <Icon name="timer" size={22} />
      <span>{step.timer.label}</span>
      {step.timer.maxSeconds && <span>· Recipe says {formatTimerLength(step.timer.seconds, step.timer.maxSeconds)}</span>}
      {step.timer.background && <span className="timer-background">· Carry on while this runs</span>}
    </p>
  );

  if (timer) {
    const finished = isFinished(timer, now);
    const paused = isPaused(timer);
    return (
      <section className={`timer-control${finished ? ' is-ringing' : ' is-running'}`} aria-label="Timer">
        {meta}
        <div className="timer-row">
          <span className="timer-clock" aria-live="off">
            {finished ? 'Done' : formatClock(timeLeft(timer, now))}
          </span>
          <div className="timer-buttons">
            {finished ? (
              <button className="btn btn-timer" onClick={() => act(timer.id, 'remove')}>
                Stop
              </button>
            ) : (
              <button className="btn btn-timer" onClick={() => act(timer.id, paused ? 'resume' : 'pause')}>
                <Icon name={paused ? 'play' : 'pause'} />
                {paused ? 'Resume' : 'Pause'}
              </button>
            )}
            <button className="btn btn-timer-secondary" onClick={() => act(timer.id, 'addMinute')}>
              +1 min
            </button>
          </div>
        </div>
        <p className="timer-hint">{finished ? 'Time’s up.' : paused ? 'Paused.' : 'Running. Also shown at the top.'}</p>
      </section>
    );
  }

  return <TimerSetup session={session} step={step} meta={meta} />;
}

function TimerSetup({ session, step, meta }: { session: CookSession; step: Step; meta: ReactNode }) {
  const seconds = draftSeconds(session, step) ?? 60;
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const set = (next: number) => updateSession((s) => setDraft(s, step.id, next, Date.now()));
  const commit = () => {
    const parsed = parseTimerInput(input.current?.value ?? '');
    if (parsed) set(parsed);
    setEditing(false);
  };
  const start = () => {
    unlockAudio();
    updateSession((s) => startStepTimer(s, step, newId(), Date.now()));
  };

  return (
    <section className="timer-control" aria-label="Timer">
      {meta}
      <div className="timer-row">
        <div className="timer-adjust">
          <button className="btn btn-timer-secondary" onClick={() => set(seconds - 60)} disabled={seconds <= 60} aria-label="One minute less">
            −1 min
          </button>
          {editing ? (
            <form
              className="timer-edit"
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
            >
              <label className="visually-hidden" htmlFor={`timer-${step.id}`}>
                Minutes
              </label>
              <input
                id={`timer-${step.id}`}
                ref={input}
                className="timer-input"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                defaultValue={String(Math.round((seconds / 60) * 100) / 100)}
                onBlur={commit}
              />
              <span className="timer-input-unit">min</span>
            </form>
          ) : (
            <button className="timer-clock timer-clock-button" onClick={() => setEditing(true)} aria-label={`${formatClock(seconds * 1000)}. Tap to type minutes`}>
              {formatClock(seconds * 1000)}
            </button>
          )}
          <button className="btn btn-timer-secondary" onClick={() => set(seconds + 60)} aria-label="One minute more">
            +1 min
          </button>
        </div>
        <button className="btn btn-timer btn-timer-start" onClick={start}>
          <Icon name="play" />
          Start
        </button>
      </div>
    </section>
  );
}

const PRESETS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60];

/** "+ Timer": a quick timer that isn't tied to a step. */
export function QuickTimerSheet({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');

  const start = (seconds: number) => {
    unlockAudio();
    if (!getState().session) return;
    updateSession((s) => addQuickTimer(s, label, seconds, newId(), Date.now()));
    onClose();
  };

  return (
    <Sheet title="New timer" onClose={onClose}>
      <label className="field">
        <span className="field-label">Name (optional)</span>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Timer" autoComplete="off" />
      </label>
      <p className="field-label">Start a timer for</p>
      <div className="preset-grid">
        {PRESETS.map((m) => (
          <button key={m} className="btn btn-preset" onClick={() => start(m * 60)}>
            {m} min
          </button>
        ))}
      </div>
      <form
        className="custom-timer"
        onSubmit={(e) => {
          e.preventDefault();
          const seconds = parseTimerInput(custom);
          if (seconds) start(seconds);
          else setError('Type minutes, like 7 or 7.5, or minutes and seconds, like 7:30.');
        }}
      >
        <label className="field">
          <span className="field-label">Or type minutes</span>
          <input
            className="input"
            inputMode="decimal"
            enterKeyHint="go"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setError('');
            }}
            placeholder="e.g. 7 or 7:30"
            autoComplete="off"
          />
        </label>
        <button className="btn btn-primary" type="submit">
          Start
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </Sheet>
  );
}
