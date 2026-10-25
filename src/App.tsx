import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { isFinished, isRunning } from './core/timers';
import { useKeepAwake } from './platform/keepAwake';
import { useAppState } from './state/store';
import { DialogHost, ToastHost } from './ui/components/overlays';
import { TimerAlerts } from './ui/components/timers';
import { useNow } from './ui/hooks';
import { setPendingImport } from './ui/pendingImport';
import { navigate, useRoute } from './ui/router';
import { CookScreen } from './ui/screens/Cook';
import { FinishedScreen } from './ui/screens/Finished';
import { ImportScreen } from './ui/screens/Import';
import { LibraryScreen } from './ui/screens/Library';
import { PrepScreen } from './ui/screens/Prep';
import { SettingsScreen } from './ui/screens/Settings';

export function App() {
  const route = useRoute();
  const { loaded, session } = useAppState();
  const {
    needRefresh: [updateReady],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  const update = () => void updateServiceWorker(true);

  // Launching the app (from the Home Screen icon, so no #route yet) mid-cook goes straight back to where you were.
  const booted = useRef(false);
  useEffect(() => {
    if (!loaded || booted.current) return;
    booted.current = true;
    if (session && (location.hash === '' || location.hash === '#')) {
      navigate({ name: session.stage === 'finished' ? 'finished' : 'cook' }, { replace: true });
    }
  }, [loaded, session, route.name]);

  // Keep the screen on while preparing or cooking, and whenever a timer is going.
  const now = useNow(5000, !!session?.timers.length);
  const timerGoing = !!session?.timers.some((t) => isRunning(t, now) || isFinished(t, now));
  useKeepAwake(route.name === 'recipe' || route.name === 'cook' || route.name === 'finished' || timerGoing);

  // Drag and drop a .json file anywhere (desktop).
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      setPendingImport(await file.text(), file.name);
      navigate({ name: 'import' });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  let screen;
  switch (route.name) {
    case 'import':
      screen = <ImportScreen />;
      break;
    case 'recipe':
      screen = <PrepScreen key={route.id} id={route.id} />;
      break;
    case 'cook':
      screen = <CookScreen />;
      break;
    case 'finished':
      screen = <FinishedScreen />;
      break;
    case 'settings':
      screen = <SettingsScreen updateReady={updateReady} onUpdate={update} />;
      break;
    default:
      screen = <LibraryScreen updateReady={updateReady} onUpdate={update} />;
  }

  return (
    <>
      {screen}
      <TimerAlerts />
      <DialogHost />
      <ToastHost />
    </>
  );
}
