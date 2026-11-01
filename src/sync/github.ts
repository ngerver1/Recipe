import { decodeBase64Utf8, encodeBase64Utf8 } from '../core/base64';
import { readSyncFile, SyncError, type LibraryState, type SyncFile } from '../core/sync';

/**
 * The shared library file, kept in a private GitHub repository through
 * GitHub's REST API. Each write carries the version (sha) it was based on,
 * so GitHub refuses it if another device wrote in between.
 */

export interface GitHubConfig {
  /** "owner/name" */
  repo: string;
  token: string;
}

const API = 'https://api.github.com';
export const SYNC_PATH = 'recipe-cards-library.json';

async function call(config: GitHubConfig, path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
  try {
    return await fetch(`${API}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { Accept: accept, Authorization: `Bearer ${config.token.trim()}`, ...(init.headers ?? {}) },
    });
  } catch {
    throw new SyncError('Can’t reach GitHub. It will sync when you’re back online.', 'offline');
  }
}

async function failure(res: Response, config: GitHubConfig): Promise<SyncError> {
  let message = '';
  try {
    message = String(((await res.json()) as { message?: unknown }).message ?? '');
  } catch {
    // no body
  }
  if (res.status === 401) {
    return new SyncError('GitHub didn’t accept the sync key. It may have expired: make a new one and paste it in Settings → Sync.', 'auth');
  }
  if (res.status === 404) {
    return new SyncError(`Can’t find ${config.repo}, or the sync key doesn’t have access to it.`, 'access');
  }
  if (res.status === 403 && /rate limit/i.test(message)) {
    return new SyncError('GitHub is limiting requests right now. It will try again shortly.', 'offline');
  }
  if (res.status === 403) {
    return new SyncError(`The sync key can’t write to ${config.repo}. It needs “Contents: Read and write”.`, 'access');
  }
  if (res.status === 409 || (res.status === 422 && /sha/i.test(message))) {
    return new SyncError('Another device saved at the same moment.', 'conflict');
  }
  if (res.status >= 500) return new SyncError('GitHub is having trouble right now. It will try again shortly.', 'offline');
  return new SyncError(`GitHub said: ${message || res.statusText || res.status}`, 'other');
}

const repoPath = (config: GitHubConfig) => `/repos/${config.repo.split('/').map(encodeURIComponent).join('/')}`;

export function isRepoName(repo: string): boolean {
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo.trim());
}

/** Checks the key and the repository before turning sync on. */
export async function checkRepository(config: GitHubConfig): Promise<{ private: boolean }> {
  const res = await call(config, repoPath(config));
  if (!res.ok) throw await failure(res, config);
  const repo = (await res.json()) as { private?: boolean };
  return { private: repo.private === true };
}

export async function fetchLibrary(config: GitHubConfig): Promise<{ library: LibraryState | null; version: string | null }> {
  const url = `${repoPath(config)}/contents/${SYNC_PATH}`;
  const res = await call(config, url);
  if (res.status === 404) return { library: null, version: null };
  if (!res.ok) throw await failure(res, config);
  const meta = (await res.json()) as { sha: string; content?: string; encoding?: string };
  let text: string;
  if (meta.encoding === 'base64' && meta.content) {
    text = decodeBase64Utf8(meta.content);
  } else {
    // Files over 1 MB come without content; fetch them raw.
    const raw = await call(config, url, {}, 'application/vnd.github.raw+json');
    if (!raw.ok) throw await failure(raw, config);
    text = await raw.text();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SyncError('The sync file on GitHub is damaged, so it was left alone.', 'file');
  }
  return { library: readSyncFile(parsed), version: meta.sha };
}

export async function saveLibrary(config: GitHubConfig, file: SyncFile, version: string | null, device: string): Promise<void> {
  const res = await call(config, `${repoPath(config)}/contents/${SYNC_PATH}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Sync from ${device}: ${file.recipes.length} recipe${file.recipes.length === 1 ? '' : 's'}`,
      content: encodeBase64Utf8(JSON.stringify(file)),
      ...(version ? { sha: version } : {}),
    }),
  });
  if (!res.ok) throw await failure(res, config);
}
