import { describe, expect, it } from 'vitest';
import curry from '../../examples/green-curry.json';
import loaf from '../../examples/overnight-loaf.json';
import roast from '../../examples/sunday-roast.json';
import stew from '../../examples/pressure-cooker-beef-stew.json';
import { decodeBase64Utf8, encodeBase64Utf8 } from './base64';
import { dedupeKey, type RecipeRecord } from './library';
import {
  EMPTY_LIBRARY,
  mergeLibraries,
  readSyncFile,
  SyncError,
  syncOnce,
  toSyncFile,
  type LibraryState,
  type SyncFile,
  type SyncIO,
} from './sync';
import { validateRecipe } from './validate';

const key = (raw: unknown) => {
  const r = validateRecipe(raw);
  if (!r.ok) throw new Error('invalid');
  return dedupeKey(r.recipe);
};
const rec = (id: string, raw: unknown, at: number, extra: Partial<RecipeRecord> = {}): RecipeRecord => ({
  id,
  raw,
  importedAt: at,
  dedupeKey: key(raw),
  ...extra,
});
const lib = (records: RecipeRecord[], tombstones: LibraryState['tombstones'] = []): LibraryState => ({ records, tombstones });
const ids = (l: LibraryState) => l.records.map((r) => r.id).sort();

describe('mergeLibraries', () => {
  it('keeps recipes added on either side', () => {
    const m = mergeLibraries(lib([rec('a', curry, 1)]), lib([rec('b', stew, 2)]));
    expect(ids(m)).toEqual(['a', 'b']);
    expect(m.changedLocal).toBe(true);
    expect(m.changedRemote).toBe(true);
  });

  it('reports no change when both sides already match', () => {
    const both = lib([rec('a', curry, 1), rec('b', stew, 2)]);
    const m = mergeLibraries(both, structuredClone(both));
    expect(m.changedLocal).toBe(false);
    expect(m.changedRemote).toBe(false);
  });

  it('pushes a first library into an empty shared file', () => {
    const m = mergeLibraries(lib([rec('a', curry, 1)]), EMPTY_LIBRARY);
    expect(m.changedLocal).toBe(false);
    expect(m.changedRemote).toBe(true);
  });

  it('takes the later change to the same recipe, and the later cooked date', () => {
    const edited = { ...structuredClone(curry), title: 'Green chicken curry (v2)' };
    const local = lib([rec('a', curry, 1, { lastCookedAt: 500 })]);
    const remote = lib([rec('a', edited, 1, { updatedAt: 100, lastCookedAt: 300 })]);
    const m = mergeLibraries(local, remote);
    expect(m.records[0]!.raw).toEqual(edited);
    expect(m.records[0]!.lastCookedAt).toBe(500);
    expect(m.changedLocal).toBe(true);
    expect(m.changedRemote).toBe(true); // the shared file needs the later cooked date
  });

  it('remembers deletions so a recipe does not come back', () => {
    const local = lib([], [{ id: 'a', deletedAt: 50 }]);
    const remote = lib([rec('a', curry, 1), rec('b', stew, 2)]);
    const m = mergeLibraries(local, remote);
    expect(ids(m)).toEqual(['b']);
    expect(m.tombstones).toEqual([{ id: 'a', deletedAt: 50 }]);
    expect(m.changedRemote).toBe(true);
  });

  it('brings a recipe back if it was replaced after the deletion', () => {
    const m = mergeLibraries(lib([], [{ id: 'a', deletedAt: 50 }]), lib([rec('a', curry, 1, { updatedAt: 80 })]));
    expect(ids(m)).toEqual(['a']);
  });

  it('folds the same recipe imported on two devices into one, keeping the first import', () => {
    const m = mergeLibraries(lib([rec('ipad-1', curry, 10, { lastCookedAt: 900 })]), lib([rec('pixel-1', curry, 20)]));
    expect(ids(m)).toEqual(['ipad-1']);
    expect(m.records[0]!.lastCookedAt).toBe(900);
    expect(m.tombstones).toEqual([{ id: 'pixel-1', deletedAt: 20 }]);
  });

  it('keeps both when the same source was converted differently', () => {
    const other = { ...structuredClone(curry), notes: 'A different conversion.' };
    const m = mergeLibraries(lib([rec('x', curry, 10)]), lib([rec('y', other, 20)]));
    expect(ids(m)).toEqual(['x', 'y']);
  });

  it('gives the same answer on both devices', () => {
    const a = lib([rec('a', curry, 1), rec('c', roast, 3, { lastCookedAt: 9 })], [{ id: 'z', deletedAt: 4 }]);
    const b = lib([rec('b', stew, 2), rec('c', roast, 3), rec('d', curry, 5)]);
    const ab = mergeLibraries(a, b);
    const ba = mergeLibraries(b, a);
    expect(ab.records).toEqual(ba.records);
    expect(ab.tombstones).toEqual(ba.tombstones);
  });
});

describe('sync file', () => {
  it('round-trips through JSON and base64, accents included', () => {
    const library = lib([rec('a', stew, 1, { updatedAt: 2, lastCookedAt: 3 })], [{ id: 'b', deletedAt: 4 }]);
    const text = JSON.stringify(toSyncFile(library, 0));
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
    expect(readSyncFile(JSON.parse(text))).toEqual(library);
    expect(text).toContain('López');
  });

  it('refuses a file it does not understand rather than overwrite it', () => {
    expect(() => readSyncFile({ hello: 'world' })).toThrow(SyncError);
    expect(() => readSyncFile({ format: 'recipe-cards-sync', version: 2 })).toThrow(/newer version/);
  });

  it('skips damaged entries', () => {
    const file = { ...toSyncFile(lib([rec('a', curry, 1)]), 0), recipes: [rec('a', curry, 1), { id: 5 }, null] };
    expect(ids(readSyncFile(file))).toEqual(['a']);
  });
});

/** An in-memory stand-in for the shared file on GitHub, with version checks like GitHub's. */
function fakeRemote() {
  const remote = { file: null as SyncFile | null, version: 0, writes: 0, interfere: null as null | (() => void) };
  return remote;
}

function device(remote: ReturnType<typeof fakeRemote>, initial: LibraryState) {
  let local = structuredClone(initial);
  let clock = 1000;
  const io: SyncIO = {
    loadLocal: async () => structuredClone(local),
    applyLocal: async (next) => {
      local = structuredClone({ records: next.records, tombstones: next.tombstones });
    },
    fetchRemote: async () => ({
      library: remote.file ? readSyncFile(structuredClone(remote.file)) : null,
      version: remote.file ? String(remote.version) : null,
    }),
    putRemote: async (file, version) => {
      if (remote.interfere) {
        const interfere = remote.interfere;
        remote.interfere = null;
        interfere();
      }
      if ((remote.file ? String(remote.version) : null) !== version) throw new SyncError('stale', 'conflict');
      remote.file = structuredClone(file);
      remote.version++;
      remote.writes++;
    },
    now: () => clock++,
  };
  return {
    io,
    get local() {
      return local;
    },
    set local(next: LibraryState) {
      local = next;
    },
  };
}

describe('syncOnce: two devices', () => {
  it('ends with the same library on the iPad and the Pixel', async () => {
    const remote = fakeRemote();
    const ipad = device(remote, lib([rec('a', curry, 1), rec('shared-ipad', stew, 5)]));
    const pixel = device(remote, lib([rec('b', roast, 2), rec('shared-pixel', stew, 6)]));

    expect(await syncOnce(ipad.io)).toEqual({ pulled: false, pushed: true });
    expect(await syncOnce(pixel.io)).toEqual({ pulled: true, pushed: true });
    expect(await syncOnce(ipad.io)).toEqual({ pulled: true, pushed: false });

    expect(ids(ipad.local)).toEqual(['a', 'b', 'shared-ipad']);
    expect(ipad.local.records).toEqual(pixel.local.records);
    expect(await syncOnce(pixel.io)).toEqual({ pulled: false, pushed: false });
  });

  it('carries a deletion across', async () => {
    const remote = fakeRemote();
    const ipad = device(remote, lib([rec('a', curry, 1), rec('b', loaf, 2)]));
    const pixel = device(remote, EMPTY_LIBRARY);
    await syncOnce(ipad.io);
    await syncOnce(pixel.io);
    pixel.local = { records: pixel.local.records.filter((r) => r.id !== 'b'), tombstones: [{ id: 'b', deletedAt: 5000 }] };
    await syncOnce(pixel.io);
    await syncOnce(ipad.io);
    expect(ids(ipad.local)).toEqual(['a']);
  });

  it('retries when the other device writes in between', async () => {
    const remote = fakeRemote();
    const ipad = device(remote, lib([rec('a', curry, 1)]));
    const pixel = device(remote, lib([rec('b', stew, 2)]));
    await syncOnce(ipad.io);
    // Between the Pixel reading the shared file and writing it, the iPad adds a recipe and writes first.
    remote.interfere = () => {
      ipad.local = { ...ipad.local, records: [...ipad.local.records, rec('c', roast, 3)] };
      const current = readSyncFile(remote.file);
      remote.file = toSyncFile({ ...current, records: [...current.records, rec('c', roast, 3)] }, 0);
      remote.version++;
    };
    const writesBefore = remote.writes;
    expect(await syncOnce(pixel.io)).toEqual({ pulled: true, pushed: true });
    expect(remote.writes).toBe(writesBefore + 1); // the first write was refused, the retry went through
    await syncOnce(ipad.io);
    expect(ids(pixel.local)).toEqual(['a', 'b', 'c']);
    expect(ids(ipad.local)).toEqual(['a', 'b', 'c']);
  });

  it('gives up after repeated conflicts', async () => {
    const remote = fakeRemote();
    const ipad = device(remote, lib([rec('a', curry, 1)]));
    const io: SyncIO = { ...ipad.io, putRemote: async () => Promise.reject(new SyncError('stale', 'conflict')) };
    await expect(syncOnce(io, 3)).rejects.toThrow('stale');
  });
});
