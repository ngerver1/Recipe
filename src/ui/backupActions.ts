import { buildBackup, planRestore, readBackup } from '../core/backup';
import { getState, putRecords } from '../state/store';
import { showToast } from './components/overlays';

function backupFile(): File {
  const records = getState().recipes.map((r) => r.record);
  const json = JSON.stringify(buildBackup(records, Date.now()), null, 2);
  const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  return new File([json], `recipe-cards-backup-${date}.json`, { type: 'application/json' });
}

export function canShareFiles(): boolean {
  try {
    const probe = new File(['{}'], 'probe.json', { type: 'application/json' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Downloads the backup (best on the Pixel and desktop). */
export function downloadBackup(): void {
  const file = backupFile();
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  showToast(`Saved ${file.name}`);
}

/** Opens the share sheet with the backup (best on the iPad: choose Save to Files). */
export async function shareBackup(): Promise<void> {
  const file = backupFile();
  try {
    await navigator.share({ files: [file], title: 'Recipe Cards backup' });
  } catch (error) {
    if ((error as Error).name !== 'AbortError') downloadBackup();
  }
}

/** Restores a backup without losing anything already on this device. */
export async function restoreBackup(value: unknown): Promise<boolean> {
  const read = readBackup(value, Date.now());
  if (!read.ok) {
    showToast(read.error, { durationMs: 6000 });
    return false;
  }
  const plan = planRestore(
    getState().recipes.map((r) => r.record),
    read.records,
  );
  if (plan.put.length) await putRecords(plan.put);
  const parts = [
    plan.added && `${plan.added} added`,
    plan.updated && `${plan.updated} updated`,
    plan.unchanged && `${plan.unchanged} already here`,
    read.skipped.length && `${read.skipped.length} couldn’t be read`,
  ].filter(Boolean);
  showToast(`Backup restored: ${parts.join(', ') || 'nothing in it'}.`, { durationMs: 6000 });
  return true;
}
